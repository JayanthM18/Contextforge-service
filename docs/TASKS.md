# Tasks

Nine stages. Each ends with something runnable, a demo command you run
yourself, and a review gate. Do not start a stage before the previous gate has
passed. Append to `docs/MEMORY.md` at every gate.

**Current stage: 7 — blocked on a GitHub remote.** Stages 3–6 have passed their
gates (2026-09-28), against a real judge where one is needed. Stages 7 and 8
are built and unit tested but their demos need the repository on GitHub.
Stage 9 has been partly demonstrated. The status line under each stage says
what its gate still needs.

---

## Stage 0 — Scaffold ✅

pnpm workspace, TypeScript strict config, Vitest, ESLint, `.env.example`, and a
CI workflow that only lints and tests this repo. No product code.

- Demo: `pnpm install && pnpm test && pnpm lint` all pass
- Gate: builds from a clean clone on another team member's machine
- Owner: _____

## Stage 1 — Sample RAG app ✅

A small app in `examples/sample-rag-app/` implementing the app contract in
`docs/DESIGN.md` over about 20 documents, with a Dockerfile. This exists so
every later stage has something real to test against.

- Demo: `docker compose up`, then a `curl` POST to `/query` returns an answer with contexts
- Gate: the response matches the contract exactly, including `contexts[].id`
- Owner: _____

## Stage 2 — Config loader ✅

Parse and validate `contextforge.yml` per `docs/DESIGN.md` section 2, with
errors that name the offending key.

- Demo: `contextforge validate --config examples/contextforge.yml`
- Gate: tests cover at least six invalid configs; every error names the bad key
- Owner: _____

## Stage 3 — Evaluator container ✅

Python and Ragas in `evaluator/`. Reads a JSON file of cases with answers and
contexts, writes a JSON file of per-case scores. No Git or CI awareness.

- Demo: `docker run ... evaluator < fixtures/sample-results.json` prints scores
- Gate: the same input twice at temperature 0 scores within a documented tolerance
- Owner: _____
- **Status:** ✅ gate passed 2026-09-28 with qwen3:14b (thinking off) and nomic-embed-text: every mean identical across two runs (spread 0.000 against a 0.05 tolerance); the fabricated answer scored below the grounded ones.

## Stage 4 — Dataset generation ✅

`contextforge dataset generate` produces `benchmark/testcases.json` from the
source documents, for a human to review and commit.

- Demo: generate 20 cases from the sample app's documents, read them, delete the bad ones
- Gate: file matches the benchmark format; regeneration is always an explicit command
- Owner: _____
- **Status:** ✅ gate passed 2026-09-28: 63 cases generated in two runs with qwen3:14b, reviewed by hand down to 34 (`benchmark/testcases.json`), valid against the format; regenerating without `--overwrite` is refused before any judge call.

## Stage 5 — Runner (dual mode) ✅

Build and start baseline and candidate through Compose, health-check, query
every case, collect answers and contexts, tear down cleanly on success and on
failure.

- Demo: `contextforge run --mode dual --baseline main --candidate HEAD` writes two result files
- Gate: no stray containers after a forced failure; `startup_timeout` honoured
- Owner: _____
- **Status:** ✅ gate passed 2026-09-28: both sides built and answered; contract ids present; a crashing app failed in 2s, a never-healthy one at the 10s startup_timeout; no containers, networks or worktrees left behind.

## Stage 6 — Comparator, thresholds and the noise floor ✅

Pure comparison logic over two result sets. Before setting defaults, run `main`
against itself five times and record the per-metric spread. That number is the
noise floor and it goes in `docs/MEMORY.md`.

- Demo: `contextforge compare a.json b.json` prints a verdict and the regressed cases
- Gate: noise floor measured and recorded; defaults sit above it; comparison logic is pure and fully unit tested
- Owner: _____
- **Status:** ✅ gate passed 2026-09-28: five self-comparisons with the real judge drifted by exactly 0 on every metric; defaults kept at 0.05 and 0.30, above it and above one flipped case (0.029). Still to try: `reasoning_effort: low` against `none` for accuracy.

## Stage 7 — Cached benchmark mode

The push-to-main workflow writes `benchmark/baseline/<sha>.json`. Pull requests
resolve the merge base, check the fingerprint, and choose: stored scores,
re-judge stored answers, or dual mode.

- Demo: open a PR; CI builds only the candidate and still returns a verdict
- Gate: cached and dual mode agree on the same PR; every fingerprint branch has a test
- Owner: _____
- **Status:** built; every fingerprint branch tested; cached and dual agree on fake scores. CI can now reach the self-hosted judge (`scripts/ci-judge-config.sh`); the real-PR demo waits on the Tailscale OAuth client and the `JUDGE_HOST` secret.

## Stage 8 — Action and reporting

The GitHub Action wrapper, a sticky PR comment updated on each push, the check
status, and the HTML artifact.

- Demo: a real PR comment with a metric table and a blocked merge
- Gate: comment updates rather than duplicating; exit codes distinguish regression from tool error
- Owner: _____
- **Status:** built; comment update-not-duplicate and exit codes tested. Real-PR demo needs a GitHub remote.

## Stage 9 — Validation and write-up

Branches with deliberate regressions (smaller `top_k`, weaker embedding model,
sloppy prompt) plus one harmless refactor. Measure whether the tool catches
each one.

- Demo: a results table of regressions introduced versus regressions detected
- Gate: every deliberate regression flagged, harmless refactor passes, numbers recorded for the report
- Owner: _____
- **Status:** partly demonstrated 2026-09-28 on the first 10 cases with `scripts/demo.sh`: `top_k` 5→1 was flagged (FAIL, 5 of 10 cases regressed) and a pure rename passed. Remaining: the weaker-embedding and prompt scenarios, and all four on the full 34 cases (`pnpm validate-regressions`).

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
