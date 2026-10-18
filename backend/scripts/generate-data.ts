import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chat } from "../src/llms/index.js";
import { CATEGORIES, CATEGORY_NAMES, type Category } from "../src/data/categories.js";
import { TicketDraftSchema, TicketSchema, type Ticket } from "../src/types/ticket.js";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const TICKETS_PATH = path.join(DATA_DIR, "tickets.json");
const DELAY_MS = 5_000;
const RATE_LIMIT_WAIT_MS = 60_000;
const RATE_LIMIT_RETRIES = 3;
const MAX_EMPTY_BATCHES = 3;
const JSON_RETRIES = 2;

class LimitHitError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseCli() {
  const { values } = parseArgs({
    options: {
      category: { type: "string" },
      "per-category": { type: "string", default: "25" },
      batch: { type: "string", default: "10" },
    },
  });
  const perCategory = Number(values["per-category"]);
  const batch = Number(values.batch);
  if (!Number.isInteger(perCategory) || perCategory < 1) throw new Error("--per-category must be a positive integer");
  if (!Number.isInteger(batch) || batch < 1) throw new Error("--batch must be a positive integer");
  if (values.category && !CATEGORY_NAMES.includes(values.category as Category)) {
    throw new Error(`Unknown --category "${values.category}". Valid: ${CATEGORY_NAMES.join(", ")}`);
  }
  return { category: values.category as Category | undefined, perCategory, batch };
}

function loadTickets(): Ticket[] {
  if (!existsSync(TICKETS_PATH)) return [];
  return JSON.parse(readFileSync(TICKETS_PATH, "utf8")) as Ticket[];
}

function saveTickets(tickets: Ticket[]) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TICKETS_PATH, JSON.stringify(tickets, null, 2) + "\n", "utf8");
}

function maxId(tickets: Ticket[]): number {
  return tickets.reduce((max, t) => Math.max(max, Number(t.id.replace(/^TKT-/, "")) || 0), 0);
}

// Split n tickets across subtopics as evenly as possible. `offset` rotates which
// subtopics get the remainder so that successive batches stay balanced overall.
function spread(subtopics: readonly string[], n: number, offset: number): Map<string, number> {
  const counts = new Map<string, number>();
  const base = Math.floor(n / subtopics.length);
  const extra = n % subtopics.length;
  subtopics.forEach((s, i) => {
    const rotated = (i - offset + subtopics.length) % subtopics.length;
    const count = base + (rotated < extra ? 1 : 0);
    if (count > 0) counts.set(s, count);
  });
  return counts;
}

// Approximate count for a share of the batch, so small batches get concrete numbers.
const pct = (total: number, share: number) => Math.round(total * share);

function buildPrompt(category: Category, plan: Map<string, number>, total: number): string {
  const planLines = [...plan].map(([s, n]) => `- "${s}": exactly ${n}`).join("\n");
  return `Generate ${total} realistic, already-resolved customer support tickets for "TeleNova", a fictional Indian telecom operator.

Category for ALL tickets: "${category}"
Subtopic distribution (use these subtopic strings verbatim):
${planLines}

Return ONLY JSON of the form:
{"tickets":[{"category":"${category}","subtopic":"...","priority":"Low|Medium|High|Critical","description":"...","resolution":"...","status":"Resolved"}]}
Do not include ids.

Variety requirements:
- Mix customer personas across the batch: college student, senior citizen, small-business owner, repeat caller whose issue came back, and a non-native English speaker whose description has minor typos/grammar slips. Write the description in that customer's voice.
- Tone mix across the batch: about ${pct(total, 0.5)} calm/polite, ${pct(total, 0.3)} frustrated, ${pct(total, 0.2)} angry. Most angry customers just vent; only about ${pct(total, 0.125)} ticket(s) in this batch may threaten TRAI, a consumer forum, or social media.
- Openings: no more than 2 tickets may start with the same first few words. Never open with "This is my third time", "I am writing to", "Hello", "Dear", or "Hi team". Vary openings: start mid-problem, with a number or plan name, a question, a date, a device, or a complaint fragment.
- Vary description length from 1 to 5 sentences. About ${pct(total, 0.25)} should be a single short, casual, chat-style sentence typed quickly on a phone: all lowercase, little or no punctuation, doubled "??" or "!!", texting abbreviations like "pls" or "plz", and a bare number or plan name instead of a full explanation. Every description must still be at least 15 words.
- Include specific details: Indian cities (e.g. Pune, Lucknow, Kochi, Indore, Guwahati), fictional TeleNova plan names (e.g. "Nova 599 Unlimited", "Nova 299 Lite", "NovaFiber 999"), real phone models (e.g. Samsung Galaxy A54, iPhone 13, Redmi Note 12), dates, and amounts in ₹. Short casual tickets can include just one or two such details.
- Priority mix across the batch: about ${pct(total, 0.2)} Low, ${pct(total, 0.4)} Medium, ${pct(total, 0.3)} High, ${pct(total, 0.1)} Critical. Priority must match the actual severity, not the customer's tone (an angry customer with a minor issue is still Low/Medium): Low = minor inconvenience or query; Medium = degraded service or small money issue; High = service down or significant money; Critical = business/emergency impact, extended total outage, or large financial loss.
- Resolution is written by the support agent, at least 20 words, in exactly this structure:
  "Root cause: <specific cause>. Steps taken: 1) <action> 2) <action> [3) ...] Outcome: <result>."
  Steps must be concrete and technical (e.g. reset APN to "tnova.net", reprovisioned VoLTE flag on HLR, reversed ₹599 duplicate debit via ref REF12345, reissued eSIM QR). Never vague phrases like "fixed the issue" or "checked the system".
- Every ticket must clearly be about its assigned subtopic; never mention another category's problem.
- No two tickets should read alike.`;
}

