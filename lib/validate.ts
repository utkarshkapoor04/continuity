import type { AskAI, GapsAI, Question, Rule, SheetAI } from "./types";
import type { BankAI } from "./bank";

export const MIN_CHARS = 200;
export const MAX_CHARS = 30000;

// Returns a message to show the user, or null if the input is fine.
export function checkInput(sop: string, cases = ""): string | null {
  if (sop.trim().length < MIN_CHARS) return "Paste a process description";
  if (sop.length + cases.length > MAX_CHARS) {
    return "That's too long. Paste just the relevant part (under 30,000 characters in total).";
  }
  return null;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";

// Each parse function returns the checked data, or null if the AI's JSON has the wrong shape.

export function parseGaps(x: unknown): GapsAI | null {
  if (!isObj(x) || typeof x.is_process !== "boolean" || !isStr(x.reason)) return null;
  const raw = Array.isArray(x.questions) ? x.questions : [];
  const questions: Question[] = [];
  for (const q of raw) {
    if (!isObj(q) || !isStr(q.id) || !isStr(q.quote) || !isStr(q.question) || !isStr(q.why_it_matters)) {
      return null;
    }
    questions.push({ id: q.id, quote: q.quote, question: q.question, why_it_matters: q.why_it_matters });
  }
  return { is_process: x.is_process, reason: x.reason, questions: questions.slice(0, 10) };
}

export function parseSheet(x: unknown): SheetAI | null {
  if (!isObj(x) || !Array.isArray(x.rules)) return null;
  const rules: Rule[] = [];
  const seen = new Set<string>();
  for (const r of x.rules) {
    if (!isObj(r) || !isStr(r.id) || !isStr(r.rule) || !isStr(r.quote)) return null;
    if (r.source !== "SOP" && r.source !== "leaver") return null;
    if (typeof r.conflict !== "boolean" || typeof r.no_contingency !== "boolean") return null;
    if (seen.has(r.id)) return null;
    seen.add(r.id);
    rules.push({
      id: r.id,
      rule: r.rule,
      source: r.source,
      quote: r.quote,
      question_id: isStr(r.question_id) ? r.question_id : null,
      conflict: r.conflict,
      conflict_note: isStr(r.conflict_note) ? r.conflict_note : "",
      no_contingency: r.no_contingency,
    });
  }
  return { rules };
}

export function parseBankAnswer(x: unknown): BankAI | null {
  if (!isObj(x) || typeof x.found !== "boolean" || !isStr(x.answer)) return null;
  if (!Array.isArray(x.entry_ids) || !x.entry_ids.every(isStr)) return null;
  return { found: x.found, answer: x.answer, entry_ids: x.entry_ids };
}

export function parseAsk(x: unknown): AskAI | null {
  if (!isObj(x) || typeof x.covered !== "boolean" || !isStr(x.answer)) return null;
  if (!Array.isArray(x.rule_ids) || !x.rule_ids.every(isStr)) return null;
  return { covered: x.covered, answer: x.answer, rule_ids: x.rule_ids };
}
