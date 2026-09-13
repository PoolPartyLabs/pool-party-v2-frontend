# hookrisk — one entry point per thing you might want to do.
#
# `make` on its own prints the targets. Every error message in
# errors/catalog.json that tells you to run something tells you to run one of
# these, so they are part of the interface rather than a convenience.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Prefer the repo-local virtualenv when it exists, so a contributor who ran
# `make venv` does not also have to remember to activate it.
#
# Recursively expanded (`=`, not `:=`) on purpose: with `:=` these resolve once
# at parse time, before the `venv` target has created .venv, so a fresh
# `make setup` installs the detectors into the system interpreter and fails
# under PEP 668 (externally-managed-environment) on the very first run.
VENV      := .venv
PYTHON    = $(shell [ -x $(VENV)/bin/python ] && echo $(VENV)/bin/python || echo python3)
PIP       = $(shell [ -x $(VENV)/bin/pip ] && echo $(VENV)/bin/pip || echo pip3)
SLITHER   = $(shell [ -x $(VENV)/bin/slither ] && echo $(VENV)/bin/slither || echo slither)

DETECTOR_ARGS := hookrisk-unprotected-callback,hookrisk-flag-divergence,hookrisk-admin-surface,hookrisk-external-call-in-swap-path,hookrisk-unbounded-dynamic-fee,hookrisk-custom-accounting,hookrisk-disabled-callback,hookrisk-unsupported-abi,hookrisk-hook-profile

