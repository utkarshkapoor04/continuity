import { NextResponse } from "next/server";
import { askAI, friendlyMessage } from "../../../lib/ai";
import { ASK_SYSTEM, askUser } from "../../../lib/prompts";
import { finalizeAsk } from "../../../lib/sheet";
import { parseAsk } from "../../../lib/validate";
import { NOT_CAPTURED } from "../../../lib/types";
import type { Rule } from "../../../lib/types";

export const maxDuration = 60;

// AI call 3: answer a question using only the confirmed rules.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ ok: false, message: "Type a question first." });

  // The bot only knows rules whose quote was found in the source text.
  const rules: Rule[] = Array.isArray(body.rules)
    ? body.rules.filter(
        (r: Rule) => r && r.source_found === true && typeof r.id === "string" && typeof r.rule === "string",
      )
    : [];
  if (rules.length === 0) {
    return NextResponse.json({ ok: true, captured: false, answer: NOT_CAPTURED, cited: [] });
  }

  try {
    const ai = await askAI(ASK_SYSTEM, askUser(rules, question), parseAsk, 1000);
    return NextResponse.json({ ok: true, ...finalizeAsk(ai, rules) });
  } catch (e) {
    console.error("ask failed:", (e as Error).message);
    return NextResponse.json({ ok: false, message: friendlyMessage(e) });
  }
}
