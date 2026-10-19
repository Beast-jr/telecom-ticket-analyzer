import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ quiet: true });

// Treat empty strings (e.g. "GROQ_API_KEY=" copied from .env.example) as unset.
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);

const EnvSchema = z.object({
  EMBEDDER: z.enum(["local", "azure"]).default("local"),
  LLM: z.enum(["gemini", "groq", "azure"]).default("gemini"),
  STORE: z.enum(["local", "azure"]).default("local"),
  // Local store file; relative paths resolve from backend/.
  STORE_VECTORS_PATH: optionalString.transform((v) => v ?? "../data/vectors.json"),
  // Cap llmScore for solutions backed by fewer than 2 tickets (see rag/rank.ts).
  EVIDENCE_CAP: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["on", "off"]).default("on"),
  ),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString.transform((v) => v ?? "gemini-2.5-flash"),
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: optionalString.transform((v) => v ?? "llama-3.3-70b-versatile"),
  PORT: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().positive().default(3000),
  ),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

const env = parsed.data;

if (env.LLM === "gemini" && !env.GEMINI_API_KEY) {
  throw new Error('LLM is "gemini" but GEMINI_API_KEY is missing. Add it to backend/.env.');
}
if (env.LLM === "groq" && !env.GROQ_API_KEY) {
  throw new Error('LLM is "groq" but GROQ_API_KEY is missing. Add it to backend/.env.');
}
if (env.LLM === "groq" && !env.GROQ_MODEL) {
  throw new Error('LLM is "groq" but GROQ_MODEL is missing. Add it to backend/.env.');
}

export const config = env;
export type Config = typeof config;
