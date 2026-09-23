# Memory

Append-only log of what changed and why. Newest entry at the top. Never delete
an entry; correct it with a later one. Every session and every stage gate adds
an entry here before the pull request is opened.

## Format

```
## YYYY-MM-DD — stage N — short title

**Changed:** files or modules touched, in one or two lines
**Why:** the reason, not the diff
**Decisions:** any choice a future reader would question
**Deferred:** what was deliberately left undone
**Notes:** surprises, measurements, things that cost time
```

---

## Current state

- **Stage:** 2 — config loader, complete and awaiting the gate review
- **Works:** the scaffold, the reference RAG app, and a `contextforge` binary
  with a working `validate` command. 109 tests across 11 files.
- **Known gaps:** no evaluator, no dataset generation, no runner, no comparator
- **Measured noise floor:** not measured yet (stage 6)

---

## 2026-09-23 — stage 2 — config loader

**Changed:** `packages/cli/src/config/{schema,load}.ts`,
`packages/cli/src/commands/validate.ts`, `packages/cli/src/{cli,bin,index}.ts`,
three test files, `examples/contextforge.yml`, `examples/testcases.json`, and
`docs/DESIGN.md` sections 2, 3 and 4.
**Why:** stage 2 in `docs/TASKS.md` — parse and validate `contextforge.yml`
with errors that name the offending key.

**Decisions:**
- **The judge endpoint is configuration, not a constant.** `judge.base_url` and
  `judge.api_key_env` were added to `docs/DESIGN.md` section 2. This came out of
  the question of what to use while no OpenAI key is available: Ollama speaks
  the OpenAI protocol, so a local judge and a user's own key are the same code
  path with different config. There is no provider branch to remove later
  because there is never one to write. `base_url` is independently justified —
  Azure, proxies and gateways all need it.
- `api_key_env` names the variable; the secret itself never enters the file.
- **`docs/PRD.md` was deliberately left alone.** It defers local-model judges
  past the MVP, and that still holds: the MVP ships `provider: openai` by
  default and makes no quality claims about local judges. `base_url` permitting
  one is a consequence, not an advertised feature.
- **Paths in the config resolve against the config file's directory**, not the
  working directory, so a config means the same thing wherever it is run from.
  `docs/DESIGN.md` was silent on this; the rule is now written down there.
- `Config` lives in `packages/cli`, not `packages/shared`, against the earlier
  plan. It is inferred from the Zod schema, and moving it to `shared` would put
  Zod in a package that does not otherwise need it. Nothing is redeclared, so
  the `docs/RULES.md` rule is satisfied. Revisit if the Action ever parses config.
- Cross-field rules live in `superRefine`; filesystem and environment checks
  live in `load.ts`. The schema stays pure and is tested without any I/O.
- `validate` prints the resolved config rather than just "ok": most config
  surprises are a default the user did not know was there.

**Deferred:** the `run`, `compare`, `report` and `dataset` subcommands — stage 2
is `validate` only. `examples/testcases.json` is a three-case handwritten
example so the reference config validates today; the real 40-case set is
generated into `benchmark/testcases.json` in stage 4.

**Notes:**
- **A real bug in `docs/DESIGN.md`, now fixed.** The fingerprint covered
  `judge` but not the embedding model, even though `answer_relevancy` is
  computed from embeddings. Changing the embedding model would have silently
  reused stale baseline scores and reported a wrong verdict. `embeddings` is
  now fingerprinted, and the staleness table treats a change to it like a judge
  change: re-score the stored answers, do not rebuild the app.
- **The noise floor belongs to the judge, not to ContextForge** —
  `docs/DESIGN.md` section 4 now says so. If stage 6 measures the floor with
  one judge and the tool ships defaults calibrated for another, the defaults
  are wrong. Whichever judge produces the stage 9 numbers gets named in the
  write-up.
- Zod 4 reports an unknown key against the *containing* object, with the
  offending names in a separate `keys` field. A naive mapper would therefore
  report `app` instead of `app.judge_model`, which is exactly what this stage's
  gate forbids. `describeIssue` expands those by hand.
- `judge-box:11434` parses as a valid URL — scheme `judge-box:` — so a URL
  check alone is not enough; the scheme is checked separately. Both failures
  now give one message, since the user made the same mistake either way.
- The CLI is a compiled package whose imports use `.js`, unlike the sample app,
  so `node src/bin.ts` does not work. `pnpm --filter cli dev` builds first.
