#!/usr/bin/env bash
# Stage 9: does ContextForge catch deliberate regressions, and pass a harmless
# change? Builds four scenarios as local branches off the base (never pushed),
# runs each through `contextforge run`, and prints a table.
#
#   pipeline/scripts/validate-regressions.sh [--config user-repo/contextforge.yml] [--base main]
#                                   [--weak-embedding text-embedding-ada-002] [--keep-branches]
#
# The sample app must answer with a real model: with PROVIDER=local, top_k and
# the prompt barely matter and the results mean nothing. Needs Docker and a
# reachable judge. Build first: pnpm build.
set -euo pipefail

# The scenario edits live in one place, shared with demo.sh.
source "$(cd "$(dirname "$0")" && pwd)/lib/scenarios.sh"

CONFIG=user-repo/contextforge.yml
BASE=main
WEAK_EMBEDDING=text-embedding-ada-002
KEEP=false
while [ $# -gt 0 ]; do
  case "$1" in
    --config) CONFIG=$2; shift 2 ;;
    --base) BASE=$2; shift 2 ;;
    --weak-embedding) WEAK_EMBEDDING=$2; shift 2 ;;
    --keep-branches) KEEP=true; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
CLI="node $ROOT/pipeline/packages/cli/dist/bin.js"
APP=user-repo/sample-rag-app
OUT=.contextforge/validation

if [ "${PROVIDER:-}" = "local" ]; then
  echo "PROVIDER=local: the offline app ignores prompts and barely uses top_k; these results would be meaningless." >&2
  exit 2
fi

$CLI validate --config "$CONFIG"

# Each scenario edits the sample app in a fresh worktree, with the same edits
# pipeline/scripts/demo.sh makes.
apply() {
  apply_scenario "$1" "$APP" "$WEAK_EMBEDDING"
}

declare -A EXPECT=(
  [smaller-top-k]=regression
  [weaker-embeddings]=regression
  [sloppy-prompt]=regression
  [harmless-refactor]=pass
)
SCENARIOS=(smaller-top-k weaker-embeddings sloppy-prompt harmless-refactor)
declare -A EXIT

for scenario in "${SCENARIOS[@]}"; do
  branch="validation/$scenario"
  git branch -D "$branch" >/dev/null 2>&1 || true

  worktree=$(mktemp -d)
  git worktree add --quiet --detach "$worktree" "$BASE"
  (
    cd "$worktree"
    apply "$scenario"
    if git diff --quiet; then echo "scenario $scenario changed nothing; the patch no longer applies" >&2; exit 2; fi
    git switch --quiet --create "$branch"
    git commit --quiet --all --message "validation: $scenario"
  )
  git worktree remove --force "$worktree"

  echo "=== $scenario ==="
  set +e
  $CLI run --config "$CONFIG" --baseline "$BASE" --candidate "$branch" --output "$OUT/$scenario"
  EXIT[$scenario]=$?
  set -e
done

echo
printf '%-20s %-11s %-12s %s\n' scenario expected verdict result
for scenario in "${SCENARIOS[@]}"; do
  code=${EXIT[$scenario]}
  case $code in 0) verdict=pass ;; 1) verdict=regression ;; *) verdict="tool error" ;; esac
  if [ "$verdict" = "${EXPECT[$scenario]}" ]; then result=correct; else result=MISSED; fi
  printf '%-20s %-11s %-12s %s\n' "$scenario" "${EXPECT[$scenario]}" "$verdict" "$result"
done
echo
echo "Per-scenario reports: $OUT/<scenario>/report.html. Record the table in pipeline/docs/MEMORY.md."

if [ "$KEEP" = false ]; then
  for scenario in "${SCENARIOS[@]}"; do git branch -D "validation/$scenario" >/dev/null; done
fi
