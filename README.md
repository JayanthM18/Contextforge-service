# ContextForge

Hosted GitHub App for RAG regression checks.

A change to a RAG pipeline — chunking, embeddings, retrieval, reranking,
prompts, models — can make answers measurably worse while the application
still starts, serves traffic and passes every unit test. Nothing raises an
error, so the drop is invisible until users complain.

The product direction is a hosted PaaS: connect a GitHub repository through a
ContextForge GitHub App, run its RAG evaluation on code changes, and report the
result on the pull request without requiring a workflow file in that
repository.

## Status

**The hosted GitHub App service is not deployable yet.** The repository now
contains a signed-webhook handler, GitHub App API client, and provider-neutral
job orchestration core, alongside developer-only CLI tools, the Compose
runner, and Ragas evaluator. The former reusable workflow and composite Action
are removed. Durable queue/state, managed report and baseline storage,
disposable VM provisioning, deployment, and App registration are still
missing. See `pipeline/docs/TASKS.md` for the current stage and
`pipeline/docs/MEMORY.md` for verified behavior and open decisions.

## Hosted evaluation architecture

1. A GitHub App webhook captures the customer repository and exact commit SHA.
2. The service queues a job and provisions an isolated, disposable worker.
3. The worker fetches the config, frozen dataset and application source from
   that exact commit, then runs the evaluator from the deployed ContextForge
   release. It never uses a developer's checkout or mutable branch ref.
4. ContextForge compares the scores with its managed baseline store and
   publishes a Check Run linking to the detailed report.

The GitHub App service core exists, but production queue/state, managed
storage, VM provisioning, deployment, and App registration are not complete.
See [the current stage](pipeline/docs/TASKS.md).

## Developer tools

- Node 20 or newer (developed on Node 26) and pnpm 10
  (`npx pnpm@10` works without installing it)
