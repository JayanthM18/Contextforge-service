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

## 2026-11-06 — stage 8 — document complete local PR demo

**Changed:** Expanded the README with a PowerShell end-to-end quick-tunnel and
GitHub App walkthrough, documented Gemini `.env` values and allowlists, and
explained why the optional `OPENAI_API_KEY` placeholder exists. Clarified the
provider notes in `.env.example`.
**Why:** The local demonstration should be reproducible without guessing how
to connect the tunnel, GitHub webhook, Gemini credentials, and PR-triggered
evaluation service.
**Decisions:** Keep `OPENAI_API_KEY` in the template for users choosing
OpenAI; Gemini mode needs only `GEMINI_API_KEY`. Preserve any existing `.env`
and never print its secret values. Document the quick tunnel as ephemeral and
the local service as trusted-repository development only.
**Deferred:** No values in `.env` were inspected or changed. Starting the
service and opening a live PR still require the user to complete GitHub App
credentials and trigger the webhook.
**Notes:** This is documentation-only; no tests required.

---

## 2026-11-06 — stage 8 — support Gemini evaluation

**Changed:** Added a Gemini sample config, native Gemini embedding clients for
the sample RAG app and Ragas evaluator, Gemini provider propagation through the
CLI/evaluator contract, and setup documentation. Updated the ignored local
`.env` without displaying or overwriting existing secrets; started a fresh
Cloudflare quick tunnel and saved its origin there.
**Why:** The local PR demo needs to use the user's Gemini key for chat and
embeddings while retaining the complete four-metric evaluation loop.
**Decisions:** Gemini chat uses Google's OpenAI-compatible API; Gemini
embeddings use the native `batchEmbedContents` API. OpenAI and local providers
remain supported. Gemini embedding failures are surfaced as tool errors rather
than silently dropping answer relevancy.
**Deferred:** No live Gemini API request was made because the user must enter
their key. A live PR evaluation still needs valid GitHub App credentials and
the service started. The quick-tunnel URL is ephemeral and will stop working
when its process exits.
**Notes:** `pnpm typecheck`, `pnpm build`, targeted ESLint/Prettier, the sample
app tests (61/61), and the evaluator container tests (55 passed, 2 skipped)
pass. The actual Gemini config validates and Compose passes `config --quiet`.
Full `pnpm test` reports 267 passed and 19 pre-existing Windows path-assumption
failures.

---

## Current state

- **Stage:** 8 — Hosted GitHub App and reporting. Stages 3–7 passed their
  historical CLI/workflow gates on 2026-09-28. Provider-neutral webhook,
  GitHub App API, and worker-orchestration core now exist; durable storage,
  queue, VM adapters, App registration, and deployment are not implemented.
  Repository CI now validates ContextForge only; the reusable workflow and
  composite Action have been removed.
- **Test set:** `user-repo/benchmark/testcases.json`, 34 cases, reviewed by
  hand.
- **Judge:** qwen3:14b with `reasoning_effort: none`, and nomic-embed-text,
  on Ollama on the GPU machine, over Tailscale at `judge-box`
  (`user-repo/contextforge.local-judge.yml`). The link is now direct, 2 ms.
- **Gemini option:** `user-repo/contextforge.gemini.yml` configures Gemini chat
  and native embeddings for both the sample app and all four evaluator
  metrics. Live use awaits the user-supplied key.
- **Works, verified by running:** the local CLI and evaluator against the sample
  app and judge; a breaking change flagged and a harmless one passed
  (`pipeline/scripts/demo.sh`). The local service passes startup, health, and
  exact-commit worker tests. It now publishes an idempotently updated PR
  result comment alongside the Check Run; live GitHub App delivery is not yet
  verified.
- **Historically verified on GitHub:** earlier `benchmark` and `pr-check`
  workflows stored baselines and returned verdicts through a private Ollama
  judge. Those workflow paths have since been removed and are not the hosted
  product integration.
- **Not yet implemented or verified:** production queue/job state, isolated
  VM runtime, hosted baseline/report storage, App registration/deployment,
  end-to-end App checks, stage 9 hosted validation, and merge blocking.
- **Repository:** github.com/JayanthM18/ContextForge, private. Customers will
  not need a workflow in their repositories; the hosted GitHub App remains
  undeployed.
- **Measured noise floor:** **0.000 within a session** (five back-to-back
  self-comparisons); **up to 0.075 between sessions** (faithfulness, 10 cases,
  runs hours apart). Defaults kept at `mean_drop: 0.05` and `case_drop: 0.30`.

---

## 2026-11-06 — stage 8 — publish real results on pull requests

