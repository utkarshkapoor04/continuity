import { afterEach, describe, expect, it, vi } from "vitest";
import { BANK_MISS, finalizeBank, MAX_BANK_ENTRIES, MAX_SENT, parseBank, rankEntries } from "../lib/bank";
import type { BankEntry } from "../lib/bank";
import { parseBankAnswer } from "../lib/validate";
import { POST } from "../app/api/bank/route";

const SAMPLE = `Q: Who can unlock the ledger after WD3?
A: Only the Controller, through an ERP ticket.
By: Meera, Finance Controller
Date: 19 Aug 2026

Q: Where is the Close folder?
A: On the shared finance drive,
under Close, then the year and month.
By: Rohan, FP&A analyst
Date: 15 May 2026`;

const entry = (n: number, over: Partial<BankEntry> = {}): BankEntry => ({
  id: `B${n}`, question: `question ${n}`, answer: `answer ${n}`, by: "", date: "", ...over,
});

describe("parsing the question bank", () => {
  it("reads question, answer, who and when, and numbers entries B1, B2", () => {
    const { entries, skipped } = parseBank(SAMPLE);
    expect(skipped).toBe(0);
    expect(entries.map((e) => e.id)).toEqual(["B1", "B2"]);
    expect(entries[0]).toEqual({ id: "B1", question: "Who can unlock the ledger after WD3?", answer: "Only the Controller, through an ERP ticket.", by: "Meera, Finance Controller", date: "19 Aug 2026" });
  });
  it("joins an answer that continues on the next line", () => {
    expect(parseBank(SAMPLE).entries[1].answer).toBe("On the shared finance drive, under Close, then the year and month.");
  });
  it("accepts Windows line endings and long labels", () => {
    const { entries } = parseBank("Question: Hi?\r\nAnswer: Hello.\r\nAnswered by: Sam\r\nWhen: today");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ question: "Hi?", answer: "Hello.", by: "Sam", date: "today" });
  });
  it("skips entries missing a question or an answer, but ignores plain headings", () => {
    const { entries, skipped } = parseBank("# Finance FAQ\n\nQ: No answer here\n\nA: No question here\n\nQ: Ok?\nA: Yes.");
    expect(entries.map((e) => e.question)).toEqual(["Ok?"]);
    expect(skipped).toBe(2);
  });
  it("returns nothing for empty text and caps the number of entries", () => {
    expect(parseBank("   ")).toEqual({ entries: [], skipped: 0 });
    const many = Array.from({ length: MAX_BANK_ENTRIES + 5 }, (_, i) => `Q: q${i}?\nA: a${i}.`).join("\n\n");
    const r = parseBank(many);
    expect(r.entries).toHaveLength(MAX_BANK_ENTRIES);
    expect(r.skipped).toBe(5);
  });
});

describe("choosing which entries go to the AI", () => {
  it("sends everything when the bank is small", () => {
    const small = [entry(1), entry(2)];
    expect(rankEntries("anything", small)).toEqual(small);
  });
  it("keeps the entries that share the most words with the question when the bank is large", () => {
    const big = Array.from({ length: MAX_SENT + 20 }, (_, i) => entry(i + 1));
    big[55] = entry(56, { question: "How do I unlock the ledger after the lock?", answer: "Ask the Controller for a ticket." });
    const sent = rankEntries("who can unlock the ledger", big);
    expect(sent).toHaveLength(MAX_SENT);
    expect(sent[0].id).toBe("B56");
  });
});

describe("the answer the user sees", () => {
  const entries = [entry(1), entry(2)];
  it("shows exactly 'not in the bank' when the AI says nothing matches", () => {
    expect(finalizeBank({ found: false, answer: "a guess", entry_ids: ["B1"] }, entries)).toEqual({ found: false, answer: BANK_MISS, cited: [] });
    expect(BANK_MISS).toBe("not in the bank");
  });
  it("shows 'not in the bank' when it cites no real entry", () => {
    expect(finalizeBank({ found: true, answer: "made up", entry_ids: ["B9"] }, entries).answer).toBe("not in the bank");
    expect(finalizeBank({ found: true, answer: "made up", entry_ids: [] }, entries).found).toBe(false);
    expect(finalizeBank({ found: true, answer: "   ", entry_ids: ["B1"] }, entries).found).toBe(false);
  });
  it("passes through a real answer with its real entries only", () => {
    const out = finalizeBank({ found: true, answer: "Ask Meera.", entry_ids: ["B2", "B9", "B2"] }, entries);
    expect(out.found).toBe(true);
    expect(out.cited.map((e) => e.id)).toEqual(["B2"]);
  });
  it("does not trust an answer that names a person whose entry was not cited", () => {
    const people = [
      entry(1, { by: "Rohan, FP&A analyst" }),
      entry(2, { by: "Deepak, FP&A analyst" }),
      entry(3, { by: "Meera, Finance Controller" }),
    ];
    // Deepak's entry is cited, but the answer credits Rohan.
    const wrong = finalizeBank({ found: true, answer: "Rohan said always resend it.", entry_ids: ["B2"] }, people);
    expect(wrong).toEqual({ found: false, answer: BANK_MISS, cited: [] });
    // Naming the person whose entry is cited is fine, and so is naming nobody.
    expect(finalizeBank({ found: true, answer: "Deepak said always resend it.", entry_ids: ["B2"] }, people).found).toBe(true);
    expect(finalizeBank({ found: true, answer: "Always resend it.", entry_ids: ["B2"] }, people).found).toBe(true);
    // A person's name inside a longer word does not count.
    expect(finalizeBank({ found: true, answer: "Use the Meeravision tool.", entry_ids: ["B2"] }, people).found).toBe(true);
  });
  it("checks the AI's JSON shape", () => {
    expect(parseBankAnswer({ found: true, answer: "x", entry_ids: ["B1"] })).toEqual({ found: true, answer: "x", entry_ids: ["B1"] });
    expect(parseBankAnswer({ found: "yes", answer: "x", entry_ids: [] })).toBeNull();
    expect(parseBankAnswer({ found: true, answer: "x", entry_ids: [1] })).toBeNull();
  });
});

// The whole route, with a pretend Gemini.
const gemini = (json: object) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 });
const call = (body: unknown) => POST(new Request("http://x/api/bank", { method: "POST", body: JSON.stringify(body) })).then((r) => r.json());
afterEach(() => vi.unstubAllGlobals());

describe("the /api/bank route", () => {
  const entries = parseBank(SAMPLE).entries;
  it("asks for a question and a bank before calling the AI", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await call({ question: "  ", entries })).toEqual({ ok: false, message: "Type a question first." });
    expect(await call({ question: "Who?", entries: [] })).toEqual({ ok: false, message: "Load a question bank first." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("answers from the bank and returns the cited entries", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => gemini({ found: true, answer: "Meera said only the Controller can.", entry_ids: ["B1"] })));
    const out = await call({ question: "Who can unlock the ledger?", entries });
    expect(out.ok).toBe(true);
    expect(out.found).toBe(true);
    expect(out.cited.map((e: BankEntry) => e.id)).toEqual(["B1"]);
    expect(out.cited[0].by).toBe("Meera, Finance Controller");
  });
  it("returns exactly 'not in the bank' when the AI cites an entry that does not exist", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => gemini({ found: true, answer: "Invented.", entry_ids: ["B99"] })));
    const out = await call({ question: "What is the wifi password?", entries });
    expect(out).toMatchObject({ ok: true, found: false, answer: "not in the bank", cited: [] });
  });
});
