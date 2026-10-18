import { z } from "zod";

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
// Counts "1." / "2)" style step markers at the start of the string or after whitespace.
const numberedSteps = (s: string) => (s.match(/(?:^|\s)\d+[.)]\s/g) ?? []).length;

export const SolutionSchema = z.object({
  rank: z.number().int().min(1).max(3),
  // "~8 words": allow a little slack so a 9-word title doesn't fail the whole reply.
  title: z.string().min(1).refine((s) => wordCount(s) <= 10, { message: "title must be at most ~8 words" }),
  steps: z.string().refine((s) => numberedSteps(s) >= 2 && numberedSteps(s) <= 5, {
    message: 'steps must be 2-5 numbered actions like "1) ... 2) ..."',
  }),
  llmScore: z.number().int().min(0).max(100),
  sourceTicketIds: z.array(z.string()).min(1),
});

export type Solution = z.infer<typeof SolutionSchema>;

export const LlmAnalysisSchema = z.object({
  solutions: z
    .array(SolutionSchema)
    .length(3)
    .refine((s) => new Set(s.map((x) => x.rank)).size === 3, { message: "ranks must be 1, 2 and 3" }),
  note: z.string().nullable().default(null),
});

export type LlmAnalysis = z.infer<typeof LlmAnalysisSchema>;

export const SimilarTicketSchema = z.object({
  id: z.string(),
  category: z.string(),
  subtopic: z.string(),
  similarity: z.number().min(0).max(1),
  description: z.string(),
  resolution: z.string(),
});

export type SimilarTicket = z.infer<typeof SimilarTicketSchema>;