**Changed:** Updated the stage-8 contract and setup docs for local real-PR
evaluation, GitHub Issues permissions, and a single ContextForge result
comment. Added comment create/update by a stable App-specific marker, exact
commit and report link, plus persisted notification delivery/retry handling.
The existing Check Run remains the branch-protection status.
**Why:** The local end-to-end demo must be triggered by an actual GitHub PR,
run the real evaluator on the PR commit, and show its real verdict to reviewers
instead of demonstrating only the standalone CLI.
**Decisions:** Keep the local worker restricted to one trusted repository and
non-fork PRs; its Docker execution is not VM isolation. The comment shows the
outcome, evaluated SHA, and detailed report link, while the Check Run remains
the machine-readable gate.
**Deferred:** Live App credentials/webhook verification, public HTTPS tunnel
setup, and end-to-end PR acceptance remain environment-dependent; hosted
durable storage and disposable VM execution remain unimplemented.
**Notes:** Service package build and typecheck pass. Targeted service tests
pass (19/19) and changed service files pass ESLint and Prettier. Full
`pnpm test` reports 259 passed and 19 failures from existing POSIX-path
assumptions on Windows (`C:\\` paths written as `C:\\Users\\...\\C\\...`).

---

## 2026-11-06 — stage 8 — verify local development service

**Changed:** Hardened temporary worktree/output cleanup so cleanup errors do
not mask evaluation failures; fixed local service type/lint issues; added a
service startup/health test and bounded the real-Git worker test. Updated the
stage status and current-state paths for the pipeline/user-repo split.
**Why:** The local trusted-repository service must build, start, answer health
checks, and evaluate the event's exact commit reliably for development/testing.
**Decisions:** Keep the local file-backed service explicitly limited to one
trusted repository; this does not satisfy the hosted stage's VM isolation,
durability, or live GitHub acceptance gate.
**Deferred:** Live GitHub App webhook-to-Check Run validation, production
queue/storage and VM adapters, deployment, and GitHub App registration.
**Notes:** `pnpm typecheck`, `pnpm build`, service tests (27/27), service
ESLint, changed-service-file Prettier, and a compiled-process HTTP health
smoke test pass. Full `pnpm test` reports 257 passed and 19 pre-existing
Windows/POSIX path-assumption failures outside the service tests.
`pnpm lint` passes ESLint but fails Prettier on nine pre-existing files
outside the service changes. No live GitHub credentials or external webhook
were used.

---

## 2026-11-04 — stage 8 — separate developer CI from hosted evaluations

**Changed:** Replaced the customer-facing reusable workflow with an internal
repository CI workflow that tests ContextForge only. Removed the composite
GitHub Action, removed baseline-storage and report-delivery settings from the
shared customer config, and kept local CLI baselines under a fixed local
directory. Documented that hosted workers use the event's exact customer
commit SHA and a deployed ContextForge release, not developer checkout state.
Updated architecture, design, README, stage status and service worker contract.
**Why:** Customer evaluations must be independent of ContextForge developers'
branches, worktrees, CI jobs, and credentials; the GitHub App service is the
sole intended production path.
**Decisions:** Keep the CLI and local Ollama config as developer-only tools for
dataset authoring and local engine verification. Use provider-neutral PaaS
contracts until a cloud provider is selected. Internal CI has read-only
repository permissions and does not receive model or customer credentials.
**Deferred:** Durable queue/job state, managed baseline/report storage,
disposable VM implementation, production service entrypoint/deployment,
GitHub App registration, and hosted end-to-end checks.
**Notes:** `pnpm typecheck`, `pnpm build`, ESLint, focused tests (42/42),
changed-file Prettier checks, YAML parsing, and frozen-lockfile install pass.
`pnpm test` reports 246 passed and 19 pre-existing Windows POSIX-path
assumption failures. Repository-wide `pnpm lint` still reports existing
Prettier issues in 82 files; internal CI runs ESLint only. Evaluator container
tests could not run locally because Docker Desktop is not running.

---

## 2026-11-02 — stage 8 — document hosted GitHub App direction

**Changed:** Updated `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`,
`docs/TASKS.md`, and `README.md` to define ContextForge as a hosted PaaS
connected through a GitHub App, with no user-repository workflow requirement.
Clarified which components exist today versus the target service, and marked
baseline persistence, worker technology, secret management, and deployment
choices as unresolved.
**Why:** The reusable workflow still requires setup in every user repository
and does not meet the independent PaaS product requirement.
**Decisions:** The user repository owns the RAG app, vector DB, Compose stack,
config, and frozen test set. ContextForge receives GitHub events, runs
evaluation in an isolated worker, and reports a check and report on the
originating commit/PR. User-approved constraints: disposable per-job VM,
ContextForge-managed baseline/report storage, no secrets for fork PRs, and
Check Run reporting without PR comments initially. Cloud vendor and storage
adapter remain unselected.
**Deferred:** A concrete hosted-service implementation plan and approval;
selection of baseline storage, worker isolation technology, secret mechanism,
cloud provider, and PR-comment policy.
**Notes:** The product-contract documentation was completed before
implementation began. Service core now exists, but no production adapters or
deployment have been configured.

---

## 2026-11-02 — stage 8 — implement hosted service core

