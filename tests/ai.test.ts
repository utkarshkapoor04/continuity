import { afterEach, describe, expect, it, vi } from "vitest";
import { askAI, friendlyMessage } from "../lib/ai";
import { parseAsk } from "../lib/validate";

// A pretend Gemini reply carrying valid JSON for the "answer a question" shape.
const goodBody = {
  candidates: [{ content: { parts: [{ text: '{"covered":true,"answer":"Lock on WD3.","rule_ids":["R1"]}' }] } }],
};
const ok = () => new Response(JSON.stringify(goodBody), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("askAI when the AI service is busy", () => {
  it("retries a 503 and still returns the answer", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++calls < 3 ? new Response("busy", { status: 503 }) : ok())));
    const out = await askAI("system", "user", parseAsk);
    expect(out.answer).toBe("Lock on WD3.");
    expect(calls).toBe(3);
  }, 20000);

  it("stops after three tries and shows a friendly message", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { calls++; return new Response("busy", { status: 503 }); }));
    const err = await askAI("system", "user", parseAsk).catch((e) => e);
    expect(calls).toBe(3);
    expect(friendlyMessage(err)).toBe("The AI service is busy right now. Try again in a moment.");
  }, 20000);

  it("does not retry a rejected key", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { calls++; return new Response("no", { status: 401 }); }));
    const err = await askAI("system", "user", parseAsk).catch((e) => e);
    expect(calls).toBe(1);
    expect(friendlyMessage(err)).toContain("API key or model name was rejected");
  });
});
