// Why we blend scores: the LLM is good at judging whether a fix *fits* the new ticket,
// but it can't prove anything; it will happily say 95% for a weak match. Retrieval
// similarity is the evidence: how close the past tickets behind a solution really are.
// Blending the two (plus a small bonus when several past tickets agree) keeps the final
// percentage honest. A solution only scores high if the LLM likes it AND real tickets back it.
import type { SimilarTicket, Solution } from "../types/analysis.js";

const LLM_WEIGHT = 0.6;
const SIMILARITY_WEIGHT = 0.4;
const BONUS_PER_EXTRA_SOURCE = 3;
const MAX_EVIDENCE_BONUS = 6;

export type FinalSolution = Solution & {
  avgSim: number;
  evidenceBonus: number;
  suitability: number;
};

const clamp = (n: number) => Math.min(100, Math.max(0, n));

export function finalizeSolutions(solutions: Solution[], similarTickets: SimilarTicket[]): FinalSolution[] {
  const similarity = new Map(similarTickets.map((t) => [t.id, t.similarity]));

  return solutions
    .map((s) => {
      const sims = s.sourceTicketIds.map((id) => similarity.get(id) ?? 0);
      const avgSim = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
      const evidenceBonus = Math.min(MAX_EVIDENCE_BONUS, BONUS_PER_EXTRA_SOURCE * Math.max(0, sims.length - 1));
      const base = clamp(Math.round(LLM_WEIGHT * s.llmScore + SIMILARITY_WEIGHT * avgSim * 100));
      return { ...s, avgSim: Number(avgSim.toFixed(3)), evidenceBonus, suitability: clamp(base + evidenceBonus) };
    })
    .sort((a, b) => b.suitability - a.suitability || a.rank - b.rank)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
