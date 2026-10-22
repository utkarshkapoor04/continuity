import { describe, expect, it } from "vitest";
import { quoteFound } from "../lib/quotes";
import { addMissingLeaverRules, annotateQuestions, finalizeAsk, mergeQuestions, openGaps, tagRules } from "../lib/sheet";
import { checkInput, parseAsk, parseSheet } from "../lib/validate";
import type { Answers, Question, Rule } from "../lib/types";

const SOP = "1. WD1: The analyst downloads the bank statements from the bank portal.\n2. WD3: The ledger is locked at the end of the third working day.";
const LOCKED = "The ledger is locked at the end of the third working day.";
const longText = "Step one do this. ".repeat(20);

const rule = (over: Partial<Rule>): Rule => ({
  id: "R1", rule: "x", source: "SOP", quote: "", question_id: null,
  conflict: false, conflict_note: "", no_contingency: false, ...over,
});

describe("input check", () => {
  it("rejects empty and short text", () => {
    expect(checkInput("")).toBe("Paste a process description");
    expect(checkInput("   a short note   ")).toBe("Paste a process description");
  });
  it("accepts a normal SOP and rejects a huge one", () => {
    expect(checkInput(longText)).toBeNull();
    expect(checkInput("x".repeat(31000))).toContain("too long");
  });
});

describe("quote check", () => {
  it("finds exact quotes, ignoring spacing, case and curly quotes", () => {
    expect(quoteFound(LOCKED, SOP)).toBe(true);
    expect(quoteFound("the  LEDGER is\nlocked at the end of the third working day.", SOP)).toBe(true);
    expect(quoteFound(`“${LOCKED}”`, SOP)).toBe(true);
  });
  it("rejects invented or empty quotes", () => {
    expect(quoteFound("The ledger is locked at midnight.", SOP)).toBe(false);
    expect(quoteFound("", SOP)).toBe(false);
  });
  it("rejects short fragments that merely appear somewhere in the source", () => {
    expect(quoteFound("the ledger", SOP)).toBe(false);
    expect(quoteFound("the bank portal", SOP)).toBe(false);
    expect(quoteFound("the ERP rate table", "Singapore statements use the ERP rate table, which updates monthly.")).toBe(false);
  });
  it("accepts a short quote when the whole source is short", () => {
    expect(quoteFound("Use the SGD rate.", "Use the SGD rate.")).toBe(true);
  });
  it("accepts a short quote only when it is a whole sentence of the source", () => {
    const src = "1. Pay vendors weekly.\n2. Urgent vendors are paid in the same week.";
    expect(quoteFound("Pay vendors weekly.", src)).toBe(true);
    expect(quoteFound("Pay vendors weekly", src)).toBe(true);
    expect(quoteFound("Pay vendors", src)).toBe(false);
  });
});

describe("keeping every leaver answer", () => {
  const qs: Question[] = [
    { id: "Q1", quote: "", question: "tolerance?", why_it_matters: "" },
    { id: "Q2", quote: "", question: "blank one", why_it_matters: "" },
  ];
  const answers: Answers = {
    Q1: { text: "Tolerance is 2% for small invoices. The Shree invoice was agreed verbally. It was a mistake.", inPerson: false },
    Q2: { text: "   ", inPerson: false },
  };
  const covering = rule({
    id: "R1", source: "leaver", question_id: "Q1", quote: "Tolerance is 2% for small invoices.",
  });
  it("adds the sentences the AI left out, word for word, with fresh ids", () => {
    const out = addMissingLeaverRules([covering], qs, answers);
    expect(out.map((r) => r.id)).toEqual(["R1", "R2", "R3"]);
    expect(out[1].quote).toBe("The Shree invoice was agreed verbally.");
    expect(out[2].quote).toBe("It was a mistake.");
    expect(out.slice(1).every((r) => r.added_as_written && r.source === "leaver" && r.question_id === "Q1")).toBe(true);
  });
  it("adds nothing for blank answers or answers already covered", () => {
    const full = rule({ id: "R1", source: "leaver", question_id: "Q1", quote: answers.Q1.text });
    expect(addMissingLeaverRules([full], qs, answers).length).toBe(1);
  });
  it("does not let a short fragment count as covering an answer", () => {
    const frag = rule({ id: "R1", source: "leaver", question_id: "Q1", quote: "2%" });
    expect(addMissingLeaverRules([frag], qs, answers).length).toBe(4);
  });
  it("added rules pass the quote check", () => {
    const out = tagRules(addMissingLeaverRules([covering], qs, answers), SOP, answers);
    expect(out.every((r) => r.source === "SOP" || r.source_found)).toBe(true);
  });
});

