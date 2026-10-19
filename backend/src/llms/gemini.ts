import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { config } from "../config.js";

const client = new OpenAI({
  apiKey: config.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

export interface ChatOptions {
  json?: boolean;
  temperature?: number;
  // Currently honored by groq.ts only.
  maxTokens?: number;
  // Override the configured model for this call.
  model?: string;
}

export async function chat(
  messages: ChatCompletionMessageParam[],
  { json = false, temperature, model }: ChatOptions = {},
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: model ?? config.GEMINI_MODEL,
    messages,
    temperature,
    ...(json ? { response_format: { type: "json_object" as const } } : {}),
  });
  return completion.choices[0]?.message?.content ?? "";
}
