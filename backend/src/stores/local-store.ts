import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import type { Ticket } from "../types/ticket.js";

export type StoredTicket = Ticket & { embedding: number[] };
export interface SearchResult {
  ticket: Ticket;
  score: number;
}

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let vectorsPath = path.resolve(BACKEND_DIR, config.STORE_VECTORS_PATH);
// In-memory cache of vectors.json, loaded on first use.
let cache: Map<string, StoredTicket> | null = null;

// Point the store at a different file (e.g. for tests). Clears the cache.
export function setVectorsPath(p: string) {
  vectorsPath = path.resolve(p);
  cache = null;
}

function load(): Map<string, StoredTicket> {
  if (!cache) {
    const items = existsSync(vectorsPath) ? (JSON.parse(readFileSync(vectorsPath, "utf8")) as StoredTicket[]) : [];
    cache = new Map(items.map((t) => [t.id, t]));
  }
  return cache;
}

export async function upsert(tickets: StoredTicket[]): Promise<void> {
  const store = load();
  for (const t of tickets) store.set(t.id, t);
  mkdirSync(path.dirname(vectorsPath), { recursive: true });
  writeFileSync(vectorsPath, JSON.stringify([...store.values()]), "utf8");
}

// Embeddings are L2-normalized, so the dot product is the cosine similarity.
export async function search(vector: number[], k = 5, category?: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  for (const { embedding, ...ticket } of load().values()) {
    if (category && ticket.category !== category) continue;
    let score = 0;
    for (let i = 0; i < vector.length; i++) score += vector[i] * embedding[i];
    results.push({ ticket, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, k);
}

export async function count(): Promise<number> {
  return load().size;
}
