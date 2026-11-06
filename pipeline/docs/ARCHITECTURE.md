# Architecture

## Product boundary

The target product is a hosted ContextForge service connected to GitHub through
a GitHub App. The service receives repository events and runs evaluations
without requiring a workflow file in the user's repository.

The user repository owns the RAG application, vector database, Compose stack,
ContextForge config and frozen test set. ContextForge owns the GitHub App,
event processing, evaluation orchestration, Ragas evaluator, result delivery,
baseline/report storage and isolated execution infrastructure.

The ContextForge development system and the hosted product are separate:
repository CI tests and releases ContextForge itself; the hosted service
processes customer GitHub events using a deployed release. Customer evaluation
never runs inside a developer's checkout, a developer's Actions run, or a
workflow installed in the customer repository.

## Components

| Component | Lives in | Responsibility |
|---|---|---|
| GitHub App/webhook API | `pipeline/packages/service` (core implemented) | Verify webhook signatures, validate PR/push events, and enqueue commit-pinned jobs; production hosting and durable queue adapter are pending |
| GitHub App client | `pipeline/packages/service/src/github-app.ts` | Authenticate as the App, mint installation tokens, and create/update Check Runs |
| Job orchestration | `pipeline/packages/service/src/worker.ts` | Coordinate check status, isolated evaluation, report persistence, and final outcome through injected ports |
| Isolated execution worker | `EvaluationWorker` port in `pipeline/packages/service/src/types.ts` | Contract requires a disposable per-job VM; VM provisioning/runtime adapter is not implemented |
| Evaluation engine | `pipeline/packages/cli` and `pipeline/evaluator/` | Target: versioned evaluation implementation packaged with the deployed service release; CLI commands are for developer authoring and local verification only |
| Config and dataset tools | `pipeline/packages/cli/src/config`, `pipeline/packages/cli/src/dataset` | Validate customer config and generate/freeze datasets; hosted jobs read the config and dataset from the event's pinned commit |
| Runner | `pipeline/packages/cli/src/runner` | Build and start the pinned customer app containers, health-check, query, tear down |
| Evaluator client | `pipeline/packages/cli/src/evaluator` | Send JSON to the Ragas container, receive per-case scores |
| Comparator | `pipeline/packages/cli/src/compare` | Diff two result sets, flag regressed cases, apply thresholds, measure noise |
| Hosted storage | service adapter (not implemented) | Persist baselines, reports, job state, and delivery idempotency independently of customer repository state |
| Evaluator service | `pipeline/evaluator/` | Python and Ragas, JSON in and JSON out, no Git or CI awareness |
| Development CI | `.github/workflows/ci.yml` | Test, typecheck, lint, build and test the evaluator image for this repository only; it does not evaluate customer repositories |
| Local development service | `pipeline/packages/service/src/server.ts` | Single-repository GitHub App listener with a file-backed job queue, exact-commit CLI worker, and file-backed reports; for trusted development repositories only |

Comparator, reporter and the benchmark decision are pure functions over data.
In the developer CLI, filesystem, Docker, and Git I/O live in the runner,
evaluator client, config loader, and local benchmark store; shell commands go
through one injectable `Exec`. The hosted service uses explicit ports for
queueing, execution, storage, and GitHub reporting. Its production adapters
are not implemented yet. When implemented, the customer's config and source
must be fetched at the event's full commit SHA; its mutable ref is metadata
only. The worker must run an immutable deployed ContextForge release, not
source from the developer's current checkout.

## Development CI and hosted evaluation boundary

`.github/workflows/ci.yml` runs only for changes to this ContextForge
repository. It installs this repository's lockfile and validates its source,
tests, and evaluator image. It has no customer repository token, model key,
workflow-call interface, or step that checks out or evaluates a customer app.

The hosted product has no customer-side workflow or action. GitHub sends an
event to the independently deployed GitHub App service. The service records
the repository and full commit SHA, queues the job, and launches a disposable
worker. The worker fetches exactly that commit and runs the evaluator version
in the deployed service release; it must not use a developer workspace or
resolve the event's mutable branch ref. This hosted path is not yet deployable:
the durable queue/state, managed storage, VM adapter, deployment, and App
registration remain to be implemented.

The CLI remains a developer tool for validating configs, generating frozen
datasets, and testing the evaluation engine locally. It is not a second
production integration and its local `user-repo/benchmark/baseline` directory is not
used by the hosted service.

The local development service listens on a configurable HTTP port, normally
bound to loopback behind an HTTPS reverse proxy. It accepts events only for one
configured repository, persists webhook jobs and reports under its data
directory, fetches the event's full commit SHAs using the configured local
Git remote, calculates the merge base, and invokes the built CLI against a
temporary worktree. Fork pull requests are disabled because a local Docker
worker is not a security boundary for arbitrary contributor code. Do not expose
this mode to repositories or contributors you do not trust.

