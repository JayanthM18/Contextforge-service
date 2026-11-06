# Detailed design

Specs the implementation must follow. Change these deliberately, with a note in
`pipeline/docs/MEMORY.md`.

## 1. App contract

The interface every RAG application must expose. The runner, evaluator and
sample app all depend on it, so it is the most load-bearing spec here.

### `GET /health`

Returns `200` once the app is ready to serve queries (index built, models
loaded). The runner polls this before sending any question.

```json
{ "status": "ok" }
```

### `POST /query`

Request:

```json
{ "question": "What is the refund window?" }
```

Response:

```json
{
  "answer": "Refunds are accepted within 30 days of delivery.",
  "contexts": [
    { "text": "Customers may request a refund within 30 days...", "id": "policy.md#c12", "score": 0.81 }
  ],
  "metadata": { "latency_ms": 820, "tokens": { "prompt": 1450, "completion": 60 } }
}
```

Rules:

- `answer` is a plain string. No markdown wrapper, no streaming.
- `contexts` is the ordered list of chunks actually passed to the LLM, most
  relevant first. `text` is required; `id` and `score` are optional but
  recommended — `id` enables cheap retrieval-only metrics later.
- `metadata` is optional. When present, latency and token counts are reported
  alongside quality.
- A non-2xx response or malformed body fails that test case, not the whole run.

### Container requirements

- Listens on the port given by `PORT` (default `8000`)
- Reads API keys from environment variables, never baked into the image
- Starts cold within the configured `startup_timeout`
- Generation temperature `0`, so two runs are comparable

## 2. Configuration: `contextforge.yml`

Validated with Zod at load time. Unknown keys are an error, not a warning.

```yaml
version: 1

app:
  compose_file: docker-compose.eval.yml
  service: rag-app
  port: 8000
  health_path: /health
  query_path: /query
  startup_timeout: 120        # seconds
  query_timeout: 60           # seconds per question; a timeout fails that case only
  env_passthrough: [RAG_MODEL_API_KEY]  # allowlisted names; secrets are supplied out of band

dataset:
  path: benchmark/testcases.json
  source_docs: docs/knowledge-base   # only used by `contextforge dataset generate`
  size: 40

evaluation:
  metrics: [context_precision, context_recall, faithfulness, answer_relevancy]
  judge:
    provider: openai          # the wire protocol, not the vendor
    model: gpt-4o-mini
    base_url: null            # any OpenAI-compatible endpoint; null uses the default
    api_key_env: OPENAI_API_KEY   # names the variable, never holds the secret
    temperature: 0
    seed: 42
    reasoning_effort: null    # none|minimal|low|medium|high; sent only when set
  embeddings:                 # answer_relevancy is computed from these
    provider: openai          # openai or gemini (Gemini native embedding API)
    model: text-embedding-3-small
    base_url: null
    api_key_env: OPENAI_API_KEY
  runs: 1                     # repeat count; >1 averages to reduce noise
  concurrency: 4

thresholds:
  mean_drop:
    context_precision: 0.05
    context_recall: 0.05
    faithfulness: 0.05
    answer_relevancy: 0.05
  absolute_floor:
    faithfulness: 0.70
  case_drop: 0.30             # a case regresses if any metric falls further than this
  max_regressed_cases: 3

```

Validation rules:

- `version` must be `1`
- every metric in `evaluation.metrics` is a known metric name
- every key under `thresholds.*` appears in `evaluation.metrics`
- `dataset.path` exists unless the command is `dataset generate`
- `startup_timeout` between 10 and 900
- `base_url` is an absolute `http` or `https` URL when set
- `api_key_env` names an environment variable that must be present, unless it
  is `null` for an endpoint that needs no key
- `evaluation.embeddings` is required whenever `answer_relevancy` is in
  `evaluation.metrics`
- `evaluation.judge.provider` is `openai`, the chat-completions wire protocol;
  Gemini judges use Google's OpenAI-compatible endpoint in `base_url`.
