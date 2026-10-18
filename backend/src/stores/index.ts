import { config } from "../config.js";
import type { SearchResult, StoredTicket } from "./local-store.js";

export type { SearchResult, StoredTicket };

// Import lazily so only the active store is loaded.
async function loadStore() {
  switch (config.STORE) {
    case "local":
      return import("./local-store.js");
    default:
      throw new Error(`STORE "${config.STORE}" is not implemented yet.`);
  }
}

export async function upsert(tickets: StoredTicket[]): Promise<void> {
  return (await loadStore()).upsert(tickets);
}

export async function search(vector: number[], k = 5, category?: string): Promise<SearchResult[]> {
  return (await loadStore()).search(vector, k, category);
}

export async function count(): Promise<number> {
  return (await loadStore()).count();
}

// Local store only: point it at a different vectors file (e.g. for tests).
export async function setVectorsPath(p: string): Promise<void> {
  const store = await loadStore();
  if ("setVectorsPath" in store) store.setVectorsPath(p);
}
