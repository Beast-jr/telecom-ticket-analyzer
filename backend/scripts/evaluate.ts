import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import { config } from "../src/config.js";
import { CATEGORY_NAMES } from "../src/data/categories.js";
import { chat } from "../src/llms/index.js";
import { LimitHitError, withRateLimitRetry } from "../src/llms/rate-limit.js";
import { buildJudgePrompt } from "../src/prompts/judge-prompt.js";
import { analyzeTicket } from "../src/rag/analyze.js";
import { JudgeSchema, type EvalResult, type EvalSolution, type Judge } from "../src/types/eval.js";
import type { Ticket } from "../src/types/ticket.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOLDOUT_PATH = path.join(ROOT, "data/holdout.json");
const { values } = parseArgs({
  options: { limit: { type: "string" }, "judge-model": { type: "string" }, tag: { type: "string" } },
});
if (values.tag !== undefined && !/^[\w.-]+$/.test(values.tag)) throw new Error("--tag may only contain letters, digits, _ . -");
// --tag v2 → results-v2.json / eval-results-v2.md; no tag → the untagged files.
const suffix = values.tag ? `-${values.tag}` : "";
const RESULTS_PATH = path.join(ROOT, `data/eval/results${suffix}.json`);
const REPORT_PATH = path.join(ROOT, `docs/eval-results${suffix}.md`);
const DELAY_MS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x: number, digits = 2) => (Number.isNaN(x) ? "-" : x.toFixed(digits));

function loadResults(): EvalResult[] {
  const saved = existsSync(RESULTS_PATH) ? (JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as EvalResult[]) : [];
  // Results from older judges (no per-solution scores) are re-run.
  return saved.filter((r) => Array.isArray(r.judge?.solutions));
}

function saveResults(results: EvalResult[]) {
  mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + "\n", "utf8");
}

async function judge(ticket: Ticket, solutions: EvalSolution[], model: string | undefined): Promise<Judge> {
  const messages = buildJudgePrompt(ticket.description, ticket.resolution, solutions);
  const ask = (msgs: ChatCompletionMessageParam[]) =>
    withRateLimitRetry(() => chat(msgs, { json: true, temperature: 0, model }));

  const parse = (raw: string) => {
    try {
      const r = JudgeSchema.safeParse(JSON.parse(raw));
      return r.success ? { ok: true as const, data: r.data } : { ok: false as const, error: z.prettifyError(r.error) };
    } catch (err) {
      return { ok: false as const, error: `not valid JSON (${(err as Error).message})` };
    }
  };

  let raw = "";
  let parsed: ReturnType<typeof parse>;
  try {
    raw = await ask(messages);
    parsed = parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    parsed = { ok: false, error: `not valid JSON (${err.message})` };
  }
  if (parsed.ok) return parsed.data;

  console.warn(`  Judge reply invalid (${parsed.error.split("\n")[0]}) — retrying once.`);
  const retry: ChatCompletionMessageParam[] = [
    ...messages,
    ...(raw ? [{ role: "assistant" as const, content: raw }] : []),
    { role: "user", content: `Your last reply was invalid: ${parsed.error}. Reply with valid JSON only.` },
  ];
  const second = parse(await ask(retry));
  if (!second.ok) throw new Error(`Judge returned invalid JSON twice: ${second.error}`);
  return second.data;
}

async function evaluateTicket(ticket: Ticket, judgeModel: string | undefined, judgeModelLabel: string): Promise<EvalResult> {
  const analysis = await withRateLimitRetry(() => analyzeTicket(ticket.description));
  const retrieved = analysis.similarTickets.map(({ id, category, subtopic, similarity }) => ({ id, category, subtopic, similarity }));
  const solutions: EvalSolution[] = analysis.solutions.map((s) => ({
    rank: s.rank,
    title: s.title,
    steps: s.steps,
    suitability: s.suitability,
    llmScore: s.llmScore,
    rawLlmScore: s.rawLlmScore,
    evidenceCapped: s.evidenceCapped,
    sourceTicketIds: s.sourceTicketIds,
    avgSim: s.avgSim,
    evidenceBonus: s.evidenceBonus,
  }));

  return {
    id: ticket.id,
    category: ticket.category,
    subtopic: ticket.subtopic,
    description: ticket.description,
    realResolution: ticket.resolution,
    retrieved,
    categoryHit5: retrieved.some((r) => r.category === ticket.category),
    top1Category: retrieved[0]?.category === ticket.category,
    subtopicHit5: retrieved.some((r) => r.category === ticket.category && r.subtopic === ticket.subtopic),
    topSimilarity: retrieved[0]?.similarity ?? 0,
    leaked: retrieved.some((r) => r.id === ticket.id),
    solutions,
    top1Suitability: solutions[0]?.suitability ?? 0,
    evidenceCap: config.EVIDENCE_CAP,
    judge: await judge(ticket, solutions, judgeModel),
    judgeModel: judgeModelLabel,
    timings: analysis.timings,
  };
}

