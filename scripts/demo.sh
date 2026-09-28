#!/usr/bin/env bash
# Demo: change the sample RAG app, then let ContextForge report what the
# change did to answer quality.
#
#   scripts/demo.sh top-k        # retrieve 1 passage instead of 5 (should regress)
#   scripts/demo.sh prompt       # drop the grounding rules from the prompt (should regress)
#   scripts/demo.sh harmless     # rename variables only (should pass)
#   scripts/demo.sh              # compare your own uncommitted edits to the app
#
# Options:
#   --cases N     use only the first N test cases: faster, noisier (default: all)
#   --judge HOST  the Ollama machine (default: judge-box)
#
# Both versions are built and answer every question, and the judge scores both:
# the last commit (HEAD) is the baseline, the working tree is the candidate.
# Scenario edits are undone afterwards, however the run ends.
set -uo pipefail

# The scenario edits live in one place, shared with validate-regressions.sh.
source "$(cd "$(dirname "$0")" && pwd)/lib/scenarios.sh"

SCENARIO=""
CASES=""
JUDGE_HOST=judge-box
while [ $# -gt 0 ]; do
  case "$1" in
    --cases) CASES=$2; shift 2 ;;
    --judge) JUDGE_HOST=$2; shift 2 ;;
    top-k | prompt | harmless) SCENARIO=$1; shift ;;
    *) echo "unknown argument: $1 (see the top of this script)" >&2; exit 2 ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
APP=examples/sample-rag-app
OUT=.contextforge/demo${SCENARIO:+-$SCENARIO}
CONFIG=examples/contextforge.local-judge.yml

if [ ! -f packages/cli/dist/bin.js ]; then
  echo "ContextForge is not built yet: run pnpm build first." >&2
  exit 2
fi

# A scenario edits the app and undoes the edit afterwards. It refuses to run
# over your own uncommitted edits, which the undo would destroy.
if [ -n "$SCENARIO" ]; then
  if ! git diff --quiet -- "$APP"; then
    echo "$APP has uncommitted changes. Commit or stash them, or run scripts/demo.sh with no scenario to compare them." >&2
    exit 2
  fi
  trap 'git checkout -- "$APP"' EXIT
  apply_scenario "$SCENARIO" "$APP"
  case "$SCENARIO" in
    top-k) echo "Change: the app now retrieves 1 passage per question instead of 5." ;;
    prompt) echo "Change: the prompt no longer tells the model to answer only from the retrieved passages." ;;
    harmless) echo "Change: variables renamed in the retriever; behaviour is identical." ;;
  esac
  git diff --stat -- "$APP" | sed 's/^/  /'
elif git diff --quiet -- "$APP"; then
  echo "No scenario given and $APP has no uncommitted changes: there is nothing to compare." >&2
  echo "Edit the app, or pass a scenario: top-k, prompt or harmless." >&2
  exit 2
else
  echo "Comparing your uncommitted edits to the app:"
  git diff --stat -- "$APP" | sed 's/^/  /'
fi

# A subset of the test set for a quicker demo: a copy of the config pointing at
# the first N cases. Both sides use the same subset, so the comparison is fair.
if [ -n "$CASES" ]; then
  mkdir -p "$OUT"
  node -e '
    const fs = require("fs");
    const [n, out, root] = process.argv.slice(1);
    const set = JSON.parse(fs.readFileSync(`${root}/benchmark/testcases.json`, "utf8"));
    set.cases = set.cases.slice(0, Number(n));
    fs.writeFileSync(`${out}/testcases.json`, JSON.stringify(set, null, 2));
    let cfg = fs.readFileSync(`${root}/examples/contextforge.local-judge.yml`, "utf8");
    cfg = cfg.replace(/(compose_file|source_docs): sample-rag-app/g, `$1: ${root}/examples/sample-rag-app`)
             .replace("path: ../benchmark/testcases.json", `path: ${root}/${out}/testcases.json`)
             .replace("store: ../benchmark/", `store: ${root}/benchmark/`);
    fs.writeFileSync(`${out}/contextforge.yml`, cfg);
  ' "$CASES" "$OUT" "$ROOT"
  CONFIG="$OUT/contextforge.yml"
  echo "Using the first $CASES test cases."
fi

# The sample app answers through the same Ollama server that judges it.
export PROVIDER=openai OPENAI_API_KEY=ollama \
  OPENAI_BASE_URL="http://$JUDGE_HOST:11434/v1" \
  GENERATION_MODEL=qwen3:14b EMBEDDING_MODEL=nomic-embed-text REASONING_EFFORT=none

mkdir -p "$OUT"
echo "Building both versions, asking every question and judging the answers. This takes a while."
start=$(date +%s)
node packages/cli/dist/bin.js run --config "$CONFIG" --baseline HEAD --mode dual --output "$OUT" \
  >"$OUT.log" 2>&1
code=$?
echo "Finished in $(( $(date +%s) - start ))s."
echo

case $code in
  0) echo "VERDICT: PASS: no quality regression." ;;
  1) echo "VERDICT: FAIL: quality regressed." ;;
  *) echo "ContextForge could not reach a verdict (exit $code). The end of the log:"
     grep -v -i deprecat "$OUT.log" | tail -8
     exit "$code" ;;
esac
echo
# The metric table from the report, which is what a pull request would show.
sed -n '/^| Metric/,/^$/p' "$OUT/report.md"
echo "Full report: $OUT/report.md (and report.html)"
exit "$code"
