import { Router } from "express";
import { z } from "zod";
import { analyzeTicket } from "../rag/analyze.js";

const BodySchema = z.object({
  description: z
    .string({ error: "Please provide a ticket description." })
    .trim()
    .min(10, "Please describe the problem in at least 10 characters.")
    .max(2000, "Please keep the description under 2000 characters."),
});

function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  return e?.status === 429 || /429|quota|rate.?limit|resource.?exhausted/i.test(e?.message ?? "");
}

export const analyzeRouter = Router();

analyzeRouter.post("/api/analyze", async (req, res) => {
  const body = BodySchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid request." });
    return;
  }

  const start = performance.now();
  const { description } = body.data;
  try {
    const result = await analyzeTicket(description);
    const { embedMs, searchMs, llmMs } = result.timings;
    console.log(
      `POST /api/analyze len=${description.length} total=${Math.round(performance.now() - start)}ms ` +
        `embed=${embedMs}ms search=${searchMs}ms llm=${llmMs}ms`,
    );
    res.json(result);
  } catch (err) {
    console.error(`POST /api/analyze len=${description.length} failed after ${Math.round(performance.now() - start)}ms:`, err);
    if (isRateLimit(err)) {
      res.status(429).json({ error: "The AI service is busy, please try again in a minute." });
    } else {
      res.status(500).json({ error: "Something went wrong analyzing this ticket." });
    }
  }
});
