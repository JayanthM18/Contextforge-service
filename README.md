# ContextForge

CI regression testing for RAG applications.

A change to a RAG pipeline — chunking, embeddings, retrieval, reranking,
prompts, models — can make answers measurably worse while the application
still starts, serves traffic and passes every unit test. Nothing raises an
error, so the drop is invisible until users complain.

ContextForge runs a frozen evaluation set against the pull request, compares
the scores to a stored baseline from the merge base, and reports pass or fail
on the PR before the change is merged.

## Status

Stages 0–8 are built and tested. Stage 9, measuring the tool against
deliberate regressions, is prepared but not yet run: it needs a judge model.
See `docs/TASKS.md` for the staged plan and `docs/MEMORY.md` for exactly what
has and has not been verified.

## How it works

1. **A frozen test set.** `contextforge dataset generate` drafts questions and
   ground truths from your documents with Ragas. You review it, delete the
   weak cases and commit it. It does not change unless you regenerate it on
   purpose.
2. **Your app in Docker.** ContextForge builds your app with Docker Compose and
   asks it every question through two HTTP endpoints (below).
3. **A judge.** Four Ragas metrics — context precision, context recall,
   faithfulness and answer relevancy — are scored by an LLM judge.
4. **A baseline.** On every push to `main`, the scores are stored per commit.
   A pull request builds only its own version and compares against the stored
   benchmark for its merge base. If none is usable, it builds both.
5. **A verdict.** Thresholds on the mean drop, an absolute floor and a
   regressed-case count decide pass or fail, posted as a PR comment and a check
   that branch protection can require.

## Requirements

- Node 20 or newer (developed on Node 26) and pnpm 10
  (`npx pnpm@10` works without installing it)
- Docker and Docker Compose
- A judge: an OpenAI API key, or any OpenAI-compatible endpoint (see
  [Choosing a judge](#choosing-a-judge))

## Quick start

```sh
pnpm install && pnpm build
```

**1. Make your app speak the contract.** Two endpoints, specified in
`docs/DESIGN.md` section 1:

```
GET  /health  → 200 {"status":"ok"} once ready
POST /query   {"question": "..."}
           → {"answer": "...", "contexts": [{"text": "...", "id": "doc.md#c3"}]}
```

`examples/sample-rag-app` is a working reference.

**2. Write `contextforge.yml`.** Start from `examples/contextforge.yml`. Paths
in it resolve against the file's own directory. Check it with:

```sh
node packages/cli/dist/bin.js validate --config contextforge.yml
```

**3. Generate, review and commit the test set.**

```sh
node packages/cli/dist/bin.js dataset generate --config contextforge.yml --size 40
```

Read `benchmark/testcases.json`, delete questions that are wrong or trivial,
and commit it.

**4. Check the app side works** — no judge needed:

```sh
node packages/cli/dist/bin.js run --config contextforge.yml --answers-only
```

**5. Run a real comparison** of your working tree against `main`:

```sh
node packages/cli/dist/bin.js run --config contextforge.yml --mode dual
```

Results land in `.contextforge/`: `report.md`, `report.html`, `results.json`.
The exit code is `0` for pass, `1` for a regression and `2` for a tool error.

**6. Add it to CI.** Copy `.github/workflows/benchmark.yml` (push to main:
store the baseline) and `.github/workflows/pr-check.yml` (pull request: check
and comment), add `OPENAI_API_KEY` as a repository secret, and make the
`pr-check` job a required check in branch protection.

## Demo

`scripts/demo.sh` changes the sample app, compares it with the last commit and
prints the verdict, then undoes the change:

```sh
scripts/demo.sh top-k --cases 10      # retrieve 1 passage instead of 5: should fail
scripts/demo.sh prompt --cases 10     # drop the grounding rule from the prompt: should fail
scripts/demo.sh harmless --cases 10   # rename variables only: should pass
scripts/demo.sh --cases 10            # compare your own uncommitted edits to the app
```

It uses the Ollama judge in `examples/contextforge.local-judge.yml`; pass
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

For a self-hosted judge such as Ollama, set `base_url` to its `/v1` endpoint
and `api_key_env: null`. `examples/contextforge.local-judge.yml` is a complete
example.

### CI with a self-hosted judge

The workflows can reach an Ollama judge on a private Tailscale network. Each
step below is skipped unless its secrets exist, so the OpenAI path is unchanged.

1. In the Tailscale admin console, add `"tag:ci": ["autogroup:admin"]` to
   `tagOwners` in the access-control policy, and make sure the policy lets
   `tag:ci` reach the judge machine on port 11434.
2. Under Settings → OAuth clients, create a client with the **Auth Keys**
   write scope and the tag `tag:ci`.
3. In the GitHub repository, add the secrets `TS_OAUTH_CLIENT_ID`,
   `TS_OAUTH_SECRET` and `JUDGE_HOST` (the judge's Tailscale IP).

Each run then joins the tailnet as an ephemeral node, writes a copy of
`examples/contextforge.local-judge.yml` with the real host (never committed;
GitHub masks it in logs), and has the sample app answer through the same
server. Baselines go to `benchmark/baseline-local-judge/`. The judge machine
must be on while CI runs; if it is unreachable the run stops early with a
tool error (exit 2).

To re-check an open pull request by hand, for example in dual mode, run the
`pr-check` workflow from the Actions tab with the pull request's number.

Scores from different judges are not comparable. ContextForge fingerprints the
judge and embedding model and re-scores stored answers when either changes,
and thresholds should be recalibrated per judge with `pnpm measure-noise`.

## Commands

```
contextforge validate          --config <path>
contextforge dataset generate  --config <path> [--size <n>] [--overwrite]
contextforge run               --config <path> [--candidate HEAD] [--baseline <ref>] [--mode cached|dual]
                               [--base-branch main] [--output .contextforge] [--answers-only]
contextforge benchmark         --config <path>
contextforge compare           <baseline.json> <candidate.json> --config <path> [--output <file>]
contextforge report            <results.json> --format md|html|json [--output <file>]
```

## Developing ContextForge

```sh
pnpm test              # TypeScript tests (Vitest)
pnpm test:evaluator    # Python tests, inside the evaluator image
pnpm lint              # ESLint and Prettier
pnpm typecheck
pnpm build
```

## Layout

```
packages/cli       the core: config, dataset, runner, evaluator client, compare, report
packages/action    the GitHub Action: a thin wrapper over the core
packages/shared    result and benchmark schemas shared across packages
evaluator/         Python and Ragas, JSON in and JSON out
examples/          the sample RAG app and reference configs
scripts/           noise-floor measurement and regression validation
```

## Documentation

| File | What it is |
|---|---|
| `docs/PRD.md` | Problem, goals, users, MVP scope |
| `docs/ARCHITECTURE.md` | App flow, tech stack, folder structure |
| `docs/RULES.md` | Principles, technology rules, coding standards |
| `docs/DESIGN.md` | App contract, config, benchmark, verdict, report, CLI and evaluator formats |
| `docs/TASKS.md` | Staged plan, exit criteria, current stage |
| `docs/MEMORY.md` | Log of changes, decisions and what has been verified |

## Licence

MIT
