import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "../src/data/categories.js";
import type { Ticket } from "../src/types/ticket.js";

const TICKETS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/tickets.json");

if (!existsSync(TICKETS_PATH)) {
  console.log(`No data at ${TICKETS_PATH}. Run "npm run gen" first.`);
  process.exit(0);
}

const tickets = JSON.parse(readFileSync(TICKETS_PATH, "utf8")) as Ticket[];
console.log(`Total tickets: ${tickets.length}\n`);

console.log("Per category:");
console.table(
  Object.fromEntries(CATEGORIES.map((c) => [c.name, { count: tickets.filter((t) => t.category === c.name).length }])),
);

console.log("Per priority:");
console.table(
  Object.fromEntries(
    ["Low", "Medium", "High", "Critical"].map((p) => [p, { count: tickets.filter((t) => t.priority === p).length }]),
  ),
);

// Repeated openings are the easiest sign of templated LLM output.
const openings = new Map<string, number>();
for (const t of tickets) {
  const words = t.description.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);
  const phrase = words.slice(0, 4).join(" ");
  openings.set(phrase, (openings.get(phrase) ?? 0) + 1);
}
console.log("Top 10 opening 4-word phrases:");
for (const [phrase, count] of [...openings].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(count).padStart(4)}  "${phrase}"`);
}

for (const { name, subtopics } of CATEGORIES) {
  const inCategory = tickets.filter((t) => t.category === name);
  console.log(`\n${name} (${inCategory.length}):`);
  // Include unexpected subtopics too, so drift from the canonical list is visible.
  const names = new Set<string>([...subtopics, ...inCategory.map((t) => t.subtopic)]);
  for (const s of names) {
    console.log(`  ${s.padEnd(36)} ${inCategory.filter((t) => t.subtopic === s).length}`);
  }
}

const sample = [...tickets].sort(() => Math.random() - 0.5).slice(0, 3);
console.log("\nRandom samples:");
for (const t of sample) {
  console.log("\n" + "-".repeat(60));
  console.log(JSON.stringify(t, null, 2));
}
