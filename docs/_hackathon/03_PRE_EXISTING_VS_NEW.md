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
- **Hackathon epic:** POO-1022, 33 issues (UF-01 … UF-33): POO-1023 … POO-1052 and POO-1054 … POO-1056
- **Work started:** 2026-07-24
- **Boundary commit:** `21a2c289` — everything reachable from it pre-dates the event
- **Every Part 2 row below is `landed`.** The epic is delivered; the issues still open are
  documentation-shaped or deliberately deferred, and are named in
  [`00_IMPLEMENTATION_PLAN.md` §11](00_IMPLEMENTATION_PLAN.md#11-how-the-plan-changed-under-contact-with-the-live-api).

## How to verify the boundary yourself

```bash
# Everything built during the hackathon
git log --oneline 21a2c289..HEAD

# Every file the epic touched, with its churn
git diff --stat 21a2c289..HEAD           # 180 files, +32821 / -451

# Only the epic's own artifacts (they all carry a @hackathon header tag)
git grep -l "@hackathon" -- src scripts   # 102 files
```

Every source file created for this epic carries `@hackathon` in its standard file header, alongside
the repository's usual `@id` / `@name` / `@implements-rules-version` fields, and so does every
pre-existing module the epic re-headered when it changed. Nothing unrelated was retro-tagged.

**Reconciling the grep against the table.** The grep returns **102 files**; Part 2 lists **modules**,
so their `.test.ts` / `.stories.tsx` siblings get no rows of their own — 47 of the 102 are modules and
the remaining 55 are the tests and stories beside them. Every one of those 47 appears below, and
`tests/hackathonDocs.test.ts` asserts exactly that, so this table cannot silently drift from the tree
again. A path listed here that is missing from the tree, or a tagged module missing from here, fails
the suite.

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
| `src/lib/provisioning/mockPlanner.ts` | Deterministic mock planner + hardcoded fee model | Mock only — **renamed and re-scoped by this epic**, see *Deleted* |
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
the tree and in `git diff 21a2c289..HEAD` today, `planned` is filed and not yet written. **Every row
is now `landed`** — the column is kept because it is what made this document trustworthy while the
epic was running, and because `tests/hackathonDocs.test.ts` enforces it in both directions.

Paths are repo-relative and resolvable. A row naming a directory covers the files under it.

### New modules

**Transport and contract** — the whole Uniswap surface, behind one server-only boundary.

| Path | What it does | Issue | Status |
|---|---|---|---|
| `src/lib/uniswap/client.ts` | Server-only `uniswapFetch`: `x-api-key`, Zod, bounded retry on the transient class only, per-attempt abort with a cumulative budget | POO-1027 | landed |
| `src/lib/uniswap/errors.ts` | Typed `UniswapApiError` / `UniswapParseError`, so callers never regex-match a message | POO-1027 | landed |
| `src/lib/uniswap/schemas.ts` | Zod contracts for every endpoint we call. Strict where a value can influence a transaction, tolerant on display-only blocks | POO-1028 | landed |
| `src/lib/uniswap/actions.ts` | The `"use server"` boundary: `quoteSwap` · `checkApproval` · `buildSwapTx` · `listSwappableTokens`. The key never leaves the server | POO-1029 | landed |

**Planner** — turning "this operation needs N USDC on chain X" into executable legs.

| Path | What it does | Issue | Status |
|---|---|---|---|
| `src/lib/balances/fundingInventory.ts`, `src/lib/balances/fundingInventoryActions.ts` | What the wallet can actually pay with: the intersection of the shipped multi-chain holdings read and what Uniswap can route | POO-1031 | landed |
| `src/lib/provisioning/gasFeasibility.ts` | The OK / TOP-UP / BLOCKED classifier, per source chain. Pure, injected quotes, exhaustively table-tested | POO-1032 | landed |
| `src/lib/provisioning/buildPlan.ts` | **The engine.** Same-chain `CLASSIC`, cross-chain same-token `BRIDGE`, cross-chain different-token decomposed into swap-then-bridge, which POO-1054 established is the only shape the live API serves | POO-1034 | landed |
| `src/lib/provisioning/costBreakdown.ts` | Fees, gas, impact, slippage → `ProvisioningQuote`, itemized per source. Pure, and run by BOTH the planner and the cost table so the two cannot disagree | POO-1035 | landed |
| `src/lib/provisioning/planActions.ts` | The server boundary for the planner and the gate context | POO-1024, POO-1042 | landed |
| `src/lib/provisioning/gateContext.ts` | Everything the gate needs to know about a wallet, read once, server-side. Replaces the hard-disable stub | POO-1042 | landed |
| `src/lib/provisioning/fixtures/mockPlan.ts` | Mock mode's plan source. Moved here from `mockPlanner.ts`, see *Deleted* | POO-1030, POO-1034 | landed |
| `src/lib/provisioning/fixtures/uniswapQuotes.ts` | Recorded quote fixtures, so the planner's suite runs offline | POO-1034 | landed |
| `src/lib/provisioning/fixtures/pricedPlans.ts` | Priced-plan fixtures (same-chain / cross-chain / gas top-up) for the cost table's tests and stories | POO-1035, POO-1040 | landed |

**Execution rail** — mapping legs onto the shipped `useWalletSignFlow`, and surviving interruption.

| Path | What it does | Issue | Status |
|---|---|---|---|
| `src/features/strategies/lib/buildPlanSteps.ts` | **The adapter.** Funding legs → `FlowStep[]`, each re-quoted at execution time from the balance the previous leg actually produced | POO-1036 | landed |
| `src/features/strategies/lib/awaitBridgeSettlement.ts` | Destination-chain arrival, polled with backoff against a recorded baseline. A source receipt only proves the funds left | POO-1037 | landed |
| `src/features/strategies/lib/fundingJournal.ts` | **The recovery primitive.** The client-persisted leg journal that replaces the server-held `planId` POO-1054 established we cannot obtain | POO-1038 | landed |
| `src/features/strategies/lib/reconcileFundingJournal.ts` | The §3.5 decision table: journal versus chain, resolved by reading, never by re-broadcasting | POO-1038 | landed |
| `src/features/strategies/lib/fundingAuthorisation.ts` | What a funding route asks a wallet to authorise, made legible for clear-vs-blind signing | POO-1050 | landed |
| `src/features/strategies/hooks/useProvisioningPlan.ts` | The plan seam every render surface resolves through, so `mockComputePlan` has no second caller | POO-1023, POO-1043 | landed |
| `src/features/strategies/hooks/useProvisioningRail.ts` | Binds the rail to the connected wallet, in one place, for all six operations. The prop `ProvisioningPanel` had declared and nobody passed | POO-1042, POO-1043 | landed |
| `src/features/strategies/hooks/useFundingRecovery.ts` | The reading half: on session entry it finds the in-flight route for the connected wallet and reconciles it against the chain | POO-1055 | landed |

**UI**

| Path | What it does | Issue | Status |
|---|---|---|---|
| `src/features/strategies/components/provisioning/FundingSourceSelector.tsx`, `src/features/strategies/components/provisioning/fundingSelection.ts` | Multi-select across chains, running total, gas badges, blocked rows shown with their reason | POO-1039 | landed |
| `src/features/strategies/components/provisioning/ProvisioningCostBreakdown.tsx` | The cost table and the buy-crypto alternative | POO-1040 | landed |
| `src/features/strategies/components/provisioning/FundingRecoveryBanner.tsx` | "You have funding in progress", mounted on the app shell. Resume is a link back to the operation, never a re-send | POO-1055 | landed |
| `src/app/[locale]/(auth)/(app)/swap/`, `src/features/swap/` | Standalone swap + bridge screen behind the `swapScreen` flag. Destination + amount, then the shipped `ProvisioningPanel`: no second planner, no second rail | POO-1046 | landed |

**Measurement and tooling**

| Path | What it does | Issue | Status |
|---|---|---|---|
| `src/lib/analytics/provisioningFunnel.ts` | The nine typed funnel events, plus the pure derivation of what a route *is*: shape, leg count, USD magnitude. Never a raw address | POO-1048 | landed |
| `scripts/bundle-secrets-check.ts` | `pnpm secrets:check`: greps the build output for every server-only secret and for any `NEXT_PUBLIC_` twin. The one failure the other five gates all pass straight through | POO-1050 | landed |

`src/lib/uniswap/` already existed and holds pre-existing pool math (`tick.ts`, `price.ts`, `range.ts`,
`amount.ts`, `positionSplit.ts`). The four rows above are new files in that folder, not the folder.

### Modified pre-existing files

| Path | Change | Issue | Status |
|---|---|---|---|
| `src/lib/provisioning/types.ts` | Contract v2 → v3: `stepIndex`, `method`, `payload`, `chainId`, `etaSeconds`, per-chain balances. Additive. `planId` was revisited once POO-1054 established there is no server-held plan to key on | POO-1030, POO-1054 | landed |
| `src/lib/provisioning/planner.ts` | The `throw` becomes the real planner, behind the server boundary | POO-1023, POO-1034 | landed |
| `src/lib/provisioning/computeNeed.ts` | Scalar wallet model → per-chain map; `needsBridge` no longer requires `opRequiredUsdc > 0` | POO-1033 | landed |
| `src/lib/provisioning/index.ts` | The client barrel stops re-exporting anything that transitively imports `server-only` | POO-1024 | landed |
| `src/features/strategies/components/ProvisioningPanel.tsx` | Routes through the `computePlan` seam; mounts the real rail, the cost breakdown, the price-impact gate and the funnel; gas-only skips the picker; a blocked plan offers buy-crypto and no retry | POO-1023, POO-1043, POO-1044, POO-1047, POO-1048 | landed |
| `src/features/strategies/components/ProvisioningWizardModal.tsx` | Routes through the same seam. Both `PP-FIXME`s deleted, not reworded | POO-1023 | landed |
| `src/features/strategies/hooks/useProvisioningGate.ts` | The gate reads live context and reports the funnel's first event | POO-1042, POO-1048 | landed |
| `src/features/strategies/lib/buildProvisioningInput.ts` | The hard-disable stub becomes live balance reads, failing safe: a degraded read means no gate, and the operation proceeds exactly as today | POO-1042 | landed |
| `src/features/strategies/components/InvestModal.tsx` | The `needsDeposit` deep-link early return yields to the gate, and the flagship any-token any-chain invest resumes with its original parameters | POO-1025, POO-1043 | landed |
| `src/features/strategies/components/provisioning/provisioningView.ts` | Real-step rendering; the local network-name literal replaced by the shared chain config | POO-1041 | landed |
| `src/features/strategies/components/provisioning/ProvisioningPlanCard.tsx` | Renders the rail's own rows: approvals, bridge ETA, per-leg explorer links, and no link at all when there is no hash | POO-1041 | landed |
| `src/lib/tx/diagnostics.ts` | `wrongChain` error kind carrying the target chain id, and `gasBlocked` mapped from `PROVISIONING_GAS_BLOCKED` | POO-1026, POO-1044 | landed |
| `src/features/strategies/components/TransactionErrorActions.tsx` | `wrongChain` and `gasBlocked` copy, network-named, degrading to generic copy on an unknown chain | POO-1026, POO-1044 | landed |
| `src/features/strategies/components/BuyGasModal.tsx`, `src/features/strategies/components/provisioning/PoweredByPaybis.tsx` | The gas surface stops naming a fiat provider: the implemented step is an on-chain swap | POO-1044 | landed |
| `src/features/strategies/components/CollectModal.tsx`, `src/features/strategies/components/CompoundModal.tsx`, `src/features/strategies/components/WithdrawModal.tsx`, `src/features/manager/components/MoveRangeModal.tsx`, `src/features/manager/components/RemoveLiquidityModal.tsx` | The rail reaches the other five operations, including the manager collect path that was silently exempt | POO-1045 | landed |
| `src/features/strategies/components/FeeBreakdown.tsx` | The canonical fee tooltip's Bridge line finally shows a number instead of its "Coming soon" placeholder | POO-1035 | landed |
| `src/lib/features/registry.ts`, `src/lib/features/resolve.ts` | The `swapScreen` flag; `provisioning`'s baseline becomes a flat boolean, so production no longer depends on `NODE_ENV` | POO-1042, POO-1046 | landed |
| `src/features/wallet/components/WalletModal.tsx`, `src/features/wallet/components/WalletMenu.tsx` | The Swap action gets a destination: an optional `onSwap`, passed only when `swapScreen` is on. Off, the modal is byte-identical to POO-240 | POO-1046 | landed |
| `src/components/layout/AppShell.tsx` | Mounts the recovery banner, so an interrupted route is found wherever the user comes back | POO-1055 | landed |
| `src/lib/chains/config.ts`, `src/lib/tokens/readErc20.ts`, `src/lib/tx/sendTransaction.ts` | Per-chain receipt / nonce / balance reads and explorer-address links: what recovery needs and a single-chain operation never did | POO-1038, POO-1055 | landed |
| `src/lib/balances/types.ts`, `src/lib/balances/mapHolding.ts`, `src/lib/balances/getRealTokenBalances.ts` | Holdings carry what the inventory needs to decide routability | POO-1031 | landed |
| `src/lib/analytics/events.ts` | The nine funnel events join the typed catalog | POO-1048 | landed |
| `src/i18n/messages/`, `src/i18n/request.ts` | All new copy in 11 locales, plus a new `swap` namespace | POO-1049 | landed |

### Deleted

| Path | Why | Issue | Status |
|---|---|---|---|
| `src/lib/provisioning/mockPlanner.ts` | Real-only decision. Deleting it removed a hardcoded fee model (~1% with a $0.99 floor) that contradicted the deposit screen's own copy (1.49% + $2 minimum), so real quotes are now the single source of provisioning fees. Its scenarios did **not** move to throwaway fixtures: `buildPlan` is `server-only` and `planner.ts` ships to the browser, so mock mode still needs a client-side plan source. The module was renamed to `fixtures/mockPlan.ts` and kept its suite, because deleting a suite that covers the repository's default mode is a coverage regression, not a cleanup | POO-1030, POO-1034 | landed |

`createPlan` / `advancePlan` / `getPlan` were also deleted, from inside `src/lib/uniswap/actions.ts`
rather than as whole files (POO-1054 R3). They called endpoints that require a `CHAINED` quote the
live API never returns, and an action that cannot be called with any payload the API accepts is worse
than an absent one: the next author reads it as a capability the rail has.

### Documentation and tooling

| Path | What | Issue | Status |
|---|---|---|---|
| `docs/_hackathon/00_IMPLEMENTATION_PLAN.md` | The plan of record, mirroring every tracker issue | POO-1051 | landed |
| `docs/_hackathon/01_UNISWAP_INTEGRATION.md` | Endpoint-by-endpoint reference, corrected against the live API | POO-1051, POO-1054 | landed |
| `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` | The cross-chain step machine, its failure modes, and the verified flagship route | POO-1051, POO-1054 | landed |
| `docs/_hackathon/03_PRE_EXISTING_VS_NEW.md` | This file | POO-1051 | landed |
| `docs/adr/0002-uniswap-trading-api-as-the-provisioning-rail.md`, `docs/adr/0003-server-only-uniswap-key-boundary.md` | The two architecture decisions, 0002 with its live-API addendum | POO-1051, POO-1054 | landed |
| `tests/hackathonDocs.test.ts` | The fitness function under this document: every claim above that a machine can check | POO-1051 | landed |
| `.claude/skills/swap-integration/` | **Vendored third-party**, not written by us: Uniswap's official `swap-integration` skill (MIT, `Uniswap/uniswap-ai@3ddd8a9d`). Provenance and every local edit are recorded in its header | POO-1052 | landed |

---

## Part 3 — What the hackathon work actually contributes

Stated plainly, so each claim can be checked against the diff behind it:

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
6. **A course correction taken in public.** Halfway through, a read-only probe of the live API
   invalidated the mechanism the epic was designed around. The docs were corrected against the
   evidence, the replacement design was written down, and the commit history shows the correction
   rather than hiding it. See [`00_IMPLEMENTATION_PLAN.md` §11](00_IMPLEMENTATION_PLAN.md#11-how-the-plan-changed-under-contact-with-the-live-api).

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
| A durable, server-side funding journal | The journal is `localStorage`, so recovery is per-browser. Deliberate for the event, and the honest limit of the recovery claim: a user who clears their profile mid-bridge loses the resume affordance, not the funds (§3.1 re-derives from the chain) |
