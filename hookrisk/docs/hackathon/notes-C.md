# Agent C — Python detectors: stop crying wolf, stop staying silent

Scope: `detectors/`, `corpus/`, the `test-corpus` Makefile target,
`docs/DETECTORS.md`. Nothing under `cli/` or `harness/` was touched.

## What changed

### 1. HS-02 no longer accuses deliberate revert-guards

`always_reverts()` (a boolean) is gone. `classify_callback()` in
`detectors/slither_hookrisk/utils/hook_analysis.py` returns one of three
verdicts for every IHooks callback:

| Verdict | Rule |
|---|---|
| `IMPLEMENTED` | the most-derived delegate can return |
| `STUB` | not overridden, or the override reverts `HookNotImplemented()`, or it lives under a dependency path |
| `INTENTIONALLY_DISABLED` | delegate declared in project source (`source_mapping.is_dependency == False`) and reverts with anything else |

`unconditional_revert()` reports *what* a function reverts with (`RevertReason`:
custom error name, string literal, or bare), which is what makes the
`HookNotImplemented` name check possible. That check is load-bearing: WETHHook
vendors `BaseHook` into `src/base/`, so "project-owned" alone would have turned
every stub in that repo into a false "intentional".

HS-02 fires High only on `STUB`. `INTENTIONALLY_DISABLED` goes to the new
`hookrisk-disabled-callback` detector (`detectors/disabled_callback.py`,
rule class `callback-intentionally-disabled`, INFO, `IS_CLASSIFICATION=True`).
Its message names the callback, the error, and the operation, and says the
harness will observe reverts there. It anchors on the developer's delegate so it
survives `--exclude-dependencies`.

### 2. Discriminators

`HookriskDetector._report(parts, discriminator=None)` writes
`hookrisk.discriminator`. HS-02 passes the permission field, HS-01 and
disabled-callback pass the callback name, the partial unsupported-ABI finding
passes `"partial"`. Agent D consumes it in the CLI's de-duplication.

### 3. Legacy ABI is reported, not silently skipped

`hookrisk-unsupported-abi` (`detectors/unsupported_abi.py`, rule class
`unsupported-hook-abi`, INFO, classification) overrides `_detect` and iterates
*all* non-abstract, non-dependency contracts. Evidence comes from
`legacy_abi_evidence()` in `hook_analysis.py`: `getHooksCalls()` defined,
callbacks with IHooks names but non-current signatures, or a `BaseHook`
ancestor with no recognised callback.

**A finding from the real-world run that changed the design:** `afterInitialize`
has the same signature today as in 2023, so v4-stoploss, nft-owners-only,
trading-days and take-profits-hook were *partially* recognised — `is_hook_contract`
was true on that one callback — and HS-02 reported them at **High** for "does
not declare `getHookPermissions()`" (they declare `getHooksCalls()`). Wrong
reason, wrong severity, on a contract the tool could not read. So
`is_hook_contract` now refuses any contract that defines `getHooksCalls()`, and
the classification takes over.

A second shape, v2-on-v4: a current-ABI hook with one callback whose
`ModifyLiquidityParams` predates `salt`. HS-02 called that "no working
implementation" at High. Now HS-02 skips callbacks that exist under a
non-current signature and the unsupported-ABI detector emits a shorter
`partial` finding listing them.

### 4. Corpus

- `corpus/src/good/CleanHook.sol` imported OZ's `AntiSandwichHook` and
  `LiquidityPenaltyHook`, both **abstract** at the pinned commit, so
  `HookriskDetector` skipped them and the "runs against production code" claim
  was empty. It now subclasses the concrete `AntiSandwichMock`,
  `LimitOrderHookMock` and `LiquidityPenaltyHookMock` **in project source** —
  subclassing, not just importing, because `--exclude-dependencies` drops any
  finding whose elements all live under `lib/`, so a finding on the mock itself
  could never reach the gate. HS-01/HS-02 are silent on all three; HS-07 fires
  on AntiSandwich and LiquidityPenalty (correct). No HR-E205 IR gap at this pin.
- `corpus/src/good/IntentionalRevertHook.sol`: HS-02 silent, disabled-callback
  fires with discriminator `beforeAddLiquidity`.
- `corpus/src/legacy/LegacyHook.sol`: a 2023-style hook, the v4-stoploss shape
  (`LegacyAfterInitializeHook`), the v2-on-v4 shape (`MixedAbiHook`), and a
  `HookRegistry` control that must stay silent.
