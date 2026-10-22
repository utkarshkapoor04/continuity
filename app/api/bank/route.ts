import { NextResponse } from "next/server";
import { askAI, friendlyMessage } from "../../../lib/ai";
import { finalizeBank, MAX_BANK_CHARS, MAX_BANK_ENTRIES, rankEntries } from "../../../lib/bank";
import type { BankEntry } from "../../../lib/bank";
import { BANK_SYSTEM, bankUser } from "../../../lib/prompts";
import { parseBankAnswer } from "../../../lib/validate";

export const maxDuration = 60;

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

// AI call 4: answer from the team question bank, for questions the SOP and the rules sheet do not cover.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ ok: false, message: "Type a question first." });

  const raw: unknown[] = Array.isArray(body.entries) ? body.entries : [];
  const entries: BankEntry[] = [];
  for (const r of raw.slice(0, MAX_BANK_ENTRIES)) {
    const e = r as Partial<BankEntry> | null;
    if (!e || typeof e.id !== "string" || typeof e.question !== "string" || typeof e.answer !== "string") continue;
    entries.push({ id: e.id, question: clip(e.question, 1200), answer: clip(e.answer, 1200), by: clip(e.by, 200), date: clip(e.date, 60) });
  }
  if (entries.length === 0) return NextResponse.json({ ok: false, message: "Load a question bank first." });
  const size = entries.reduce((n, e) => n + e.question.length + e.answer.length + e.by.length + e.date.length, 0);
  if (size > MAX_BANK_CHARS) {
    return NextResponse.json({ ok: false, message: "The question bank is too large. Keep it under 40,000 characters." });
  }

  const sent = rankEntries(question, entries);
  try {
    const ai = await askAI(BANK_SYSTEM, bankUser(sent, question), parseBankAnswer, 1500);
    return NextResponse.json({ ok: true, ...finalizeBank(ai, sent) });
  } catch (e) {
    console.error("bank failed:", (e as Error).message);
    return NextResponse.json({ ok: false, message: friendlyMessage(e) });
  }
}
