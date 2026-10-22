// Errors that usually go away if you simply try again: the AI service is busy (5xx) or rate-limited (429).
// A timeout is not retried: it already took long enough, and a retry would run past the time limit.
export function isTransient(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === 429 || (typeof status === "number" && status >= 500 && status < 600);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Runs fn, and if it fails with a transient error, waits a moment and tries again (up to `tries` in total).
export async function withRetry<T>(
  fn: () => Promise<T>,
  tries = 3,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries || !isTransient(e)) throw e;
      await wait(1500 * attempt);
    }
  }
}