## Baseline reuse

There is one PR evaluation path. The run resolves the PR merge base and looks
for the nearest stored benchmark at or before it. If the benchmark fingerprint
matches the current dataset, app environment, judge, embeddings and tool
version, its scores are reused. If no compatible benchmark exists, the runner
builds and scores the merge-base app before evaluating the candidate. A changed
judge or embedding model rebuilds the baseline instead of adding a separate
re-judge path.

Local CLI benchmarking stores commit-keyed files under
`user-repo/benchmark/baseline/<sha>.json` for the sample fixture. For other
customer projects, the local CLI stores the baseline under that config's
`benchmark/baseline/<sha>.json`. The hosted service instead owns its baseline
store and report retention; customer config does not select or persist hosted
baseline storage. A matching benchmark is reused only when its evaluation
fingerprint matches; otherwise the hosted worker rebuilds the merge-base
baseline from the corresponding pinned source.

## Hosted evaluation flow (target; production adapters pending)

1. A user installs the GitHub App and grants access to selected repositories.
2. GitHub sends push or pull-request events to the hosted webhook API.
3. The service validates and deduplicates each delivery, then creates an
   evaluation job for the exact commit(s).
4. A disposable isolated worker checks out the user's repository and reads its
   config, dataset, and Compose file.
5. The runner builds and starts the configured RAG service and its Compose
   dependencies, such as a vector DB. It waits for health, submits the frozen
   queries, collects answers and retrieved contexts, and tears the app stack
   down.
6. The separate Ragas evaluator container scores the collected cases using
   configured cloud judge/embedding endpoints. The comparator evaluates the
   scores against the baseline and thresholds.
7. The service publishes a check and report on the originating GitHub commit
   or PR, then destroys the worker and its temporary data.

User-controlled pull-request code and Compose configuration are untrusted.
Workers must be isolated per run, bounded by resource/time limits, and
destroyed after use. Platform credentials must not be exposed to the user app
container. User-provided app credentials and evaluator credentials require
separate scoping; fork PR jobs receive no user secrets. The cloud provider and
specific storage/VM adapters are deferred, while the security boundary and
provider-neutral service contracts are required.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language (current core) | TypeScript, Node 20+ (developed and run on 26) | Service core, CLI, and runner |
| CLI | Commander.js | Subcommands, flags, help output |
| Config | YAML plus Zod | Human-editable config, runtime validation with typed output |
| Evaluation | Ragas (Python 3.11) | Reference-free RAG metrics; runs in its own container |
| Containers | Docker, Docker Compose | Reproducible environments for baseline and candidate |
| GitHub integration | GitHub App/webhooks and Checks API (service core implemented) | Central service reacts to repository events without a user workflow; deployment adapters remain |
| Tests | Vitest (TS), pytest (Python) | Fast, watch mode, good TS support |
| Package manager | pnpm workspaces | Monorepo with service, CLI, shared core and the sample app |
| Internal CI | GitHub Actions validation workflow | Validates ContextForge source only; never runs customer evaluations |
| Hosted product integration | GitHub App/webhooks and Checks API | The sole production customer-evaluation path; no user workflow required |

## Folder structure

```
contextforge/
  package.json                 # root workspace orchestration for developer CI
  pnpm-workspace.yaml
  README.md
  CLAUDE.md
  .github/workflows/ci.yml     # required root-level internal CI entrypoint
  pipeline/                    # ContextForge-owned pipeline and product code
    docs/
      PRD.md
      ARCHITECTURE.md
      RULES.md
      DESIGN.md
      TASKS.md
      MEMORY.md
    packages/
      service/            # webhook validation, GitHub App client, orchestration ports
      cli/                # config, dataset, runner, evaluator client, compare, report
      shared/             # shared result and benchmark schemas
    evaluator/             # Ragas wrapper and Python tests
    scripts/               # local demo, noise measurement, regression validation
    deploy/                 # example HTTPS reverse-proxy configuration
  user-repo/                    # sample customer-repository fixture
    sample-rag-app/        # reference RAG app and Compose stack
    contextforge.yml
    contextforge.local-judge.yml
    benchmark/
      testcases.json
      baseline/<sha>.json
```

The webhook handler, App API client, and provider-neutral job orchestration
core and a single-repository local development server now exist. Production
registration/deployment, distributed durable queue and job-state adapters,
managed report/baseline storage, and the per-job VM implementation do not. The
local server is for trusted repositories and is not the hosted production
worker. The root-level workspace files and GitHub Actions entrypoint are
development orchestration only. The folder tree describes the current code,
not a complete hosted deployment topology. The former reusable workflow and composite Action have
been removed so they cannot be mistaken for, or substitute for, the hosted
product path.
