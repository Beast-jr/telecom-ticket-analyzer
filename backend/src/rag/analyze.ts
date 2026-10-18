import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import { embed } from "../embedders/index.js";
import { chat } from "../llms/index.js";
import { buildSolutionPrompt } from "../prompts/solution-prompt.js";
import { search } from "../stores/index.js";
import { LlmAnalysisSchema, type LlmAnalysis, type SimilarTicket } from "../types/analysis.js";
import { finalizeSolutions, type FinalSolution } from "./rank.js";

const TOP_K = 5;

export interface AnalysisResult {
  solutions: FinalSolution[];
  similarTickets: SimilarTicket[];
  note: string | null;
  timings: { embedMs: number; searchMs: number; llmMs: number };
}

// Returns the parsed analysis, or an error message to feed back to the model.
function parseReply(raw: string): { ok: true; data: LlmAnalysis } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `not valid JSON (${(err as Error).message})` };
  }
  const result = LlmAnalysisSchema.safeParse(json);
  return result.success ? { ok: true, data: result.data } : { ok: false, error: z.prettifyError(result.error) };
}

async function chatOrError(messages: ChatCompletionMessageParam[]): Promise<{ raw: string; error?: string }> {
  try {
    return { raw: await chat(messages, { json: true, temperature: 0.2 }) };
  } catch (err) {
    // groq.ts throws SyntaxError when even its no-response_format fallback isn't JSON.
    if (err instanceof SyntaxError) return { raw: "", error: `not valid JSON (${err.message})` };
    throw err;
  }
}

export async function analyzeTicket(description: string): Promise<AnalysisResult> {
  let t = performance.now();
  const vector = await embed(description);
  const embedMs = performance.now() - t;

  t = performance.now();
  const results = await search(vector, TOP_K);
  const searchMs = performance.now() - t;
  if (results.length === 0) throw new Error("Vector store is empty — run `npm run ingest` first.");

  const similarTickets: SimilarTicket[] = results.map(({ ticket, score }) => ({
    id: ticket.id,
    category: ticket.category,
    subtopic: ticket.subtopic,
    similarity: Math.min(1, Math.max(0, score)),
    description: ticket.description,
    resolution: ticket.resolution,
  }));

  t = performance.now();
  const messages = buildSolutionPrompt(description, similarTickets);
  let reply = await chatOrError(messages);
  let parsed = reply.error ? ({ ok: false, error: reply.error } as const) : parseReply(reply.raw);
  if (!parsed.ok) {
    const retryMessages: ChatCompletionMessageParam[] = [
      ...messages,
      ...(reply.raw ? [{ role: "assistant" as const, content: reply.raw }] : []),
      { role: "user", content: `Your last reply was invalid: ${parsed.error}. Reply with valid JSON only.` },
    ];
    reply = await chatOrError(retryMessages);
    parsed = reply.error ? ({ ok: false, error: reply.error } as const) : parseReply(reply.raw);
    if (!parsed.ok) throw new Error(`LLM returned an invalid analysis twice. Last error: ${parsed.error}`);
  }
  const llmMs = performance.now() - t;

  // Keep only sources we actually retrieved; fall back to the best match.
  const retrievedIds = new Set(similarTickets.map((s) => s.id));
  const grounded = parsed.data.solutions.map((s) => {
    const ids = [...new Set(s.sourceTicketIds.filter((id) => retrievedIds.has(id)))];
    return { ...s, sourceTicketIds: ids.length > 0 ? ids : [similarTickets[0].id] };
  });
  // Re-rank by blended suitability (LLM fit + retrieval evidence).
  const solutions = finalizeSolutions(grounded, similarTickets);

  return {
    solutions,
    similarTickets,
    note: parsed.data.note,
    timings: { embedMs: Math.round(embedMs), searchMs: Math.round(searchMs), llmMs: Math.round(llmMs) },
  };
}
