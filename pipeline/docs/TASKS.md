# Tasks

Nine stages. Each ends with something runnable, a demo command you run
yourself, and a review gate. Do not start a stage before the previous gate has
passed. Append to `pipeline/docs/MEMORY.md` at every gate.

**Current stage: 8 — Hosted GitHub App and reporting.** Stages 3–7 passed
their historical gates (2026-09-28) for the CLI/workflow implementation.
Stage 8's product target is an independent hosted service connected through
a GitHub App; it must not require a workflow file in user repositories or run
inside ContextForge's developer CI. ContextForge's repository CI validates
ContextForge itself only. Stage 9's earlier regression demonstrations cover
the local evaluator only.
The status line under each stage says what its gate still needs.

---

## Stage 0 — Scaffold ✅

pnpm workspace, TypeScript strict config, Vitest, ESLint, `.env.example`, and
repository CI that validates ContextForge source and the evaluator image.
Customer RAG evaluations run only through the hosted service.

- Demo: `pnpm install && pnpm test && pnpm lint` all pass
- Gate: builds from a clean clone on another team member's machine
- Owner: _____

## Stage 1 — Sample RAG app ✅

A small app in `user-repo/sample-rag-app/` implementing the app contract in
`pipeline/docs/DESIGN.md` over about 20 documents, with a Dockerfile. This exists so
every later stage has something real to test against.

- Demo: `docker compose up`, then a `curl` POST to `/query` returns an answer with contexts
- Gate: the response matches the contract exactly, including `contexts[].id`
- Owner: _____

## Stage 2 — Config loader ✅

Parse and validate `contextforge.yml` per `pipeline/docs/DESIGN.md` section 2, with
errors that name the offending key.

- Demo: `contextforge validate --config user-repo/contextforge.yml`
- Gate: tests cover at least six invalid configs; every error names the bad key
- Owner: _____

## Stage 3 — Evaluator container ✅

Python and Ragas in `pipeline/evaluator/`. Reads a JSON file of cases with answers and
contexts, writes a JSON file of per-case scores. No Git or CI awareness.

- Demo: `docker run ... evaluator < fixtures/sample-results.json` prints scores
- Gate: the same input twice at temperature 0 scores within a documented tolerance
- Owner: _____
- **Status:** ✅ gate passed 2026-09-28 with qwen3:14b (thinking off) and nomic-embed-text: every mean identical across two runs (spread 0.000 against a 0.05 tolerance); the fabricated answer scored below the grounded ones.

## Stage 4 — Dataset generation ✅

`contextforge dataset generate` produces `user-repo/benchmark/testcases.json` from the
source documents, for a human to review and commit.

- Demo: generate 20 cases from the sample app's documents, read them, delete the bad ones
- Gate: file matches the benchmark format; regeneration is always an explicit command
- Owner: _____
- **Status:** ✅ gate passed 2026-09-28: 63 cases generated in two runs with qwen3:14b, reviewed by hand down to 34 (`benchmark/testcases.json`), valid against the format; regenerating without `--overwrite` is refused before any judge call.

## Stage 5 — Runner ✅

Build and start baseline and candidate through Compose, health-check, query
every case, collect answers and contexts, tear down cleanly on success and on
failure.

- Demo: `contextforge run --baseline main --candidate HEAD` writes two result files
- Gate: no stray containers after a forced failure; `startup_timeout` honoured
- Owner: _____
- **Status:** ✅ gate passed 2026-09-28: both sides built and answered; contract ids present; a crashing app failed in 2s, a never-healthy one at the 10s startup_timeout; no containers, networks or worktrees left behind.

## Stage 6 — Comparator, thresholds and the noise floor ✅

Pure comparison logic over two result sets. Before setting defaults, run `main`
against itself five times and record the per-metric spread. That number is the
noise floor and it goes in `pipeline/docs/MEMORY.md`.

- Demo: `contextforge compare a.json b.json` prints a verdict and the regressed cases
- Gate: noise floor measured and recorded; defaults sit above it; comparison logic is pure and fully unit tested
- Owner: _____
- **Status:** ✅ gate passed 2026-09-28: five self-comparisons with the real judge drifted by exactly 0 on every metric; defaults kept at 0.05 and 0.30, above it and above one flipped case (0.029). Still to try: `reasoning_effort: low` against `none` for accuracy.