- Verified by running, not assuming: the demo command exits `0` and prints the
  resolved config; five hand-broken configs (unknown key, threshold naming a
  non-metric, out-of-range `startup_timeout`, malformed `base_url`,
  `answer_relevancy` with no embeddings) each named the offending key; a
  missing config file exits `2`, not `1`.
- Fixed while checking failure output: a config outside the working directory
  was displayed as `../../../../tmp/...`. It now shows the absolute path.

---

## 2026-09-23 — stage 1 — sample RAG app

**Changed:** `examples/sample-rag-app/` — 21 knowledge-base documents, eight
source modules (`config`, `chunk`, `corpus`, `embed`, `retrieve`, `generate`,
`pipeline`, `server`, plus `log` and `index`), five test files, a `Dockerfile`,
`docker-compose.eval.yml` and a README. Workspace wiring updated so the example
is linted, typechecked and tested by the root scripts.
**Why:** stage 1 in `docs/TASKS.md` — something real for every later stage to
build, run, query and measure against.
**Decisions:**
- **The app is TypeScript, not Python.** `docs/RULES.md` says "Python only
  inside `evaluator/`". A RAG app would normally be Python, but the runner only
  ever speaks HTTP to it, so the language is invisible and the rule holds
  without costing anything. Flagged because it is the surprising choice.
- **No build step and no dependencies.** Node 26 executes TypeScript directly,
  so the image is `FROM node:26.8.1-trixie-slim`, a copy of `src` and `docs`,
  and `CMD node src/index.ts` — 360MB, no `npm install` in the build. The
  project is `noEmit` with `erasableSyntaxOnly`, so the typechecker enforces
  that only strippable syntax is used. Imports therefore use `.ts` extensions,
  which is why `tsconfig.eslint.json` needed `allowImportingTsExtensions`.
- **A second, offline provider (`PROVIDER=local`).** Hashed TF-IDF embeddings
  and extractive answers, no key and no network. Stages 3 to 7 need to run the
  full loop hundreds of times while being developed; doing that against a real
  API is slow and expensive. It is stubbed deliberately and the README says in
  as many words that a number produced with it is not a quality measurement.
- **The server listens before the index is built** and answers `/health` with
  `503 {"status":"starting"}` until ready, so the runner's health poll gets an
  answer instead of a refused connection. The contract only fixes the ready
  response, so this does not contradict `docs/DESIGN.md`.
- **Determinism where ids are concerned.** Files are read in sorted order and
  retrieval ties break on chunk id. ContextForge compares retrieved context ids
  between runs, so an id that drifts would read as a regression that never
  happened.
- Chunk ids are `<file>#c<n>` numbered from 1, matching the `policy.md#c12`
  form in `docs/DESIGN.md`.
- A bad environment variable exits `2` and names the variable, verified by
  running the container.
**Deferred:** a `PROMPT_STYLE` switch for the "sloppy prompt" regression in
stage 9 — stage 9 describes those as branches, so the prompt gets edited on a
branch rather than pre-wired here. Reranking, streaming and any persistence of
the index are out of scope; the index is rebuilt in memory at every start,
which takes about a second on the offline provider.
**Notes:**
- **Not verified end to end against OpenAI.** No `OPENAI_API_KEY` is available
  in this environment, so the `openai` provider's request and response handling
  is covered by types and by reading the API docs, not by a live call. The
  first person with a key should run `OPENAI_API_KEY=... docker compose -f
  docker-compose.eval.yml up --build` before stage 3 depends on it.
- The offline retriever needed two fixes that were not obvious. Without crude
  suffix stripping, "refund" never matched "refunds" and it retrieved almost
  nothing. Without IDF weighting, every document that cross-references
  `returns-and-refunds.md` scored as a refund document — the cross-references
  in the knowledge base put the word into eight unrelated files.
- Spot check of the offline provider on six questions with an obvious correct
  document: **right document at rank 1 in 4 of 6, in the top 5 in 6 of 6.**
  Raising the hash space from 1024 to 16384 dimensions changed neither number,
  so collisions are not the limit and 1024 was kept. The two rank-1 misses are
  lexically fair: "refund window" appears verbatim in `subscription-plans.md`
  and "Express delivery" in `exchanges.md`.
- Two of the first test failures were wrong expectations of mine, not bugs: the
  overlap tail cuts at the first word boundary inside the tail, and a 100-char
  chunk size swallowed both paragraphs of the overlap fixture so no overlap was
  ever exercised.
- Verified by running, not by assuming: container built, `/health` returned
  `200 {"status":"ok"}`, `/query` returned the exact contract shape with
  `contexts[].id` like `subscription-plans.md#c2`, malformed bodies returned
  `400`, unknown routes `404`, the Compose healthcheck reached `healthy`, and
  `docker compose down` left no stray containers.

