#!/usr/bin/env bash
#
# Preflight check. Tells you what hookrisk can and cannot do in this environment,
# and separates "this is fatal" from "this only disables part of the scan".
#
# Exits 0 when a scan is possible at all, 10 when it is not. Optional components
# report as warnings so you learn what you are giving up rather than discovering
# it three minutes into a run.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

fatal=0
warn=0

ok()   { printf '  %s✓%s %-22s %s\n' "$GREEN" "$RESET" "$1" "${DIM}$2${RESET}"; }
bad()  { printf '  %s✗%s %-22s %s\n' "$RED" "$RESET" "$1" "$2"; fatal=$((fatal+1)); }
soft() { printf '  %s!%s %-22s %s\n' "$YELLOW" "$RESET" "$1" "$2"; warn=$((warn+1)); }

# Compare dotted versions without relying on sort -V, which BSD userland lacks.
version_ge() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | awk -F. '{printf "%d%03d%03d\n", $1, $2, $3}' | sort -n | head -1)" == "$(printf '%s' "$2" | awk -F. '{printf "%d%03d%03d\n", $1, $2, $3}')" ]]
}

first_version() { grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<<"$1" | head -1; }

printf '\n%shookrisk doctor%s\n\n' "$BOLD" "$RESET"

# --- Required ---------------------------------------------------------------
printf '%sRequired%s\n' "$BOLD" "$RESET"

if command -v forge >/dev/null 2>&1; then
  v="$(first_version "$(forge --version 2>&1)")"
  if [[ -n "$v" ]] && version_ge "$v" "1.0.0"; then
    ok "forge" "$v"
  else
    soft "forge" "${v:-unknown} — hookrisk targets 1.0.0+; older versions may not parse foundry.toml profiles (HR-E001)"
  fi
else
  bad "forge" "not on PATH — install Foundry, see HR-E001"
fi

if command -v git >/dev/null 2>&1; then
  ok "git" "$(first_version "$(git --version 2>&1)")"
else
  bad "git" "not on PATH — required to materialise pinned dependencies"
fi

# --- Static analysis --------------------------------------------------------
printf '\n%sStatic analysis%s %s(optional: --skip-static drops these dimensions)%s\n' \
  "$BOLD" "$RESET" "$DIM" "$RESET"

SLITHER=""
for candidate in "$ROOT/.venv/bin/slither" slither; do
  if command -v "$candidate" >/dev/null 2>&1; then SLITHER="$candidate"; break; fi
done

if [[ -n "$SLITHER" ]]; then
  ok "slither" "$($SLITHER --version 2>&1 | head -1) ${DIM}($SLITHER)${RESET}"
  if $SLITHER --list-detectors 2>/dev/null | grep -q 'hookrisk-'; then
    ok "hookrisk detectors" "registered"
  else
    soft "hookrisk detectors" "not registered — run 'make install-detectors' (HR-E004)"
  fi
else
  soft "slither" "not found — static layer disabled (HR-E002)"
fi

py="$(command -v python3 || true)"
if [[ -n "$py" ]]; then
  pyv="$($py -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])')"
  if version_ge "$pyv" "3.10.0"; then ok "python3" "$pyv"; else soft "python3" "$pyv — need 3.10+ (HR-E003)"; fi
else
  soft "python3" "not found — static layer disabled (HR-E003)"
fi

# --- Reporting --------------------------------------------------------------
printf '\n%sReporting%s\n' "$BOLD" "$RESET"
if command -v node >/dev/null 2>&1; then
  nv="$(first_version "$(node --version 2>&1)")"
  if version_ge "$nv" "20.0.0"; then ok "node" "v$nv"; else soft "node" "v$nv — need 20+ for the CLI"; fi
else
  soft "node" "not found — manifest/report generation unavailable"
fi

# --- Dependency tree --------------------------------------------------------
printf '\n%sDependencies%s\n' "$BOLD" "$RESET"
if [[ -d "$ROOT/harness/lib/v4-core" ]]; then
  pinned="$(awk '$1=="v4-core"{print $3}' "$ROOT/harness/deps.lock")"
  actual="$(git -C "$ROOT/harness/lib/v4-core" rev-parse HEAD 2>/dev/null || echo "?")"
  if [[ "$pinned" == "$actual" ]]; then
    ok "v4-core" "${actual:0:12} (pinned)"
  else
    soft "v4-core" "${actual:0:12} but deps.lock says ${pinned:0:12} — run 'make deps'"
  fi
else
  soft "solidity deps" "not fetched — run 'make deps'"
fi

if [[ -L "$ROOT/corpus/lib" ]]; then
  ok "corpus/lib" "symlink present"
else
  soft "corpus/lib" "missing — run 'make deps'; a relative libs path breaks Slither (HR-E201)"
fi

# --- Network ----------------------------------------------------------------
printf '\n%sNetwork%s %s(only needed for deployed and fork modes)%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
for var in BASE_RPC_URL UNICHAIN_RPC_URL MAINNET_RPC_URL; do
  if [[ -n "${!var:-}" ]]; then ok "$var" "set"; else soft "$var" "unset — source-mode scans are unaffected (HR-E401)"; fi
done
if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
  ok "ETHERSCAN_API_KEY" "set"
else
  soft "ETHERSCAN_API_KEY" "unset — source fetching falls back to Sourcify, heavily rate limited (HR-E402)"
fi

# --- Verdict ----------------------------------------------------------------
printf '\n'
if (( fatal > 0 )); then
  printf '%s%d blocking problem(s).%s Fix those before scanning; see docs/TROUBLESHOOTING.md.\n\n' "$RED" "$fatal" "$RESET"
  exit 10
fi
if (( warn > 0 )); then
  printf '%sReady, with %d limitation(s).%s Source-mode scanning works; the notes above say what is disabled.\n\n' "$YELLOW" "$warn" "$RESET"
else
  printf '%sReady.%s Every component available.\n\n' "$GREEN" "$RESET"
fi
exit 0
