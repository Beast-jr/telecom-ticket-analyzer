import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CATEGORY_NAMES } from "../src/data/categories.js";
import type { Ticket } from "../src/types/ticket.js";

const DEFAULT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/tickets.json");
const MIN_DESCRIPTION_WORDS = 15;
const MIN_RESOLUTION_WORDS = 20;
const DUPLICATE_PREFIX_CHARS = 60;
const LOW_CATEGORY_WARNING = 110;

// Common UTF-8-read-as-Windows-1252 mojibake. Longest sequences first so prefixes don't win.
const MOJIBAKE: [string, string][] = [
  ["â‚¹", "₹"],
  ["â€™", "'"],
  ["â€˜", "'"],
  ["â€œ", '"'],
  ["â€\u009d", '"'],
  ["â€“", "-"],
  ["â€”", "-"],
  ["â€‘", "-"],
  ["â€¦", "..."],
  ["Ã©", "é"],
  ["Â ", " "],
];

function normalize(text: string): string {
  let s = text;
  for (const [bad, good] of MOJIBAKE) s = s.split(bad).join(good);
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

const duplicateKey = (description: string) =>
  description
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DUPLICATE_PREFIX_CHARS);

const { values } = parseArgs({ options: { file: { type: "string" } } });
const file = values.file ? path.resolve(values.file) : DEFAULT_FILE;
if (!existsSync(file)) {
  console.error(`No data at ${file}.`);
  process.exit(1);
}

const backup = path.join(path.dirname(file), `${path.basename(file, ".json")}.raw.json`);
copyFileSync(file, backup);
console.log(`Backed up ${file} → ${backup}`);

const tickets = JSON.parse(readFileSync(file, "utf8")) as Ticket[];

const seenIds = new Map<string, number>();
for (const t of tickets) seenIds.set(t.id, (seenIds.get(t.id) ?? 0) + 1);
const duplicateIds = [...seenIds].filter(([, n]) => n > 1).map(([id]) => id);
if (duplicateIds.length > 0) {
  console.error(`Duplicate ids found, not writing anything: ${duplicateIds.join(", ")}`);
  process.exit(1);
}

const removed = { shortDescription: 0, shortResolution: 0, nearDuplicate: 0 };
const seenKeys = new Set<string>();
const cleaned: Ticket[] = [];

for (const t of tickets) {
  const ticket: Ticket = {
    ...t,
    subtopic: normalize(t.subtopic),
    description: normalize(t.description),
    resolution: normalize(t.resolution),
  };
  if (wordCount(ticket.description) < MIN_DESCRIPTION_WORDS) {
    removed.shortDescription++;
    continue;
  }
  if (wordCount(ticket.resolution) < MIN_RESOLUTION_WORDS) {
    removed.shortResolution++;
    continue;
  }
  const key = duplicateKey(ticket.description);
  if (seenKeys.has(key)) {
    removed.nearDuplicate++;
    continue;
  }
  seenKeys.add(key);
  cleaned.push(ticket);
}

writeFileSync(file, JSON.stringify(cleaned, null, 2) + "\n", "utf8");

console.log(`\nRead ${tickets.length}, kept ${cleaned.length}, removed ${tickets.length - cleaned.length}.`);
console.log("Removed by reason:");
console.table({
  [`description < ${MIN_DESCRIPTION_WORDS} words`]: { count: removed.shortDescription },
  [`resolution < ${MIN_RESOLUTION_WORDS} words`]: { count: removed.shortResolution },
  [`near-duplicate (first ${DUPLICATE_PREFIX_CHARS} chars)`]: { count: removed.nearDuplicate },
});

console.log("Final count per category:");
const counts = Object.fromEntries(CATEGORY_NAMES.map((c) => [c, cleaned.filter((t) => t.category === c).length]));
console.table(Object.fromEntries(Object.entries(counts).map(([c, n]) => [c, { count: n }])));
for (const [c, n] of Object.entries(counts)) {
  if (n < LOW_CATEGORY_WARNING) console.warn(`WARNING: ${c} has ${n} tickets (below ${LOW_CATEGORY_WARNING}).`);
}
console.log(`Wrote ${file}`);
