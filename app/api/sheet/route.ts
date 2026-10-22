import { NextResponse } from "next/server";
import { askAI, friendlyMessage } from "../../../lib/ai";
import { SHEET_SYSTEM, sheetUser } from "../../../lib/prompts";
import { addMissingLeaverRules, inPersonItems, openGaps, tagRules } from "../../../lib/sheet";
import { checkInput, parseSheet } from "../../../lib/validate";
import type { Answers, Question } from "../../../lib/types";

export const maxDuration = 60;

// AI call 2: build the rules sheet from the SOP plus the leaver's answers.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sop = typeof body.sop === "string" ? body.sop : "";
  const cases = typeof body.cases === "string" ? body.cases : "";
  const answers: Answers = body.answers && typeof body.answers === "object" ? body.answers : {};
  const questions: Question[] = Array.isArray(body.questions)
    ? body.questions.filter(
        (q: Question) => q && typeof q.id === "string" && typeof q.question === "string",
      )
    : [];

  const problem = checkInput(sop, cases);
  if (problem) return NextResponse.json({ ok: false, message: problem });
  if (questions.length === 0) return NextResponse.json({ ok: false, message: "Find gaps first." });

  try {
    const result = await askAI(SHEET_SYSTEM, sheetUser(sop, cases, questions, answers), parseSheet, 8000);
    if (result.rules.length === 0) {
      return NextResponse.json({ ok: false, message: "No rules could be built from that text." });
    }
    return NextResponse.json({
      ok: true,
      rules: tagRules(addMissingLeaverRules(result.rules, questions, answers), `${sop}\n${cases}`, answers),
      openGaps: openGaps(questions, answers),
      inPerson: inPersonItems(questions, answers),
    });
  } catch (e) {
    console.error("sheet failed:", (e as Error).message);
    return NextResponse.json({ ok: false, message: friendlyMessage(e) });
  }
}
