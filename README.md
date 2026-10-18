# telecom-ticket-analyzer

A GenAI assistant that analyzes telecom support tickets using local embeddings and an LLM (Gemini by default).

## How to run backend

```bash
cd backend
npm install
cp .env.example .env   # then set GEMINI_API_KEY
npm run dev            # http://localhost:3000/api/health
```

Sanity checks:

```bash
npm run test:embed     # prints vector length 384 + first 5 numbers
npm run test:llm       # asks Gemini for {"greeting": "..."} and prints it
```

## How to run frontend

```bash
cd frontend
npm install
cp .env.example .env   # optional; defaults to http://localhost:3000
npm run dev            # http://localhost:5173
```
