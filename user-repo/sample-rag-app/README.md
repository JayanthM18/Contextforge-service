# Sample RAG application

A small retrieval-augmented-generation app over 21 support documents for a
fictional retailer, Northwind Supply Co. It exists so every later ContextForge
stage has something real to build, run, query and measure.

It implements the app contract in `docs/DESIGN.md` section 1 exactly. If you
are making your own app work with ContextForge, this is the reference.

## Running it

```sh
# Offline: no API key, no network.
PROVIDER=local docker compose -f docker-compose.eval.yml up --build

# Real retrieval and generation.
OPENAI_API_KEY=sk-... docker compose -f docker-compose.eval.yml up --build

# Gemini chat generation and native Gemini embeddings.
PROVIDER=gemini GEMINI_API_KEY=... docker compose -f docker-compose.eval.yml up --build
```

Then:

```sh
curl localhost:8000/health
curl -X POST localhost:8000/query \
  -H 'content-type: application/json' \
  -d '{"question":"What is the refund window?"}'
```

Outside Docker, `node src/index.ts` from this directory does the same thing —
Node 26 runs TypeScript directly, so there is no build step.

## Providers

| | `openai` (default) | `gemini` | `local` |
|---|---|---|---|
| Embeddings | `text-embedding-3-small` | `gemini-embedding-001` | hashed TF-IDF bag of words |
| Generation | `gpt-4o-mini`, temperature 0 | `gemini-3.8-flash`, temperature 0 | extractive sentence picking |
| Needs a key | yes | yes | no |
| Network | yes | yes | no |

**`local` is for plumbing, not for quality.** It lets the runner, the
evaluator and CI be exercised without spending money or needing a key, and its
answers are deliberately crude. Measured against the six-question spot check in
`docs/MEMORY.md` it puts the right document in the top 5 every time and at rank
1 four times out of six. Never treat a number produced with `PROVIDER=local` as
a quality measurement.

## Configuration

Everything comes from the environment; nothing is baked into the image.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8000` | |
| `KNOWLEDGE_BASE_DIR` | `docs/knowledge-base` | Source documents |
| `PROVIDER` | `openai` | `openai`, `gemini` or `local` |
| `TOP_K` | `5` | Chunks passed to the model |
| `CHUNK_SIZE` | `900` | Characters |
| `CHUNK_OVERLAP` | `150` | Must be smaller than `CHUNK_SIZE` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | |
| `GENERATION_MODEL` | `gpt-4o-mini` | |
| `OPENAI_API_KEY` | — | Required when `PROVIDER=openai` |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Point at a compatible proxy |
| `GEMINI_API_KEY` | — | Required when `PROVIDER=gemini` |
| `GEMINI_EMBEDDING_BASE_URL` | Gemini API v1beta | Override the native Gemini embeddings API root |
| `REQUEST_TIMEOUT_MS` | `60000` | |

A bad value exits `2` and says which variable is wrong.

With `PROVIDER=gemini`, chat generation uses Gemini's OpenAI-compatible
endpoint and embeddings use the native `batchEmbedContents` API. A ready-to-
use evaluation configuration is provided at
`user-repo/contextforge.gemini.yml`; set `GEMINI_API_KEY` in the environment.

## How it works

`corpus.ts` reads the markdown files in sorted order and `chunk.ts` packs whole
paragraphs into ~900-character chunks with 150 characters of overlap. Each
chunk gets the id `<file>#c<n>` the contract asks for. `embed.ts` vectorises
them, `retrieve.ts` takes the `TOP_K` nearest by cosine similarity, and
`generate.ts` answers from those passages alone.

The index is built once at startup and held in memory. The server starts
listening *before* the index is ready and answers `/health` with `503
{"status":"starting"}` until it is, so a runner polling health gets an honest
answer instead of a refused connection.

Two things are deliberately deterministic, because ContextForge compares
retrieved context ids across runs and a value that drifts would look like a
regression that never happened: files are read in sorted order, and retrieval
ties break on chunk id.

## Tests

Run from the repository root with `pnpm test`. `test/contract.test.ts` asserts
the app contract against the real server and the real documents using the
offline provider, so it needs no key and makes no network call.
