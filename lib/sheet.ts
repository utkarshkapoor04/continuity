import { normalize, quoteFound } from "./quotes";
import { NOT_CAPTURED } from "./types";
import type { AskAI, Answers, FlaggedQuestion, Question, Rule } from "./types";

const isBlank = (text?: string) => !text || text.trim() === "";

// Mark each gap question with whether its quote really exists in the SOP or cases.
export function annotateQuestions(questions: Question[], sourceText: string): Question[] {
  return questions.map((q) => ({ ...q, source_found: quoteFound(q.quote, sourceText) }));
}

export const MIN_QUESTIONS = 5;
export const MAX_QUESTIONS = 10;

// Combine the first set of gap questions with extra ones: drop repeats, keep the order,
// stop at the maximum, and number them Q1, Q2, ... again.
export function mergeQuestions(first: Question[], more: Question[]): Question[] {
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const q of [...first, ...more]) {
    const key = normalize(q.question);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out.slice(0, MAX_QUESTIONS).map((q, i) => ({ ...q, id: `Q${i + 1}` }));
}

export type SheetSummary = {
  total: number;
  answered: number;
  open: number;
  inPerson: number;
  conflicts: number;
  noContingency: number;
  sourceNotFound: number;
  percent: number;
};

// The numbers behind the "handover status" bar. Plain counting, no AI.
export function summarizeSheet(totalQuestions: number, rules: Rule[], openCount: number, inPersonCount: number): SheetSummary {
  const answered = Math.min(totalQuestions, Math.max(0, totalQuestions - openCount));
  return {
    total: totalQuestions,
    answered,
    open: openCount,
    inPerson: inPersonCount,
    conflicts: rules.filter((r) => r.conflict).length,
    noContingency: rules.filter((r) => r.no_contingency).length,
    sourceNotFound: rules.filter((r) => r.source_found === false).length,
    percent: totalQuestions > 0 ? Math.round((answered / totalQuestions) * 100) : 0,
  };
}

// Questions the leaver left blank. Every one of these is an open gap.
export function openGaps(questions: Question[], answers: Answers): FlaggedQuestion[] {
  return questions
    .filter((q) => isBlank(answers[q.id]?.text))
    .map((q) => ({ id: q.id, question: q.question, inPerson: !!answers[q.id]?.inPerson }));
}

// Questions ticked "needs in-person", answered or not.
export function inPersonItems(questions: Question[], answers: Answers): FlaggedQuestion[] {
  return questions
    .filter((q) => answers[q.id]?.inPerson)
    .map((q) => ({ id: q.id, question: q.question, inPerson: true }));
}

// The AI sometimes drops part of a leaver's answer. Any sentence of an answer that no leaver
// rule covers is added to the sheet word for word, so nothing the leaver said gets lost.
export function addMissingLeaverRules(rules: Rule[], questions: Question[], answers: Answers): Rule[] {
  const out = [...rules];
  let n = Math.max(rules.length, ...rules.map((r) => Number(/^R(\d+)$/.exec(r.id)?.[1] ?? 0)));
  for (const q of questions) {
    const answer = answers[q.id]?.text ?? "";
    if (isBlank(answer)) continue;
    const covered = rules
      .filter((r) => r.source === "leaver" && r.question_id === q.id && quoteFound(r.quote, answer))
      .map((r) => normalize(r.quote));
    for (const sentence of answer.trim().split(/(?<=[.!?])\s+/)) {
      const s = normalize(sentence);
      if (!s || covered.some((c) => c.includes(s) || s.includes(c))) continue;
      n += 1;
      out.push({
        id: `R${n}`,
        rule: `Leaver's answer to ${q.id}: ${sentence.trim()}`,
        source: "leaver",
        quote: sentence.trim(),
        question_id: q.id,
        conflict: false,
        conflict_note: "",
        no_contingency: false,
        added_as_written: true,
      });
    }
  }
  return out;
}

// Check each rule's quote against the right source:
// SOP rules against the SOP + cases, leaver rules against that question's answer.
export function tagRules(rules: Rule[], sopAndCases: string, answers: Answers): Rule[] {
  return rules.map((r) => {
    const source =
      r.source === "SOP" ? sopAndCases : r.question_id ? (answers[r.question_id]?.text ?? "") : "";
    return { ...r, source_found: quoteFound(r.quote, source) };
  });
}

// Decide what the user sees as the bot's answer. The AI's word is not enough:
// it must say the sheet covers it AND cite at least one rule that really exists.
export function finalizeAsk(ai: AskAI, rules: Rule[]): { captured: boolean; answer: string; cited: Rule[] } {
  const cited = [...new Set(ai.rule_ids)]
    .map((id) => rules.find((r) => r.id === id))
    .filter((r): r is Rule => !!r);
  if (!ai.covered || cited.length === 0 || ai.answer.trim() === "") {
    return { captured: false, answer: NOT_CAPTURED, cited: [] };
  }
  return { captured: true, answer: ai.answer.trim(), cited };
}
