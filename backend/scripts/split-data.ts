import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CATEGORIES } from "../src/data/categories.js";
import type { Ticket } from "../src/types/ticket.js";

const DEFAULT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/tickets.json");
const HOLDOUT_SIZE = 50;
const SEED = 42;
const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;

// mulberry32: small seeded PRNG so the split is reproducible.
function makeRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
const openingPhrase = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean).slice(0, 4).join(" ");

const { values } = parseArgs({ options: { file: { type: "string" }, "out-dir": { type: "string" } } });
const file = values.file ? path.resolve(values.file) : DEFAULT_FILE;
const outDir = values["out-dir"] ? path.resolve(values["out-dir"]) : path.dirname(file);
if (!existsSync(file)) {
  console.error(`No data at ${file}.`);
  process.exit(1);
}

// Sort by id so the split depends only on the data, not on file order.
const tickets = (JSON.parse(readFileSync(file, "utf8")) as Ticket[]).sort((a, b) => a.id.localeCompare(b.id));
const random = makeRandom(SEED);

// ~6 per category; the remainder goes to the largest categories (ties: category order).
const byCategory = new Map(CATEGORIES.map((c) => [c.name as string, tickets.filter((t) => t.category === c.name)]));
const quota = new Map(CATEGORIES.map((c) => [c.name as string, Math.floor(HOLDOUT_SIZE / CATEGORIES.length)]));
const remainder = HOLDOUT_SIZE % CATEGORIES.length;
[...CATEGORIES]
  .sort((a, b) => byCategory.get(b.name)!.length - byCategory.get(a.name)!.length)
  .slice(0, remainder)
  .forEach((c) => quota.set(c.name, quota.get(c.name)! + 1));

const holdoutIds = new Set<string>();
for (const { name, subtopics } of CATEGORIES) {
  const want = quota.get(name)!;
  // Round-robin over shuffled subtopics, taking a random ticket from each in turn.
  const pools = shuffle([...subtopics], random)
    .map((s) => shuffle(byCategory.get(name)!.filter((t) => t.subtopic === s), random))
    .filter((p) => p.length > 0);
  let taken = 0;
  while (taken < want && pools.some((p) => p.length > 0)) {
    for (const pool of pools) {
      if (taken >= want) break;
      const t = pool.shift();
      if (t) {
        holdoutIds.add(t.id);
        taken++;
      }
    }
  }
  if (taken < want) console.warn(`WARNING: ${name} only had ${taken} tickets for a holdout quota of ${want}.`);
}

const holdout = tickets.filter((t) => holdoutIds.has(t.id));
const corpus = tickets.filter((t) => !holdoutIds.has(t.id));
if (holdout.length + corpus.length !== tickets.length || corpus.some((t) => holdoutIds.has(t.id))) {
  throw new Error("Split overlap detected — refusing to write.");
}

const write = (name: string, content: string) => {
  const p = path.join(outDir, name);
  writeFileSync(p, content, "utf8");
  console.log(`Wrote ${p}`);
};
write("holdout.json", JSON.stringify(holdout, null, 2) + "\n");
write("corpus.json", JSON.stringify(corpus, null, 2) + "\n");

// --- stats.md ---
const table = (headers: string[], rows: (string | number)[][]) =>
  [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join(
    "\n",
  );
const count = (list: Ticket[], pred: (t: Ticket) => boolean) => list.filter(pred).length;
const avgWords = (list: Ticket[]) =>
  list.length ? (list.reduce((sum, t) => sum + wordCount(t.description), 0) / list.length).toFixed(1) : "0";

const openings = new Map<string, number>();
for (const t of tickets) {
  const p = openingPhrase(t.description);
  openings.set(p, (openings.get(p) ?? 0) + 1);
}

const subtopicRows = CATEGORIES.flatMap(({ name, subtopics }) => {
  const inCategory = byCategory.get(name)!;
  const names = new Set<string>([...subtopics, ...inCategory.map((t) => t.subtopic)]);
  return [...names].map((s) => [name, s, count(inCategory, (t) => t.subtopic === s)]);
});

const md = `> Synthetic data generated with Gemini and Groq (gpt-oss-120b) via backend/scripts/generate-data.ts

# Dataset stats

Total: ${tickets.length} tickets (corpus ${corpus.length}, holdout ${holdout.length}). Holdout is stratified by category and subtopic, seed ${SEED}.

## Per category

${table(
  ["Category", "Corpus", "Holdout", "Total"],
  [
    ...CATEGORIES.map(({ name }) => [
      name,
      count(corpus, (t) => t.category === name),
      count(holdout, (t) => t.category === name),
      byCategory.get(name)!.length,
    ]),
    ["**All**", corpus.length, holdout.length, tickets.length],
  ],
)}

## Priority

${table(
  ["Priority", "Corpus", "Holdout", "Total"],
  PRIORITIES.map((p) => [p, count(corpus, (t) => t.priority === p), count(holdout, (t) => t.priority === p), count(tickets, (t) => t.priority === p)]),
)}

## Subtopics per category

${table(["Category", "Subtopic", "Count"], subtopicRows)}

## Average description length (words)

${table(
  ["Category", "Avg words"],
  [...CATEGORIES.map(({ name }) => [name, avgWords(byCategory.get(name)!)]), ["**All**", avgWords(tickets)]],
)}

## Top 10 opening phrases (first 4 words)

${table(
  ["Phrase", "Count"],
  [...openings].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, n]) => [`"${p}"`, n]),
)}
`;
write("stats.md", md);