**Changed:** Added `packages/service` with a signed GitHub webhook handler,
default-branch push and PR-event parsing, fork secret gating, GitHub App JWT
and installation-token handling, Check Run publishing, and injected worker
and managed-report storage contracts. Registered it in the TypeScript
workspace and added tests.
**Why:** Begin replacing the per-repository reusable workflow with the
independent GitHub App service while leaving cloud-provider adapters open.
**Decisions:** Webhook requests are size-limited and signature-verified;
supported PR events are opened, reopened, and synchronize; only default
branch pushes enqueue jobs; fork PR jobs have `secretsAllowed: false`. Worker,
queue, and report-store providers are injected, not implemented in this
provider-neutral core.
**Deferred:** Durable queue/job-state adapter, managed object/database
adapters, disposable per-job VM implementation, production service entrypoint
and deployment, App registration, and GitHub end-to-end validation.
**Notes:** All 16 focused service tests, workspace build/typecheck, service
lint, and documentation formatting pass. Full `pnpm test` reports 261 passed
and 19 pre-existing Windows path-assumption failures in CLI config/evaluator/
run tests. The service package is orchestration core only and is not
deployable as the hosted product yet.

---

## 2026-11-02 — stage 8 — separate pipeline from target application

**Changed:** Converted `.github/workflows/ci.yml` into a reusable
`workflow_call` pipeline. It checks out and evaluates the caller repository,
while obtaining ContextForge tooling from this repository. Updated setup and
architecture documentation to describe the two-repository arrangement,
caller permissions/secrets, Compose-owned RAG/vector DB services, and the
separate one-shot Ragas evaluator.
**Why:** The CI product is the pipeline; the user repository supplies the RAG
application, vector database, test set, Compose stack, and config.
**Decisions:** ContextForge does not add or own a vector database. Its sample
app remains an in-memory reference only. The caller pins a `contextforge-ref`
matching its reusable workflow ref, and the central private repository is
checked out into a separate directory.
**Deferred:** Validate execution in a caller repository, including private
workflow/action access, benchmark commit permissions, and a real PR comment.
**Notes:** The user's config must point to its own app service and the
`baseline-store` workflow input must match the repository-root location of
`baseline.store`.

## 2026-11-02 — stage 8 — consolidate the hosted pipeline

**Changed:** Replaced the separate benchmark and PR-check workflows with
`.github/workflows/ci.yml`; removed the CI-only Tailscale config script. The
single workflow benchmarks `main` and evaluates pull requests without running
ContextForge's own test suite. Simplified baseline selection to exact
fingerprint reuse or merge-base rebuild, removed mode controls, and added a
validated PR-author mention to the sticky report comment.
**Why:** Keep one cloud-hosted evaluation path that returns a verdict directly
to the PR author.
**Decisions:** Kept local judge configuration, local demo/validation scripts,
and commit-keyed baseline JSON; these remain useful and/or required by the
pipeline. The author mention is inserted after the sticky marker.
**Deferred:** Verify the consolidated workflow and comment on a real GitHub PR.
**Notes:** `pnpm typecheck` passed; focused tests passed (39/39). Full
`pnpm test` had 19 failures out of 264, caused by test fixtures expecting
POSIX paths such as `/work/...` while running on Windows. Full `pnpm lint`
reached Prettier but reported formatting warnings in many workspace files;
all changed formatter-supported source files pass a focused Prettier check.

## 2026-09-28 — stage 7 — gate passed on GitHub

**Changed:** `packages/action/action.yml` uploads hidden paths, so the report
artifact exists at last; verdict notes say "1 case" rather than "1 cases".
`benchmark` re-enabled on GitHub. Demo PRs #1–#4 opened, not for merging.
**Why:** stage 7's gate: cached and dual mode must agree on the same PR.
**Decisions:**
- **The gate was run on a pass and on a regression.** PR #2 (harmless rename)
  and PR #4 (retrieval cut to 1 passage, in `pipeline.ts`) each ran cached on
  `pull_request`, then dual by hand through `pr-check`'s manual trigger.
- **PR #4 exists because PR #1 could not run cached.** #1 made the same cut
  in the Compose file, which changes the app environment's fingerprint, so
  ContextForge rightly rebuilt both sides. A regression made in code keeps
  the stored baseline.
- Demo PRs left open for stage 8's comment and blocked-merge demo.
**Deferred:** a merge actually blocked (stage 8). Branch protection is not
available for private repositories on GitHub's free plan.
**Notes:**

| PR | change | mode | verdict | regressed | recall Δ | faithfulness Δ | time |
|---|---|---|---|---|---:|---:|---:|
| #2 | rename locals | cached | pass | 1 | 0.000 | −0.004 | 16 min* |
| #2 | rename locals | dual | pass | 1 | — | — | 26 min* |
| #4 | top_k 1, in code | cached | **fail** | 14 | −0.252 | −0.183 | 7 min |
| #4 | top_k 1, in code | dual | **fail** | 13 | −0.252 | −0.183 | 16 min |
| #1 | top_k 1, in Compose | dual (forced) | **fail** | 14 | −0.252 | −0.180 | 21 min* |
| #3 | prompt without grounding rules | cached | pass | 0 | 0.000 | +0.005 | — |

\* shared the GPU with another run. #2's dual numbers were lost to the
artifact bug below; its log gives the verdict and the one regressed case.
- **Cached and dual agree** on verdict, on 13 of the 14 regressed cases, and
  on every metric delta within 0.004. The one difference, tc-016, and a
  baseline faithfulness 0.017 lower in dual than stored, are the
  between-session noise recorded earlier.
