import type { FlaggedQuestion, Rule } from "./types";
import type { SheetSummary } from "./sheet";

// Turns the rules sheet into a plain Markdown document the successor can keep, paste or print.
export function sheetToMarkdown(
  rules: Rule[],
  openGaps: FlaggedQuestion[],
  inPerson: FlaggedQuestion[],
  summary: SheetSummary,
  date: string,
): string {
  const out: string[] = [];
  out.push("# Handover rules sheet", "");
  out.push(
    `Made with Continuity on ${date}. Every rule quotes its source. Tags marked AI-flagged are the AI's judgement, so check them against the quote.`,
    "",
  );

  out.push("## Handover status", "");
  out.push(`- Questions answered: ${summary.answered} of ${summary.total} (${summary.percent}%)`);
  out.push(`- Open gaps: ${summary.open}`);
  out.push(`- Needs in-person: ${summary.inPerson}`);
  out.push(`- Conflicts to check: ${summary.conflicts}`);
  out.push(`- Rules marked "no contingency documented": ${summary.noContingency}`);
  out.push(`- Rules with source not found: ${summary.sourceNotFound}`, "");

  out.push("## Rules", "");
  for (const r of rules) {
    out.push(`### ${r.id}. ${r.rule}`, "");
    out.push(`- Source: ${r.source === "SOP" ? "SOP or cases" : "leaver"}`);
    out.push(`- Quote: "${r.quote}"`);
    const flags: string[] = [];
    if (r.source_found === false) flags.push("source not found");
    if (r.added_as_written) flags.push("added as written");
    if (r.conflict) flags.push("AI-flagged conflict" + (r.conflict_note ? `: ${r.conflict_note}` : ""));
    if (r.no_contingency) flags.push("AI-flagged: no contingency documented");
    if (r.question_id && inPerson.some((p) => p.id === r.question_id)) flags.push("needs in-person");
    if (flags.length) out.push(`- Flags: ${flags.join("; ")}`);
    out.push("");
  }

  out.push("## Open gaps (unanswered)", "");
  if (openGaps.length === 0) out.push("None. Every question has an answer.");
  else for (const g of openGaps) out.push(`- ${g.id}. ${g.question}${g.inPerson ? " (needs in-person)" : ""}`);
  out.push("");

  if (inPerson.length > 0) {
    out.push("## Needs in-person", "");
    for (const g of inPerson) out.push(`- ${g.id}. ${g.question}`);
    out.push("");
  }
  return out.join("\n");
}
