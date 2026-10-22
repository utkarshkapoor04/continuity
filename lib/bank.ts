// The team question bank: past questions and answers between colleagues.
// It is informal knowledge from other employees, not the SOP, and it is kept apart from the rules sheet.

export type BankEntry = { id: string; question: string; answer: string; by: string; date: string };
export type BankAI = { found: boolean; answer: string; entry_ids: string[] };

export const BANK_MISS = "not in the bank";
export const MAX_BANK_ENTRIES = 200;
export const MAX_BANK_CHARS = 40000;
export const MAX_SENT = 40; // how many entries go to the AI for one question
const MAX_FIELD = 1200;

// Lines like "Q: ...", "A: ...", "By: ...", "Date: ...". Entries are separated by a blank line.
const LABEL = /^\s*(question|answered by|answer|source|from|when|date|by|q|a)\s*:\s*(.*)$/i;
type Field = "question" | "answer" | "by" | "date";

function fieldOf(label: string): Field {
  const k = label.toLowerCase();
  if (k === "q" || k === "question") return "question";
  if (k === "a" || k === "answer") return "answer";
  if (k === "date" || k === "when") return "date";
  return "by";
}

export function parseBank(text: string): { entries: BankEntry[]; skipped: number } {
  const entries: BankEntry[] = [];
  let skipped = 0;
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    const f: Record<Field, string> = { question: "", answer: "", by: "", date: "" };
    let current: Field | null = null;
    let sawLabel = false;
    for (const line of block.split("\n")) {
      const m = LABEL.exec(line);
      if (m) {
        sawLabel = true;
        current = fieldOf(m[1]);
        f[current] = m[2].trim();
      } else if (current && line.trim()) {
        f[current] += " " + line.trim(); // a long answer can continue on the next line
      }
    }
    if (!sawLabel) continue; // a heading or note, not an entry
    if (!f.question || !f.answer) { skipped++; continue; }
    if (entries.length >= MAX_BANK_ENTRIES) { skipped++; continue; }
    entries.push({
      id: `B${entries.length + 1}`,
      question: f.question.slice(0, MAX_FIELD),
      answer: f.answer.slice(0, MAX_FIELD),
      by: f.by.slice(0, 200),
      date: f.date.slice(0, 60),
    });
  }
  return { entries, skipped };
}

const STOP = new Set("the and for are was were with that this from have has had you your can how what when who why does did not but our they them any all out about into over after before there then than will would should could which where while".split(" "));
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];

// A big bank cannot all go to the AI, so keep the entries that share the most words with the question.
export function rankEntries(question: string, entries: BankEntry[], limit = MAX_SENT): BankEntry[] {
  if (entries.length <= limit) return entries;
  const q = new Set(words(question));
  const scored = entries.map((e, i) => {
    const hay = new Set(words(`${e.question} ${e.answer}`));
    let score = 0;
    for (const w of q) if (hay.has(w)) score++;
    return { e, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.e);
}

// What the user sees. The AI must say the bank covers it AND cite entries that really exist,
// otherwise the answer is exactly "not in the bank".
export function finalizeBank(ai: BankAI, entries: BankEntry[]): { found: boolean; answer: string; cited: BankEntry[] } {
  const cited = [...new Set(ai.entry_ids)]
    .map((id) => entries.find((e) => e.id === id))
    .filter((e): e is BankEntry => !!e);
  if (!ai.found || cited.length === 0 || ai.answer.trim() === "") {
    return { found: false, answer: BANK_MISS, cited: [] };
  }
  if (namesSomeoneElse(ai.answer, cited, entries)) {
    return { found: false, answer: BANK_MISS, cited: [] }; // an answer crediting the wrong person is not trusted
  }
  return { found: true, answer: ai.answer.trim(), cited };
}

// The first name of whoever wrote an entry, e.g. "Meera" from "Meera, Finance Controller".
const nameOf = (e: BankEntry) => e.by.split(/[,(]/)[0].trim().split(/\s+/)[0];

// True if the answer mentions a person whose entry was not cited (the AI mixed up who said what).
export function namesSomeoneElse(answer: string, cited: BankEntry[], entries: BankEntry[]): boolean {
  const ok = new Set(cited.map((e) => nameOf(e).toLowerCase()));
  for (const e of entries) {
    const n = nameOf(e);
    if (n.length < 3 || ok.has(n.toLowerCase())) continue;
    if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(answer)) return true;
  }
  return false;
}