- `evaluation.embeddings.provider` may be `openai` or `gemini`. Gemini
  embeddings use the native Gemini `batchEmbedContents` API and require a
  non-null `api_key_env`; the default API root is
  `https://generativelanguage.googleapis.com/v1beta`.

`mean_drop` catches "this PR made it worse"; `absolute_floor` catches "never
ship below this". Both apply.

Every path in the config — `app.compose_file`, `dataset.path`, and
`dataset.source_docs` — resolves against the directory holding the config
file, not the working directory, so a config means the same thing wherever it
is run from.

`reasoning_effort` is OpenAI's own parameter, sent only when set. Reasoning
models such as Qwen3 otherwise think before every verdict — measured at 246
tokens to produce a 14-character answer — which is slow, and the thinking
counts against the response's token budget. `none` turns it off. It defaults
to unset because non-reasoning models such as gpt-4o-mini reject it.

`base_url` and `api_key_env` exist because the endpoint is not always OpenAI's:
Azure OpenAI, a corporate proxy, a self-hosted gateway and a local server all
speak the same protocol on a different address. The secret itself never appears
in the config — `api_key_env` names the variable that holds it, per
`pipeline/docs/RULES.md`.

For Gemini, configure the judge with `provider: openai`, its OpenAI-compatible
chat base URL, a Gemini model, and `api_key_env: GEMINI_API_KEY`. Configure
embeddings with `provider: gemini`, a Gemini embedding model, and the same key
name. The sample RAG app accepts `PROVIDER=gemini` and uses the OpenAI-
compatible chat endpoint plus Gemini's native embeddings endpoint. See
`user-repo/contextforge.gemini.yml`.

The config contains environment-variable names, never secret values. For local
CLI runs, the named variables come from the user's environment. The hosted
service must obtain user secrets through a separate protected mechanism and
must keep evaluator credentials out of the user's application container.
Exact hosted secret storage and fork-PR policy are open decisions.

The config contains evaluation inputs and thresholds only. It does not choose
baseline storage, report delivery, or GitHub integration behavior: those are
owned by the hosted ContextForge service. Local CLI benchmarking uses
`benchmark/baseline` as a developer convenience; that directory is not the
hosted baseline store.

## 3. Benchmark format

```
benchmark/
  testcases.json              # frozen questions and ground truth
  baseline/
    <commit-sha>.json         # one file per main commit
```

The local CLI uses one file per commit, so concurrent local benchmark writes
do not overwrite one another. Hosted baseline payloads are stored by
ContextForge, not committed to customer repositories; storage adapters and
retention remain to be implemented.

### `testcases.json`

```json
{
  "dataset_version": 1,
  "generated_at": "2026-09-20T10:00:00Z",
  "generator": { "tool": "ragas", "version": "0.2.x", "model": "gpt-4o-mini" },
  "cases": [
    {
      "id": "tc-001",
      "question": "What is the refund window?",
      "ground_truth": "30 days from delivery.",
      "reference_context_ids": ["policy.md#c12"],
      "hops": "single"
    }
  ]
}
```

Frozen means frozen. Regenerating changes the exam, so any comparison across
the change is meaningless. Regenerate deliberately, in its own pull request,
and record it in `pipeline/docs/MEMORY.md`. `dataset generate` refuses to replace an
existing file without `--overwrite`.

In a generated set, `reference_context_ids` holds **source document ids**
(`returns-and-refunds.md`), not chunk ids. Chunk ids belong to the app and
change whenever its chunking changes — which is exactly the kind of change
ContextForge exists to test — so a frozen set that named chunks would go stale
the first time anyone touched chunking. A human editing the set may still use
chunk ids when they know them to be stable.

The dataset hash in a fingerprint covers `cases` only, in canonical JSON, so
reformatting the file or regenerating its timestamp does not invalidate every
stored benchmark, but changing a question does.

