// Why we blend scores: the LLM is good at judging whether a fix *fits* the new ticket,
// but it can't prove anything; it will happily say 95% for a weak match. Retrieval
// similarity is the evidence: how close the past tickets behind a solution really are.
// Blending the two (plus a small bonus when several past tickets agree) keeps the final
// percentage honest. A solution only scores high if the LLM likes it AND real tickets back it.
//
// Evidence cap: the LLM tends to give its highest score to the most technical-sounding fix,
// even when only one past ticket shows it. Prompting alone didn't stop that, so a solution
// backed by fewer than MIN_SOURCES_FOR_HIGH_SCORE tickets has its llmScore capped before
// blending. Toggle with EVIDENCE_CAP=off to compare.
import { config } from "../config.js";
import type { SimilarTicket, Solution } from "../types/analysis.js";

const LLM_WEIGHT = 0.6;
const SIMILARITY_WEIGHT = 0.4;
const BONUS_PER_EXTRA_SOURCE = 3;
const MAX_EVIDENCE_BONUS = 6;
export const MIN_SOURCES_FOR_HIGH_SCORE = 2;
export const LOW_EVIDENCE_LLM_CAP = 84;

export type FinalSolution = Solution & {
  // The LLM's own score before the evidence cap; llmScore is the value used in the blend.
  rawLlmScore: number;
  evidenceCapped: boolean;
  avgSim: number;
  evidenceBonus: number;
  suitability: number;
};

export interface RankOptions {
  evidenceCap?: boolean;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

export function finalizeSolutions(
  solutions: Solution[],
  similarTickets: Pick<SimilarTicket, "id" | "similarity">[],
  { evidenceCap = config.EVIDENCE_CAP === "on" }: RankOptions = {},
): FinalSolution[] {
  const similarity = new Map(similarTickets.map((t) => [t.id, t.similarity]));

  return solutions
    .map((s) => {
      const sims = s.sourceTicketIds.map((id) => similarity.get(id) ?? 0);
      const avgSim = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
      const evidenceBonus = Math.min(MAX_EVIDENCE_BONUS, BONUS_PER_EXTRA_SOURCE * Math.max(0, sims.length - 1));
      const evidenceCapped =
        evidenceCap && sims.length < MIN_SOURCES_FOR_HIGH_SCORE && s.llmScore > LOW_EVIDENCE_LLM_CAP;
      const llmScore = evidenceCapped ? LOW_EVIDENCE_LLM_CAP : s.llmScore;
      const base = clamp(Math.round(LLM_WEIGHT * llmScore + SIMILARITY_WEIGHT * avgSim * 100));
      return {
        ...s,
        llmScore,
        rawLlmScore: s.llmScore,
        evidenceCapped,
        avgSim: Number(avgSim.toFixed(3)),
        evidenceBonus,
        suitability: clamp(base + evidenceBonus),
      };
    })
    .sort((a, b) => b.suitability - a.suitability || a.rank - b.rank)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
