# Architecture

## Layers

The **core** (CLI plus Docker images) does all the work and knows nothing about
GitHub. The **Action** is a thin wrapper that reads CI inputs, calls the core
and posts results. This split is what keeps the tool portable to other CI
systems later.

## Components

| Component | Lives in | Responsibility |
|---|---|---|
| Config loader | `packages/cli/src/config` | Parse `contextforge.yml`, validate with Zod, fail with actionable errors |
| Dataset manager | `packages/cli/src/dataset` | Generate the test set once via Ragas, load the frozen set, hash it |
| Runner | `packages/cli/src/runner` | Build and start app containers, health-check, query, tear down |
| Evaluator client | `packages/cli/src/evaluator` | Send JSON to the Ragas container, receive per-case scores |
| Comparator | `packages/cli/src/compare` | Diff two result sets, flag regressed cases, apply thresholds, measure noise |
| Benchmark store | `packages/cli/src/benchmark` | Find the stored benchmark for a merge base; decide stored, re-scored or dual |
| Reporter | `packages/cli/src/report` | Render Markdown, JSON and HTML |
| Evaluator service | `evaluator/` | Python and Ragas, JSON in and JSON out, no Git or CI awareness |
| Action wrapper | `packages/action` | Map Action inputs to CLI flags, post the sticky PR comment, set the check status |

Comparator, reporter and the benchmark decision are pure functions over data.
All I/O lives in the runner, evaluator client, config loader and benchmark
store, and everything that shells out goes through one injectable `Exec`, so
each is tested without Docker.

Posting the PR comment lives in the Action, not the Reporter. The core renders
the report; only the Action knows it is on GitHub. That is the layering this
document starts with, and it keeps the core portable.

## Modes

**Cached mode (default).** A push to `main` runs the benchmark job and stores
answers, contexts and scores under `benchmark/baseline/<sha>.json`. A pull
request builds only the candidate, scores it and compares against the stored
benchmark for the merge base.

**Re-judge fallback.** If only the judge fingerprint changed, the stored scores
are void but the stored answers and contexts are still valid, so re-score that
text instead of rebuilding anything.

**Dual mode (fallback).** If no usable benchmark exists for the merge base, or
the app environment changed, build and run both baseline and candidate.

Dual mode is the correctness reference; cached mode is the optimisation. Cached
mode must produce the same verdict as dual mode on the same pull request.

## Flow: push to main

1. Workflow triggers on push to `main`
2. CLI loads config and the frozen test set
3. Runner builds and starts the app, waits for health
4. Every test case is sent to the app; answers and contexts recorded
5. Evaluator scores the results (repeated `runs` times, mean and stddev stored)
6. Result written to `benchmark/baseline/<sha>.json` and committed with `[skip ci]`

## Flow: pull request

1. Action starts, passes config path and secrets to the CLI
2. Config loaded and validated; test set loaded and hashed
3. Merge base resolved; stored benchmark looked up
4. Fingerprint compared — use stored scores, re-judge stored answers, or fall
   back to dual mode
5. Candidate container built, started, health-checked
6. Every test case sent to the candidate; answers and contexts recorded
7. Evaluator scores the candidate
8. Comparator diffs against the baseline and applies thresholds
9. Reporter posts a sticky PR comment and sets the check status
10. Containers torn down, artifacts uploaded

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language (core) | TypeScript, Node 20+ (developed and run on 26) | GitHub Actions ecosystem is JS-native |
| CLI | Commander.js | Subcommands, flags, help output |
| Config | YAML plus Zod | Human-editable config, runtime validation with typed output |
| Evaluation | Ragas (Python 3.11) | Reference-free RAG metrics; runs in its own container |
| Containers | Docker, Docker Compose | Reproducible environments for baseline and candidate |
| CI | GitHub Actions, REST via `fetch` | Where the report needs to appear. Three API calls did not justify Octokit |
| Tests | Vitest (TS), pytest (Python) | Fast, watch mode, good TS support |
| Package manager | pnpm workspaces | Monorepo with cli, action, shared and the sample app |
| Action type | Composite | Builds the same CLI developers run; no bundled second artefact to drift |

## Folder structure

```
contextforge/
  CLAUDE.md
  README.md
  docs/
    PRD.md
    ARCHITECTURE.md
    RULES.md
    DESIGN.md
    TASKS.md
    MEMORY.md
  packages/
    cli/
      src/
        commands/        # validate, dataset, run, benchmark, compare, report
        config/          # schema.ts, load.ts
        dataset/         # generate.ts, freeze.ts, hash.ts
        runner/          # compose.ts, health.ts, query.ts, side.ts, fingerprint.ts
        evaluator/       # client.ts, types.ts, aggregate.ts
        compare/         # diff.ts, thresholds.ts, verdict.ts, summary.ts, noise.ts
        benchmark/       # decide.ts, store.ts
        report/          # markdown.ts, html.ts, format.ts
        util/            # errors, logger, exec, docker, git, version
      test/
    action/
      action.yml         # composite: build, run, comment, upload, set the check
      src/               # index.ts, comment.ts — the sticky comment
    shared/
      src/types.ts       # result and benchmark schemas shared across packages
  evaluator/
    Dockerfile           # runtime and test targets
    app/                 # Ragas wrapper: score and generate, JSON in and out
    tests/
    fixtures/
  examples/
    sample-rag-app/      # reference app implementing the contract
    contextforge.yml
    contextforge.local-judge.yml
  scripts/               # measure-noise.mjs, validate-regressions.sh
  benchmark/
    testcases.json
    baseline/<sha>.json
  .github/workflows/
    ci.yml               # lint and test this repo, TypeScript and Python
    benchmark.yml        # push to main, writes the baseline
    pr-check.yml         # pull request, runs the regression check
```