### `baseline/<sha>.json`

Stores answers and contexts, not only scores. Scores can be recomputed from
stored text; answers cannot be recomputed without rebuilding the app.

```json
{
  "commit": "a1b2c3d",
  "created_at": "2026-09-20T10:05:00Z",
  "fingerprint": {
    "dataset_hash": "sha256:...",
    "app_hash": "sha256:...",
    "judge": { "model": "gpt-4o-mini", "temperature": 0, "seed": 42, "reasoning_effort": null },
    "embeddings": { "model": "text-embedding-3-small" },
    "tool_version": "0.3.0"
  },
  "runs": 3,
  "results": [
    {
      "case_id": "tc-001",
      "answer": "Refunds are accepted within 30 days of delivery.",
      "contexts": [{ "id": "policy.md#c12", "text": "..." }],
      "scores": { "context_precision": 0.84, "faithfulness": 0.91 },
      "scores_stddev": { "context_precision": 0.02, "faithfulness": 0.01 },
      "latency_ms": 820
    }
  ],
  "summary": { "context_precision": 0.82, "faithfulness": 0.90 }
}
```

### Fingerprint and staleness

The benchmark is reusable only when its complete fingerprint matches the
current run. Any difference—including the dataset, app environment, judge,
embeddings, or tool version—makes it unusable, and the runner rebuilds and
scores the merge-base app. `judge` includes `reasoning_effort`: a judge that
thinks and one that does not can reach different verdicts. The embedding model
is included because it contributes to answer relevancy.

### Baseline selection

Use the **merge base** of the pull request, not the tip of `main`, so a PR is
not blamed for changes merged after it branched. Search commit-keyed benchmark
records from the merge base back through its ancestors for the nearest
compatible fingerprint. If no compatible benchmark exists, build and score
the merge-base app in this run. Record whether scores came from a stored
baseline or a newly built baseline in the report. The local CLI persists
benchmarks under `benchmark/baseline/<sha>.json`; hosted baseline storage is
managed independently by the service.

## 4. Verdict and thresholds

A run produces a verdict object:

```json
{
  "status": "fail",
  "mode": "cached",
  "baseline_commit": "a1b2c3d",
  "metrics": [
    { "name": "context_recall", "baseline": 0.78, "candidate": 0.66,
      "delta": -0.12, "threshold": -0.05, "status": "fail" }
  ],
  "regressed_cases": ["tc-004", "tc-011", "tc-027"],
  "regressions": [
    { "case_id": "tc-004", "reasons": ["context_recall fell from 0.90 to 0.40"] }
  ],
  "notes": ["judge unchanged", "3 of 40 cases regressed"]
}
```

`status` is `fail` if any metric breaches `mean_drop`, any metric falls below
`absolute_floor`, or the regressed-case count exceeds `max_regressed_cases`.

How each part is computed:

- **Paired means for `mean_drop`.** A metric's baseline and candidate means are
  taken over the same cases: those both sides answered and the judge scored on
  both sides. Comparing means over different sets of cases would let a case the
  candidate failed to answer quietly drop out of its average and flatter it.
- **`absolute_floor`** applies to the candidate's mean over every case it
  scored.
- **A regressed case** is one where the candidate app failed to answer and the
  baseline did not, or where any metric fell by more than `case_drop`. A score
  the judge could not produce (`null`) is not a regression; it is counted in
  the notes.
- **A threshold with nothing to measure fails.** If `mean_drop` or
  `absolute_floor` names a metric and no pair of scores exists for it, the
  metric fails with that reason rather than passing silently.
- **Incomparable inputs are a tool error, not a verdict.** Two results with
  different `dataset_hash` or a different judge fingerprint cannot be compared
  and exit `2`.

`case_drop` defaults to `0.30` provisionally — single-case judge scores are far
noisier than means — until stage 6 measures the real spread.

