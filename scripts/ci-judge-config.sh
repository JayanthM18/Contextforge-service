#!/usr/bin/env bash
# CI only: point a run at a self-hosted Ollama judge whose address is a secret.
#
#   JUDGE_HOST=<ip> scripts/ci-judge-config.sh
#
# The committed examples/contextforge.local-judge.yml carries the placeholder
# judge-box. This writes a copy with the real host to
# examples/contextforge.ci.local.yml (git-ignored, next to the original so its
# relative paths still resolve), has the sample app answer through the same
# server, and prints the copy's path as the step output `config`. The host
# comes from a secret, so GitHub masks it in every log line.
#
# Without JUDGE_HOST it does nothing, and the workflow keeps its usual config.
set -euo pipefail

if [ -z "${JUDGE_HOST:-}" ]; then
  echo "JUDGE_HOST not set: using the workflow's configured judge."
  exit 0
fi

ROOT=$(git rev-parse --show-toplevel)
CONFIG=examples/contextforge.ci.local.yml
sed "s|http://judge-box:|http://$JUDGE_HOST:|g" "$ROOT/examples/contextforge.local-judge.yml" >"$ROOT/$CONFIG"
if grep -q 'base_url: http://judge-box' "$ROOT/$CONFIG"; then
  echo "::error::judge-box is still in $CONFIG; the base_url lines changed shape" >&2
  exit 2
fi

# The sample app answers through the judge's server, as scripts/demo.sh has it.
{
  echo "PROVIDER=openai"
  echo "OPENAI_API_KEY=ollama"
  echo "OPENAI_BASE_URL=http://$JUDGE_HOST:11434/v1"
  echo "GENERATION_MODEL=qwen3:14b"
  echo "EMBEDDING_MODEL=nomic-embed-text"
  echo "REASONING_EFFORT=none"
} >>"$GITHUB_ENV"

# Fail fast, before any build, if the tailnet cannot reach the judge.
if ! curl --silent --fail --max-time 20 "http://$JUDGE_HOST:11434/api/tags" >/dev/null; then
  echo "::error::cannot reach the judge's Ollama server; is the machine on and the tailnet joined?" >&2
  exit 2
fi

echo "config=$CONFIG" >>"$GITHUB_OUTPUT"
echo "Using the self-hosted judge through $CONFIG."
