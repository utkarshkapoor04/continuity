// Finds where a quote sits inside the user's own text, so the screen can show it in context.
// It ignores capital letters, extra spaces and curly-versus-straight quotes and dashes.

export type Range = { start: number; end: number };

// One character of the quote as a pattern: punctuation that can be written two ways matches both.
function charPattern(ch: string): string {
  if (/['‘’]/.test(ch)) return "['‘’]";
  if (/["“”]/.test(ch)) return '["“”]';
  if (/[-–—]/.test(ch)) return "[-–—]";
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function locateQuote(text: string, quote: string): Range | null {
  const q = quote.trim().replace(/^["'‘’“”]+|["'‘’“”]+$/g, "");
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = words.map((w) => [...w].map(charPattern).join("")).join("\\s+");
  const m = new RegExp(pattern, "i").exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

// Start of the line before the one starting at `s` (or 0 if there is none).
const previousLineStart = (text: string, s: number) => (s - 2 < 0 ? 0 : text.lastIndexOf("\n", s - 2) + 1);

// The matched text plus whole lines around it: `before` lines above and `after` lines below.
export function contextAround(text: string, r: Range, before = 1, after = 1): { before: string; match: string; after: string } {
  let s = r.start > 0 ? text.lastIndexOf("\n", r.start - 1) + 1 : 0;
  for (let i = 0; i < before && s > 0; i++) s = previousLineStart(text, s);
  let e = text.indexOf("\n", r.end);
  if (e === -1) e = text.length;
  for (let i = 0; i < after && e < text.length; i++) {
    const n = text.indexOf("\n", e + 1);
    e = n === -1 ? text.length : n;
  }
  return { before: text.slice(s, r.start), match: text.slice(r.start, r.end), after: text.slice(r.end, e) };
}