Noise matters: metrics are LLM-judged and vary between identical runs. Default
thresholds must sit above the measured noise floor recorded in
`pipeline/docs/MEMORY.md` during stage 6.

A noise floor belongs to the judge and embedding model that produced it, not to
ContextForge. `pipeline/docs/MEMORY.md` therefore records which judge and embeddings a
measurement used, shipped defaults are calibrated against the shipped default
judge, and a user running a different judge recalibrates their own thresholds.
Any published result names the judge that produced it.

Thresholds also respect how coarse scores are. One case flipping from 1 to 0
moves a mean over N cases by 1/N, so a `mean_drop` below that fails a pull
request on a single flip however quiet the measurement was: with 34 cases, one
flip is 0.029. `pnpm measure-noise` therefore never suggests a `mean_drop`
below 1.5 flips, nor a `case_drop` below 0.30 — about one statement's verdict
in a typical three-statement answer.

## 5. Report

A report for the originating commit/PR contains:

- Headline: pass or fail, with the number of regressed cases
- A table of metrics: baseline, candidate, delta, threshold, status
- A collapsed section listing regressed cases with both versions' answers and
  retrieved context ids
- A footnote naming the baseline commit, whether the baseline was reused or
  rebuilt, and the judge model

The hosted product publishes a check status so branch protection can block a
merge and makes the detailed report available from that check. Whether it also
posts or updates a PR comment is an open product decision. The current Action
posts a sticky comment and uploads an HTML artifact.

## 6. CLI surface

```
contextforge validate            --config <path>
contextforge dataset generate    --config <path> [--size <n>] [--overwrite]
contextforge run                 --config <path> [--candidate HEAD] [--baseline <ref>]
                                 [--base-branch main] [--output .contextforge] [--answers-only]
contextforge benchmark           --config <path>
contextforge compare             <baseline.json> <candidate.json> --config <path> [--output <results.json>]
contextforge report              <results.json> --format md|html|json [--output <file>]
```

Every command exits `0` on pass, `1` on regression, `2` on a tool error, so
automation can distinguish "quality regressed" from "the tool broke".

- `run` builds the candidate and resolves the baseline to the merge base with
  `--base-branch` unless `--baseline` names one. `--candidate HEAD` uses the
  working tree, uncommitted changes included and noted; any other ref is built
  from a clean worktree. It writes `baseline.json`, `candidate.json`,
  `results.json`, `report.md`, and `report.html` to `--output`.
- `run --answers-only` queries both sides and stops: no judge, no verdict. It
  exists to check the app side works before spending judge calls.
- `benchmark` is a local developer command: it scores `HEAD` and writes
  `benchmark/baseline/<sha>.json`. It refuses a dirty working tree, because
  the file would describe a commit that does not contain the code that
  produced it. Hosted jobs do not use this local store.
- `compare` and `report` never call the judge and need no API key.

## 7. Evaluator interface

The evaluator is a Python container (`pipeline/evaluator/`) wrapping Ragas. The
TypeScript core talks to it only through JSON files on a mounted directory —
never by importing Python — so either side can change without the other
noticing, and the evaluator knows nothing about Git, CI or the app.

```
docker run --rm -v <workdir>:/work contextforge-evaluator:<version> \
  score --input /work/request.json --output /work/response.json
```

With no `--input` / `--output` it reads stdin and writes stdout. Logs go to
stderr only.

### Score request

```json
{
  "task": "score",
  "metrics": ["context_precision", "context_recall", "faithfulness", "answer_relevancy"],
  "judge": { "model": "gpt-4o-mini", "base_url": null, "api_key_env": "OPENAI_API_KEY",
             "temperature": 0, "seed": 42, "reasoning_effort": null },
  "embeddings": { "model": "text-embedding-3-small", "base_url": null,
                  "api_key_env": "OPENAI_API_KEY" },
  "concurrency": 4,
  "cases": [
    { "case_id": "tc-001", "question": "What is the refund window?",
      "ground_truth": "30 days from delivery.",
      "answer": "Refunds are accepted within 30 days of delivery.",
      "contexts": ["Customers may request a refund within 30 days..."] }
  ]
}
```