- **The prompt scenario is not a regression for qwen3:14b.** Without its
  grounding rules the model still answers from the passages it is given;
  relevancy even rose (+0.044). The tool was right to pass it. Stage 9's
  sloppy-prompt scenario needs a stronger change for this model, or it
  should be expected to pass.
- **No report artifact had ever been uploaded:** `upload-artifact@v4` skips
  hidden paths by default and the output is `.contextforge`. Found because
  the dual run's numbers could not be downloaded; fixed, and PR #4's runs
  uploaded theirs.
- One cached PR check: 7 minutes for 34 cases, a quarter of it setup. The
  judge's address never appeared in a log: GitHub masks the secret.

---

## 2026-09-28 — stage 7 — CI can reach the self-hosted judge

**Changed:** `scripts/ci-judge-config.sh`, called by `benchmark.yml` and
`pr-check.yml` after the optional Tailscale step. With a `JUDGE_HOST` secret
it writes `examples/contextforge.ci.local.yml` (git-ignored) from the
local-judge config with the real host, points the sample app at the same
Ollama server, checks the server answers, and hands the config to the run.
`pr-check` gained a manual trigger taking a PR number and a mode, for running
dual mode on the same PR. `benchmark` now commits everything under
`benchmark/`, since the local judge stores to `baseline-local-judge/`.
README has the setup steps.
**Why:** stage 7's demo needs CI to score with the same judge as local runs,
and the judge's address must stay out of the repository.
**Decisions:**
- **A generated config rather than `${VAR}` interpolation in the config
  file.** Interpolation would change the config schema (DESIGN §2) for one
  deployment detail; a git-ignored copy beside the original keeps relative
  paths working with no product change.
- **Fail before the build when the judge is unreachable,** rather than
  after ten minutes of Docker builds.
- `benchmark` stays disabled on GitHub until the secrets exist.
**Deferred:** the real-PR demo and the cached-versus-dual gate, pending the
user's Tailscale OAuth client and GitHub secrets.
**Notes:** tested locally with fake `GITHUB_ENV`/`GITHUB_OUTPUT` files: a
reachable judge gives the config output and six app variables; an unreachable
address exits 2; no `JUDGE_HOST` is a no-op. Whether containers on a GitHub
runner can reach the tailnet is untested until the first run.

---

## 2026-09-28 — noise between sessions; pushed to GitHub

**Changed:** the history was rewritten once more, before the first push, to
replace the GPU machine's Tailscale address with the placeholder `judge-box`
and to drop the relay's city code; the real address now lives in the
git-ignored `examples/contextforge.local-judge.local.yml`, which `demo.sh`
uses automatically. Pushed to a new private repository. `benchmark` disabled
on GitHub.
**Why:** the user asked to push with no trace of their network and no Claude
contributor.
**Decisions:**
- **The scrub covered the whole history, not just the latest commit,**
  because pushing uploads every commit. Done before the first push, when
  rewriting was still safe. Verified: 37 commits before and after, authors
  and all dates identical, the address in no file or message, and only the
  intended strings changed.
- **`benchmark` is disabled on GitHub** until stages 7–8 give CI a judge:
  without one, every push to `main` produced a red run. `pr-check` stays
  enabled; it runs only on pull requests.
**Notes:**
- **Noise exists between sessions.** The failing `top_k` demo, rerun a few
  hours after the first run, gave the same verdict and the same 5 regressed
  cases, with context_recall again 1.000 → 0.750 — but faithfulness went
  1.000 → 0.738 instead of 0.925 → 0.783, and answer relevancy 0.894 → 0.799
  instead of 0.897 → 0.791.
- **The cause is the app, not the judge.** Between sessions the GPU produced
  reworded answers for 5 of the 10 unchanged baseline questions, and two of
  those scored differently on faithfulness (0.75 → 1.00, 0.50 → 1.00). The
  judge itself moved by 0.02 on answer relevancy for one identical answer.
  The five back-to-back runs of stage 6 never showed this; plausibly the
  model's state on the GPU, such as a fresh load, is what differs.
- The largest drift seen, 0.075 on a 10-case mean, is still far below the
  drops a real regression caused (−0.25 on recall, −0.26 on faithfulness),
  so the 0.05 threshold is not threatened on the full 34 cases, where one
  such reworded case moves a mean by at most about 0.015. The noise
  measurement should nonetheless be repeated across separate sessions.
- **The first GitHub CI run passed**: lint, typecheck, tests, and the
  evaluator image built and tested on GitHub's machines. That is the first
  build anywhere but this laptop, which is stage 0's original gate.
- GitHub lists one contributor, the user, with every commit linked to their
  account.
- A 2-case demo run used to test the local config overwrote the 10-case
  `top_k` report; it was regenerated, which is how the drift was noticed.

---

## 2026-09-28 — cleanup — bloat removed, behaviour unchanged