- `make test-corpus` now uses `--json -` + `jq`: bad ⇒ ≥1 High/Medium; good ⇒
  0 High/Medium and no unsupported-ABI; legacy ⇒ ≥1 finding, all
  unsupported-ABI. Then runs `detectors/tests/test_corpus.py` (17 tests,
  stdlib `unittest` only, ~3 s) which asserts anchors, discriminators and
  in-file controls. Each gate was fed the wrong corpus to prove it fails
  (`scratchpad/prove_gate_fails.sh` — good-vs-bad exit 1, missing dir exit 4,
  legacy-vs-good exit 1).

## Real-world verification

Re-ran `.venv/bin/slither . --detect <all five> --exclude-dependencies --json`
inside the pre-fix clones under
`/private/tmp/claude-501/.../scratchpad/hooks/<slug>/repo` (13 of 14; ref-fee-hook
does not compile in its clone, pre-existing).

| Hook | Before | After |
|---|---|---|
| orbital-hook | HS-02 High `beforeRemoveLiquidity` (the `beforeAddLiquidity` twin was collapsed by dedupe) | 2× disabled-callback INFO, discriminators `beforeAddLiquidity` / `beforeRemoveLiquidity`; no High |
| v4-hooks-public-weth (WETHHook) | HS-02 High `beforeAddLiquidity` | disabled-callback INFO on `BaseTokenWrapperHook._beforeAddLiquidity` (`LiquidityNotAllowed()`); StablePairHook's `afterInitialize` **stays High** — a genuine `BaseHook` stub declared "for future headroom" |
| v4-constant-sum (Counter) | HS-02 High `beforeAddLiquidity` | disabled-callback INFO (`"No v4 Liquidity allowed"`); HS-01 on the vendored `src/forks/BaseHook.sol` is pre-existing HS-01 behaviour, unchanged |
| v2-on-v4 (V2PairHook) | HS-02 High `beforeAddLiquidity` + `beforeInitialize` | unsupported-abi `partial` naming six pre-current callbacks; HS-01 on `afterSwap` unchanged |
| cork-hook | HS-02 High `beforeRemoveLiquidity` | disabled-callback INFO on `beforeAddLiquidity` (`DisableNativeLiquidityModification()`); `beforeRemoveLiquidity` stays High (genuine stub) |
| v4-stoploss, nft-owners-only, trading-days, take-profits-hook | 0 findings via the CLI; raw Slither: HS-02 **High** "does not declare getHookPermissions()" on the `*Implementation` contracts | unsupported-abi INFO on every deployable contract (`StopLoss` *and* `StopLossImplementation`), nothing else |
| oz-antisandwich-mock, oz-limitorder-mock | HS-07 only | unchanged for the mocks; OZ's own `BaseCustomAccounting` now gets 2× disabled-callback (`LiquidityOnlyViaHook()`), and `BaseHookMockReverts` correctly keeps 10× HS-02 High (it declares everything and implements nothing — a test double) |
| v4-template-counter | 0 findings | 0 findings (current ABI, clean) |

## How to demo

```sh
make test-corpus                      # three jq gates + 17 unittest assertions
cd corpus && ../.venv/bin/slither src/good --detect hookrisk-flag-divergence,hookrisk-disabled-callback --exclude-dependencies --fail-none
cd corpus && ../.venv/bin/slither src/legacy --detect hookrisk-unsupported-abi --exclude-dependencies --fail-none
# Real hook, before/after in one command (needs the scratchpad clone):
cd /private/tmp/claude-501/.../scratchpad/hooks/orbital-hook/repo && \
  /path/to/hookrisk/.venv/bin/slither . --detect hookrisk-flag-divergence,hookrisk-disabled-callback --exclude-dependencies --fail-none --json - | jq '.results.detectors[] | {check, impact, d: .hookrisk.discriminator}'
```

## Caveats

- `getHooksCalls()` is treated as conclusive legacy evidence. A current-ABI hook
  that also happens to define a function by that name would be excluded from
  the HS detectors and classified as unsupported. I could not find one; the
  classification message makes the reason visible if it ever happens.
- The `partial` finding anchors on the contract; the `unreadable` skip in HS-02
  is name-based (a callback name with any mismatched overload). A hook that has
  both the current and an old overload of the same callback would have its
  current one unjudged by HS-02. Not observed in the corpus of 14.
- `disabled-callback` anchors on the delegate, which for WETHHook lives on the
  abstract base `BaseTokenWrapperHook`. Slither de-duplicates identical
  descriptions, so two concrete hooks sharing that base produce one finding,
  not two. The CLI scans one target contract at a time, so this does not lose
  information per scan.
- No pytest in the venv (`make install-detectors` does not install the `dev`
  extra); the test file is plain `unittest` and runs under either.
