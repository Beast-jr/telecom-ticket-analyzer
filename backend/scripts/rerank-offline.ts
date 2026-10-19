// Re-rank saved eval results under different rules, using the judge's per-solution
// scores. No LLM calls: every strategy just picks which of the 3 judged solutions is #1.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { finalizeSolutions, LOW_EVIDENCE_LLM_CAP, MIN_SOURCES_FOR_HIGH_SCORE } from "../src/rag/rank.js";
import type { EvalResult, EvalSolution } from "../src/types/eval.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_PATH = path.join(ROOT, "docs/rerank-offline.md");

const { values } = parseArgs({ options: { tag: { type: "string" }, file: { type: "string" } } });
const file = values.file
  ? path.resolve(values.file)
  : path.join(ROOT, `data/eval/results${values.tag ? `-${values.tag}` : ""}.json`);
if (!existsSync(file)) {
  console.error(`No results at ${file}.`);
  process.exit(1);
}

const all = JSON.parse(readFileSync(file, "utf8")) as EvalResult[];
// Per-solution judge scores and source ids are required to re-rank.
const results = all.filter((r) => Array.isArray(r.judge?.solutions) && r.solutions.every((s) => Array.isArray(s.sourceTicketIds)));
const skipped = all.length - results.length;
if (results.length === 0) {
  console.error(`${file} has no results with per-solution judge scores (${all.length} older results). Run eval with the new judge first.`);
  process.exit(1);
}

// A strategy returns the shipped rank of the solution it would put first.
type Strategy = { name: string; description: string; pickRank: (r: EvalResult) => number };

const blendPick = (evidenceCap: boolean) => (r: EvalResult) => {
  // Re-blend from the LLM's raw scores, so this works whether the run had the cap on or off.
  const raw = r.solutions.map((s: EvalSolution) => ({ ...s, llmScore: s.rawLlmScore ?? s.llmScore }));
  const reranked = finalizeSolutions(raw, r.retrieved, { evidenceCap });
  // finalizeSolutions renumbers ranks; map #1 back to its shipped rank by title + steps.
  const top = reranked[0];
  return r.solutions.find((s) => s.title === top.title && s.steps === top.steps)?.rank ?? 1;
};

const STRATEGIES: Strategy[] = [
  { name: "(a) shipped", description: "the order the pipeline actually returned", pickRank: () => 1 },
  {
    name: "(b) evidence cap",
    description: `blend with llmScore capped at ${LOW_EVIDENCE_LLM_CAP} when a solution has < ${MIN_SOURCES_FOR_HIGH_SCORE} source tickets`,
    pickRank: blendPick(true),
  },
  { name: "(b0) blend, no cap", description: "the Day 6 blend without the evidence cap", pickRank: blendPick(false) },
  {
    name: "(c) most sources",
    description: "the solution citing the most source tickets (ties: shipped order)",
    pickRank: (r) => [...r.solutions].sort((a, b) => b.sourceTicketIds.length - a.sourceTicketIds.length || a.rank - b.rank)[0].rank,
  },
];

const judged = (r: EvalResult, rank: number) => r.judge.solutions.find((s) => s.rank === rank)!;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f2 = (x: number) => x.toFixed(2);

const rows = STRATEGIES.map((s) => {
  const picks = results.map((r) => ({ r, rank: s.pickRank(r) }));
  return {
    name: s.name,
    description: s.description,
    useful: avg(picks.map(({ r, rank }) => judged(r, rank).useful)),
    match: avg(picks.map(({ r, rank }) => judged(r, rank).match)),
    changed: picks.filter(({ rank }) => rank !== 1).length,
  };
});
rows.push({
  name: "(d) oracle",
  description: "best of the 3 first, per metric (upper bound for any re-ranking)",
  useful: avg(results.map((r) => r.judge.bestOf3Useful)),
  match: avg(results.map((r) => r.judge.bestOf3Score)),
  changed: results.filter((r) => judged(r, 1).useful < r.judge.bestOf3Useful).length,
});

const shipped = rows[0];
const table = (headers: string[], body: (string | number)[][]) =>
  [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const signed = (x: number) => (x > 0 ? `+${f2(x)}` : f2(x));

// Tickets where the evidence cap rule changes #1 vs what was shipped.
const capChanges = results
  .map((r) => ({ r, rank: blendPick(true)(r) }))
  .filter(({ rank }) => rank !== 1)
  .map(({ r, rank }) => {
    const before = judged(r, 1);
    const after = judged(r, rank);
    return [
      r.id,
      `${r.category} › ${r.subtopic}`,
      `${r.solutions[0].title} (${r.solutions[0].sourceTicketIds.length} src)`,
      `${r.solutions.find((s) => s.rank === rank)!.title} (${r.solutions.find((s) => s.rank === rank)!.sourceTicketIds.length} src)`,
      `${before.useful} → ${after.useful}`,
      `${before.match} → ${after.match}`,
    ];
  });

const shippedCap = [...new Set(results.map((r) => r.evidenceCap ?? "unknown"))].join(", ");
const md = `# Offline re-ranking

Re-ranks the 3 judged solutions of each ticket in \`${path.relative(ROOT, file).replaceAll("\\", "/")}\` under different rules and reports how good #1 would have been. **No LLM calls**: the judge already scored all 3 solutions per ticket, so any re-ranking can be scored for free.

n = ${results.length}${skipped ? ` (${skipped} older results without per-solution scores skipped)` : ""} · results were produced with EVIDENCE_CAP=${shippedCap}.

${table(
  ["Strategy", "avg #1 useful", "Δ vs shipped", "avg #1 match", "Δ vs shipped", "#1 changed", "Rule"],
  rows.map((r) => [
    r.name,
    f2(r.useful),
    r === shipped ? "-" : signed(r.useful - shipped.useful),
    f2(r.match),
    r === shipped ? "-" : signed(r.match - shipped.match),
    r === shipped ? "-" : `${r.changed}/${results.length}`,
    r.description,
  ]),
)}

Scores are the judge's 1–5. For the oracle, "#1 changed" counts tickets where a more useful option than the shipped #1 existed.

## Where the evidence cap changes #1

${
  capChanges.length
    ? table(["Ticket", "Category › subtopic", "Shipped #1", "Cap-rule #1", "useful", "match"], capChanges)
    : "_The cap rule picks the same #1 as shipped for every ticket._"
}

## Notes

- The gap between **(a) shipped** and **(d) oracle** is the most any re-ranking of these same 3 solutions could gain; closing it doesn't need better solutions, only a better order.
- All 3 solutions are scored in one judge call that sees them together, so each score may be influenced by the others; re-ranked results are an estimate, not a fresh evaluation.
- Small n: a difference of ~0.1–0.2 on a 1–5 scale can be noise.
`;

mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, md, "utf8");
console.table(
  Object.fromEntries(
    rows.map((r) => [r.name, { "#1 useful": f2(r.useful), "#1 match": f2(r.match), "#1 changed": r === shipped ? "-" : r.changed }]),
  ),
);
console.log(`n=${results.length}${skipped ? ` (skipped ${skipped})` : ""} · wrote ${OUT_PATH}`);
