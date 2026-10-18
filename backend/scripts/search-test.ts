import path from "node:path";
import { parseArgs } from "node:util";
import { embed } from "../src/embedders/index.js";
import { search, setVectorsPath } from "../src/stores/index.js";

const { values, positionals } = parseArgs({ options: { vectors: { type: "string" } }, allowPositionals: true });
const query = positionals.join(" ").trim();
if (!query) {
  console.error('Usage: npm run search -- "<query>" [--vectors <path>]');
  process.exit(1);
}
if (values.vectors) await setVectorsPath(path.resolve(values.vectors));

const results = await search(await embed(query), 5);
console.log(`Query: "${query}"\n`);
for (const { ticket, score } of results) {
  console.log(`${score.toFixed(3)}  ${ticket.id}  ${ticket.category} › ${ticket.subtopic}`);
  console.log(`       ${ticket.description.slice(0, 100)}`);
}
