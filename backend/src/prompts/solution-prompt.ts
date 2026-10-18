import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SimilarTicket } from "../types/analysis.js";

const SYSTEM = `You are a senior telecom support lead at TeleNova.
You recommend fixes for a new customer ticket using ONLY the similar resolved tickets you are given as evidence. Do not invent fixes that no listed ticket supports.
Reply with JSON only.`;

export function buildSolutionPrompt(newTicket: string, similar: SimilarTicket[]): ChatCompletionMessageParam[] {
  const evidence = similar
    .map(
      (t, i) => `${i + 1}. [${t.id}] ${t.category} › ${t.subtopic} (similarity ${t.similarity.toFixed(2)})
   Problem: ${t.description}
   Fix: ${t.resolution}`,
    )
    .join("\n\n");
  const ids = similar.map((t) => `"${t.id}"`).join(", ");

  const user = `New ticket:
"""
${newTicket}
"""

Similar resolved tickets:
${evidence}

Task: propose exactly 3 DISTINCT solutions for the new ticket (different approaches, not rewordings of the same fix), ranked best first.
No two solutions may share the same main action (e.g. two solutions that both reset the APN are not distinct).
For each solution:
- rank: 1, 2 or 3 (1 = best)
- title: short, at most 8 words
- steps: one string with 2-5 concrete numbered actions an agent can follow, formatted "1) ... 2) ... 3) ..."
- llmScore: integer 0-100 for how well this solution fits THIS ticket
- sourceTicketIds: ids of the listed tickets that support it; only use ids from: ${ids}

Scoring guide:
- 85-100: past tickets show this exact problem and fix
- 60-84: similar problem, the fix likely applies
- 30-59: partial match
- below 30: weak guess
Scores should differ between solutions; don't give everything 90+.
Do not use fixed steps like 90/80/70. Judge each solution separately: consider how many listed tickets support it and how closely their problem matches. Two solutions may have close scores if both are well supported.

Rules:
- Never copy reference numbers, transaction ids, amounts or customer names from the past tickets into the steps. Write general actions (e.g. "Reverse the duplicate debit", not "Reverse ₹599 via REF12345").
- If the past tickets don't really match the new ticket, still give 3 options, but set "note" to a short explanation of the weak match. Otherwise set "note" to null.

Output JSON only, exactly in this shape:
{"solutions":[{"rank":1,"title":"...","steps":"1) ... 2) ...","llmScore":0,"sourceTicketIds":["..."]}],"note":null}`;

  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}