.PHONY: help
help: ## Show this help
	@echo "hookrisk"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-22s\033[0m %s\n", $$1, $$2}'
	@echo

# --------------------------------------------------------------------------- #
# Setup
# --------------------------------------------------------------------------- #

.PHONY: setup
setup: venv deps install-detectors install-cli ## Everything needed to work on hookrisk
	@echo
	@./scripts/doctor.sh

.PHONY: venv
venv: ## Create the Python virtualenv
	@[ -d $(VENV) ] || python3 -m venv $(VENV)
	@$(VENV)/bin/pip install -q --upgrade pip
	@$(VENV)/bin/pip install -q 'slither-analyzer>=0.11.5,<0.12'
	@echo "venv ready: $$($(VENV)/bin/slither --version)"

.PHONY: deps
deps: ## Materialise pinned Solidity dependencies (harness/deps.lock)
	@./scripts/fetch-deps.sh

.PHONY: install-detectors
install-detectors: ## Install the Slither plugin into the active environment
	@$(PIP) install -q -e ./detectors
	@$(SLITHER) --list-detectors 2>/dev/null | grep -q 'hookrisk-' \
		&& echo "detectors registered" \
		|| { echo "detectors NOT registered — see HR-E004 in docs/TROUBLESHOOTING.md"; exit 1; }

.PHONY: install-cli
install-cli: ## Build the TypeScript CLI
	@cd cli && npm install --silent && npm run --silent build
	@echo "cli built: $$(node cli/dist/cli.js --version)"

.PHONY: doctor
doctor: ## Check what this environment can and cannot do
	@./scripts/doctor.sh

# --------------------------------------------------------------------------- #
# Generated files
# --------------------------------------------------------------------------- #

.PHONY: spec
spec: ## Regenerate hooks_spec.py from the pinned v4-core
	@$(PYTHON) scripts/gen_hooks_spec.py --core harness/lib/v4-core

.PHONY: docs
docs: ## Regenerate docs/TROUBLESHOOTING.md from errors/catalog.json
	@$(PYTHON) scripts/gen_error_docs.py

.PHONY: check-generated
check-generated: ## Fail if any generated file is stale
	@$(PYTHON) scripts/gen_hooks_spec.py --core harness/lib/v4-core --check
	@$(PYTHON) scripts/gen_error_docs.py --check

# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #

.PHONY: test
test: test-harness test-cli test-corpus ## Run everything

.PHONY: test-harness
test-harness: ## Foundry: spec cross-check, invariants, planted-bug detection
	@cd harness && FOUNDRY_PROFILE=scan forge test

.PHONY: test-cli
test-cli: ## TypeScript: engines, scoring, config
	@cd cli && npm run --silent test

# One JSON scan per corpus directory, gated with jq rather than by grepping the
# human-readable log. The three gates are deliberately asymmetric:
#
#   bad     must produce at least one High and at least one Medium finding —
#           the detectors work at both severities (HS-03's owner-only shape,
#           HS-05 and HS-06 report at Medium; a gate that only asked for a
#           High would not notice all three going silent).
#   good    must produce nothing at High or Medium, and nothing from the
#           unsupported-ABI classification (every good hook is on the current
#           interface). Informational classifications are allowed: OZ's
#           AntiSandwich legitimately uses custom accounting, and
#           IntentionalRevertHook is *meant* to trip `hookrisk-disabled-callback`.
#   legacy  must produce unsupported-ABI classifications and nothing else — the
#           point of the fixture is that the scan admits it did not look,
#           without inventing findings it could not have derived. The one
#           other thing allowed is a hook-profile on the partially readable
#           MixedAbiHook: its current-ABI callbacks *were* analysed, and the
#           profile says so (its `partial` unsupported-ABI twin still revokes
#           coverage in the CLI).
#
# `--fail-none` so Slither's exit code reflects "did the scan run", not "were
# there findings"; the pipeline then checks `.success` so a compile failure is
# a loud red FAIL rather than an empty finding list that passes the good gate.
# The finer-grained expectations (discriminators, which contract each finding
# anchors on, the in-file controls) live in detectors/tests/test_corpus.py,
# run last; it needs only the standard library.
CORPUS_SCAN = cd corpus && $(abspath $(SLITHER)) $(1) --detect $(DETECTOR_ARGS) --exclude-dependencies --fail-none --json - 2>/dev/null
JQ_SEVERE  = [.results.detectors[] | select(.impact == "High" or .impact == "Medium")] | length
JQ_HIGH    = [.results.detectors[] | select(.impact == "High")] | length
JQ_MEDIUM  = [.results.detectors[] | select(.impact == "Medium")] | length

.PHONY: test-corpus
test-corpus: ## Detectors must fire on corpus/src/bad, stay silent on src/good, and admit src/legacy is unreadable
	@command -v jq >/dev/null || { echo "FAIL: jq is required for the corpus gates"; exit 1; }
	@echo "--- corpus/src/bad (must fire at High and at Medium) ---"
	@$(call CORPUS_SCAN,src/bad) | jq -e '.success and (($(JQ_HIGH)) > 0) and (($(JQ_MEDIUM)) > 0)' >/dev/null \
		|| { echo "FAIL: detectors found nothing at High, or nothing at Medium, in the positive corpus"; exit 1; }
	@echo "--- corpus/src/good (nothing at High or Medium, no unsupported-ABI) ---"
	@$(call CORPUS_SCAN,src/good) | jq -e '.success and (($(JQ_SEVERE)) == 0) and ([.results.detectors[] | select(.check == "hookrisk-unsupported-abi")] | length == 0)' >/dev/null \
		|| { echo "FAIL: false positive on the negative corpus"; exit 1; }
	@echo "--- corpus/src/legacy (only unsupported-abi, plus the partial hook's profile) ---"
	@$(call CORPUS_SCAN,src/legacy) | jq -e '.success and ([.results.detectors[] | select(.check == "hookrisk-unsupported-abi")] | length > 0) and all(.results.detectors[]; .check == "hookrisk-unsupported-abi" or .check == "hookrisk-hook-profile")' >/dev/null \
		|| { echo "FAIL: legacy corpus must produce unsupported-ABI classifications and nothing else"; exit 1; }
	@echo "--- detectors/tests (finding-level expectations) ---"
	@cd detectors && HOOKRISK_SLITHER_BIN=$(abspath $(SLITHER)) $(abspath $(PYTHON)) -m unittest discover -s tests -v \
		|| { echo "FAIL: detectors/tests"; exit 1; }
	@echo "corpus gates passed"

.PHONY: deep
deep: ## Overnight invariant run (5000 sequences, depth 128)
	@cd harness && FOUNDRY_PROFILE=deep forge test --match-contract Invariants

# --------------------------------------------------------------------------- #
# Demo
# --------------------------------------------------------------------------- #

.PHONY: demo
demo: ## Scan a clean hook and a hook with a planted bug, end to end
	@echo "=============================================================="
	@echo " 1. A correct hook: no findings, invariants hold"
	@echo "=============================================================="
	@cd corpus && HOOKRISK_SLITHER_BIN=$(abspath $(SLITHER)) \
		node ../cli/dist/cli.js scan src/good/CleanHook.sol:CleanHook --no-gate || true
	@echo
	@echo "=============================================================="
	@echo " 2. A hook that charges 3.5% while documenting 1%"
	@echo "    Structurally flawless. Only execution can see it."
	@echo "=============================================================="
	@cd harness && forge build >/dev/null 2>&1 && HOOKRISK_SLITHER_BIN=$(abspath $(SLITHER)) \
		node ../cli/dist/cli.js scan src/hooks/FeeHooks.sol:SkimmingFeeHook --skip-static; \
		echo "exit code: $$? (2 = gate failed)"

.PHONY: clean
clean: ## Remove build output, keep dependencies
	@rm -rf cli/dist harness/out harness/cache corpus/out corpus/cache
	@rm -f harness/hook-risk.json harness/HOOK_RISK.md harness/hookrisk.sarif
	@rm -f corpus/hook-risk.json corpus/HOOK_RISK.md corpus/hookrisk.sarif
	@echo "cleaned"