The request names the key variable, never the key. The core passes that one
variable into the container's environment and nothing else.

### Score response

```json
{
  "evaluator": { "ragas_version": "0.4.3", "judge_model": "gpt-4o-mini",
                 "embeddings_model": "text-embedding-3-small" },
  "results": [
    { "case_id": "tc-001",
      "scores": { "faithfulness": 0.91, "answer_relevancy": null },
      "errors": { "answer_relevancy": "judge returned no usable questions" } }
  ]
}
```

- Every requested metric appears in `scores` for every case. A metric that
  could not be computed is `null`, never a guessed number, and carries a reason
  in `errors`. Ragas returns `NaN` in several such situations; the evaluator
  converts every `NaN` to `null` plus a reason, because a `NaN` that reaches a
  mean silently poisons it.
- Results come back in request order.
- `context_precision` is Ragas's reference-based variant, since every case has
  a ground truth.
- Temperature and seed are passed explicitly on every judge call. Ragas's own
  default temperature is `0.01`, not `0`.

### Generate request and response

`generate` drafts a test set for a human to review (stage 4). The core reads
`dataset.source_docs` and sends the documents in the request, so the container
needs no second mount.

```json
{ "task": "generate", "size": 20,
  "judge": { "model": "gpt-4o-mini", "base_url": null, "api_key_env": "OPENAI_API_KEY",
             "temperature": 0, "seed": 42 },
  "embeddings": { "model": "text-embedding-3-small", "base_url": null,
                  "api_key_env": "OPENAI_API_KEY" },
  "documents": [ { "id": "returns-and-refunds.md", "text": "..." } ] }
```

```json
{ "generator": { "tool": "ragas", "version": "0.4.3", "model": "gpt-4o-mini" },
  "cases": [ { "question": "...", "ground_truth": "...",
               "reference_document_ids": ["returns-and-refunds.md"], "hops": "single" } ] }
```

Generation uses the judge endpoint. Empty and duplicate questions are dropped
and counted in the log. The core numbers the cases `tc-001`… and writes
`testcases.json`.

### Exit codes

`0` when the response was written, even if some metrics are `null`. `2` for a
malformed request, a missing key variable, or an unreachable judge — anything
that means the scores cannot be trusted as a whole.

### Image

The CLI tags the evaluator image `contextforge-evaluator:<tool version>-<hash>`,
where the hash covers exactly what is baked into the image: the Dockerfile,
the pinned requirements and the Python app. Changing any of them builds a new
image on the next run; a tag carrying only the tool version silently reused a
stale one. `CONTEXTFORGE_EVALUATOR_IMAGE` overrides the tag entirely.

The image carries tiktoken's encoding tables, which Ragas uses to count tokens
and which tiktoken would otherwise download on first use. At run time the
evaluator needs the network only to reach the judge.

### Networking

On Linux the container runs with host networking, so a judge reachable from
the host — `localhost`, a LAN address, a Tailscale address — is reachable
unchanged. Elsewhere it runs on the default bridge with `host.docker.internal`
mapped to the host.

## 8. Hosted GitHub App integration (service core implemented; production adapters pending)

The target product is a ContextForge-hosted service connected through a
GitHub App. Users install the App and grant access to selected repositories;
they do not add a ContextForge workflow file. The repository under test remains
the source of truth for the RAG app, Compose stack, `contextforge.yml`, and
frozen dataset.

### Event and result contract

1. GitHub sends installation lifecycle, pull-request, or configured-branch
   push events to the App's webhook endpoint.
2. The service verifies the webhook signature, rejects unsupported events,
   deduplicates delivery IDs, and acknowledges accepted work without waiting
   for an evaluation to finish.
