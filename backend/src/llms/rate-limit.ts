// Shared 429 handling for scripts that make many LLM calls in a row.
const DEFAULT_WAIT_MS = 60_000;
const DEFAULT_RETRIES = 3;

export class LimitHitError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  return e?.status === 429 || /429|quota|rate.?limit|resource.?exhausted/i.test(e?.message ?? "");
}

// Provider-suggested wait: a retry-after header (seconds), or Groq's "try again in 1m2.5s" message.
export function retryAfterMs(err: unknown): number | undefined {
  const e = err as { headers?: Headers | Record<string, string>; message?: string };
  const header =
    e?.headers instanceof Headers ? e.headers.get("retry-after") : e?.headers?.["retry-after"];
  const seconds = Number(header);
  if (header && Number.isFinite(seconds) && seconds > 0) return seconds * 1000 + 1000;

  const m = /try again in\s+(?:(\d+)m)?\s*(?:([\d.]+)s)?/i.exec(e?.message ?? "");
  if (m && (m[1] || m[2])) {
    const total = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
    if (total > 0) return Math.ceil(total * 1000) + 1000;
  }
  return undefined;
}

// Run fn; on a rate limit wait (provider hint or 60s) and retry up to `retries` times,
// then throw LimitHitError so the caller can stop gracefully.
export async function withRateLimitRetry<T>(fn: () => Promise<T>, retries = DEFAULT_RETRIES): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimit(err)) throw err;
      if (attempt >= retries) throw new LimitHitError();
      const waitMs = retryAfterMs(err) ?? DEFAULT_WAIT_MS;
      console.warn(`  Rate limited — waiting ${Math.ceil(waitMs / 1000)}s (retry ${attempt + 1}/${retries})...`);
      await sleep(waitMs);
    }
  }
}
