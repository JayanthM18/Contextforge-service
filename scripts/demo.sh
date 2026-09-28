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
#   --judge HOST  the Ollama machine (default: the judge in your local config)
#
# The committed config carries a placeholder host, judge-box. Put your judge's
# real address in examples/contextforge.local-judge.local.yml, a git-ignored
# copy of examples/contextforge.local-judge.yml; this script uses it when present.
#
# Both versions are built and answer every question, and the judge scores both:
# the last commit (HEAD) is the baseline, the working tree is the candidate.
# Scenario edits are undone afterwards, however the run ends.
set -uo pipefail

# The scenario edits live in one place, shared with validate-regressions.sh.
source "$(cd "$(dirname "$0")" && pwd)/lib/scenarios.sh"

SCENARIO=""
CASES=""
JUDGE_HOST=""
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

# The judge's real address lives in a git-ignored local copy of the config.
BASE_CONFIG=examples/contextforge.local-judge.yml
[ -f examples/contextforge.local-judge.local.yml ] && BASE_CONFIG=examples/contextforge.local-judge.local.yml
CONFIG=$BASE_CONFIG
CONFIG_HOST=$(sed -n 's|^ *base_url: http://\([^:/]*\):.*|\1|p' "$BASE_CONFIG" | head -1)
JUDGE_HOST=${JUDGE_HOST:-$CONFIG_HOST}
if [ "$JUDGE_HOST" = judge-box ]; then
  echo "No judge address set: the committed config has the placeholder judge-box." >&2
  echo "Copy examples/contextforge.local-judge.yml to examples/contextforge.local-judge.local.yml" >&2
  echo "and put your Ollama machine's address in its base_url lines, or pass --judge HOST." >&2
  exit 2
fi

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

# A copy of the config when the run differs from it: the first N cases for a
# quicker demo, or a judge given with --judge. Both sides use the same copy, so
# the comparison stays fair.
if [ -n "$CASES" ] || [ "$JUDGE_HOST" != "$CONFIG_HOST" ]; then
  mkdir -p "$OUT"
  node -e '
    const fs = require("fs");
    const [n, out, root, base, host] = process.argv.slice(1);
    let dataset = `${root}/benchmark/testcases.json`;
    if (n !== "") {
      const set = JSON.parse(fs.readFileSync(dataset, "utf8"));
      set.cases = set.cases.slice(0, Number(n));
      dataset = `${root}/${out}/testcases.json`;
      fs.writeFileSync(dataset, JSON.stringify(set, null, 2));
    }
    let cfg = fs.readFileSync(`${root}/${base}`, "utf8");
    cfg = cfg.replace(/(compose_file|source_docs): sample-rag-app/g, `$1: ${root}/examples/sample-rag-app`)
             .replace("path: ../benchmark/testcases.json", `path: ${dataset}`)
             .replace("store: ../benchmark/", `store: ${root}/benchmark/`)
             .replace(/base_url: http:\/\/[^:\/]+:/g, `base_url: http://${host}:`);
    fs.writeFileSync(`${out}/contextforge.yml`, cfg);
  ' "$CASES" "$OUT" "$ROOT" "$BASE_CONFIG" "$JUDGE_HOST"
  CONFIG="$OUT/contextforge.yml"
  [ -n "$CASES" ] && echo "Using the first $CASES test cases."
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