function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  return e?.status === 429 || /429|quota|rate.?limit|resource.?exhausted/i.test(e?.message ?? "");
}

// Provider-suggested wait: a retry-after header (seconds), or Groq's "try again in 1m2.5s" message.
function retryAfterMs(err: unknown): number | undefined {
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

async function callWithRetry(prompt: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chat(
        [
          { role: "system", content: "You generate synthetic telecom support data. Reply with valid JSON only." },
          { role: "user", content: prompt },
        ],
        { json: true, temperature: 0.9 },
      );
    } catch (err) {
      if (!isRateLimit(err)) throw err;
      if (attempt >= RATE_LIMIT_RETRIES) throw new LimitHitError();
      const waitMs = retryAfterMs(err) ?? RATE_LIMIT_WAIT_MS;
      console.warn(`  Rate limited — waiting ${Math.ceil(waitMs / 1000)}s (retry ${attempt + 1}/${RATE_LIMIT_RETRIES})...`);
      await sleep(waitMs);
    }
  }
}

function isJsonFailure(err: unknown): boolean {
  const e = err as { code?: string; error?: { code?: string }; message?: string };
  return (
    err instanceof SyntaxError ||
    e?.code === "json_validate_failed" ||
    e?.error?.code === "json_validate_failed" ||
    /json_validate_failed/.test(e?.message ?? "")
  );
}

function parseBatch(raw: string, category: Category, subtopics: readonly string[]) {
  const parsed = JSON.parse(raw) as { tickets?: unknown };
  if (!Array.isArray(parsed.tickets)) throw new SyntaxError('Response JSON has no "tickets" array');
  const items: unknown[] = parsed.tickets;
  const valid = [];
  for (const item of items) {
    const r = TicketDraftSchema.safeParse(item);
    if (r.success && r.data.category === category && subtopics.includes(r.data.subtopic)) valid.push(r.data);
  }
  return { valid, dropped: items.length - valid.length };
}

// Request one batch. On JSON failures, retry the same size JSON_RETRIES times, then once more
// at half size. Returns undefined if every attempt failed.
async function requestBatch(category: Category, subtopics: readonly string[], size: number, offset: number) {
  const sizes = [...new Set([size, Math.ceil(size / 2)])];
  for (const s of sizes) {
    if (s !== size) console.warn(`  Fallback: halving batch ${size} → ${s}.`);
    for (let attempt = 0; attempt <= JSON_RETRIES; attempt++) {
      if (attempt > 0) {
        console.warn(`  Fallback: retrying batch of ${s} (${attempt}/${JSON_RETRIES}) after JSON failure.`);
        await sleep(DELAY_MS);
      }
      try {
        const raw = await callWithRetry(buildPrompt(category, spread(subtopics, s, offset), s));
        return parseBatch(raw, category, subtopics);
      } catch (err) {
        if (!isJsonFailure(err)) throw err;
        console.warn(`  JSON failure: ${(err as Error).message}`);
      }
    }
  }
  return undefined;
}

async function main() {
  const { category, perCategory, batch } = parseCli();
  const tickets = loadTickets();
  let nextId = maxId(tickets) + 1;
  let firstCall = true;
  const targets = category ? CATEGORIES.filter((c) => c.name === category) : CATEGORIES;

  try {
    for (const { name, subtopics } of targets) {
      let emptyBatches = 0;
      while (true) {
        const have = tickets.filter((t) => t.category === name).length;
        const missing = perCategory - have;
        if (missing <= 0) {
          console.log(`${name}: ${have}/${perCategory} — done.`);
          break;
        }
        const size = Math.min(batch, missing);

        if (!firstCall) await sleep(DELAY_MS);
        firstCall = false;

        console.log(`${name}: ${have}/${perCategory} — requesting ${size}...`);
        const result = await requestBatch(name, subtopics, size, have % subtopics.length);
        if (!result) {
          console.warn(`  JSON kept failing for ${name}, even at half batch size — giving up on this category.`);
          break;
        }
        const { valid, dropped } = result;

        // Don't overshoot the target if the model returned extras.
        for (const draft of valid.slice(0, missing)) {
          tickets.push(TicketSchema.parse({ id: `TKT-${String(nextId++).padStart(4, "0")}`, ...draft }));
        }
        saveTickets(tickets);
        console.log(`  +${Math.min(valid.length, missing)} saved, ${dropped} dropped as invalid.`);

        if (valid.length === 0 && ++emptyBatches >= MAX_EMPTY_BATCHES) {
          console.warn(`  ${MAX_EMPTY_BATCHES} empty batches in a row for ${name} — skipping.`);
          break;
        }
        if (valid.length > 0) emptyBatches = 0;
      }
    }
  } catch (err) {
    if (!(err instanceof LimitHitError)) throw err;
    console.warn("\nLimit hit — rerun later, progress is saved.");
  }

  console.log("\nSummary:");
  console.table(
    Object.fromEntries(CATEGORY_NAMES.map((c) => [c, { count: tickets.filter((t) => t.category === c).length }])),
  );
  console.log(`Total: ${tickets.length} → ${TICKETS_PATH}`);
}

await main();