- Docker and Docker Compose
- A judge endpoint for local evaluation (see [Choosing a judge](#choosing-a-judge))

These are requirements for developing and running the local CLI. Customer
repositories do not run this repository's CI or install a ContextForge
workflow; hosted evaluation is triggered by the GitHub App.

## Local CLI quick start

The CLI can run an evaluation locally today. This is separate from the
planned hosted GitHub App integration.

```sh
cd /path/to/ContextForge
pnpm install && pnpm build
export CONTEXTFORGE_DIR="$PWD"
```

**1. Prepare a repository containing your RAG app and dependencies.** Its
Compose stack can include the vector database and other services. The app
must expose the contract in `pipeline/docs/DESIGN.md` section 1:

```
GET  /health  → 200 {"status":"ok"} once ready
POST /query   {"question": "..."}
           → {"answer": "...", "contexts": [{"text": "...", "id": "doc.md#c3"}]}
```

`user-repo/sample-rag-app` is only a small local reference implementation; it
uses an in-memory vector index and is not your application's vector database.

**2. Add `contextforge.yml` to that repository.** From the RAG repository
root, configure
`app.compose_file` and `app.service` to point to the RAG service in your
Compose stack, then configure the frozen dataset, judge, metrics, and
thresholds. Start from the schema in `user-repo/contextforge.yml`; paths resolve
against the config file's directory. Check it with:

```sh
cd /path/to/your-rag-repo
node "$CONTEXTFORGE_DIR/pipeline/packages/cli/dist/bin.js" validate --config contextforge.yml
```

Supply app and evaluator credentials through environment variables as named by
the config; never put secret values in `contextforge.yml`.

**3. Generate, review and freeze the test set.**

```sh
node "$CONTEXTFORGE_DIR/pipeline/packages/cli/dist/bin.js" dataset generate --config contextforge.yml --size 40
```

Review the generated test set, remove weak cases, and keep it unchanged during
evaluations.

**4. Check the app side works** — no judge needed:

```sh
node "$CONTEXTFORGE_DIR/pipeline/packages/cli/dist/bin.js" run --config contextforge.yml --answers-only
```

**5. Run a local comparison** of your working tree against `main`:

```sh
node "$CONTEXTFORGE_DIR/pipeline/packages/cli/dist/bin.js" run --config contextforge.yml
```

Results land in `.contextforge/`: `report.md`, `report.html`, and
`results.json`. The exit code is `0` for pass, `1` for a regression, and `2`
for a tool error.

## Hosted GitHub App (not deployed yet)

The target onboarding is to install the ContextForge GitHub App on selected
repositories. GitHub events trigger isolated evaluations, and the hosted
service publishes a check and report on the exact commit. User repositories
will not need a ContextForge workflow file, and evaluations do not run in
ContextForge's developer CI. The service core exists, but production adapters,
deployment, and App registration are not available yet. See
[the design contract](pipeline/docs/DESIGN.md#8-hosted-github-app-integration-service-core-implemented-production-adapters-pending).

## Local GitHub App service (development/testing)

ContextForge can run as a **single-repository development service** on the
machine that has the target Git clone. GitHub sends pull-request webhooks to
the public HTTPS reverse proxy; the service queues the event, fetches the exact
head/base commits through the clone's configured `origin`, computes their
merge base, and runs the existing CLI in a temporary Git worktree. It posts a
Check Run and links to a report served by the local service.

This is not the hosted production worker. It uses the host's Docker daemon and
local Git credentials, accepts one configured repository, and refuses fork
pull requests. Only use it with repositories and contributors you trust:
Docker is not a strong boundary against malicious Dockerfiles or Compose
configuration.

### 1. Prepare the machine

Install Node.js 20.6 or newer, pnpm 10, Git, Docker Desktop (or Docker Engine
with Compose v2), and Caddy or another HTTPS reverse proxy. Clone the target
GitHub repository onto this machine with full history, configure its `origin`
to that GitHub repository, and authenticate Git so this account can fetch PR
commits. The service uses this local clone only as a Git object store; its
uncommitted working files are not evaluated.

In the ContextForge checkout, install/build and prepare the environment file:

```powershell
pnpm install --frozen-lockfile
pnpm build
Copy-Item .env.example .env
```

Edit `.env` and set:

- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `CONTEXTFORGE_WEBHOOK_SECRET`
  from a GitHub App you create.
- `CONTEXTFORGE_GITHUB_REPOSITORY` to the exact `owner/name` of the target
  repo; `CONTEXTFORGE_REPOSITORY_PATH` to its local clone root.
- `CONTEXTFORGE_CONFIG_PATH` to the path of its config, relative to that
  repository root (for this monorepo's sample fixture:
  `user-repo/contextforge.yml`).
- `CONTEXTFORGE_PUBLIC_URL` to the public HTTPS origin that proxies to the
  service. Keep `CONTEXTFORGE_HOST=127.0.0.1` when the proxy is on the same
  machine; set `CONTEXTFORGE_PORT` to the proxy's upstream port (default 3000).
- `OPENAI_API_KEY` or the keys required by the configured judge/embeddings.
  Add only intended variable names to `CONTEXTFORGE_EVALUATION_ENV_KEYS` and
  `CONTEXTFORGE_APP_ENV_KEYS`. The service excludes `GITHUB_*`,
  `CONTEXTFORGE_*`, and `RUNNER_*` names from those lists.

Keep `.env` private. The service requires the configured app and evaluator
variables explicitly; it does not pass the service's GitHub App credentials
to the CLI or customer containers.

### 2. Configure the GitHub App and HTTPS proxy

Create a GitHub App for the target repository with **Contents: read**,
**Pull requests: read**, **Checks: read and write**, and **Issues: read and
write** permissions. Subscribe to the **Pull request** webhook event. Generate
an App private key and set its webhook secret to the same value as
`CONTEXTFORGE_WEBHOOK_SECRET`. Install the App only on the configured
repository. Configure its webhook URL as
`https://<your-domain>/webhooks/github`.

The service itself listens on HTTP at `127.0.0.1:3000` by default. A reverse
proxy terminates HTTPS and forwards requests for `/webhooks/github`, `/reports/*`,
and `/health`. GitHub cannot send webhooks directly to a loopback address: use
a publicly reachable HTTPS reverse proxy or tunnel that forwards to the local
listener. For Caddy, copy
[`pipeline/deploy/Caddyfile.example`](pipeline/deploy/Caddyfile.example) and
set `CONTEXTFORGE_DOMAIN`; ensure the machine is reachable on ports 80 and 443
so Caddy can provision its certificate. Set `CONTEXTFORGE_PUBLIC_URL` to
`https://<your-domain>` (origin only, no path).

### 3. Start the service and open a real PR

Make sure the target clone's `origin` points at the configured repository and
that Docker is running. Then start the service from the ContextForge checkout:

```powershell
pnpm --filter @contextforge/service start
```

`GET https://<your-domain>/health` should return `{"status":"ok"}`. Open or
update a **same-repository** pull request (not a fork PR; fork evaluations are
disabled by the local service). GitHub delivers the real webhook, the service
fetches the event's exact head and base commits, runs the configured CLI
evaluation against them, and publishes the actual pass/regression/tool-error
result. No verdict is seeded or simulated. The Check Run is attached to the
evaluated head commit, and one ContextForge PR comment is created or updated
with that commit's outcome and report link. Full reports are written under
`CONTEXTFORGE_DATA_DIR` (default: `<target-clone>/.contextforge/service`) and
served at unguessable HTTPS report URLs. Anyone with a report URL can read its
answers, contexts, and scores, so treat the URL and local report directory as
private data.

The service runs one job at a time and stores its queue state in a local JSON
file. Keep one service instance running for this data directory. It does not
support multiple replicas, fork PRs, push-triggered evaluation, public
multi-tenant use, or VM-grade isolation.

## Local developer demo

This smoke test exercises the evaluation engine on the sample app. It is not
the hosted PaaS execution path.
`pipeline/scripts/demo.sh` changes the sample app, compares it with the last
commit and prints the verdict, then undoes the change:

```sh
pipeline/scripts/demo.sh top-k --cases 10      # retrieve 1 passage instead of 5: should fail
pipeline/scripts/demo.sh prompt --cases 10     # drop the grounding rule from the prompt: should fail
pipeline/scripts/demo.sh harmless --cases 10   # rename variables only: should pass
pipeline/scripts/demo.sh --cases 10            # compare your own uncommitted edits to the app
```

It uses the developer-only Ollama config in
`user-repo/contextforge.local-judge.yml`; pass
`--judge <host>` if that machine's address changes. Reports land in
`.contextforge/demo-<scenario>/`.

## Choosing a judge

The judge is configuration, not code. Any server that speaks the OpenAI API
works, so moving between providers changes two lines:

```yaml
evaluation:
  judge:
    provider: openai
    model: gpt-4o-mini
    base_url: null                 # null → api.openai.com
    api_key_env: OPENAI_API_KEY    # names the variable; the key never goes in the file
```

For local development with a self-hosted judge such as Ollama, set `base_url`
to its `/v1` endpoint and `api_key_env: null`. The developer-only config
`user-repo/contextforge.local-judge.yml` demonstrates this; the hosted service
does not consume it.

Gemini chat models are accessed through Google's OpenAI-compatible endpoint;
Gemini embeddings use Google's native API. The sample configuration
`user-repo/contextforge.gemini.yml` selects Gemini for the judge, embeddings,
and sample RAG app while retaining all four evaluation metrics. Set
`PROVIDER=gemini` and `GEMINI_API_KEY` in `.env`, choose that config with
`CONTEXTFORGE_CONFIG_PATH=user-repo/contextforge.gemini.yml`, and allow
`GEMINI_API_KEY` in both `CONTEXTFORGE_EVALUATION_ENV_KEYS` and
`CONTEXTFORGE_APP_ENV_KEYS`.

The hosted service obtains evaluator credentials from its own protected
configuration. User application credentials are separately scoped and are
never placed in the evaluator container. Those production integrations have
not yet been implemented.

Scores from different judges are not comparable. ContextForge fingerprints the
judge and embedding model and rebuilds the merge-base baseline when either
changes. Thresholds should be recalibrated per judge with `pnpm measure-noise`.

## Commands

```
contextforge validate          --config <path>
contextforge dataset generate  --config <path> [--size <n>] [--overwrite]
contextforge run               --config <path> [--candidate HEAD] [--baseline <ref>]
                               [--base-branch main] [--output .contextforge] [--answers-only]
contextforge benchmark         --config <path>
contextforge compare           <baseline.json> <candidate.json> --config <path> [--output <file>]
contextforge report            <results.json> --format md|html|json [--output <file>]
```

## Developing ContextForge

`.github/workflows/ci.yml` validates only this repository's source and
evaluator image. It has no customer-evaluation trigger or customer credentials.
The hosted GitHub App is a separate deployed service; it fetches customer
source by exact commit SHA and executes a pinned service release.

```sh
pnpm test              # TypeScript tests (Vitest)
pnpm test:evaluator    # Python tests, inside the evaluator image
pnpm lint              # ESLint and Prettier
pnpm typecheck
pnpm build
```

## Repository separation

The ContextForge pipeline and the sample customer repository have separate
top-level directories in this development monorepo. Root package/workspace
files orchestrate developer checks, and GitHub requires the internal workflow
to remain at `.github/workflows/ci.yml`. That workflow validates ContextForge
only; it does not run the sample/customer evaluation. In production, the
hosted worker independently fetches a customer's repository at the event's
exact commit SHA and runs a deployed ContextForge release.

```
pipeline/                    ContextForge-owned pipeline and product code
  packages/cli/              config, dataset, runner, evaluator client, compare, report
  packages/service/           GitHub App webhook, API client, orchestration core
  packages/shared/            shared result and benchmark schemas
  evaluator/                  Python and Ragas, JSON in and JSON out
  scripts/                    local demo and regression/noise validation
  docs/                       product specs, architecture, tasks and memory
user-repo/                   sample customer repository fixture
  sample-rag-app/             reference RAG application and Compose stack
  contextforge.yml            sample customer configuration
  benchmark/                  frozen sample evaluation set
.github/workflows/ci.yml     root entrypoint for ContextForge developer CI only
package.json                 root workspace orchestration for development
```

`user-repo/` is a fixture inside this repository, not a separate Git
repository. It demonstrates the customer-side layout without coupling the
hosted execution path to this development checkout.

## Documentation

| File | What it is |
|---|---|
| `pipeline/docs/PRD.md` | Problem, goals, users, MVP scope |
| `pipeline/docs/ARCHITECTURE.md` | Current components and target hosted-app flow |
| `pipeline/docs/RULES.md` | Principles, technology rules, coding standards |
| `pipeline/docs/DESIGN.md` | App contract, config, benchmark, verdict, report, CLI and evaluator formats |
| `pipeline/docs/TASKS.md` | Staged plan, exit criteria, current stage |
| `pipeline/docs/MEMORY.md` | Log of changes, decisions and what has been verified |

## Licence

MIT
