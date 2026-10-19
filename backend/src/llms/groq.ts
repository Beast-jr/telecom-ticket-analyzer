import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { config } from "../config.js";
import type { ChatOptions } from "./gemini.js";

const client = new OpenAI({
  apiKey: config.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const GPT_OSS_MAX_TOKENS = 8000;

// Groq rejects json_object output it can't validate with 400 code "json_validate_failed".
function isJsonValidateFailed(err: unknown): boolean {
  const e = err as { status?: number; code?: string; error?: { code?: string }; message?: string };
  return (
    e?.status === 400 &&
    (e.code === "json_validate_failed" || e.error?.code === "json_validate_failed" || /json_validate_failed/.test(e.message ?? ""))
  );
}

// Pull a JSON object out of free text: strip ``` fences, take first "{" to last "}".
function extractJson(text: string): string {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SyntaxError("No JSON object found in model output");
  const json = unfenced.slice(start, end + 1);
  JSON.parse(json); // throws SyntaxError if still invalid
  return json;
}

export async function chat(
  messages: ChatCompletionMessageParam[],
  { json = false, temperature, maxTokens, model = config.GROQ_MODEL }: ChatOptions = {},
): Promise<string> {
  const isGptOss = model.startsWith("openai/gpt-oss");
  const maxCompletionTokens = maxTokens ?? (isGptOss ? GPT_OSS_MAX_TOKENS : undefined);
  const request = (useResponseFormat: boolean) =>
    client.chat.completions.create({
      model,
      messages,
      temperature,
      ...(isGptOss ? { reasoning_effort: "low" as const } : {}),
      ...(maxCompletionTokens ? { max_completion_tokens: maxCompletionTokens } : {}),
      ...(useResponseFormat ? { response_format: { type: "json_object" as const } } : {}),
    });

  if (!json) {
    const completion = await request(false);
    return completion.choices[0]?.message?.content ?? "";
  }

  try {
    const completion = await request(true);
    return completion.choices[0]?.message?.content ?? "";
  } catch (err) {
    if (!isJsonValidateFailed(err)) throw err;
    console.warn("  [groq] json_validate_failed — fallback: retrying without response_format, extracting JSON manually.");
    const completion = await request(false);
    return extractJson(completion.choices[0]?.message?.content ?? "");
  }
}
