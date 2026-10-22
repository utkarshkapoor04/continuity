// A quote shorter than this must be a whole sentence of the source (see quoteFound).
export const MIN_QUOTE_CHARS = 25;

// Makes text easier to compare: same quote marks and dashes, single spaces, no capitals.
export function normalize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .toLowerCase();
}

// The source split into whole sentences/lines, without list numbers or final full stops.
function sentences(source: string): string[] {
  return source
    .split(/\n|(?<=[.!?])\s+/)
    .map((x) => normalize(x.replace(/^\s*\d+[.)]\s*/, "")).replace(/[.!?]+$/, ""))
    .filter(Boolean);
}

// True only if the quote really appears in the source text. A long quote just has to appear.
// A short quote (a few words) must be a complete sentence of the source, not a fragment
// picked out of the middle of one.
export function quoteFound(quote: string, source: string): boolean {
  const q = normalize(quote);
  if (!q || !normalize(source).includes(q)) return false;
  if (q.length >= MIN_QUOTE_CHARS) return true;
  return sentences(source).includes(q.replace(/[.!?]+$/, ""));
}
