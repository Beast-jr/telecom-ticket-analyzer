import path from "node:path";
import { parseArgs } from "node:util";
import { analyzeTicket } from "../src/rag/analyze.js";
import { setVectorsPath } from "../src/stores/index.js";

const { values, positionals } = parseArgs({ options: { vectors: { type: "string" } }, allowPositionals: true });
const description = positionals.join(" ").trim();
if (!description) {
  console.error('Usage: npm run analyze -- "<ticket description>" [--vectors <path>]');
  process.exit(1);
}
if (values.vectors) await setVectorsPath(path.resolve(values.vectors));

const { solutions, similarTickets, note, timings } = await analyzeTicket(description);

console.log(`Ticket: "${description}"\n`);
console.log("Similar tickets:");
for (const t of similarTickets) {
  console.log(`  ${t.similarity.toFixed(3)}  ${t.id}  ${t.category} › ${t.subtopic}`);
}

for (const s of solutions) {
  console.log(
    `\n#${s.rank}  ${s.title}  (suitability ${s.suitability}% = llmScore ${s.llmScore}, avgSim ${s.avgSim}, bonus +${s.evidenceBonus})`,
  );
  console.log(`    sources: ${s.sourceTicketIds.join(", ")}`);
  // Put each numbered step on its own line.
  for (const step of s.steps.split(/\s+(?=\d+[.)]\s)/)) console.log(`    ${step.trim()}`);
}

console.log(`\nNote: ${note ?? "(none)"}`);
console.log(`Timings: embed ${timings.embedMs}ms, search ${timings.searchMs}ms, llm ${timings.llmMs}ms`);