**Changed:** six commits, one concern each — one shared `failure()` test
helper instead of five copies; one `scripts/lib/scenarios.sh` for the
scenario edits `demo.sh` and `validate-regressions.sh` both make; `pnpm
sample-app` fixed; an unread variable dropped from `.env.example`; the
evaluator's test image installs from `requirements-dev.txt`; the Action's
unused `@contextforge/shared` dependency removed. Also deleted git's
`refs/original` backup from the commit-message rewrite.
**Why:** the user asked for the codebase to be organised and its bloat
removed, without changes that could break it.
**Decisions:**
- **No files moved or renamed.** The layout already follows
  `docs/ARCHITECTURE.md`; moving files would rewrite imports for no gain.
- **About 50 exports that are only used in their own file were left
  exported.** They are option and result types; removing `export` changes
  nothing at runtime.
- The survey found almost no dead code in the TypeScript core. The bloat was
  duplication and stale configuration.
**Notes:**
- **Proof of no behaviour change:** before and after, the same script recorded
  the built CLI's help text, every exit code, the `compare` verdict and all
  three report formats on fixed inputs, plus test, typecheck and lint output.
  All 14 outputs were byte-identical. A real `run --answers-only` in Docker
  answered all 34 cases on both sides and left nothing behind.
- **`pnpm sample-app` had never worked:** run from the repository root, the
  app looked for `docs/knowledge-base` there and crashed on start.
- The `refs/original` backup still held the 14 commits carrying Claude
  trailers. A normal push would not have sent it; a mirror push would have.
- Changing the Dockerfile changes the evaluator image's source hash, so the
  next scoring run rebuilds the runtime image once. That is the tagging
  working as designed.

---

## 2026-09-28 — stage 6 — noise floor measured; first demos

**Changed:** `packages/cli/src/compare/noise.ts` (suggestions respect score
granularity), `scripts/measure-noise.mjs`, `scripts/demo.sh` (new), a
granularity paragraph in `docs/DESIGN.md` section 4, a Demo section in the
README. Earlier in the stage: `REASONING_EFFORT` for the sample app, and
Prettier kept off `benchmark/`.
**Why:** stage 6's gate — measure the noise floor and set defaults above it —
and a demo the user asked for.
**Decisions:**
- **Defaults kept at `mean_drop: 0.05`, `case_drop: 0.30`.** Both sit above
  the measured floor. Tighter was rejected: scores are coarse, and one case
  flipping from 1 to 0 moves a 34-case mean by 0.029, so 0.05 tolerates one
  flip and catches two or more.
- **The script's suggestions were wrong for a quiet judge, and are fixed.**
  Suggesting 1.5× the observed drift gave 0.02 when the drift was zero — below
  a single flip. Suggestions now never fall below 1.5 flips for `mean_drop`
  (0.05 at 34 cases) or 0.30 for `case_drop`.
- The sample app answers through the same Ollama server, with thinking off,
  so the measurement reflects a realistic app rather than the offline stub.
**Notes:**
- **Measured noise floor: zero.** Five self-comparisons of commit `59c9287`,
  10 app builds, 340 answers and about 3,700 judge calls in 78 minutes: every
  answer identical word for word, every score identical, all four means
  identical to four decimals across all ten scored sides — context_precision
  0.767, context_recall 0.956, faithfulness 0.933, answer_relevancy 0.863.
- **But noise is not impossible.** An earlier smoke test of the same commit
  produced 4 of 34 answers worded differently between the two sides. It did
  not recur in the measurement; plausibly it depends on GPU state, such as the
  model having just been loaded. The 0.30 case threshold absorbs it.
- **Why a comparison takes 15 minutes:** 11 judge calls per answer —
  context_precision makes one per retrieved passage (5), answer_relevancy 3,
  faithfulness 2, context_recall 1 — so 748 calls for 68 answers, about 2s
  each on the GPU, two at a time. Not the network: Tailscale now connects
  directly at 2 ms. Raising `OLLAMA_NUM_PARALLEL` is the untried speed-up.
- **Demo, first 10 cases:** `top_k` 5→1 was flagged — context_recall −0.250,
  faithfulness −0.142, answer_relevancy −0.106, 5 of 10 cases regressed, exit
  1, in 226s. context_precision did not move, correctly: the one passage kept
  is still the relevant top-ranked one. Renaming variables passed with every
  score identical, exit 0, in 274s. Both runs undid their edit and left no
  containers.

---

## 2026-09-28 — stage 4 — gate passed: a reviewed 34-case test set

**Changed:** `benchmark/testcases.json` (new), both example configs now use
it, `examples/testcases.json` removed. Before that, in two `fix:` commits:
`rapidfuzz` pinned, tiktoken's tables baked into the image, an unexpected
evaluator failure exits 2, and the image tag carries a hash of its sources.
**Why:** stage 4 — generate a test set from the sample app's documents, review
it, delete the bad cases.
**Decisions:**
- Generated with qwen3:14b in two runs: 20 requested (21 produced, 171s), then
  40 requested (42 produced, 206s). 63 cases in all.
- **Review outcome: 34 kept.** 18 kept as written, 16 rewritten, 29 deleted.
  Every rewrite's answer was checked against the knowledge-base text.
