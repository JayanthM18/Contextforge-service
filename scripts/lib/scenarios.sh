# Scenario edits to the sample app, shared by scripts/demo.sh and
# scripts/validate-regressions.sh so that the demo and the validation always
# make exactly the same changes. Source this file, then:
#
#   apply_scenario <scenario> <app-dir> [weak-embedding-model]
#
# Values are written literally rather than as ${VAR:-default}, so an exported
# variable cannot quietly undo the regression.

apply_scenario() {
  local scenario=$1 app=$2 weak_embedding=${3:-text-embedding-ada-002}
  case "$scenario" in
    top-k | smaller-top-k)
      sed -i 's/TOP_K: \${TOP_K:-5}/TOP_K: 1/' "$app/docker-compose.eval.yml" ;;
    weaker-embeddings)
      sed -i "s/EMBEDDING_MODEL: \${EMBEDDING_MODEL:-[^}]*}/EMBEDDING_MODEL: $weak_embedding/" "$app/docker-compose.eval.yml" ;;
    prompt | sloppy-prompt)
      python3 - "$app/src/generate.ts" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
start = s.index("const SYSTEM_PROMPT = [")
end = s.index('].join(" ");', start) + len('].join(" ");')
s = s[:start] + 'const SYSTEM_PROMPT = ["You are a friendly assistant. Answer the question as helpfully as you can."].join(" ");' + s[end:]
p.write_text(s)
PY
      ;;
    harmless | harmless-refactor)
      # Rename locals only; behaviour is identical.
      sed -i 's/magnitudeA/normA/g; s/magnitudeB/normB/g; s/denominator/norms/g' "$app/src/retrieve.ts" ;;
    *)
      echo "unknown scenario: $scenario" >&2
      return 2 ;;
  esac
}
