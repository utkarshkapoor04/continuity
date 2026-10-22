// The fixed shapes of data used across the app.

export const NOT_CAPTURED = "not captured";

export type Question = {
  id: string;
  quote: string;
  question: string;
  why_it_matters: string;
  source_found?: boolean; // set by plain code, not by the AI
};

export type Answer = { text: string; inPerson: boolean };
export type Answers = Record<string, Answer>;

export type Rule = {
  id: string;
  rule: string;
  source: "SOP" | "leaver";
  quote: string;
  question_id: string | null;
  conflict: boolean;
  conflict_note: string;
  no_contingency: boolean;
  source_found?: boolean; // set by plain code
  added_as_written?: boolean; // set by plain code when it adds a leaver sentence the AI left out
};

export type FlaggedQuestion = { id: string; question: string; inPerson: boolean };

// What the AI is asked to return (one shape per AI call)
export type GapsAI = { is_process: boolean; reason: string; questions: Question[] };
export type SheetAI = { rules: Rule[] };
export type AskAI = { covered: boolean; answer: string; rule_ids: string[] };
