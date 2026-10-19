import { z } from "zod";

const score = z.number().int().min(1).max(5);

// The judge scores each of our 3 solutions; the top1/bestOf3 summary fields are derived
// from those per-solution scores so they can never disagree.
export const JudgeSchema = z
  .object({
    solutions: z
      .array(z.object({ rank: z.number().int().min(1).max(3), match: score, useful: score }))
      .length(3)
      .refine((s) => new Set(s.map((x) => x.rank)).size === 3, { message: "solutions must have ranks 1, 2 and 3" }),
    distinct: z.boolean(),
    reason: z.string().min(1),
  })
  .transform((j) => {
    const solutions = [...j.solutions].sort((a, b) => a.rank - b.rank);
    return {
      ...j,
      solutions,
      top1Score: solutions[0].match,
      bestOf3Score: Math.max(...solutions.map((s) => s.match)),
      top1Useful: solutions[0].useful,
      bestOf3Useful: Math.max(...solutions.map((s) => s.useful)),
    };
  });

export type Judge = z.output<typeof JudgeSchema>;

export interface EvalSolution {
  rank: number;
  title: string;
  steps: string;
  suitability: number;
  // Blended value (after the evidence cap, if it applied).
  llmScore: number;
  rawLlmScore: number;
  evidenceCapped: boolean;
  sourceTicketIds: string[];
  avgSim: number;
  evidenceBonus: number;
}

export interface EvalResult {
  id: string;
  category: string;
  subtopic: string;
  description: string;
  realResolution: string;
  retrieved: { id: string; category: string; subtopic: string; similarity: number }[];
  categoryHit5: boolean;
  top1Category: boolean;
  subtopicHit5: boolean;
  topSimilarity: number;
  // Guard: a holdout ticket should never retrieve itself.
  leaked: boolean;
  // Solutions in the order we shipped them (rank 1 first).
  solutions: EvalSolution[];
  top1Suitability: number;
  evidenceCap: "on" | "off";
  judge: Judge;
  judgeModel: string;
  timings: { embedMs: number; searchMs: number; llmMs: number };
}
