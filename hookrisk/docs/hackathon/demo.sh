#!/usr/bin/env bash
#
# hookrisk hackathon demo — runs every step of DEMO_RUNBOOK.md non-interactively.
#
#   ./docs/hackathon/demo.sh <hookrisk-root> <clones-root>
#
# <hookrisk-root>  a checkout where `make setup` has been run (.venv, cli/dist,
#                  harness/lib all present).
# <clones-root>    directory holding the hook clones, one per slug, each as
#                  <clones-root>/<slug>/repo, already `forge build`-ed and
#                  carrying the hookrisk.toml the runbook specifies.
#
# NOTE ON `set -e`: it is deliberately NOT set around scans. `hookrisk scan`
# exits 2 when the gate fails, and a failed gate is a result, not an error —
# the Cork step is *supposed* to exit 2. Every scan runs through run_scan(),
# which captures the code and prints it.
#
# The BlockSec step is skipped unless the image is already pulled.

set -u
set -o pipefail

HOOKRISK_ROOT=${1:-}
CLONES_ROOT=${2:-}

if [ -z "$HOOKRISK_ROOT" ] || [ -z "$CLONES_ROOT" ]; then
  echo "usage: $0 <hookrisk-root> <clones-root>" >&2
  exit 64
fi

HOOKRISK_ROOT=$(cd "$HOOKRISK_ROOT" && pwd) || exit 10
CLONES_ROOT=$(cd "$CLONES_ROOT" && pwd) || exit 10

SLITHER_BIN="$HOOKRISK_ROOT/.venv/bin/slither"
CLI="$HOOKRISK_ROOT/cli/dist/cli.js"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/hookrisk-demo.XXXXXX")

for required in "$SLITHER_BIN" "$CLI" "$HOOKRISK_ROOT/harness/foundry.toml"; do
  [ -e "$required" ] || { echo "missing $required — run 'make setup' in $HOOKRISK_ROOT" >&2; exit 10; }
done

STEP=0
banner() {
  STEP=$((STEP + 1))
  printf '\n\033[1m'
  printf '=%.0s' $(seq 1 78); printf '\n'
  printf ' STEP %d — %s\n' "$STEP" "$1"
  printf ' %s\n' "$2"
  printf '=%.0s' $(seq 1 78); printf '\033[0m\n\n'
}

skipped() { printf '\n  \033[33mSKIPPED: %s\033[0m\n' "$1"; }

# Run a scan without `set -e`. $1 = project dir, rest = CLI arguments.
run_scan() {
  local dir=$1; shift
  ( cd "$dir" && HOOKRISK_SLITHER_BIN="$SLITHER_BIN" node "$CLI" scan "$@" )
  local code=$?
  printf '\n  exit code: %d   (0 = gate passed, 2 = gate failed — a result, not an error)\n' "$code"
  return 0
}

need_clone() {
  if [ ! -d "$CLONES_ROOT/$1/repo" ]; then
    skipped "$CLONES_ROOT/$1/repo not found — see DEMO_RUNBOOK.md § Clones"
    return 1
  fi
  if [ ! -d "$CLONES_ROOT/$1/repo/out" ] && [ ! -d "$CLONES_ROOT/$1/repo/foundry-out" ]; then
    skipped "$1 has no forge artifacts — run 'forge build' in $CLONES_ROOT/$1/repo"
    return 1
  fi
  return 0
}

# --------------------------------------------------------------------------- #
banner "Everything green" "make setup && make test — 45 harness, 274 CLI, 3 corpus gates, 29 detector tests"
( cd "$HOOKRISK_ROOT" && make setup ) || exit 10
( cd "$HOOKRISK_ROOT" && make test ) > "$WORK/make-test.log" 2>&1
test_status=$?
grep -E 'Ran [0-9]+ test suites|^ℹ (tests|suites|pass|fail)|^Ran [0-9]+ tests|^OK$|corpus gates passed|FAIL' \
  "$WORK/make-test.log"
KEEP_WORK=0
[ "$test_status" -eq 0 ] || { KEEP_WORK=1; printf \
  '\n  \033[31mmake test exited %d — full log kept at %s\033[0m\n' "$test_status" "$WORK/make-test.log"; }

# --------------------------------------------------------------------------- #
banner "The planted bugs" "The harness must catch a skim and a liquidity trap that no static rule can see"
( cd "$HOOKRISK_ROOT/harness" && forge test --match-path test/HarnessValidation.t.sol ) \
  2>&1 | grep -E '^\[(PASS|FAIL)\] test_(I2|I3)_|^Ran [0-9]+ test suites'

# --------------------------------------------------------------------------- #
banner "The Cork exploit hook" "HS-01 reports the unguarded beforeSwap at line 365 the attacker called directly"
if need_clone cork-hook; then
  run_scan "$CLONES_ROOT/cork-hook/repo" src/CorkHook.sol:CorkHook --verbose --out out
  echo
  echo "  findings, by rule class and callback:"
  jq -r '.findings[] | "    \(.severity)\t\(.ruleClass)\t\(.discriminator // "-")\tline \(.location.line)"' \
    "$CLONES_ROOT/cork-hook/repo/out/hook-risk.json"
fi

