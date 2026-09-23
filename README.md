# ContextForge

CI regression testing for RAG applications.

A change to a RAG pipeline — chunking, embeddings, retrieval, reranking,
prompts, models — can make answers measurably worse while the application
still starts, serves traffic and passes every unit test. Nothing raises an
error, so the drop is invisible until users complain.

ContextForge runs a frozen evaluation set against the pull request branch,
compares the scores to a stored baseline from the merge base, and reports
pass or fail on the PR before the change is merged.

## Status

**Stage 2 of 9 complete.** The workspace and CI are in place,
`examples/sample-rag-app` is a working reference application implementing the
app contract, and the `contextforge` binary validates `contextforge.yml`. The
evaluator, dataset generation, runner, comparator and report do not exist yet.
See `docs/TASKS.md` for the staged plan and the current stage.

## Requirements

- Node 20 or newer (developed on Node 26; `.nvmrc` pins 26)
- pnpm 10 — `corepack enable pnpm`, or run it through `npx pnpm@10`
- Docker and Docker Compose (needed from stage 1 onwards)

## Getting started

```sh
pnpm install
pnpm test        # vitest
pnpm lint        # eslint + prettier --check
pnpm typecheck   # tsc --build --force
pnpm build       # tsc --build
```

To see the reference app run without needing an API key:

```sh
cd examples/sample-rag-app
PROVIDER=local docker compose -f docker-compose.eval.yml up --build
curl -X POST localhost:8000/query -H 'content-type: application/json' \
  -d '{"question":"What is the refund window?"}'
```

To check a configuration:

```sh
pnpm --filter @contextforge/cli dev -- validate --config examples/contextforge.yml
```

The judge endpoint is configuration, not a constant. `evaluation.judge.base_url`
points at any OpenAI-compatible endpoint — OpenAI, Azure, a proxy, a gateway or
a self-hosted server — and `api_key_env` names the environment variable holding
the key, which never appears in the config file.

Copy `.env.example` to `.env` and fill in the keys you need. `.env` is
git-ignored; secrets come from the environment only and are never baked into
an image.

## Layout

```
packages/shared   types shared across packages
packages/cli      the core: config, dataset, runner, evaluator client, compare, report
packages/action   thin GitHub Action wrapper over the core
evaluator/        Python and Ragas, JSON in and JSON out (stage 3)
examples/         sample RAG app implementing the app contract
benchmark/        frozen test cases and per-commit baselines (stage 4 onwards)
```

The core knows nothing about GitHub; the Action is a thin wrapper. That split
is what keeps the tool portable to another CI system later.

## Documentation

Read in this order. `CLAUDE.md` is the working agreement for the repo.

| File | What it is |
|---|---|
| `docs/PRD.md` | Problem, goals, users, MVP scope |
| `docs/ARCHITECTURE.md` | App flow, tech stack, folder structure |
| `docs/RULES.md` | Principles, technology rules, coding standards |
| `docs/DESIGN.md` | App contract, config schema, benchmark and report formats |
| `docs/TASKS.md` | Staged plan, exit criteria, current stage |
| `docs/MEMORY.md` | Log of changes and decisions |

## Licence

MIT