// --- report ---

function table(headers: string[], rows: (string | number)[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function summarize(results: EvalResult[]) {
  const n = results.length;
  return {
    n,
    categoryHit5: pct(results.filter((r) => r.categoryHit5).length, n),
    top1Category: pct(results.filter((r) => r.top1Category).length, n),
    subtopicHit5: pct(results.filter((r) => r.subtopicHit5).length, n),
    avgTop1Score: fmt(avg(results.map((r) => r.judge.top1Score))),
    avgBestOf3Score: fmt(avg(results.map((r) => r.judge.bestOf3Score))),
    avgTop1Useful: fmt(avg(results.map((r) => r.judge.top1Useful))),
    avgBestOf3Useful: fmt(avg(results.map((r) => r.judge.bestOf3Useful))),
    distinct: pct(results.filter((r) => r.judge.distinct).length, n),
    avgTop1Suitability: fmt(avg(results.map((r) => r.top1Suitability)), 1),
  };
}

const BUCKETS: { label: string; test: (s: number) => boolean }[] = [
  { label: "<60", test: (s) => s < 60 },
  { label: "60–74", test: (s) => s >= 60 && s < 75 },
  { label: "75–89", test: (s) => s >= 75 && s < 90 },
  { label: "90+", test: (s) => s >= 90 },
];

function example(r: EvalResult): string {
  const top = r.solutions[0];
  const j = r.judge;
  return `**${r.id}** · ${r.category} › ${r.subtopic} · match ${j.top1Score}/5 (best of 3: ${j.bestOf3Score}) · useful ${j.top1Useful}/5 (best of 3: ${j.bestOf3Useful}) · suitability ${r.top1Suitability}%

- **Ticket:** ${r.description}
- **Real fix:** ${r.realResolution}
- **Our #1 — ${top?.title}:** ${top?.steps}
- **Judge:** ${r.judge.reason}`;
}

function whatThisMeans(results: EvalResult[]): string {
  const n = results.length;
  const s = summarize(results);
  const top1 = avg(results.map((r) => r.judge.top1Score));
  const best = avg(results.map((r) => r.judge.bestOf3Score));
  const useful = avg(results.map((r) => r.judge.top1Useful));
  const bestUseful = avg(results.map((r) => r.judge.bestOf3Useful));
  const paragraphs: string[] = [];

  paragraphs.push(
    `**Two kinds of score.** *Match* asks: "is our suggestion the same fix the agent actually recorded?" *Useful* asks: ` +
      `"ignoring what was recorded, would an experienced agent think this is a sensible, safe thing to try, knowing only what the customer wrote?" ` +
      `A suggestion can be very useful and still score low on match, for example checking the customer's router when the recorded cause turned out to be a fault at the exchange.`,
  );

  paragraphs.push(
    `**Why match is capped on this data.** The tickets are synthetic: for each complaint the generator picked one plausible root cause at random ` +
      `(the same "gaming lag" complaint might be a routing loop in one ticket and cell congestion in another), and the customer's description usually doesn't reveal which. ` +
      `No system, and no human agent, can reliably guess a hidden, randomly chosen cause from the description alone, so a perfect match score is impossible here. ` +
      `The useful score is the better measure of whether the suggestions would actually help an agent.`,
  );

  const parts: string[] = [];
  parts.push(
    `Retrieval found at least one past ticket from the right category for ${s.categoryHit5} of the ${n} unseen tickets ` +
      `(the very first match was the right category ${s.top1Category} of the time), and a ticket with the exact same subtopic for ${s.subtopicHit5}.`,
  );
  const usefulness =
    useful >= 4 ? "is usually a sensible thing to try" : useful >= 3 ? "is often reasonable but not always the obvious first step" : "is often not a sensible first step";
  parts.push(`Our #1 suggestion ${usefulness} (useful ${fmt(useful)}/5; best of 3: ${fmt(bestUseful)}/5).`);
  const quality =
    top1 >= 4 ? "usually matches the recorded fix" : top1 >= 3 ? "is often partly the recorded fix" : "often differs from the recorded fix";
  parts.push(`Against the recorded resolution, #1 ${quality} (match ${fmt(top1)}/5).`);
  if (best - top1 >= 0.5) {
    parts.push(
      `The best of the 3 matches noticeably better (${fmt(best)}/5), so the recorded fix is often among the options but not ranked first; ranking has room to improve.`,
    );
  } else {
    parts.push(`The best of the 3 matches ${fmt(best)}/5, close to #1, so the ranking mostly puts the strongest option first.`);
  }

  const groups = BUCKETS.map((b) => results.filter((r) => b.test(r.top1Suitability))).filter((g) => g.length > 0);
  const rising = (score: (r: EvalResult) => number) => {
    const avgs = groups.map((g) => avg(g.map(score)));
    return avgs.every((v, i) => i === 0 || v >= avgs[i - 1]);
  };
  if (groups.length < 2) {
    parts.push("Nearly all #1 suggestions fall in one suitability band, so we can't yet tell whether the % predicts quality.");
  } else {
    const matchRises = rising((r) => r.judge.top1Score);
    const usefulRises = rising((r) => r.judge.top1Useful);
    if (matchRises && usefulRises) parts.push("Higher suitability % goes with higher match and useful scores, so the % is a useful confidence signal.");
    else if (usefulRises) parts.push("Higher suitability % goes with more useful suggestions, though not consistently with matching the recorded fix.");
    else if (matchRises) parts.push("Higher suitability % goes with matching the recorded fix, though not consistently with usefulness.");
    else parts.push("Higher suitability % does not consistently mean a better answer yet, so treat the % as a rough guide, not a guarantee.");
  }
  parts.push(`The judge saw the 3 options as genuinely different approaches ${s.distinct} of the time.`);
  paragraphs.push(`**Results.** ${parts.join(" ")}`);
  return paragraphs.join("\n\n");
}

function writeReport(results: EvalResult[], holdoutSize: number) {
  const s = summarize(results);
  const byScore = [...results].sort((a, b) => b.judge.top1Score - a.judge.top1Score || b.top1Suitability - a.top1Suitability);
  const worst = [...results].sort((a, b) => a.judge.top1Score - b.judge.top1Score || b.top1Suitability - a.top1Suitability);
  const judgeModels = [...new Set(results.map((r) => r.judgeModel))].join(", ");
  const leaks = results.filter((r) => r.leaked).length;

  const md = `# Evaluation results

Holdout evaluation of the RAG pipeline on ${results.length} of ${holdoutSize} holdout tickets. Generated by \`backend/scripts/evaluate.ts\` on ${new Date().toISOString().slice(0, 10)}.

## Summary

${table(
  [
    "n",
    "categoryHit@5",
    "top1Category",
    "subtopicHit@5",
    "avg top1Score (match)",
    "avg bestOf3Score (match)",
    "avg top1Useful",
    "avg bestOf3Useful",
    "distinct",
    "avg #1 suitability",
  ],
  [
    [
      s.n,
      s.categoryHit5,
      s.top1Category,
      s.subtopicHit5,
      s.avgTop1Score,
      s.avgBestOf3Score,
      s.avgTop1Useful,
      s.avgBestOf3Useful,
      s.distinct,
      s.avgTop1Suitability,
    ],
  ],
)}

Judge scores are 1–5. **Match** = same fix as the recorded resolution. **Useful** = a sensible, safe thing to try given only the customer's description, ignoring the recorded fix.

## Per category

${table(
  ["Category", "n", "categoryHit@5", "avg top1Score (match)", "avg top1Useful"],
  CATEGORY_NAMES.map((c) => {
    const rs = results.filter((r) => r.category === c);
    return [
      c,
      rs.length,
      pct(rs.filter((r) => r.categoryHit5).length, rs.length),
      fmt(avg(rs.map((r) => r.judge.top1Score))),
      fmt(avg(rs.map((r) => r.judge.top1Useful))),
    ];
  }),
)}

## Calibration: does a higher suitability % mean a better answer?

${table(
  ["#1 suitability", "n", "avg top1Score (match)", "avg top1Useful"],
  BUCKETS.map((b) => {
    const rs = results.filter((r) => b.test(r.top1Suitability));
    return [b.label, rs.length, fmt(avg(rs.map((r) => r.judge.top1Score))), fmt(avg(rs.map((r) => r.judge.top1Useful)))];
  }),
)}

## Best examples

${byScore.slice(0, 3).map(example).join("\n\n")}

## Worst examples

${worst.slice(0, 2).map(example).join("\n\n")}

## What this means

${whatThisMeans(results)}

## Method notes

- **Holdout never ingested:** the ${holdoutSize} holdout tickets were split off before embedding and are not in the vector store, so every ticket is new to the system.${leaks ? ` ⚠️ ${leaks} ticket(s) retrieved themselves — check the split.` : ""}
- **The judge is an LLM** (${judgeModels}), scoring match against the recorded resolution and usefulness from the description alone, in one call per ticket. It can be biased (e.g. toward fluent or longer answers, or answers from its own model family), so treat scores as indicative, not ground truth.
- **Small sample:** ${results.length} tickets${results.length >= CATEGORY_NAMES.length ? ` (about ${Math.round(results.length / CATEGORY_NAMES.length)} per category)` : ""}. Differences of a few percentage points, especially per category, are within noise.
- **Synthetic data:** both the tickets and their "real" resolutions were generated by an LLM. The generated root cause often can't be inferred from the ticket text (e.g. a routing loop vs. congestion for the same lag complaint), so matching the exact fix is partly luck, and scores may not reflect real-world accuracy in either direction.
`;
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, md, "utf8");
}

// --- main ---

const limit = values.limit ? Number(values.limit) : undefined;
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
const judgeModel = values["judge-model"];
const judgeModelLabel = judgeModel ?? (config.LLM === "groq" ? config.GROQ_MODEL : config.GEMINI_MODEL);

if (!existsSync(HOLDOUT_PATH)) {
  console.error(`No holdout at ${HOLDOUT_PATH}. Run "npm run split" first.`);
  process.exit(1);
}
const holdout = JSON.parse(readFileSync(HOLDOUT_PATH, "utf8")) as Ticket[];
const selected = holdout.slice(0, limit ?? holdout.length);
const results = loadResults();
const done = new Set(results.map((r) => r.id));
const todo = selected.filter((t) => !done.has(t.id));
console.log(
  `Holdout ${holdout.length} · selected ${selected.length} · already done ${selected.length - todo.length} · to run ${todo.length} · judge ${judgeModelLabel}`,
);

try {
  for (const [i, ticket] of todo.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    const label = `[${i + 1}/${todo.length}] ${ticket.id} ${ticket.category} › ${ticket.subtopic}`;
    try {
      const r = await evaluateTicket(ticket, judgeModel, judgeModelLabel);
      results.push(r);
      saveResults(results);
      console.log(
        `${label}: catHit@5=${r.categoryHit5 ? "Y" : "N"} top1Cat=${r.top1Category ? "Y" : "N"} subHit@5=${r.subtopicHit5 ? "Y" : "N"} ` +
          `sim=${r.topSimilarity.toFixed(3)} #1=${r.top1Suitability}% match=${r.judge.top1Score}/${r.judge.bestOf3Score} ` +
          `useful=${r.judge.top1Useful}/${r.judge.bestOf3Useful} ` +
          `distinct=${r.judge.distinct ? "Y" : "N"}${r.leaked ? " ⚠️ LEAK" : ""}`,
      );
    } catch (err) {
      if (err instanceof LimitHitError) throw err;
      // Not saved, so a rerun will try this ticket again.
      console.error(`${label}: FAILED — ${(err as Error).message}`);
    }
  }
} catch (err) {
  if (!(err instanceof LimitHitError)) throw err;
  console.warn("\nLimit hit — rerun later, progress is saved.");
}

if (results.length === 0) {
  console.log("No results yet.");
} else {
  writeReport(results, holdout.length);
  const s = summarize(results);
  console.log(`\nSummary (all ${results.length} saved results):`);
  console.table({
    n: s.n,
    "categoryHit@5": s.categoryHit5,
    top1Category: s.top1Category,
    "subtopicHit@5": s.subtopicHit5,
    "avg top1Score (match)": s.avgTop1Score,
    "avg bestOf3Score (match)": s.avgBestOf3Score,
    "avg top1Useful": s.avgTop1Useful,
    "avg bestOf3Useful": s.avgBestOf3Useful,
    distinct: s.distinct,
    "avg #1 suitability": s.avgTop1Suitability,
  });
  console.log(`Results: ${RESULTS_PATH}\nReport:  ${REPORT_PATH}`);
}
