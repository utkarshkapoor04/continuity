import { describe, expect, it } from "vitest";
import { contextAround, locateQuote } from "../lib/locate";

const TEXT = "Heading line\n1. WD1: The analyst downloads the bank statements.\n2. WD2: The analyst reconciles each account.\n3. WD3: The ledger is locked.\nLast line";

describe("locating a quote in the user's text", () => {
  it("finds an exact quote and gives its position", () => {
    const q = "The analyst reconciles each account.";
    const r = locateQuote(TEXT, q)!;
    expect(TEXT.slice(r.start, r.end)).toBe(q);
  });
  it("ignores capitals, extra spaces and line breaks", () => {
    const r = locateQuote(TEXT, "the  ANALYST\nreconciles each account.")!;
    expect(TEXT.slice(r.start, r.end)).toBe("The analyst reconciles each account.");
  });
  it("treats curly and straight quotes and dashes as the same", () => {
    const text = "Use the bank’s rate – not Deepak's sheet.";
    expect(locateQuote(text, "the bank's rate - not Deepak’s sheet.")).not.toBeNull();
  });
  it("strips quote marks around the quote", () => {
    expect(locateQuote(TEXT, "“The ledger is locked.”")).not.toBeNull();
  });
  it("returns null when the text is not there, or the quote is empty", () => {
    expect(locateQuote(TEXT, "The ledger is locked at midnight.")).toBeNull();
    expect(locateQuote(TEXT, "   ")).toBeNull();
  });
  it("is safe with characters that mean something in patterns", () => {
    expect(locateQuote("Pay Rs 5,000 (approx.) [see $note]", "Rs 5,000 (approx.) [see $note]")).not.toBeNull();
  });
});

describe("showing the lines around a quote", () => {
  it("returns the line above and the line below by default", () => {
    const r = locateQuote(TEXT, "The analyst reconciles each account.")!;
    const c = contextAround(TEXT, r);
    expect(c.before).toBe("1. WD1: The analyst downloads the bank statements.\n2. WD2: ");
    expect(c.match).toBe("The analyst reconciles each account.");
    expect(c.after).toBe("\n3. WD3: The ledger is locked.");
  });
  it("copes with a quote on the first line", () => {
    const c = contextAround(TEXT, locateQuote(TEXT, "Heading line")!);
    expect(c.before).toBe("");
    expect(c.after.startsWith("\n1. WD1")).toBe(true);
  });
  it("copes with a quote on the last line", () => {
    const c = contextAround(TEXT, locateQuote(TEXT, "Last line")!);
    expect(c.after).toBe("");
    expect(c.before.endsWith("3. WD3: The ledger is locked.\n")).toBe(true);
  });
  it("can show no extra lines", () => {
    const c = contextAround(TEXT, locateQuote(TEXT, "The ledger is locked.")!, 0, 0);
    expect(c.before).toBe("3. WD3: ");
    expect(c.after).toBe("");
  });
});