---

## 2026-09-23 — stage 0 — scaffold

**Changed:** workspace root (`package.json`, `pnpm-workspace.yaml`,
`tsconfig.base.json`, `tsconfig.json`, `tsconfig.eslint.json`,
`vitest.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
`.gitignore`, `.nvmrc`, `.env.example`, `README.md`), three workspace packages
(`shared`, `cli`, `action`), `.github/workflows/ci.yml`, and `git init`.
**Why:** stage 0 in `docs/TASKS.md` — a workspace that lints, typechecks and
tests from a clean clone, with no product code.
**Decisions:**
- Docs folder renamed `Docs/` → `docs/` to match every path in `CLAUDE.md`,
  `docs/ARCHITECTURE.md` and this file. The filesystem is case-sensitive, so
  the capitalised name would have broken those references.
- Node 26 locally (`.nvmrc`), `engines` left at `>=20` and CI pinned to 26.
  `docs/ARCHITECTURE.md` says Node 20; nothing in the scaffold depends on a
  version-specific API, so the doc stays accurate as a floor.
- pnpm is run via `npx pnpm@10.34.5` rather than installed globally, because
  `docs/RULES.md` forbids global installs and `corepack` is not bundled with
  Node 26. `packageManager` pins the exact version for `pnpm/action-setup`.
- `packages/cli/src/util/{errors,logger}.ts` were written now even though
  stage 0 says "no product code". They are infrastructure every later stage
  needs, `docs/RULES.md` mandates their exact shape (typed errors with a
  `code`, one structured logger, no `console.log`), and without them the
  `no-console` rule has no sanctioned escape hatch. Called out here because it
  is a deliberate stretch of the stage boundary, not an oversight.
- Exit codes (`0` pass, `1` regression, `2` tool error, `docs/DESIGN.md` §6)
  live in `packages/shared` because the CLI and the Action both need them.
- The logger writes to stderr only, so `results.json` on stdout stays clean
  for CI to pipe.
- Prettier ignores `docs/`, `CLAUDE.md` and `README.md`: they are hand-wrapped
  prose and reflowing them would wreck spec diffs.
- Type-aware linting needs a project that covers tests and root configs, which
  the per-package build configs exclude. Hence `tsconfig.eslint.json`; without
  it ESLint silently fell back to a default project with `strictNullChecks`
  off and half the strict rules disabled themselves.
**Deferred:** CLI binary and Commander wiring (stage 2), `packages/action/action.yml`
(stage 8), `evaluator/`, `examples/` and `benchmark/` directories (stages 1–4),
the `benchmark.yml` and `pr-check.yml` workflows (stages 7–8), a coverage
threshold (nothing meaningful to cover yet). Judge model still not pinned and
the benchmark store location is still undecided, both carried over from the
previous entry.
**Notes:**
- `pnpm` 10 blocks dependency build scripts by default; Vitest silently failed
  to resolve esbuild's binary until `esbuild` was added to
  `onlyBuiltDependencies` in `pnpm-workspace.yaml`.
- Verified rather than assumed: a probe file using `any`, `console.log` and a
  non-null assertion was linted and produced errors on all three, then deleted.
- Full gate run on a wiped `node_modules`: install (frozen lockfile), build,
  14 tests passing, lint and format clean, typecheck clean.
- Vitest 5 and `@types/node` 26 were chosen over the versions first installed;
  starting a project two majors behind is a cost paid later for nothing.

---

## 2026-09-23 — stage 0 — project docs written

**Changed:** `CLAUDE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`,
`docs/RULES.md`, `docs/DESIGN.md`, `docs/TASKS.md`, `docs/MEMORY.md`
**Why:** specs before code, so the staged plan and the app contract are settled
before any implementation starts
**Decisions:**
- Baseline is cached by default, with a dual-environment fallback. Dual mode is
  the correctness reference; cached mode is the optimisation and must agree
  with it.
- The stored benchmark keeps answers and contexts, not only scores, so a judge
  change can be handled by re-scoring stored text instead of rebuilding the app.
- Baseline is looked up by the pull request's merge base, not the tip of main,
  so a PR is not blamed for changes merged after it branched.
- The dataset is frozen and committed; regenerating it is an explicit command.
**Deferred:** judge model not yet pinned; benchmark store location (results
branch versus Actions cache) not yet decided
**Notes:** the app contract in `docs/DESIGN.md` is the load-bearing spec — the
runner, evaluator and sample app all depend on it
