import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "./retry";

// Which AI to use is set in .env.local:  AI_PROVIDER=gemini  (free, for testing)  or  claude
const PROVIDER = process.env.AI_PROVIDER === "claude" ? "claude" : "gemini";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";
const TIMEOUT_MS = 25000;

// An error whose message is safe and useful to show on screen.
export class UserFacingError extends Error {}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in reply");
  return JSON.parse(text.slice(start, end + 1));
}

function getKey(name: string): string {
  const key = process.env[name];
  if (!key || key.startsWith("paste-")) {
    throw new UserFacingError(`No API key yet. Paste ${name} into .env.local, then restart the app.`);
  }
  return key;
}

async function callGemini(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": getKey("GEMINI_API_KEY") },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        // maxOutputTokens is doubled because Gemini's "thinking" also counts against it
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens * 2 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!res.ok) throw Object.assign(new Error(`Gemini HTTP ${res.status}`), { status: res.status });
  const data = await res.json();
  const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

async function callClaude(system: string, user: string, maxTokens: number): Promise<string> {
  const client = new Anthropic({ apiKey: getKey("ANTHROPIC_API_KEY"), timeout: TIMEOUT_MS, maxRetries: 0 });
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

// The only place that talks to an AI. Runs on the server only.
// If the reply isn't valid JSON in the expected shape, it tries once more.
export async function askAI<T>(
  system: string,
  user: string,
  parse: (x: unknown) => T | null,
  maxTokens = 4000,
): Promise<T> {
  const call = PROVIDER === "claude" ? callClaude : callGemini;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await withRetry(() => call(system, user, maxTokens));
    try {
      const parsed = parse(extractJson(text));
      if (parsed) return parsed;
    } catch {
      // bad JSON: fall through and retry once
    }
  }
  throw new Error("The AI reply was not in the expected shape twice.");
}

export function friendlyMessage(e: unknown): string {
  if (e instanceof UserFacingError) return e.message;
  const status = (e as { status?: number })?.status;
  if (status === 401 || status === 403 || status === 400 || status === 404) {
    return "The API key or model name was rejected. Check .env.local, then restart the app.";
  }
  if (status === 429) return "Free-tier limit reached. Wait a minute and try again.";
  if (typeof status === "number" && status >= 500) return "The AI service is busy right now. Try again in a moment.";
  return "Something went wrong, try again.";
}