# --------------------------------------------------------------------------- #
banner "A custom curve the old harness silently passed" "Zero swaps landed, so I1/I2 are inconclusive and I3 is not-applicable — not 'passed'"
if need_clone v4-constant-sum; then
  run_scan "$CLONES_ROOT/v4-constant-sum/repo" src/Counter.sol:Counter --verbose --out out
  echo
  jq -r '.invariants[] | "  \(.id) \(.status)\n     \(.detail // "-")"' \
    "$CLONES_ROOT/v4-constant-sum/repo/out/hook-risk.json"
  echo
  echo "  harness run record:"
  jq -c '.permissions.harnessRun' "$CLONES_ROOT/v4-constant-sum/repo/out/hook-risk.json"
fi

# --------------------------------------------------------------------------- #
banner "Orbital: constructorArgs and a measured complexity" "[harness] constructorArgs stands the hook up; the hook profile scores complexity 4/5"
if need_clone orbital-hook; then
  echo "  hookrisk.toml [harness] section:"
  sed -n '/^\[harness\]/,$p' "$CLONES_ROOT/orbital-hook/repo/hookrisk.toml" | grep -v '^\s*#' | sed 's/^/    /'
  run_scan "$CLONES_ROOT/orbital-hook/repo" src/OrbitalHook.sol:OrbitalHook --verbose --out out
  echo
  sed -n '/### Hook profile/,/^## /p' "$CLONES_ROOT/orbital-hook/repo/out/HOOK_RISK.md" | head -16
fi

# --------------------------------------------------------------------------- #
banner "A 2023-era hook" "unsupported-hook-abi and seven unmeasured dimensions, instead of a clean report"
if need_clone v4-stoploss; then
  run_scan "$CLONES_ROOT/v4-stoploss/repo" src/StopLoss.sol:StopLoss --verbose --out out
  echo
  echo "  dimensions hookrisk refused to score:"
  jq -r '[.score.dimensions[] | select(.source=="unmeasured") | .id] | "    " + join(", ")' \
    "$CLONES_ROOT/v4-stoploss/repo/out/hook-risk.json"
fi

# --------------------------------------------------------------------------- #
banner "The official template on a fresh config" "hookrisk init's default gate passes the Uniswap Foundation template, exit 0"
if need_clone v4-template-counter; then
  node "$CLI" init --config "$WORK/hookrisk.toml" >/dev/null
  echo "  fresh config written to $WORK/hookrisk.toml (maxTier commented out, failOnInconclusive = false)"
  run_scan "$CLONES_ROOT/v4-template-counter/repo" src/Counter.sol:Counter \
    --config "$WORK/hookrisk.toml" --verbose --out out
  echo
  jq -c '.coverage.observations' "$CLONES_ROOT/v4-template-counter/repo/out/hook-risk.json"
fi

# --------------------------------------------------------------------------- #
banner "Two engines agreeing" "BlockSec HookScan (Yul CFG) and hookrisk (solc AST) merge into one corroborated finding"
if ! command -v docker >/dev/null 2>&1 || ! docker image inspect futuretech6/hookscan >/dev/null 2>&1; then
  skipped "futuretech6/hookscan is not pulled. Run:
             docker pull --platform linux/amd64 futuretech6/hookscan   # ~1.2 GB, once
           The corroboration this step shows is recorded verbatim in
           docs/hackathon/evidence/blocksec-corroboration.md, which is what to
           put on screen when Docker is unavailable."
else
  PROJ="$WORK/blocksec/proj"
  mkdir -p "$WORK/blocksec"
  # The corpus project cannot be used directly: its lib/ is a symlink out of the
  # project root, which the engine detects and refuses. The harness project has
  # a real lib/.
  cp -R "$HOOKRISK_ROOT/harness" "$PROJ"
  cp "$HOOKRISK_ROOT/corpus/src/bad/UnvalidatedCallback.sol" "$PROJ/src/"
  sed 's/^blocksec = false/blocksec = true/' "$HOOKRISK_ROOT/harness/hookrisk.toml" > "$PROJ/hookrisk.toml"
  ( cd "$PROJ" && forge build >/dev/null 2>&1 )
  run_scan "$PROJ" src/UnvalidatedCallback.sol:UnvalidatedCallback --skip-dynamic --no-gate --verbose --out out
  echo
  jq -r '.findings[] | select(.ruleClass=="unprotected-hook-callback")
         | "  line \(.location.line)  \(.confidence)  " + ([.engines[] | .engine + "/" + .nativeRule] | join(" + "))' \
    "$PROJ/out/hook-risk.json"
fi

# --------------------------------------------------------------------------- #
banner "What CI branches on" "--log-json, and the four manifest fields a pipeline reads"
run_scan "$HOOKRISK_ROOT/harness" src/hooks/RefusingHook.sol:RefusingHook --log-json --out out
echo
echo "  the fields a CI job would read:"
jq -r '"    exit code       (above)
    .gate.passed              = \(.gate.passed)
    .coverage.harnessStatus   = \(.coverage.harnessStatus)
    engines[].errorCode       = \([.engines[].errorCode // "-"] | join(", "))
    invariants                = \([.invariants[] | .id + "=" + .status] | join(" "))"' \
  "$HOOKRISK_ROOT/harness/out/hook-risk.json"
echo
echo "  Note: this scan exits 0. A harness that could not stand the hook up does"
echo "  not fail the gate on its own — set failOnInconclusive = true under [gate]"
echo "  to make an unmeasured tier a CI failure (then the same scan exits 2)."

[ "$KEEP_WORK" -eq 1 ] || rm -rf "$WORK"
printf '\n\033[1mDemo finished.\033[0m Reset instructions are in docs/hackathon/DEMO_RUNBOOK.md.\n'
