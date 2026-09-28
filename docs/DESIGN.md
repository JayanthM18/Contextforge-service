# Detailed design

Specs the implementation must follow. Change these deliberately, with a note in
`docs/MEMORY.md`.

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
  env_passthrough: [OPENAI_API_KEY]

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
    provider: openai
    model: text-embedding-3-small
    base_url: null
    api_key_env: OPENAI_API_KEY
  runs: 1                     # repeat count; >1 averages to reduce noise
  concurrency: 4

baseline:
  mode: cached                # cached | dual
  store: benchmark/baseline
  rebuild_if_missing: true

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

report:
  pr_comment: true
  check_status: true
  html_artifact: true
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

`mean_drop` catches "this PR made it worse"; `absolute_floor` catches "never
ship below this". Both apply.

Every path in the config — `app.compose_file`, `dataset.path`,
`dataset.source_docs`, `baseline.store` — resolves against the directory
holding the config file, not the working directory, so a config means the same
thing wherever it is run from.

`reasoning_effort` is OpenAI's own parameter, sent only when set. Reasoning
models such as Qwen3 otherwise think before every verdict — measured at 246
tokens to produce a 14-character answer — which is slow, and the thinking
counts against the response's token budget. `none` turns it off. It defaults
to unset because non-reasoning models such as gpt-4o-mini reject it.

`base_url` and `api_key_env` exist because the endpoint is not always OpenAI's:
Azure OpenAI, a corporate proxy, a self-hosted gateway and a local server all
speak the same protocol on a different address. The secret itself never appears
in the config — `api_key_env` names the variable that holds it, per
`docs/RULES.md`.

## 3. Benchmark format

```
benchmark/
  testcases.json              # frozen questions and ground truth
  baseline/
    <commit-sha>.json         # one file per main commit
```

One file per commit, so concurrent merges never conflict.

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
and record it in `docs/MEMORY.md`. `dataset generate` refuses to replace an
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

| Difference from stored fingerprint | Action |
|---|---|
| Nothing differs | Use stored scores directly |
| `judge` differs | Re-score the stored answers with the current judge |
| `embeddings` differs | Re-score the stored answers with the current embeddings |
| `dataset_hash` differs | Benchmark unusable — dual mode |
| `app_hash` differs (deps, Dockerfile, compose) | Dual mode |
| `tool_version` major differs | Dual mode |

`judge` includes `reasoning_effort`: a judge that thinks and one that does
not reach different verdicts.

`embeddings` is fingerprinted for the same reason `judge` is: `answer_relevancy`
is computed from embeddings, so changing that model changes the score. Without
it, swapping the embedding model would silently reuse stale baseline scores and
report a verdict that is simply wrong. Like a judge change it invalidates the
stored scores but not the stored answers, so the fix is to re-score the stored
text rather than rebuild the app.

### Baseline selection

Use the **merge base** of the pull request, not the tip of `main`, so a PR is
not blamed for changes merged after it branched. If no benchmark exists for the
merge base, walk back through ancestors; if nothing is found, fall back to dual
mode and say so in the report.

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
`docs/MEMORY.md` during stage 6.

A noise floor belongs to the judge and embedding model that produced it, not to
ContextForge. `docs/MEMORY.md` therefore records which judge and embeddings a
measurement used, shipped defaults are calibrated against the shipped default
judge, and a user running a different judge recalibrates their own thresholds.
Any published result names the judge that produced it.

## 5. Report

A single sticky PR comment, updated on every push:

- Headline: pass or fail, with the number of regressed cases
- A table of metrics: baseline, candidate, delta, threshold, status
- A collapsed section listing regressed cases with both versions' answers and
  retrieved context ids
- A footnote naming the baseline commit, the mode used, and the judge model

Also emitted: `results.json` (machine-readable), an HTML artifact, and a check
status so branch protection can block a merge.

## 6. CLI surface

```
contextforge validate            --config <path>
contextforge dataset generate    --config <path> [--size <n>] [--overwrite]
contextforge run                 --config <path> [--candidate HEAD] [--baseline <ref>] [--mode cached|dual]
                                 [--base-branch main] [--output .contextforge] [--answers-only]
contextforge benchmark           --config <path>
contextforge compare             <baseline.json> <candidate.json> --config <path> [--output <results.json>]
contextforge report              <results.json> --format md|html|json [--output <file>]
```

Every command exits `0` on pass, `1` on regression, `2` on a tool error, so CI
can distinguish "quality regressed" from "the tool broke".

- `run` builds the candidate and resolves the baseline to the merge base with
  `--base-branch` unless `--baseline` names one. `--candidate HEAD` uses the
  working tree, uncommitted changes included and noted; any other ref is built
  from a clean worktree. It writes `baseline.json`, `candidate.json`,
  `results.json`, `report.md` and — when `report.html_artifact` is set —
  `report.html` to `--output`.
- `run --answers-only` queries both sides and stops: no judge, no verdict. It
  exists to check the app side works before spending judge calls.
- `benchmark` is the push-to-main half of cached mode: it scores `HEAD` and
  writes `<baseline.store>/<sha>.json`. It refuses a dirty working tree,
  because the file would describe a commit that does not contain the code that
  produced it. Committing the file is the workflow's job.
- `compare` and `report` never call the judge and need no API key.

## 7. Evaluator interface

The evaluator is a Python container (`evaluator/`) wrapping Ragas. The
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
