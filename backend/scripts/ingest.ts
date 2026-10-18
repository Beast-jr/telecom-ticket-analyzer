import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { embedBatch } from "../src/embedders/index.js";
import { buildEmbedText } from "../src/rag/embed-text.js";
import { count, setVectorsPath, upsert } from "../src/stores/index.js";
import type { Ticket } from "../src/types/ticket.js";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const BATCH_SIZE = 32;

const { values } = parseArgs({ options: { file: { type: "string" }, vectors: { type: "string" } } });
const file = values.file ? path.resolve(values.file) : path.join(DATA_DIR, "corpus.json");
const vectors = values.vectors ? path.resolve(values.vectors) : path.join(DATA_DIR, "vectors.json");
if (!existsSync(file)) {
  console.error(`No data at ${file}. Run "npm run split" first.`);
  process.exit(1);
}

await setVectorsPath(vectors);
const tickets = JSON.parse(readFileSync(file, "utf8")) as Ticket[];
console.log(`Ingesting ${tickets.length} tickets from ${file} → ${vectors}`);

const start = Date.now();
for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
  const batch = tickets.slice(i, i + BATCH_SIZE);
  const embeddings = await embedBatch(batch.map(buildEmbedText));
  // Upsert replaces by id, so re-running never creates duplicates.
  await upsert(batch.map((t, j) => ({ ...t, embedding: embeddings[j] })));
  console.log(`embedded ${Math.min(i + BATCH_SIZE, tickets.length)}/${tickets.length}`);
}

console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s. Store now holds ${await count()} tickets.`);
