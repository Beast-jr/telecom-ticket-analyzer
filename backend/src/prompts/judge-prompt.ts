import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface JudgeSolution {
  rank: number;
  title: string;
  steps: string;
}

const SYSTEM = `You are a strict evaluator of telecom support answers at TeleNova.
You compare proposed solutions against the fix that actually resolved the ticket. Judge substance (what action fixes the problem), not wording, length or formatting.
Reply with JSON only.`;

export function buildJudgePrompt(ticket: string, realResolution: string, solutions: JudgeSolution[]): ChatCompletionMessageParam[] {
  const proposed = solutions.map((s) => `#${s.rank} ${s.title}\n   ${s.steps}`).join("\n\n");

  const user = `Customer ticket:
"""
${ticket}
"""

The REAL resolution (what actually fixed it):
"""
${realResolution}
"""

Our 3 proposed solutions, ranked:
${proposed}

Score EACH of the 3 solutions on two different things, judging each one on its own (not relative to the others):

- match (integer 1-5), compared with the real resolution: does this solution match the real fix? 5 = same fix, 4 = mostly the same, 3 = partly right, 2 = related but wrong action, 1 = wrong.
- useful (integer 1-5), ignoring the real resolution completely: would an experienced agent consider this solution a sensible, safe thing to try given only the customer's description? 5 = exactly what a good agent would try first, 3 = reasonable but not the obvious first step, 1 = irrelevant, unsafe or nonsensical.

Also:
- distinct (true/false): are the 3 solutions genuinely different approaches, not rewordings of the same main action?
- reason: one short sentence covering match and usefulness of solution #1.

Output JSON only, exactly in this shape, with one entry per solution using its rank (1, 2, 3):
{"solutions":[{"rank":1,"match":1,"useful":1},{"rank":2,"match":1,"useful":1},{"rank":3,"match":1,"useful":1}],"distinct":true,"reason":"..."}`;

  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}
