import { z } from "zod";
import { CATEGORY_NAMES } from "../data/categories.js";

const minWords = (n: number) =>
  z.string().refine((s) => s.trim().split(/\s+/).filter(Boolean).length >= n, {
    message: `Must be at least ${n} words`,
  });

export const TicketSchema = z.object({
  id: z.string().regex(/^TKT-\d{4,}$/),
  category: z.enum(CATEGORY_NAMES),
  subtopic: z.string().min(1),
  priority: z.enum(["Low", "Medium", "High", "Critical"]),
  description: minWords(15),
  resolution: minWords(20),
  status: z.literal("Resolved"),
});

export type Ticket = z.infer<typeof TicketSchema>;

// What the LLM returns: no id yet, and status may be omitted.
export const TicketDraftSchema = TicketSchema.omit({ id: true }).extend({
  status: z.literal("Resolved").default("Resolved"),
});

export type TicketDraft = z.infer<typeof TicketDraftSchema>;
