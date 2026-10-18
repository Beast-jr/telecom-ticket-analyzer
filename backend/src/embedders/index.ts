import { config } from "../config.js";

// Import lazily so only the active embedder is loaded.
async function loadEmbedder() {
  switch (config.EMBEDDER) {
    case "local":
      return import("./local-minilm.js");
    default:
      throw new Error(`EMBEDDER "${config.EMBEDDER}" is not implemented yet.`);
  }
}

export async function embed(text: string): Promise<number[]> {
  return (await loadEmbedder()).embed(text);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  return (await loadEmbedder()).embedBatch(texts);
}
