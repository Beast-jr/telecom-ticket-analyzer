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

## Dataset

~1000 synthetic, resolved support tickets for a fictional operator (TeleNova), across 8 categories with 6 subtopics each: Network/Connectivity, Billing, Service Activation, SIM & Porting, Roaming, Device/Handset, Plan Change, Complaint/Escalation. A stratified holdout of 50 tickets is kept aside for evaluation.

To regenerate (from `backend/`):

```bash
npm run gen      # generate tickets into data/tickets.json (resumable; rerun to top up)
npm run clean    # normalize text, drop short/near-duplicate tickets (backup: data/tickets.raw.json)
npm run split    # write data/corpus.json, data/holdout.json and data/stats.md
```

If `clean` warns that a category is low, run `gen` again to top it up, then `clean` and `split`.

Counts and distributions: [data/stats.md](data/stats.md).

## How to run frontend

```bash
cd frontend
npm install
cp .env.example .env   # optional; defaults to http://localhost:3000
npm run dev            # http://localhost:5173
```
