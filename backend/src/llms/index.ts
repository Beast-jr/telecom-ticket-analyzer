import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { config } from "../config.js";
import type { ChatOptions } from "./gemini.js";

export type { ChatOptions };

// Import lazily so only the active provider's client is constructed (and only its key is needed).
async function loadProvider() {
  switch (config.LLM) {
    case "gemini":
      return import("./gemini.js");
    case "groq":
      return import("./groq.js");
    default:
      throw new Error(`LLM "${config.LLM}" is not implemented yet.`);
  }
}

export async function chat(messages: ChatCompletionMessageParam[], options?: ChatOptions): Promise<string> {
  const provider = await loadProvider();
  return provider.chat(messages, options);
}
