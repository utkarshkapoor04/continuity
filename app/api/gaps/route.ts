import { NextResponse } from "next/server";
import { askAI, friendlyMessage } from "../../../lib/ai";
import { GAPS_SYSTEM, gapsMoreUser, gapsUser } from "../../../lib/prompts";
import { annotateQuestions, mergeQuestions, MIN_QUESTIONS } from "../../../lib/sheet";
import { checkInput, parseGaps } from "../../../lib/validate";

export const maxDuration = 60;

// AI call 1: find the gaps in the SOP.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sop = typeof body.sop === "string" ? body.sop : "";
  const cases = typeof body.cases === "string" ? body.cases : "";

  // Plain-code check first: bad input never reaches the AI.
  const problem = checkInput(sop, cases);
  if (problem) return NextResponse.json({ ok: false, message: problem });

  try {
    const result = await askAI(GAPS_SYSTEM, gapsUser(sop, cases), parseGaps);
    if (!result.is_process) {
      return NextResponse.json({ ok: false, message: "This doesn't look like a process", detail: result.reason });
    }
    // The AI sometimes returns too few. Ask for more (up to twice) and merge them in.
    let questions = mergeQuestions(result.questions, []);
    for (let i = 0; i < 2 && questions.length < MIN_QUESTIONS; i++) {
      const more = await askAI(GAPS_SYSTEM, gapsMoreUser(sop, cases, questions), parseGaps);
      questions = mergeQuestions(questions, more.questions);
    }
    if (questions.length === 0) {
      return NextResponse.json({ ok: false, message: "No gaps found. Check that the text is a full process description." });
    }
    return NextResponse.json({ ok: true, questions: annotateQuestions(questions, `${sop}\n${cases}`) });
  } catch (e) {
    console.error("gaps failed:", (e as Error).message);
    return NextResponse.json({ ok: false, message: friendlyMessage(e) });
  }
}