describe("source tagging", () => {
  const answers: Answers = { Q1: { text: "Call the bank on 1800-123 if the portal is down.", inPerson: false } };
  it("tags a rule whose quote is not in the source as source not found", () => {
    const [bad, good] = tagRules(
      [rule({ id: "R1", quote: "Approve everything in Pune by phone." }), rule({ id: "R2", quote: LOCKED })],
      SOP, answers,
    );
    expect(bad.source_found).toBe(false);
    expect(good.source_found).toBe(true);
  });
  it("checks leaver rules against that question's answer only", () => {
    const [ok, wrongQ, blank] = tagRules(
      [
        rule({ source: "leaver", question_id: "Q1", quote: "Call the bank on 1800-123 if the portal is down" }),
        rule({ source: "leaver", question_id: "Q2", quote: "Call the bank on 1800-123 if the portal is down" }),
        rule({ source: "leaver", question_id: null, quote: "anything" }),
      ],
      SOP, answers,
    );
    expect(ok.source_found).toBe(true);
    expect(wrongQ.source_found).toBe(false);
    expect(blank.source_found).toBe(false);
  });
  it("flags gap questions with invented quotes", () => {
    const qs: Question[] = [
      { id: "Q1", quote: LOCKED, question: "?", why_it_matters: "" },
      { id: "Q2", quote: "Not in the SOP at all", question: "?", why_it_matters: "" },
    ];
    expect(annotateQuestions(qs, SOP).map((q) => q.source_found)).toEqual([true, false]);
  });
});

describe("merging extra gap questions", () => {
  const q = (id: string, question: string): Question => ({ id, quote: "q", question, why_it_matters: "" });
  it("drops repeats, keeps order and renumbers from Q1", () => {
    const out = mergeQuestions([q("Q1", "A?"), q("Q2", "B?")], [q("Q1", "b?"), q("Q2", "C?"), q("Q3", "D?")]);
    expect(out.map((x) => x.question)).toEqual(["A?", "B?", "C?", "D?"]);
    expect(out.map((x) => x.id)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });
  it("never returns more than 10", () => {
    const many = Array.from({ length: 8 }, (_, i) => q(`Q${i}`, `first ${i}?`));
    const extra = Array.from({ length: 5 }, (_, i) => q(`Q${i}`, `extra ${i}?`));
    expect(mergeQuestions(many, extra).length).toBe(10);
  });
});

describe("open gaps", () => {
  const qs: Question[] = [
    { id: "Q1", quote: "", question: "a", why_it_matters: "" },
    { id: "Q2", quote: "", question: "b", why_it_matters: "" },
  ];
  it("lists every question when all answers are blank", () => {
    expect(openGaps(qs, {}).map((g) => g.id)).toEqual(["Q1", "Q2"]);
    expect(openGaps(qs, { Q1: { text: "  ", inPerson: false } }).length).toBe(2);
  });
  it("leaves answered questions out and keeps the in-person tick on blank ones", () => {
    const gaps = openGaps(qs, { Q1: { text: "done", inPerson: false }, Q2: { text: "", inPerson: true } });
    expect(gaps).toEqual([{ id: "Q2", question: "b", inPerson: true }]);
  });
});

describe("bot answer", () => {
  const rules = [rule({ id: "R1" }), rule({ id: "R2" })];
  it("shows exactly 'not captured' when the AI says not covered", () => {
    expect(finalizeAsk({ covered: false, answer: "guess", rule_ids: ["R1"] }, rules).answer).toBe("not captured");
  });
  it("shows 'not captured' when it cites no real rule", () => {
    expect(finalizeAsk({ covered: true, answer: "made up", rule_ids: ["R9"] }, rules).answer).toBe("not captured");
    expect(finalizeAsk({ covered: true, answer: "made up", rule_ids: [] }, rules).captured).toBe(false);
  });
  it("passes through a real, cited answer", () => {
    const out = finalizeAsk({ covered: true, answer: "Lock on WD3.", rule_ids: ["R2", "R9"] }, rules);
    expect(out.captured).toBe(true);
    expect(out.cited.map((r) => r.id)).toEqual(["R2"]);
  });
});

describe("AI JSON shape check", () => {
  it("rejects wrong shapes", () => {
    expect(parseSheet({ rules: [{ id: "R1" }] })).toBeNull();
    expect(parseSheet("nope")).toBeNull();
    expect(parseAsk({ covered: "yes" })).toBeNull();
  });
});
