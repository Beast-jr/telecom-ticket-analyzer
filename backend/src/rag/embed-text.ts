import type { Ticket } from "../types/ticket.js";

// MiniLM truncates input at 256 tokens; ~180 words keeps us safely under that.
const MAX_WORDS = 180;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

// One ticket = one chunk. Tickets are short (a few sentences of problem plus a
// structured fix), and the point of retrieval is to find a past problem together with
// how it was resolved. Splitting a ticket would separate the problem from its fix.
export function buildEmbedText(ticket: Ticket): string {
  const head = `Category: ${ticket.category}. Subtopic: ${ticket.subtopic}. Problem: ${ticket.description}. Fix: `;
  const fix = words(ticket.resolution);
  // Over budget: trim the resolution first and always keep the whole problem.
  const budget = MAX_WORDS - words(head).length;
  if (fix.length <= budget) return head + ticket.resolution;
  return budget > 0 ? `${head}${fix.slice(0, budget).join(" ")} ...` : head.trimEnd();
}