3. The service creates one tracked job for the exact repository and full
   commit SHA. The branch/ref is retained only as event metadata and must
   never be resolved later to select source.
   Repeated deliveries for the same event must not create duplicate visible
   checks or concurrent duplicate jobs.
4. The service fetches the config, dataset, Compose files, and source from the
   target commit. The worker executes the evaluator from the immutable
   ContextForge service release, never from a developer checkout or from
   source in the customer repository, and follows the baseline-selection
   rules in section 3.
5. The service creates or updates a GitHub Check Run with queued, in-progress,
   and completed status. The completed check reports pass, regression, or
   tool error distinctly and links to the detailed report.
6. For pull-request jobs, the service creates or updates one ContextForge
   comment on that PR with the outcome, evaluated commit SHA, and detailed
   report link. The comment is keyed by a stable hidden marker so webhook
   retries update it instead of creating duplicates.
7. The check is associated with the commit that caused the job. A PR update
   must not overwrite a result for a different head SHA; the PR comment names
   the SHA it reports.

The GitHub App must request only permissions needed to read repository
contents and pull-request metadata, create/update Checks, and create/update
issue comments on pull requests. The App therefore needs Contents: read,
Checks: read and write, and Issues: read and write (or the equivalent
Pull requests permission supported by GitHub). Verify the selected permission
set against the GitHub App APIs during setup.

### Execution and secret boundary

Pull-request source, Dockerfiles, Compose files, and application startup
commands are untrusted. Each evaluation must use a disposable worker isolated
from other users and from the service control plane. Apply execution time and
resource limits, restrict access to platform credentials, and destroy the
worker and temporary checkout/data after completion or failure. A workload
must not receive the GitHub App private key or installation token.

The user's application credentials and the evaluator's judge/embedding
credentials have different purposes and must be separately scoped. The
application receives only its explicitly allowed variables; evaluator
credentials are available only to the evaluator process. Fork pull-request
jobs receive no user secrets. The cloud provider and concrete secret, network,
and VM adapters remain open implementation decisions.

### State and baseline persistence

The service needs durable job state, event-delivery idempotency, report
metadata, and baseline lookup. Baseline payloads contain test inputs, model
answers, retrieved contexts, and scores. ContextForge owns hosted baseline and
report storage; its adapters and retention policy remain to be implemented.
The service never commits generated files into a user's repository.

### Current implementation boundary

The CLI, Compose runner, evaluator container, comparator, report renderer,
signed-webhook handler, GitHub App API client, and provider-neutral job
orchestration core exist in this repository. A single-repository local
development server is also available: it listens behind an HTTPS reverse
proxy, persists jobs and reports to local files, fetches the event's exact
commit into a temporary worktree, and runs the built CLI. It accepts only the
configured repository and pull-request events; fork jobs are refused. This
mode is for trusted development/testing, not arbitrary public contributions.
It relies on the host's Git credentials, Docker daemon, and explicitly
allowlisted evaluation/application environment variables.

The local service does not provide production-grade worker isolation, shared
multi-instance state, managed report retention, or hosted deployment. The
hosted service still requires production adapters for durable queue/job state,
managed report and baseline storage, per-job disposable VMs, App registration,
and deployment. The local service publishes both a Check Run and an
idempotently updated PR comment after a real evaluation; it does not fabricate
or inject evaluation results. Its host-Docker execution is restricted to a
single trusted repository and non-fork PRs and is not safe for arbitrary
third-party contributions. A public HTTPS webhook endpoint (for example, a
carefully configured tunnel forwarding to the loopback listener) is required
for GitHub to reach a locally running service.

The repository's `.github/workflows/ci.yml` validates ContextForge source and
the evaluator image only. It is not a customer evaluation pipeline. The former
reusable workflow and composite Action are removed; the hosted GitHub App is
the sole intended production integration.
