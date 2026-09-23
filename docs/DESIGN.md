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
and record it in `docs/MEMORY.md`.

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
    "judge": { "model": "gpt-4o-mini", "temperature": 0, "seed": 42 },
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
  "notes": ["judge unchanged", "3 of 40 cases regressed"]
}
```

`status` is `fail` if any metric breaches `mean_drop`, any metric falls below
`absolute_floor`, or the regressed-case count exceeds `max_regressed_cases`.

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
contextforge dataset generate    --config <path> --size <n>
contextforge run                 --config <path> [--candidate HEAD] [--baseline <sha>] [--mode cached|dual]
contextforge compare             <baseline.json> <candidate.json> --config <path>
contextforge report              <results.json> --format md|html|json
```

Every command exits `0` on pass, `1` on regression, `2` on a tool error, so CI
can distinguish "quality regressed" from "the tool broke".
