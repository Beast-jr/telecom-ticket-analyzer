export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export interface Solution {
  rank: number
  title: string
  steps: string
  llmScore: number
  sourceTicketIds: string[]
  avgSim: number
  evidenceBonus: number
  suitability: number
}

export interface SimilarTicket {
  id: string
  category: string
  subtopic: string
  similarity: number
  description: string
  resolution: string
}

export interface AnalysisResult {
  solutions: Solution[]
  similarTickets: SimilarTicket[]
  note: string | null
  timings: { embedMs: number; searchMs: number; llmMs: number }
}

export class ApiError extends Error {}

const FALLBACK_MESSAGES: Record<number, string> = {
  400: 'Please check the ticket description and try again.',
  429: 'The AI service is busy, please try again in a minute.',
  500: 'Something went wrong analyzing this ticket.',
}

export async function analyzeTicket(description: string): Promise<AnalysisResult> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    })
  } catch {
    throw new ApiError("Can't reach the server")
  }

  const body = (await res.json().catch(() => null)) as (AnalysisResult & { error?: string }) | null
  if (!res.ok) {
    throw new ApiError(body?.error ?? FALLBACK_MESSAGES[res.status] ?? `Request failed (HTTP ${res.status}).`)
  }
  if (!body) throw new ApiError('The server sent an unreadable response.')
  return body
}
