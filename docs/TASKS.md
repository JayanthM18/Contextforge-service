# Tasks

Nine stages. Each ends with something runnable, a demo command you run
yourself, and a review gate. Do not start a stage before the previous gate has
passed. Append to `docs/MEMORY.md` at every gate.

**Current stage: 0**

---

## Stage 0 — Scaffold

pnpm workspace, TypeScript strict config, Vitest, ESLint, `.env.example`, and a
CI workflow that only lints and tests this repo. No product code.

- Demo: `pnpm install && pnpm test && pnpm lint` all pass
- Gate: builds from a clean clone on another team member's machine
- Owner: _____

## Stage 1 — Sample RAG app

A small app in `examples/sample-rag-app/` implementing the app contract in
`docs/DESIGN.md` over about 20 documents, with a Dockerfile. This exists so
every later stage has something real to test against.

- Demo: `docker compose up`, then a `curl` POST to `/query` returns an answer with contexts
- Gate: the response matches the contract exactly, including `contexts[].id`
- Owner: _____

## Stage 2 — Config loader

Parse and validate `contextforge.yml` per `docs/DESIGN.md` section 2, with
errors that name the offending key.

- Demo: `contextforge validate --config examples/contextforge.yml`
- Gate: tests cover at least six invalid configs; every error names the bad key
- Owner: _____

## Stage 3 — Evaluator container

Python and Ragas in `evaluator/`. Reads a JSON file of cases with answers and
contexts, writes a JSON file of per-case scores. No Git or CI awareness.

- Demo: `docker run ... evaluator < fixtures/sample-results.json` prints scores
- Gate: the same input twice at temperature 0 scores within a documented tolerance
- Owner: _____

## Stage 4 — Dataset generation

`contextforge dataset generate` produces `benchmark/testcases.json` from the
source documents, for a human to review and commit.

- Demo: generate 20 cases from the sample app's documents, read them, delete the bad ones
- Gate: file matches the benchmark format; regeneration is always an explicit command
- Owner: _____

## Stage 5 — Runner (dual mode)

Build and start baseline and candidate through Compose, health-check, query
every case, collect answers and contexts, tear down cleanly on success and on
failure.

- Demo: `contextforge run --mode dual --baseline main --candidate HEAD` writes two result files
- Gate: no stray containers after a forced failure; `startup_timeout` honoured
- Owner: _____

## Stage 6 — Comparator, thresholds and the noise floor

Pure comparison logic over two result sets. Before setting defaults, run `main`
against itself five times and record the per-metric spread. That number is the
noise floor and it goes in `docs/MEMORY.md`.

- Demo: `contextforge compare a.json b.json` prints a verdict and the regressed cases
- Gate: noise floor measured and recorded; defaults sit above it; comparison logic is pure and fully unit tested
- Owner: _____

## Stage 7 — Cached benchmark mode

The push-to-main workflow writes `benchmark/baseline/<sha>.json`. Pull requests
resolve the merge base, check the fingerprint, and choose: stored scores,
re-judge stored answers, or dual mode.

- Demo: open a PR; CI builds only the candidate and still returns a verdict
- Gate: cached and dual mode agree on the same PR; every fingerprint branch has a test
- Owner: _____

## Stage 8 — Action and reporting

The GitHub Action wrapper, a sticky PR comment updated on each push, the check
status, and the HTML artifact.

- Demo: a real PR comment with a metric table and a blocked merge
- Gate: comment updates rather than duplicating; exit codes distinguish regression from tool error
- Owner: _____

## Stage 9 — Validation and write-up

Branches with deliberate regressions (smaller `top_k`, weaker embedding model,
sloppy prompt) plus one harmless refactor. Measure whether the tool catches
each one.

- Demo: a results table of regressions introduced versus regressions detected
- Gate: every deliberate regression flagged, harmless refactor passes, numbers recorded for the report
- Owner: _____

---

## Review gate checklist

Run this yourself at the end of every stage.

1. Does the demo command work from a clean clone on your machine?
2. Did you watch the tests run, rather than trusting a summary?
3. Read the diff: can you explain every file to your guide without help?
4. Is anything hardcoded that belongs in config?
5. Does it fail well? Kill a container mid-run and read what the user is told.
6. Is `docs/MEMORY.md` updated, including anything deferred?
7. Did any spec change? If so, is `docs/DESIGN.md` updated in the same commit?