- Deleted cases fell into four kinds: nonsense from Ragas's typo persona
  ("what is the *misspelled* term for…"); circular questions ("why are gift
  cards non-returnable?" → "because they cannot be returned"); two unrelated
  questions joined with "and"; and **wrong ground truths**, where the
  generator combined facts from different policies into rules that do not
  exist, or invented a reason the documents never give. Some deletions were
  duplicates across the two runs.
- Typo'd questions whose meaning is clear were kept on purpose, as a test of
  messy user input.
- `generator.tool` reads "ragas, reviewed and edited by hand", because a third
  of the cases were rewritten; claiming pure generation would be false.
- Cases were renumbered tc-001 to tc-034 once, now, before anything depends on
  the ids. From here the set is frozen.
**Deferred:** more genuine two-document cases (see below).
**Notes:**
- **Only 4 of the 34 cases genuinely need two documents.** Almost everything
  Ragas labelled multi-hop was either two unrelated questions glued together
  or a single document split across chunks. A good multi-hop case has to be
  written by hand; Ragas 0.4.3 with this judge does not produce them.
- **Ragas could not trace the sources of any multi-hop case**: the reference
  contexts it returns are paraphrased, so the verbatim match that finds the
  source document fails. Every kept case's `reference_context_ids` was filled
  in by hand during review.
- **Usable yield: 29% as written, 54% after rewriting.** That is why
  `docs/DESIGN.md` makes human review mandatory, and it belongs in the
  write-up.
- The first real `dataset generate` failed after 16s on the missing
  `rapidfuzz`; the construction tests had passed, because Ragas imports it
  only once generation starts. The pipeline test added in response builds
  the real transforms, and passes with the network off.
- Regenerating over the reviewed file was refused in 0.24s, before any judge
  call, leaving it byte-identical.

---

## 2026-09-28 — stage 3 — gate passed against a real judge

**Changed:** `judge.reasoning_effort` added end to end — config, evaluator
request, both Python code paths, fingerprint, the cached-mode decision and
the comparability check — with `docs/DESIGN.md` sections 2, 3 and 7.
`pnpm typecheck` now covers test files. The local-judge config points at the
GPU machine.
**Why:** the judge became reachable over Tailscale, so stage 3's gate could run.
**Decisions:**
- **Thinking is switched off for judging, via OpenAI's own `reasoning_effort`
  parameter.** Qwen3 generated 246 tokens to produce the 14-character verdict
  `{"verdict": 1}`, and 8 with `reasoning_effort: none`. Thinking makes every
  one of ~360 calls per run slower, and it counts against Ragas's 1024-token
  response cap, so a long think could leave no answer to parse. Ollama ignored
  `think: false` on its OpenAI endpoint, and Qwen3 ignored a `/no_think`
  system prompt; only `reasoning_effort` worked.
- It is **optional and unset by default**, because non-reasoning models such as
  gpt-4o-mini reject the parameter. It is **fingerprinted as part of the
  judge**, because thinking changes verdicts: changing it re-scores the stored
  answers.
- Ollama returns thinking in a separate `reasoning` field, so even with it on
  the answer text was clean JSON. The fear that thinking would break Ragas's
  parsing was unfounded; its cost is time and token budget.
**Deferred:** comparing `reasoning_effort: low` against `none` for accuracy,
during the stage 6 noise measurement (see below).
**Notes:**
- **Stage 3 gate passed.** `evaluator/tests/test_integration.py` scored the
  three fixture cases twice with qwen3:14b (thinking off) and nomic-embed-text:
  every metric's mean was identical across the runs (spread 0.000 against the
  provisional 0.05 tolerance), and the fabricated answer scored below the
  grounded one. 67s for both tests over the Tailscale relay.
- Per-case scores were sensible with one exception. Faithfulness gave the
  fabricated answer 0.00 and both grounded answers 1.00. But **context_recall
  gave tc-003 0.00**, although its retrieved context says "Points post 14 days
  after delivery", which supports the ground truth. The same answer came back
  on every run, so it is a wrong verdict, not noise. With a one-sentence
  ground truth, recall is 0 or 1, so one wrong call flips a whole case. It may
  be the price of turning thinking off; worth testing `low` in stage 6.
- **Typechecking the tests found seven silent errors.** Vitest strips types
  without checking them. The worst: an edit adding `task` to a test object in
  stage 4 had never applied — the replacement ran without an assertion after
  Prettier had reformatted the target — so those tests built Docker arguments
  with an `undefined` subcommand and passed, because they only inspected the
  network flags. A test now checks the subcommand.

---

## 2026-09-28 — stages 3 and 5 — first real Docker runs

**Changed:** `evaluator/requirements.{in,txt}`, `evaluator/tests/test_ragas_wiring.py`,
`packages/cli/src/util/docker.ts`, `packages/cli/src/commands/run.ts`,
`examples/contextforge.yml`, tests for each. Four `fix:` commits on
`feat/stages-3-9`, after the nine stage commits.
**Why:** Docker was down for all of the previous session, so nothing had
touched a real container. This session ran the evaluator image and the
runner for real, and each found something the fakes could not.
**Decisions:**
- `langchain-community` is capped below 0.4.2. Ragas 0.4.3 imports a module
  0.4.2 removed, and Ragas does not cap the dependency; with it, `import
  ragas` failed and the evaluator could not score anything.
