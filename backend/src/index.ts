import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { embed } from "./embedders/index.js";
import { analyzeRouter } from "./routes/analyze.js";
import { count } from "./stores/index.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    embedder: config.EMBEDDER,
    llm: config.LLM,
    store: config.STORE,
  });
});

app.use(analyzeRouter);

// Warm up: load the embedding model and the vectors now so the first request isn't slow.
await embed("warm-up");
console.log(`Model and ${await count()} vectors loaded`);

app.listen(config.PORT, () => {
  console.log(`Backend listening on http://localhost:${config.PORT}`);
});