## Stage 7 — Baseline reuse ✅

The sample fixture's local baseline is `user-repo/benchmark/baseline/<sha>.json`.
Pull requests
resolve the merge base and reuse a stored benchmark only when its fingerprint
matches; otherwise they rebuild and score the merge-base app.

- Demo: open a PR; CI reuses a matching baseline or rebuilds an incompatible one
- Gate: exact-match reuse and incompatible/missing-baseline fallback are tested
- Owner: _____
- **Status:** ✅ gate passed 2026-09-28 on GitHub. Stored-baseline reuse and merge-base rebuild both returned verdicts; a matching PR check built only the candidate (7 min for 34 cases).

## Stage 8 — Hosted GitHub App and reporting

Implement the product integration defined in `pipeline/docs/DESIGN.md` section 8: a
hosted GitHub App service receives repository events, creates tracked
evaluations for the exact commit, invokes the existing evaluation core in an
isolated per-run worker, and publishes a Check Run with the verdict and report.
Installing the App must be sufficient; user repositories must not need a
ContextForge workflow file. The service must execute a deployed ContextForge
release against the customer commit SHA, not check out ContextForge source
from a developer branch or use developer CI. The internal CI workflow only
validates ContextForge itself; no reusable workflow or composite Action is a
customer evaluation path.

- Demo: install the App on a test repository, open/update a PR, and observe a
  completed check, updated PR result comment, and detailed report without
  adding a workflow file. The local development demo uses a real same-repository
  PR event and real evaluation; it does not inject verdicts.
- Gate: webhook authenticity and duplicate-delivery handling are verified;
  pass, regression, and tool-error outcomes reach the correct commit; user
  code runs in disposable isolated execution with explicit secret boundaries;
  baseline/job state survives service restarts; teardown works on success and
  failure; PR comments are updated rather than duplicated on webhook retry.
- Owner: _____
- **Status:** the provider-neutral webhook handler, GitHub App API client,
  Check Run reporting, and worker orchestration core are implemented and
  locally tested. A single-repository file-backed local development server is
  now available for trusted repositories behind an HTTPS reverse proxy.
  Startup/health and exact-commit worktree execution are covered by service
  tests, and the compiled service process has passed a local health smoke test.
  The reusable workflow and composite Action were removed; repository CI is
  developer-only. A live GitHub App PR-to-Check Run test, durable hosted
  queue/state, managed storage, disposable VM provisioning, production
  deployment, and App registration are not complete; the hosted stage gate
  remains open. The local service runs only for a trusted repository and
  non-fork PRs; its Check Run and PR comment are the real outcome of the
  configured evaluator. The local evaluator and sample app support Gemini
  chat through its OpenAI-compatible endpoint and native Gemini embeddings;
  live Gemini requests still require a user-provided API key.

## Stage 9 — Hosted end-to-end validation and write-up

After stage 8's hosted service gate passes, run deliberate RAG regressions
(smaller `top_k`, weaker embedding model, and a prompt change) plus a harmless
refactor through GitHub App events. Measure whether the hosted path catches
each one and delivers the result to the correct PR commit.

- Demo: a results table of regressions introduced versus detected, including
  the hosted check/report outcome
- Gate: every deliberate regression is flagged, the harmless refactor passes,
  results are attached to the triggering commit, and the measurements are
  recorded
- Owner: _____
- **Status:** local CLI demonstrations exist from 2026-09-28; hosted
  end-to-end validation is blocked on stage 8.

---

## Review gate checklist

Run this yourself at the end of every stage.

1. Does the demo command work from a clean clone on your machine?
2. Did you watch the tests run, rather than trusting a summary?
3. Read the diff: can you explain every file to your guide without help?
4. Is anything hardcoded that belongs in config?
5. Does it fail well? Kill a container mid-run and read what the user is told.
6. Is `pipeline/docs/MEMORY.md` updated, including anything deferred?
7. Did any spec change? If so, is `pipeline/docs/DESIGN.md` updated in the same commit?