- The evaluator suite gained tests that build the real Ragas objects inside
  the image. They make no network calls, and they skip on a host without
  Ragas. The fake-scorer tests had passed throughout the broken state.
- The Docker pre-flight also checks `docker compose version`, so a missing
  Compose plugin is named instead of surfacing as "unknown flag".
**Deferred:** the stage 3 determinism test and everything else needing a judge.
**Notes:**
- **Stage 5 gate passed.** `run --answers-only` with `PROVIDER=local` built
  and queried the sample app at the merge base (`221e00f`) and at HEAD; all 3
  cases answered with contract-shaped context ids, both sides identically, as
  expected since the app did not change. A crashing app (`PROVIDER=openai`, no
  key) failed in 2s with its own log line in the error; a never-healthy app
  failed at the configured 10s `startup_timeout` showing the last response,
  `HTTP 404`. Both left no containers, networks, volumes or worktrees.
- **Real error path verified:** a judge at an unreachable address raised a
  real `APIConnectionError` inside Ragas's wrapping; `find_fatal` found it and
  the evaluator exited 2 after about 20s of client retries.
- **Environment problems, both outside the code:** the machine was running a
  kernel whose modules the package manager had already replaced, so `overlay`
  could not load and every container failed (fixed by rebooting); and the same
  update removed the Docker Compose plugin (fixed with `pacman -S
  docker-compose`).
- **Two real bugs found by the first runs:** the answers-only baseline
  inherited the candidate's "uncommitted changes" note; and the example config
  did not pass `PROVIDER` through, so the documented offline command could not
  have worked. Both fixed and tested.

---

## 2026-09-27 — stages 3–9 — built; gates pending

One session, at the user's request: "complete everything else except setting
up tailscale". That overrides the one-stage-at-a-time rule in `CLAUDE.md` for
this session; each stage still gets its own status below and in
`docs/TASKS.md`. Nothing was committed.

**Changed:** `evaluator/` (new), `packages/cli/src/{evaluator,dataset,runner,
compare,benchmark,report,commands}`, `packages/action/`, `packages/shared`
(schemas), `scripts/`, three workflows, `examples/contextforge.local-judge.yml`,
`examples/testcases.json`; `docs/DESIGN.md` sections 2–7,
`docs/ARCHITECTURE.md`, `docs/TASKS.md`, `README.md`.

### Stage 3 — evaluator
- **Ragas 0.4.3, fully pinned.** The unconstrained resolve silently
  backtracked to instructor 1.3.2 (mid-2024), which lacks functions Ragas 0.4
  calls. `instructor>=1.11` and `openai>=2,<3` are now explicit in
  `requirements.in`; `requirements.txt` pins all 92 packages for CPython 3.12.
- **Ragas's default temperature is 0.01, not 0.** Temperature and seed are
  passed explicitly on every judge call.
- **NaN never reaches a mean.** Ragas returns NaN when the judge's output has
  nothing to score; the evaluator turns every NaN into `null` plus a reason.
- **An unreachable judge stops the run** (exit 2) instead of producing a wall
  of nulls that would look like per-case failures. Instructor and Ragas wrap
  client errors, so fatal ones are found by walking the exception chain.
- The core ↔ evaluator JSON contract did not exist in the spec; it is now
  `docs/DESIGN.md` section 7.
- On Linux the evaluator container uses host networking, so a judge reachable
  from the host — including over Tailscale — is reachable unchanged.

### Stage 4 — dataset generation
- Generated sets record **source document ids**, not chunk ids, in
  `reference_context_ids`. Chunk ids change whenever chunking changes — the
  very thing ContextForge tests — so a frozen set naming chunks goes stale the
  first time anyone touches chunking. Recorded in `docs/DESIGN.md` section 3.
- Generation uses Ragas's LangChain-wrapper path, which is deprecated, because
  `TestsetGenerator` is only half-migrated to the newer interface.
- `OpenAIEmbeddings` sends pre-tokenised input by default, which only OpenAI
  accepts; `check_embedding_ctx_length=False` is set so Ollama works.
- The dataset hash covers `cases` only, in canonical JSON, so reformatting or a
  new timestamp does not invalidate every stored benchmark.
- `dataset generate` checks for an existing file *before* calling the judge,
  and refuses without `--overwrite`. An early draft would have written an
  empty dataset in that check; caught in review.

### Stage 5 — runner
- Teardown runs in `finally` and never throws; tests force failures during
  build, health and query and assert `down` still runs.
- Each Compose project gets a unique name, so teardown touches nothing a
  developer already had running.
- Compose sees only Docker's variables plus `app.env_passthrough`. A stray
  shell variable cannot change a result, and secrets reach the app only when
  listed.
- A crashed container fails fast instead of at `startup_timeout`, and the
  error carries the container's last log lines.
- Cases are queried one at a time, so latency does not depend on how many
  other questions were in flight.
