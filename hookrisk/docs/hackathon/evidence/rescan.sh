#!/usr/bin/env bash
# Rescan the real-hook clones with a given hookrisk checkout and collect evidence.
#
# usage: rescan.sh <hookrisk-root> <clones-root> <out-dir> [results.json]
#
#   <clones-root>   holds one directory per hook slug, each with a `repo/`
#                   checkout that has been `forge build`-ed and carries a
#                   hookrisk.toml (see DEMO_RUNBOOK.md for clone commands).
#   [results.json]  the structured agent results that map slug -> target;
#                   defaults to agent-scan-results-before.json next to this script.
set -uo pipefail
ROOT="$1"; CLONES="$2"; OUT="$3"; HERE="$(cd "$(dirname "$0")" && pwd)"
RESULTS="${4:-$HERE/agent-scan-results-before.json}"
mkdir -p "$OUT"
jq -r '.results[] | "\(.slug)\t\(.target)"' "$RESULTS" | while IFS=$'\t' read -r slug target; do
  proj=$(dirname "$(find "$CLONES/$slug/repo" -maxdepth 2 -name hookrisk.toml 2>/dev/null | head -1)")
  [ -z "$proj" ] || [ "$proj" = "." ] && { echo "{\"slug\":\"$slug\",\"error\":\"no clone or no hookrisk.toml under $CLONES/$slug/repo\"}"; continue; }
  d="$OUT/$slug"; mkdir -p "$d"
  ( cd "$proj" && HOOKRISK_SLITHER_BIN="$ROOT/.venv/bin/slither" node "$ROOT/cli/dist/cli.js" scan "$target" --verbose --timeout 900 --out "$d" >"$d/scan.stdout" 2>"$d/scan.stderr"; echo $? >"$d/exit_code" )
  ec=$(cat "$d/exit_code")
  if [ -f "$d/hook-risk.json" ]; then
    jq -c --arg slug "$slug" --arg ec "$ec" '{slug:$slug, exit:$ec, tier:.score.tier, total:.score.total, upper:.score.totalUpperBound, findings:[.findings[]|"\(.ruleClass)/\(.severity)"], engines:[.engines[]|"\(.engine):\(.status)"], invariants:[(.invariants//[])[]|"\(.id):\(.status)"], gate:(.gate.passed), harness:(.coverage.harnessStatus // "n/a")}' "$d/hook-risk.json"
  else
    echo "{\"slug\":\"$slug\",\"exit\":\"$ec\",\"error\":\"no manifest\",\"stderr\":\"$(tail -3 "$d/scan.stderr" | tr '\n' ' ' | cut -c1-200)\"}"
  fi
done | tee "$OUT/summary.jsonl"