- `app.query_timeout` (default 60s) was added; it was hardcoded at first.
- The baseline is built from a detached `git worktree` of the base commit; the
  candidate at `HEAD` uses the working tree, with uncommitted changes noted.

### Stage 6 — comparator
- **`docs/DESIGN.md` never defined a "regressed case".** Added: the candidate
  app failed to answer where the baseline did, or any metric fell by more than
  the new `thresholds.case_drop`.
- `mean_drop` uses **paired means** over cases scored on both sides, so a case
  the candidate failed to answer cannot drop out of its average and flatter it.
- A gated metric with nothing to measure **fails**, rather than passing
  silently.
- Results from different test sets or judges are a tool error, not a verdict.
- The noise floor is not measured. `scripts/measure-noise.mjs` runs `main`
  against itself N times and suggests thresholds; the analysis is a tested,
  pure function.

### Stage 7 — cached mode
- Stored benchmarks are read from the **base branch's tree**, not the PR's. The
  benchmark for a commit lands in a *later* `[skip ci]` commit, so a PR that
  branched before it landed would otherwise never find it. A test reproduces
  exactly that case.
- `app_hash` covers the Compose file, Dockerfiles and lockfiles, deliberately
  not source code: source changes are what the PR is being tested for.
- A new `contextforge benchmark` command does the push-to-main half. It refuses
  a dirty tree, because the file would misdescribe its commit.
- `pr-check.yml` checks out the PR head rather than GitHub's merge commit, so
  the baseline really is the merge base, as `docs/DESIGN.md` requires.
- Separate stores per judge (`benchmark/baseline-local-judge` in the local
  config) keep benchmarks from two judges from colliding.

### Stage 8 — Action and reporting
- **Composite action**, not a bundled JavaScript one: it builds the same CLI
  developers run, so there is no second artefact to drift.
- **Plain `fetch`, not Octokit.** Three REST calls did not justify the
  dependency. A deviation from `docs/ARCHITECTURE.md`'s tech stack, now
  recorded there.
- **Posting the comment lives in the Action, not the core's Reporter**, as
  `docs/ARCHITECTURE.md`'s layering says, although its component table had put
  it in the core. The table is corrected.
- A tool error posts a comment saying the *check* broke — never silence, and
  never mistakable for a regression.
- A comment that cannot be posted, such as a fork PR's read-only token, raises
  a workflow warning without changing the verdict.
- The report is escaped against app output and capped under GitHub's 65,536
  character limit. The verdict gained `regressions` (case plus reasons), and
  case records gained `question`, so `report` needs no config or dataset.

### Stage 9 — prepared, not run
- `scripts/validate-regressions.sh` builds four scenarios as local branches —
  `top_k` 5→1, a weaker embedding model, a prompt without grounding rules, and
  a pure rename — runs each in dual mode and tabulates caught versus missed.
  Every patch was dry-run against a copy of the sample app.
- It refuses `PROVIDER=local`: the offline app ignores prompts, so the results
  would be meaningless.

**Deferred:** every gate from stage 3 on (see Current state); publishing the
evaluator image to a registry (the CLI builds it locally on first use).

**Notes:**
- **Docker was down all session** and starting it needs `sudo`. Nothing
  touched a real container.
- Workspace packages resolve through `package.json` to `dist/`, which is stale
  until the next build. Tests passed against old code once before Vitest and
  ESLint were both pointed at source.
- Zod 4 reports an unknown key against its parent object; pydantic reports
  paths as tuples. Both are translated into dotted key paths.
- Two test failures during the session were wrong expectations in the tests,
  not bugs: a drop of exactly `case_drop` is correctly not a regression, and
  one fixture's "held" mean had in fact dropped by 0.08.

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

---

## 2026-11-04 — pipeline and sample repository separation

**Changed:** moved the ContextForge packages, evaluator, scripts and product
docs under `pipeline/`; moved the sample RAG application, configs and frozen
benchmark under `user-repo/`. Updated root workspace/build/test wiring,
documentation, scripts and config references. Kept the required
`.github/workflows/ci.yml` entrypoint at the repository root; it still validates
ContextForge only. Added LF handling for shell scripts and made Prettier respect
the checked-out line-ending convention.
**Decisions:** `user-repo/` is a sample fixture within this development
monorepo, not the customer repository fetched by hosted jobs. Production
evaluation remains pinned to the customer's event commit and a deployed
ContextForge release.
**Verified:** frozen-lockfile install, typecheck, build, ESLint, moved local
config validation, focused CLI tests (8/8), Bash syntax, and Prettier checks
for edited files all pass. Full TypeScript tests report 246 passed and 19
Windows path-assumption failures. `pnpm lint` still reports formatter
differences in one existing pipeline source file and eight sample knowledge
base documents; ESLint itself passes.
**Deferred:** hosted queue/state, managed storage, disposable VM provisioning,
deployment and GitHub App registration remain open for stage 8. The known
Windows path-dependent tests and remaining formatter differences were not
expanded into this folder-separation change.
**Surprises:** the moved package tsconfigs needed one additional parent
directory to extend the root config. Git's Windows checkout produced CRLF in
shell scripts, which made Bash parsing fail until LF was enforced.
