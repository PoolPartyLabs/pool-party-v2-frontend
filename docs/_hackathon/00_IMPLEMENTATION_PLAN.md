# Universal Funding — swap + bridge every Pool Party operation via the Uniswap Trading API

**The plan of record for the hackathon build.** Epic [POO-1022] · **33 issues** (UF-01 … UF-33):
[POO-1023 … POO-1052] and [POO-1054 … POO-1056]. Started 2026-07-24.
Repository: `pool-party-v2-frontend`.

> **For hackathon evaluators.** Our issue tracker (Linear) is private, so this file mirrors every
> issue in the epic: title, business rules, and acceptance criteria. Nothing about the plan lives
> only in the tracker. Read this file, then `03_PRE_EXISTING_VS_NEW.md` to see exactly which code
> pre-dates the event and which was built during it.
>
> **The epic opened with 29 issues and finished with 33.** The four that were added mid-flight are in
> [§8, phase P7](#p7--added-mid-flight), and the story of why is [§11](#11-how-the-plan-changed-under-contact-with-the-live-api).
> It is a short story about a live API disagreeing with its own documentation, and it is the most
> instructive thing in this file.

---

## 1. The problem

Pool Party v2 is an OAMS: managers run on-chain liquidity strategies, retail investors buy in.
Every money-moving operation — invest, withdraw, collect, compound, move-range, close — has one hard
precondition the app cannot solve for the user:

> **You must already hold USDC, on the exact chain the strategy lives on, plus native gas on that chain.**

The consequence is concrete and, until now, unaddressed. After POO-303 removed the cross-network USDC
aggregate (`src/lib/account/readUsdcBalance.ts:67-70`), the invest screen reads the balance only on
the strategy's chain (`src/features/strategies/StrategyDetailDataLoader.tsx:100-118`). So a user
holding $1,200 of USDC on Base, looking at an Arbitrum strategy, sees **$0 spendable** — and the only
remedy the product offers is a deep link to `/deposit` to **buy more fiat**
(`src/features/strategies/components/InvestModal.tsx:589-600`).

Meanwhile the wallet modal sums a cross-network total (`src/lib/balances/useTokenBalances.ts:117`)
that no single operation can actually spend, and its Swap button is a disabled "coming soon"
(`src/features/wallet/components/WalletModal.tsx:255-259`). The user is shown money they cannot use,
and then asked to buy more.

## 2. What already existed, and what was missing

A pre-flight provisioning system (epic POO-411) was designed for exactly this problem, and its
**chassis is complete**: the FE/BE contract declares `bridge`, `swap-gas` and `swap-token` step types
(`src/lib/provisioning/types.ts:26`), a pure calculator detects the wrong-network case
(`src/lib/provisioning/computeNeed.ts:70-71`), all six operation modals mount the gate, and the plan
UI renders.

**It has never had an engine.** Verbatim, from the working tree:

| Where | What |
|---|---|
| `src/lib/provisioning/planner.ts:29` | the real branch is `throw new Error("Provisioning planner is not wired yet")` |
| `src/features/strategies/lib/buildProvisioningInput.ts:101-107` | `realProvisioningInput` ignores its arguments and returns a hard-disable stub |
| `src/features/strategies/components/ProvisioningPanel.tsx:101-118` | `buildPlanSteps`, the execution-rail prop, is passed by **no production caller**; the fallback is a 900 ms `setTimeout` returning the literal hash `0xMOCK…MOCK` |
| `ProvisioningPanel.tsx:88-90`, `ProvisioningWizardModal.tsx:104-106` | both render surfaces call `mockComputePlan` **directly**, bypassing the mock/real seam — two live `PP-FIXME`s |

So: a fully-built chassis with no drivetrain. **This epic builds the drivetrain.**

## 3. What we are building

**Pay for any Pool Party operation with any token you hold, on any supported chain.**

- Same-chain funding: Uniswap `/quote` → `/swap`.
- Cross-chain funding: Uniswap `/quote` → `/swap`, once per leg. A same-token pair across two chains
  quotes as routing `BRIDGE` and settles as one transaction; a different-token pair is decomposed by
  our planner into a source-chain swap to USDC followed by a same-token USDC bridge. Bridge legs are
  quoted through Across.

> **Correction, 2026-07-25 (POO-1054).** The two bullets above originally read "Cross-chain funding:
> Uniswap **Chained Actions** (`POST /plan` → `PATCH /plan/:id` → `GET /plan/:id`)". A read-only probe
> of the live Trading API established that we cannot obtain a `CHAINED` quote at all, and `/plan`
> requires one, so those three endpoints are unreachable for our key. Cross-chain still works, through
> the two calls above. What moved is the multi-step orchestration, into our planner, and with it the
> recovery design: `planId` was to be the idempotency key, and is replaced by a client-persisted leg
> journal reconciled against on-chain receipts. Evidence table and reproduction:
> [`01_UNISWAP_INTEGRATION.md` §1](01_UNISWAP_INTEGRATION.md#1-probe-evidence). Replacement design:
> [`02_BRIDGE_ARCHITECTURE.md` §3](02_BRIDGE_ARCHITECTURE.md#3-recovery-without-a-server-held-plan).
> Decision record: the [ADR 0002 addendum](../adr/0002-uniswap-trading-api-as-the-provisioning-rail.md#addendum-2026-07-25--live-api-evidence-forces-decomposition-in-our-planner-poo-1054).
>
> The issue bodies in §8 below mirror the tracker and are **not** retro-edited, so the rules that
> mention `/plan` (POO-1028 R3/R4, POO-1029 R4/R5, POO-1036 R3, POO-1037 R1, POO-1038 R1/R2/R4) read
> as they were written. Where they conflict with this notice, this notice and POO-1054 win.

Supported chains: **Arbitrum 42161 · Base 8453 · Polygon 137**. All three are Uniswap-supported and
Across-bridgeable.

Three product capabilities sit on top of the rail, and each was an explicit requirement:

1. **Gas feasibility per source chain.** Before a chain can fund anything the user must be able to pay
   for transactions *on it*. Every candidate chain is classified **OK / TOP-UP / BLOCKED** and the
   verdict is shown, with its reason. See §6.
2. **Funding-source selection.** The user picks *what to spend* — multi-select across every token on
   every chain, with a running total against what the operation needs. The app works out the route.
3. **Cost breakdown, with an alternative.** Swap fee, bridge fee, per-step gas, price impact and
   slippage, aggregated into "You pay" — presented next to a *buy crypto instead* option.

**Out of scope, stated honestly:** the fiat on-ramp (Paybis), crypto-deposit resume, the Ethereum
deposit-network mismatch, create-pool provisioning (a two-token seed requirement), and the
transaction-deadline gap. These are real and tracked; they are not this epic.

## 4. The architectural decision

A prior internal audit framed bridge execution as a binary: either the backend builds the calldata
(six new `pool-party-api` endpoints: `/bridge/quote`, `/bridge/build`, `/bridge/status`,
`/bridge/chains`, `/route/quote`, `/swap/build`), or we embed a client-side aggregator SDK (which
needs a Content-Security-Policy change and a security review, since `src/lib/security/csp.ts` allowlists
no bridge provider today).

**We took a third option: the Next.js server layer calls the Uniswap Trading API directly from Server
Actions.** `UNISWAP_API_KEY` stays server-only alongside the existing `PP_API_KEY`; the browser only
signs and broadcasts.

- **Zero** new backend endpoints — the entire rail ships from this repository.
- **Zero** CSP changes — nothing is fetched from the client, so `connect-src` is untouched.
- **Matches the codebase's existing and only write pattern**: server builds calldata, client signs
  (`investActions.ts` → `useInvest` → `executeBuiltTransaction`).

Recorded as ADR [`0002`](../adr/0002-uniswap-trading-api-as-the-provisioning-rail.md) and
[`0003`](../adr/0003-server-only-uniswap-key-boundary.md).

### It also closes three recorded defects for free

| Pre-existing defect | The Uniswap capability that answers it |
|---|---|
| `gasEstimateUsd` is fiction before the build: hardcoded `0.5` at `mapManagerStrategyDetail.ts:180`, while the only real figure (`estimatedGasInUsd`) exists *after* the build — but the gate runs *before* it | `/quote` returns gas info **at quote time** |
| No idempotency key on a provisioning step, while `flow.retry()` re-invokes the failed step verbatim (`useWalletSignFlow.ts:350-361`) — so a retry after an ambiguous failure could **double-bridge real money** | A plan is a pure function of current on-chain holdings, so **re-deriving it from fresh balances cannot repeat a settled leg**; a leg journal covers the only remaining gap, a transaction broadcast but not yet reflected in a balance (corrected 2026-07-25, POO-1054) |
| No partial-completion recovery — *"step 2 of 4 fails with the money already spent and the app has no state for it"* | Reconciliation against on-chain receipts and a destination-chain balance delta, from a journal persisted before each broadcast: a resume point that survives a reload and does not depend on a third party being up (corrected 2026-07-25, POO-1054) |

## 5. Architecture

```
Layer 5  UI         FundingSourceSelector · CostBreakdown · PlanCard · /swap screen
Layer 4  Rail       buildPlanSteps() → FlowStep[]  →  useWalletSignFlow
Layer 3  Planner    buildPlan() + gasFeasibility()  →  ProvisioningPlan      [server action]
Layer 2  Inventory  fetchWalletHoldings ∩ /swappable_tokens                  [server]
Layer 1  Actions    "use server" wrappers — the API key never leaves the server
Layer 0  Transport  uniswapFetch — server-only, Zod-validated, bounded retry
```

Endpoint-by-endpoint detail: [`01_UNISWAP_INTEGRATION.md`](01_UNISWAP_INTEGRATION.md).
The cross-chain step machine and its failure modes: [`02_BRIDGE_ARCHITECTURE.md`](02_BRIDGE_ARCHITECTURE.md).

## 6. The gas chicken-and-egg

Before a chain can fund anything, the user must be able to pay for transactions on that chain. This is
where naive integrations break silently, so we model it explicitly:

| Native balance on the source chain | Verdict | Behavior |
|---|---|---|
| ≥ estimated cost of (approval if required + swap + bridge), from `/quote` gas info | **OK** | Selectable as a funding source. |
| Above zero, but short | **TOP-UP** | A `swap-gas` step is prepended on that chain, converting a slice of the held token into native, sized from a live quote with headroom. |
| Exactly zero | **BLOCKED** | No transaction can originate there, full stop. The row is shown greyed **with its reason**, and offers two escapes: bridge a small amount of native in from a chain that does have gas, or buy crypto. |

The BLOCKED case is genuinely unsolvable on that chain alone. Surfacing it — rather than hiding the
row and letting the user wonder where their money went — is a deliberate design choice.

## 7. Delivery phases

| Phase | Issues | Theme |
|---|---|---|
| **P0** | POO-1023 … POO-1026 | Unblock — clear four pre-existing defects that make the rail unreachable |
| **P1** | POO-1027 … POO-1030 | Foundations — transport, schemas, server actions, contract v3 |
| **P2** | POO-1031 … POO-1035 | Planner — inventory, gas feasibility, per-chain model, `buildPlan`, cost model |
| **P3** | POO-1036 … POO-1038 | Execution rail — step mapping, bridge polling, recovery + idempotency |
| **P4** | POO-1039 … POO-1042 | UI — funding selector, cost breakdown, real plan card, live gate |
| **P5** | POO-1043 … POO-1046 | Reach — flagship invest, gas top-up, the other five operations, standalone screen |
| **P6** | POO-1047 … POO-1051 | Hardening — price-impact gate, analytics, i18n, security, docs |
| **P7** | POO-1052, POO-1054 … POO-1056 | Added mid-flight — the vendored skill, the live-API correction, the recovery surface, the deferred journal follow-up |

P7 was not planned. It is what the epic learned while it ran, and [§11](#11-how-the-plan-changed-under-contact-with-the-live-api)
is the explanation.

---

## 8. The issues

Every issue below exists in the tracker with the same title, rules and acceptance criteria. Business
rules are numbered `[R1]…` and each maps to at least one test, per the repository's TDD premise.

### P0 — Unblock

#### POO-1023 · [UF-01] Route ProvisioningPanel and the Wizard through the computePlan seam

Both provisioning render surfaces call `mockComputePlan` directly, bypassing the `computePlan(isMockMode)`
seam. Until this is fixed the real planner can be fully wired and **still never called** — this blocks
every other issue in the epic.

- **[R1]** Neither surface may import `mockComputePlan`; both resolve through the single `computePlan` seam.
- **[R2]** Mock-mode behavior is byte-identical to today — no snapshot, story or test churn.
- **[R3]** `computePlan` is async; neither surface may flash an empty plan card while it resolves.
- **[R4]** The `gasChoice` re-plan path keeps working: a valid explicit choice re-invokes the planner, an empty or invalid Custom does not.
- **[R5]** Both `PP-FIXME` comments are deleted, not reworded.

*Acceptance:* tests green with no snapshot churn; a test asserts `computePlan` is the only plan source.

#### POO-1024 · [UF-02] Split the provisioning module across the server boundary

`planner.ts` currently sits in the **client bundle** — the barrel is imported by `"use client"`
components, so it can never import the `server-only` API client. The real planner needs a secret.

- **[R1]** Types and pure math stay client-importable, and free of viem, React and I/O.
- **[R2]** Anything touching a secret or the network moves behind a `"use server"` action.
- **[R3]** The client barrel must not re-export anything that transitively imports `server-only`.
- **[R4]** `computePlan`'s signature is unchanged — a boundary move, not an API change.
- **[R5]** A server action never throws across the RSC boundary; it returns a typed result.

*Acceptance:* **`pnpm build` passes** — the only gate that catches a `server-only` leak into a client
bundle. Typecheck, lint, test and i18n:check all miss it.

#### POO-1025 · [UF-03] Let the provisioning gate preempt the deposit deep link on invest

The invest USDC branch is **dead code**: `needsDeposit = amount > balance` returns early into the
`/deposit` round-trip *before* the gate is ever consulted. The flagship flow is unreachable until this
early return yields.

- **[R1]** When the wallet is short, the gate evaluates first; a fundable plan enters the provision phase.
- **[R2]** When no fundable plan exists, the deposit deep link remains the fallback, unchanged.
- **[R3]** The deep-link query contract is preserved, so the existing resume path is untouched.
- **[R4]** `strategy_invest_submitted` still fires exactly once, before the branch.
- **[R5]** Cancelling provisioning returns to the amount step, not to `/deposit`.

*Acceptance:* all three branches tested; existing invest happy-path tests untouched.

#### POO-1026 · [UF-04] Add the wrongChain error kind and target-network copy

`WRONG_CHAIN` is thrown by the broadcast choke point but is absent from the error catalog, so a chain
mismatch classifies as `"unknown"` and shows generic "something went wrong" copy. A rail that switches
networks between legs cannot ship with that.

- **[R1]** `TxErrorKind` gains `wrongChain`; `WRONG_CHAIN` maps to it.
- **[R2]** The error carries the **target chain id**, so copy can name the network.
- **[R3]** The chain name derives from `src/lib/chains/config.ts`, never a local literal.
- **[R4]** An unknown chain id degrades to generic copy rather than rendering "Switch to undefined".
- **[R5]** All 11 locales. No em dash.

### P1 — Foundations

#### POO-1027 · [UF-05] Uniswap Trading API server client (`uniswapFetch`)

Server-only transport mirroring the established `apiFetch` pattern. Base
`https://trade-api.gateway.uniswap.org/v1`, auth header `x-api-key`.

- **[R1]** `import "server-only"`. The key is read from a server-only env var — never `NEXT_PUBLIC_`.
- **[R2]** Every response is Zod-validated before reaching a caller.
- **[R3]** Bounded retry on the transient class only (429/502/503/504/408/network), never on 4xx.
- **[R4]** Per-attempt `AbortController` timeout with a cumulative budget bounding all retries.
- **[R5]** Non-2xx produces a typed `UniswapApiError` carrying the upstream code — callers never regex-match strings.
- **[R6]** The key is never logged, never in an error message, never serialized into a return value.

*Acceptance:* stubbed-fetch tests for success, retry-then-success, retry exhaustion, timeout, and a
non-retrying 4xx; a test asserting the key never appears in any thrown or returned value.

#### POO-1028 · [UF-06] Zod schemas for all eight endpoints

- **[R1]** `routing` is a discriminated union over every documented variant (`CLASSIC | WRAP | UNWRAP | BRIDGE | CHAINED | DUTCH_V2 | DUTCH_V3 | PRIORITY`); an unrecognized value fails loudly rather than falling through to the classic path.
- **[R2]** `TransactionRequest.data` must be a **non-empty** hex string — an empty `data` is a schema failure, not a broadcastable transaction.
- **[R3]** Chained quotes always have `permitData: null`; assert it rather than handling a signature that will never come.
- **[R4]** Chained Actions are `EXACT_INPUT` only; the request type rejects `EXACT_OUTPUT` cross-chain.
- **[R5]** Plan steps carry `method` (`SEND_TX | SIGN_MSG | SEND_CALLS`) with the payload narrowed per method.
- **[R6]** Token-native amounts are decimal **strings**; USD figures are display-grade numbers.
- **[R7]** Display-only sub-objects are **tolerant** — a malformed block hides a row rather than rejecting the quote it rides on, mirroring the shipped `swapInfoSchema` precedent.

#### POO-1029 · [UF-07] Uniswap server-action layer

`quoteSwap` · `checkApproval` · `buildSwapTx` · `createPlan` · `advancePlan` · `getPlan` · `listSwappableTokens`.

- **[R1]** The wallet address comes from the **SIWE session**, never from the action body.
- **[R2]** No action throws across the RSC boundary; each returns `{ ok: true, … } | { ok: false, code, message }`.
- **[R3]** `listSwappableTokens` is cache-tagged — it must not re-fetch per keystroke.
- **[R4]** `advancePlan` is **idempotent**: re-submitting a proof for an advanced step is a no-op returning current state. This is what makes retry safe.
- **[R5]** `getPlan` exposes `forceRefresh` but never force-refreshes implicitly.
- **[R6]** Slippage rides through from the settings gear. Bridge legs are Across-quoted and ignore it — do not silently apply it there.

#### POO-1030 · [UF-08] Provisioning contract v3, and retire the mock planner

- **[R1]** Additive optional fields: `planId` (**also the idempotency key**), `stepIndex`, `method`, `payload`, `chainId`, `etaSeconds`.
- **[R2]** Existing fields keep their exact meaning — the view mapper and plan card must render unchanged, with no code edits.
- **[R3]** The money convention is unchanged.
- **[R4]** `mockPlanner.ts` and its test are **deleted**; its scenarios move to test fixtures so the suite still runs offline. *(Amended by POO-1034: the module moved to `fixtures/mockPlan.ts` and kept its suite, rather than being deleted outright. `buildPlan` is `server-only` and `planner.ts` ships to the browser, so mock mode — the repo default, and the only mode that runs without a session or an API key — still needs a client-side fixture. Deleting a suite that covers the default path would have been a coverage regression, not a cleanup.)*
- **[R5]** This also deletes its hardcoded fee model (~1% with a $0.99 floor), which contradicts the deposit screen's own copy (1.49% + $2 minimum). Real quotes become the single source of truth for provisioning fees.
- **[R6]** `@implements-rules-version` goes to v3.

### P2 — Planner

#### POO-1031 · [UF-09] Multi-chain funding inventory

`src/lib/balances/fetchWalletHoldings.ts` is already real, server-only, fans out over every supported
chain, and returns native balances **plus a USD price per network** — which largely closes the
"no native-token price source" gap the code comments still claim.

- **[R1]** The inventory is the intersection of what the wallet holds and what Uniswap can route (`/swappable_tokens`). A token we cannot move is never offered.
- **[R2]** Each entry carries token, chain, native-unit balance (decimal string), USD value, and bridgeability.
- **[R3]** A per-chain read failure is **skipped, not fatal** — funds elsewhere must never be hidden by one bad RPC.
- **[R4]** All chains failing degrades to the USDC-only read rather than showing an empty wallet.
- **[R5]** Sub-$1 dust stays filtered — bridging dust costs more than it moves.
- **[R6]** USD pricing prefers a `/quote` to USDC (the actually-executable price) over an indicative feed.

#### POO-1032 · [UF-10] Gas feasibility classifier per source chain

- **[R1]** Every candidate chain is classified **OK / TOP-UP / BLOCKED** (see §6).
- **[R2]** A BLOCKED chain is shown greyed **with its reason**, never silently omitted — hiding it makes the user's own funds look like they do not exist.
- **[R3]** A BLOCKED chain offers exactly two escapes: bridge native in, or buy crypto.
- **[R4]** Gas estimates come from `/quote`, retiring the hardcoded `0.5` and the `NETWORK_FEE_USD = 0.3` duplicated across five modals.
- **[R5]** The estimate includes headroom — a swap that lands the wallet at exactly zero native strands the user mid-plan.
- **[R6]** Pure function, no I/O: the whole verdict matrix is exhaustively unit-testable.

*Acceptance:* table-driven tests over {zero, short, sufficient} native × {has token, no token} ×
{same-chain, cross-chain}.

#### POO-1033 · [UF-11] Replace the scalar wallet model with a per-chain balance map

The calculator models the wallet as a **single scalar** chain + balance, so it structurally cannot
answer "can this be funded by bridging". Separately, `needsBridge` requires `opRequiredUsdc > 0`, so
withdraw, collect, move-range and close never consider the network branch — even when the only funds
that could buy gas are on another chain.

- **[R1]** The input carries `balancesByChain`, replacing the scalar pair.
- **[R2]** `needsBridge` no longer requires `opRequiredUsdc > 0`: it is true when the requirement (USDC **or gas**) cannot be met on the target chain but can be met from another.
- **[R3]** The `none | gas-only | multi` routing verdict is preserved exactly, so the six modals are unchanged.
- **[R4]** Gas sourceable on-chain still routes to `gas-only`; it escalates to `multi` only when gas must come from another chain.
- **[R5]** Still pure number-math.

#### POO-1034 · [UF-12] Real provisioning planner (`buildPlan`)

The engine. Replaces the `throw` at `planner.ts:29`.

> **Rules v1, restated after POO-1054.** The rules originally written here assumed Chained Actions:
> `[R1]` routed cross-chain through `POST /plan`, and `[R6]` required every step to carry a `planId`
> and a `stepIndex`. The live probe established that `routing: "CHAINED"` is never returned to us, so
> `/plan` is unreachable and neither rule can be satisfied by any real route. They are replaced below
> rather than quietly reinterpreted. See [`02_BRIDGE_ARCHITECTURE.md`](02_BRIDGE_ARCHITECTURE.md) §1.

- **[R1]** A requirement decomposes into ordered legs of **supported routes only**. Same-chain
  different-token is one `CLASSIC` swap; cross-chain same-token is one `BRIDGE` leg; cross-chain
  different-token is **not routable** (`404`) and becomes swap-to-the-source-chain's-USDC then bridge.
  The flagship WETH (Polygon) → USDC (Arbitrum) is therefore two legs, and the single cross-chain
  different-asset quote is never requested.
- **[R2]** Steps are ordered and only-what-is-needed; the last step is always the `op` anchor.
- **[R3]** A BLOCKED chain is never planned from; a TOP-UP chain gets its gas step first.
- **[R4]** Selection order is route order — what the user chose is what executes.
- **[R5]** `gasEstimateUsd` comes from the quote, not a constant.
- **[R6]** *(replaces the `planId` / `stepIndex` rule)* Fix the real defect the retired design left
  behind: `quoteRequestSchema` rejects a cross-chain `EXACT_OUTPUT`, which the live API answers `200`
  to. Provisioning is exact-output shaped, so the guard blocks the natural way to size a route.
- **[R7]** The quote's real TTL is honored, not the mock's hardcoded 60 s.
- **[R8]** Each leg is quoted **at execution time** from the balance the previous leg actually
  produced, never pre-committed from an estimate.
- **[R9]** *(was R8)* Runs server-side behind the UF-02 boundary.

*Retires:* `mockPlanner.ts` stops being the planner. It moves to `fixtures/mockPlan.ts` and keeps
backing mock mode, because `buildPlan` is `server-only` and `planner.ts` ships to the browser: mock
mode must stay offline, key-free and session-free.

#### POO-1035 · [UF-13] Cost breakdown model

`ProvisioningQuote` is computed today and **rendered nowhere**, so the entire re-quote and TTL loop is
unimplemented. This gives it real numbers.

- **[R1]** Aggregates, per source and in total: swap fee, bridge fee, per-step gas, price impact, slippage allowance.
- **[R2]** `totalPayUsd = shortfallUsd + bufferUsd + feesUsd` — the contract's own definition.
- **[R3]** Bridge fees come from the chained quote; slippage does **not** apply to a bridge leg and must not be presented as if it does.
- **[R4]** `SIGN_MSG` steps incur no gas and contribute zero to the gas line.
- **[R5]** The bridge fee is threaded so the canonical fee tooltip's Bridge line finally shows a number instead of its "Coming soon" placeholder — no production caller has ever set `crossChain: true`.
- **[R6]** No float money math where precision matters.

### P3 — Execution rail

#### POO-1036 · [UF-14] `buildPlanSteps` — map a Uniswap plan onto the FlowStep rail

The seam the whole epic converges on. `useWalletSignFlow` already provides ordered execution, per-step
status and hashes, resume-from-failed-step retry, and `{ skipped: true }` no-ops. Uniswap plan steps
map 1:1 onto its `FlowStep`.

- **[R1]** `SEND_TX` executes through `executeBuiltTransaction`, so every leg inherits the shipped chain assertion (with one corrective switch and a re-verify) and the account assertion. **Cross-chain chain-switching is therefore free and centrally enforced.**
- **[R2]** `SIGN_MSG` signs EIP-712 typed data with **all uints as decimal strings, never native bigint** — Privy embedded (social-login) wallets `JSON.stringify` typed data, which throws on bigint. A shipped, twice-learned defect.
- **[R3]** After each step settles, its proof is submitted via `PATCH /plan/:planId` before the next runs.
- **[R4]** `/check_approval` returning no calldata means the allowance already covers it: emit `{ skipped: true }`.
- **[R5]** `TransactionRequest.data` is asserted non-empty before broadcast.
- **[R6]** A step's `run()` must not mutate the accumulating context.
- **[R7]** `SEND_CALLS` (EIP-5792) is out of scope; encountering one fails with a typed, legible error rather than silently skipping a step.

*Acceptance:* includes a test that JSON-stringifies every typed-data payload and asserts no bigint survives.

#### POO-1037 · [UF-15] Bridge settlement polling and long-running step UX

Bridge steps take **minutes**; the current panel assumes ~900 ms per step.

- **[R1]** A bridge step polls `GET /plan/:planId` with backoff. A plain `GET` re-quotes remaining steps when the active step is in progress, so poll deliberately, not in a tight loop.
- **[R2]** The step shows an ETA and per-leg explorer links, so the user can independently verify the money is moving.
- **[R3]** Polling is bounded; at the ceiling it degrades to "still settling, we'll update you" with the plan recoverable. It never spins forever and never fakes success.
- **[R4]** A transient poll failure is non-fatal — the last known state stands and the next window retries.
- **[R5]** The dismissal lock holds for the whole wait.

#### POO-1038 · [UF-16] Recovery and idempotency — never double-bridge, always resume

**The highest-risk issue in the epic.** A provisioning step carries no idempotency key today, while
`flow.retry()` re-invokes the failed step verbatim — so a retry after an ambiguous failure could
double-bridge real money.

- **[R1]** `planId` + `stepIndex` are the idempotency key. A step is never re-executed on-chain if the server already holds a proof for it.
- **[R2]** Before any retry, the rail re-reads `GET /plan/:planId` and resumes from the server's `currentStepIndex` — **never** from the client's local belief about where it failed.
- **[R3]** An ambiguous failure (broadcast sent, receipt unknown) resolves by reading plan state, never by re-broadcasting.
- **[R4]** A reload or killed tab mid-bridge recovers and continues from `currentStepIndex`.
- **[R5]** An expired quote re-quotes and re-renders the cost breakdown **before** the user is asked to sign again — a user never signs a materially different price than the one they approved.
- **[R6]** A partially-completed plan is never silently abandoned.

### P4 — UI

#### POO-1039 · [UF-17] FundingSourceSelector — choose what to spend, not what to bridge

- **[R1]** Multi-select, with a running total against what the operation needs and the remaining shortfall always visible.
- **[R2]** Every row carries its gas verdict badge; a blocked row is visible and explained.
- **[R3]** A blocked row cannot be selected, and says what would unblock it.
- **[R4]** Selection order is route order — what the user sees is what executes.
- **[R5]** The CTA is disabled until the total covers the requirement including fees and buffer.
- **[R6]** Sub-$1 dust stays filtered.
- **[R7]** All copy through `useTranslations`, 11 locales, keyboard-navigable and screen-reader-labelled.

#### POO-1040 · [UF-18] ProvisioningCostBreakdown and the buy-crypto alternative

- **[R1]** Shows, per source and in aggregate: swap fee, bridge fee, per-step gas, price impact, slippage allowance, and "You pay".
- **[R2]** "You pay" is the contract's own `shortfall + buffer + fees`, not a re-derivation.
- **[R3]** A **"Buy crypto instead"** CTA sits alongside as a peer option, linking to the existing `/deposit` surface. This epic writes **no fiat on-ramp code**; the CTA is a handoff, not an integration.
- **[R4]** The quote TTL is surfaced; on expiry the breakdown re-quotes and visibly updates before the user commits.
- **[R5]** Fee figures come from real quotes only — no hardcoded fee model is reintroduced.
- **[R6]** Follows the established collapsed-detail Review convention.
- **[R7]** 11 locales, no em dash.

#### POO-1041 · [UF-19] ProvisioningPlanCard real-step rendering

- **[R1]** Per-step status comes from the rail, in the vocabulary the step component already consumes.
- **[R2]** A bridge row shows its ETA and, once broadcast, per-leg explorer links. The current "bridge rows show no amount" rule is superseded — with a real quote there is a real figure.
- **[R3]** Network names derive from `src/lib/chains/config.ts`, replacing a local literal map (there are three copies of this list in the codebase today).
- **[R4]** Explorer URLs come from the shared helper; a missing network or hash renders **no link**, never a home-page URL.
- **[R5]** The view mapper stays pure — keys and interpolation values only.

#### POO-1042 · [UF-20] Wire the provisioning gate for real

- **[R1]** `realProvisioningInput` assembles from the live inventory.
- **[R2]** The operation's target chain comes from the strategy. Move-range and close currently pass no strategy argument at all — that context must now be threaded.
- **[R3]** `opRequiredUsdc` is the entered amount for invest, zero for operations that spend no USDC.
- **[R4]** `gasEstimateUsd` is real, never the hardcoded `0.5`.
- **[R5]** The `provisioning` flag's baseline becomes a flat boolean instead of the computed `NODE_ENV === "development"`, so production behavior no longer depends on `NODE_ENV`. It ships **off**.
- **[R6]** A balance-read failure fails **safe**: the gate does not trigger and the operation proceeds exactly as today. A degraded read must never block a user who is actually funded.

### P5 — Reach

#### POO-1043 · [UF-21] Any-token, any-chain invest (flagship)

Investor holds WETH on Polygon; the strategy is USDC on Arbitrum; one flow swaps, bridges and invests.

- **[R1]** After provisioning, the original invest resumes **with its original parameters**.
- **[R2]** The invest itself remains a fresh, user-signed transaction — provisioning makes it possible, it never pre-authorizes the operation.
- **[R3]** Permit2 is still sized against the balance **on the target chain after provisioning settles**, never against a cross-chain total. This is the constraint that caused the single-chain design and must not regress.
- **[R4]** A provisioning wait that outlives the built transaction's freshness window forces a rebuild before any send — a bridge can easily outlast it.
- **[R5]** Post-write refresh runs on completion so balances and positions reflect reality immediately.
- **[R6]** Cancelling mid-provisioning preserves the entered amount.

#### POO-1044 · [UF-22] Gas top-up via swap-to-native across all six operations

- **[R1]** Gas-only shortfall with a swappable token on that chain → one `swap-gas` step, then the operation proceeds.
- **[R2]** The swap is sized to the gas requirement plus headroom, never the whole balance.
- **[R3]** Exactly-zero native is UF-10's BLOCKED verdict: gas must come cross-chain, or the alternative is offered. Never present an impossible plan.
- **[R4]** Applies to all six operations — five of them spend no USDC but all of them need gas.
- **[R5]** The gas step's "Powered by Paybis" copy is corrected: the implemented step is a **swap**. All 11 locales.
- **[R6]** The existing gas selector bounds and presets are preserved.

#### POO-1045 · [UF-23] Roll the rail out to the other five operations

- **[R1]** Withdraw, collect, move-range and close resume via `resume()` — their transaction is already built when the gate fires. Compound and invest use `run()`.
- **[R2]** **Ordering hazard:** for these operations provisioning runs *after* the build, so a multi-minute bridge can outlive the freshness window and force a rebuild mid-flight. This path is untested today and must be covered here.
- **[R3]** The manager/managed collect path is silently exempt today; either gate it or document the exemption. No silent gaps.
- **[R4]** Each operation's label and cancel destination are preserved.
- **[R5]** The dismissal lock holds during provisioning for every operation.

#### POO-1046 · [UF-24] Standalone swap and bridge screen

The wallet modal shows USDC split across three chains and offers **no action on any row**. This adds
the surface, reusing the entire rail.

- **[R1]** Behind a new `swapScreen` feature flag, dark-launched off by default.
- **[R2]** Same-chain swap and cross-chain bridge are one unified flow; routing is resolved by Uniswap, not by the UI.
- **[R3]** Reuses `buildPlanSteps`, the cost breakdown and the price-impact gate — no parallel execution path.
- **[R4]** With the flag on, the wallet modal's Swap action routes here and loses its "coming soon" hint; with it off, the modal is exactly as today.
- **[R5]** Route `/[locale]/swap`, following the page blueprint.

### P6 — Hardening

#### POO-1047 · [UF-25] Apply the price-impact gate to provisioning swaps

A funding route is a swap like any other, and a poisoned thin-pool route must not be able to enter
through the funding path — which is precisely how an earlier incident turned $40 into $3.

- **[R1]** Every provisioning swap leg is subject to the same ≥10% acknowledgement gate.
- **[R2]** Existing worsen-reset semantics apply unchanged.
- **[R3]** A missing or malformed impact figure means **no gate** — it must not fail closed and block a legitimate route.
- **[R4]** The gate is per-plan, not per-step: the user acknowledges the route they are approving.
- **[R5]** Bridge legs carry no AMM price impact and are excluded, rather than treated as 0% and silently passing.

#### POO-1048 · [UF-26] Analytics for the funding funnel

- **[R1]** Typed events: gate triggered, sources listed, sources selected, plan quoted, plan started, per-step settled, plan completed, plan failed, plan abandoned.
- **[R2]** Events carry route shape, step count and USD magnitude — never a raw wallet address.
- **[R3]** A completion event fires on **real settlement**, never optimistically on a click. There is a live bug elsewhere in the codebase where a completion event fires synchronously on the confirm click, inflating conversions with intent instead of revenue; this epic must not repeat it.
- **[R4]** A failure event fires on every terminal failure — a declared-but-never-fired event is worse than none.
- **[R5]** Events land in `docs/ANALYTICS_EVENTS.md` in the same PR.

#### POO-1049 · [UF-27] i18n for every new surface, 11 locales

- **[R1]** All new copy ships in all 11 locales in the same PR.
- **[R2]** **No em dash in any locale value** — the check fails the build on one.
- **[R3]** The investor app abstracts crypto jargon: prefer "move your funds to Arbitrum" over "bridge", and keep precise DeFi terms for the Manager Console.
- **[R4]** Blocked-state and failure copy must be **actionable** — say what the user can do.
- **[R5]** Machine-translated locales carry `PP-I18N` on any suspect DeFi rendering.

#### POO-1050 · [UF-28] Security review of the funding rail

- **[R1]** `UNISWAP_API_KEY` is server-only; a build-output grep must prove it never reaches a client bundle. **The highest-severity check in the epic.**
- **[R2]** No CSP change is required or made — a PR that needs one has violated R1 and must be re-reviewed.
- **[R3]** Approvals are sized to the plan, never unbounded, with the reasoning documented at the call site.
- **[R4]** The signing surface is reviewed for clear-vs-blind signing: a Permit2 signature in a funding plan is a money-moving authorization and the user must be able to tell what it authorizes.
- **[R5]** Every server action derives the wallet from the session, never from a client-supplied address.
- **[R6]** Provider responses are untrusted input: Zod-validated before they can influence a transaction.
- **[R7]** No secret, signature or raw address is ever logged.

#### POO-1051 · [UF-29] Documentation, ADRs and registry sync

- **[R1]** `docs/_hackathon/` carries the four documents (this plan, the integration reference, the bridge architecture, the continuity delimitation).
- **[R2]** The continuity document is file-level and honest; every new artifact carries a `@hackathon` header tag.
- **[R3]** Two immutable numbered ADRs.
- **[R4]** `IDS_REGISTRY`, `INTEGRATION_POINTS`, `ARCHITECTURE_STATE` and `FEATURE_FLAGS` are updated. Provisioning has **no rows at all** in the integration docs today.
- **[R5]** The merge-not-squash exception is recorded here, with its reason.
- **[R6]** Every new `PP-INTEGRATION-POINT` is listed.

### P7 — Added mid-flight

Four issues that did not exist when the epic was planned. They are listed last because that is when
they were filed, not because they matter least: POO-1054 changed the architecture.

#### POO-1052 · [UF-30] Vendor the official Uniswap swap-integration skill, pinned and scope-fenced

Uniswap ships eleven official Agent Skills. All were reviewed; exactly one is on-point, and it earns
its place on hard-won detail we would otherwise have learned from failed transactions. It corrected
one of our own draft rules before a line was written: the API **rejects** `permitData: null`, so it
must be stripped from the spread and re-attached explicitly, and the rules differ per routing type.

- **[R1]** Vendored, not installed: pinned at `Uniswap/uniswap-ai@3ddd8a9d`, `LICENSE.upstream` kept verbatim, a provenance block in the header listing every local edit.
- **[R2]** Exactly two local edits, both recorded: drop the `swap-integration-expert` subagent from `allowed-tools` (it ships with the upstream plugin and does not exist here), and add the provenance block.
- **[R3]** **Scope-fenced.** It covers same-chain swapping. For anything cross-chain the authority is `02_BRIDGE_ARCHITECTURE.md`.
- **[R4]** **House skills win on conflict.** Its React examples call the Trading API from the client; here the key is server-only (ADR 0003).
- **[R5]** `.claude/skills/INDEX.md` gains a "Vendored (third-party)" section, so a contributor can tell a carried skill from a house one and knows how to refresh it.

#### POO-1054 · [UF-31] Correct the cross-chain architecture against the live Trading API

**Live-API verification contradicted our docs. Correct them before the rail is built on a fiction.**
The probe table and its reproduction are [`01_UNISWAP_INTEGRATION.md` §1](01_UNISWAP_INTEGRATION.md#1-probe-evidence);
the two load-bearing findings are that cross-chain **different-token** is not routable in one call
(`404`), and that `routing: "CHAINED"` is never returned, which makes `/plan` unreachable.

- **[R1]** `01_UNISWAP_INTEGRATION.md` and `02_BRIDGE_ARCHITECTURE.md` describe the API as it actually behaves. Keep the Chained Actions material, clearly marked documented-but-unavailable, with the evidence. These docs are the submission's technical narrative; a confident description of a mechanism we never used would be the worst kind of inaccuracy.
- **[R2]** ADR 0002 gains an addendum recording that live evidence forced decomposition into our planner. The decision is not reversed, only its mechanism.
- **[R3]** The now-dead plan actions are removed. Prefer removal: dead code that cannot work is worse than absent code.
- **[R4]** Contract v3's `planId` / `stepIndex` / `method` were modelled on the Uniswap plan. Keep what the leg-based design genuinely needs, drop the rest, say why in the header.
- **[R5]** A regression test pins the decomposition rule: a cross-chain different-token requirement produces ≥ 2 legs, never a single cross-chain quote.

*Acceptance:* no document describes `/plan` as the mechanism we use; an evaluator can reproduce the
probe from the table; the commit history shows a deliberate course correction, not a silent retcon.

#### POO-1055 · [UF-32] Mount the recovery surface: read the journal, not just write it

**The epic was shipping a recovery journal that nothing read.** POO-1038 built the reconciler and the
finder; POO-1043 bound the writer. Neither reader had a non-production caller, so a user whose tab
died mid-bridge had a correct, durable record and no surface that ever showed it to them. That is the
difference between designing for recovery and recovering.

- **[R1]** Mount `findResumableJournal` on session entry, and surface an in-flight route with enough detail to be actionable: which operation, which leg, how far it got.
- **[R2]** Mount `reconcileFundingJournal`, so the §3.5 decision table actually runs. An ambiguous broadcast resolves by reading chain state, never by re-broadcasting.
- **[R3]** Fix the gap POO-1043 disclosed: a leg that never reached `beginLeg` has no `nonceBefore`, and reconciliation was reading that as ambiguous. A leg the wallet was never asked about cannot have broadcast anything, so it is safe, not unknown.
- **[R4]** Resuming never re-broadcasts a settled leg. Prove it with a test.
- **[R5]** A journal stale beyond its lifecycle window is cleaned up rather than nagging forever.

#### POO-1056 · [UF-33] Journal lifecycle: surface a reverted route, and settle the amount question

**Filed, not built.** Two gaps POO-1055's implementation disclosed, left open deliberately rather than
fixed quietly inside another issue's rules version. This is the one issue of the epic that ships
unimplemented, and it is listed here for that reason.

- **[R1]** A route whose **last** leg reverts ends all-terminal, and `isRetired` prunes it on the next read, so it is corrected and then vanishes before the banner can say it reverted. Nothing is stranded (re-opening the operation re-derives from real balances) and the common mid-route revert *is* surfaced, because later legs stay `planned` and keep the record alive. But the user whose final leg failed is simply not told. Fixing it changes POO-1038's terminal-status lifecycle, which deserves its own rules version.
- **[R2]** §3.9 says an ambiguous leg should show "the intended amount", and the journal cannot render one: it stores base units against token addresses, with no decimals anywhere. `3000000000` is worse than nothing and inferring decimals would be a guess about money. Either the journal schema gains `tokenOutDecimals` (a v2 key, per §3.7's versioning rule) or the document drops the claim. Decide, and make the doc and the code agree.

Also folded in: approvals are not journaled at all, which is POO-1038's explicit choice and safe in
practice (re-approving the same amount costs gas, not funds), and the journal is per-browser
`localStorage`, which POO-1055 made user-visible and therefore raised the stakes on.

---

## 9. Working agreement

- **One issue → one worktree → one branch → one PR.** Branches follow the repository convention
  `<type>/<area>-poo-<num>-<slug>`. Work never happens on `main`.
- **Commits are small and frequent.** TDD means a failing-test commit, then the implementation commit,
  then docs. Commit subject: `<type>(<artifact-id>): <description> [rules-vN]`.
- **Merge commits, not squash — a deliberate exception for this epic.** The repository's standing
  convention is squash-merge, which collapses each branch into a single commit on `main`. That would
  erase exactly the progression the hackathon asks reviewers to inspect. Every PR in this epic is
  merged with `--merge`, never `--squash`. All non-hackathon work keeps squash-merging.
- **Gates before every PR:** `pnpm typecheck && pnpm lint && pnpm test && pnpm i18n:check`, plus
  `pnpm build` for anything touching the server/client boundary — that is the only gate which catches
  a `server-only` module leaking into a client bundle. Anything touching the Uniswap layer also runs
  `pnpm secrets:check` **after** that build (POO-1050 [R1]): it greps the build output for the value
  of every server-only secret and for any `NEXT_PUBLIC_` twin of one, which is the single failure the
  other five gates all pass straight through.
- Every seam carries `// PP-INTEGRATION-POINT: <description>`; every new file carries the standard
  header with `@implements-rules-version` and a `@hackathon` tag.

## 10. Verification

1. **Unit / TDD.** Planner, gas classifier, cost model and step mapper are pure or injectable; each
   business rule maps to at least one test. Recorded fixtures keep the suite offline.
2. **Read-only live.** With the key set, exercise `/quote`, `/check_approval` and `/swappable_tokens`
   against real pairs on all three chains and assert every schema parses live responses. No signing.
3. **Same-chain live.** A small swap-to-native on Base through the real rail: confirm the mined hash,
   the per-step statuses, and that the original operation resumes with its original parameters.
4. **Cross-chain live.** The flagship: fund an Arbitrum strategy from a Polygon token. Verify the
   decomposed route advances approval → source swap → bridge approval → bridge, that each leg is
   re-quoted from the balance the previous one actually produced, that chain switching happens between
   legs, and that arrival is detected on the destination chain rather than assumed from the source
   receipt.
5. **Failure paths.** Reject a signature mid-route; let a quote expire; force a BLOCKED gas chain; kill
   the tab mid-bridge and reload. Each must produce a legible, recoverable state — the reload case is
   the partial-completion regression test and must reconcile the leg journal against on-chain state
   (`02_BRIDGE_ARCHITECTURE.md` §3.5) without re-broadcasting anything.

---

## 11. How the plan changed under contact with the live API

The epic opened with 29 issues and finished with 33. The four additions are not scope creep; three of
them are the plan being wrong and finding out. This section is here because the finding-out is the
part worth reading.

### The correction that mattered (POO-1054)

The plan above was written from Uniswap's public documentation, before we held a key. It committed the
whole cross-chain design to **Chained Actions**: `POST /plan` for a server-held route, `PATCH /plan/:id`
to advance a step with its proof, `GET /plan/:id` to poll and recover. Two safety properties were
borrowed from it, and both were load-bearing: `planId` was the idempotency key that made retry safe,
and `currentStepIndex` was the resume point after an interruption.

On 2026-07-25, with the key in hand, the API was probed read-only. Two of its answers invalidated that
design:

| What we assumed | What the live API does |
|---|---|
| A cross-chain different-token pair quotes in one call | `404 ResourceNotFound`. It is the flagship demo case |
| `routing: "CHAINED"` is obtainable, so `/plan` is reachable | `CHAINED` is never returned on any pair we can fund from. `/plan` takes a chained quote as its body, so all three endpoints are unreachable for our key |

The full table and a reproducible `curl` are [`01_UNISWAP_INTEGRATION.md` §1](01_UNISWAP_INTEGRATION.md#1-probe-evidence).
Corroboration arrived from an independent direction: Uniswap's own vendored skill does not use Chained
Actions either. It decomposes into swap-then-bridge, and records that a direct cross-chain swap
returns "No quotes available".

**What survived, and what moved.** The decision in ADR 0002 was not reversed: the Trading API is still
the rail, every call is still server-side, and cross-chain still works, because a same-token pair
quotes as `routing: "BRIDGE"` and settles through `POST /swap` like any other swap. What moved is
*where the multi-step logic lives* — into our planner, which decomposes `WETH(Polygon) → USDC(Arbitrum)`
into a `CLASSIC` swap on Polygon and a `BRIDGE` leg to Arbitrum. Both legs are routes the API actually
serves. The verified route, with its real numbers, is
[`02_BRIDGE_ARCHITECTURE.md` §1.6](02_BRIDGE_ARCHITECTURE.md#16-the-verified-flagship-route-live-2026-07-25).

**What had to be replaced.** The two borrowed safety properties. That is the consequential part, and
it turned out better than what it replaced. A plan is a pure function of current on-chain holdings, so
re-deriving it from fresh balances *cannot* repeat a settled leg — the leg already changed the input
the derivation reads. That closes the settled case completely, without a third party. The only
remaining gap is a transaction broadcast but not yet reflected in a balance, and a client-persisted
leg journal reconciled against on-chain receipts covers exactly that gap and nothing else. Depending
on a vendor for a property we can establish ourselves, from the chain, was never the better design;
we would just not have questioned it.

### The rules that changed with it

Four issues went to `rules:v2` after the probe, and their amendments are recorded in the artifacts
they govern rather than being retro-edited into §8 above:

| Issue | What the live API forced |
|---|---|
| POO-1028 (UF-06) | The plan schemas stay, under an `UNREACHABLE` block comment; `stepMethodSchema` survives as the wire contract `ProvisioningStep.method` is typed off. `quoteRequestSchema` had rejected a cross-chain `EXACT_OUTPUT` the live API answers `200` to, and provisioning is exact-output shaped |
| POO-1029 (UF-07) | `createPlan` / `advancePlan` / `getPlan` deleted. `advancePlan`'s idempotency rule (R4) went with them, which is what made a replacement necessary rather than optional |
| POO-1037 (UF-15) | Bridge progress cannot be polled from `GET /plan/:id`. Settlement is now a destination-chain balance delta against a baseline recorded before the broadcast, which is a stronger test anyway: a source receipt only proves the funds left |
| POO-1039 (UF-17) | The selector's gas verdicts size against the **whole route's** gas, because a decomposed route pays on the source chain twice |

**Known drift, disclosed rather than papered over.** Those four carry a `rules:v2` label whose
amendment history was never appended to the issue body, and two of their artifacts still read
`@implements-rules-version: v1` (`awaitBridgeSettlement.ts`, `FundingSourceSelector.tsx`) while
`schemas.ts` reads `v3` because two later issues also amended it. The repository's convention wants
those four places in sync. They are not, and this sentence is the record of it.

### The other three additions

- **POO-1052 (UF-30), the vendored skill.** Uniswap's official `swap-integration` skill was found and
  vendored after the plan was written. It corrected a draft rule before any code was written (the API
  rejects `permitData: null`), and it later corroborated the probe independently.
- **POO-1055 (UF-32), the recovery surface.** A `git grep` during the security review found that
  POO-1038's reconciler and finder had no non-test caller. The record was real; the resume was not.
  This is the failure mode a plan cannot catch — every issue was Done and the capability did not
  exist — and it is why "is anything actually calling this?" is worth asking on the way out.
- **POO-1056 (UF-33), deferred on purpose.** Two lifecycle gaps POO-1055 disclosed. Both need a change
  to POO-1038's terminal-status lifecycle or to the journal's stored shape, and both were left as a
  filed issue with rules rather than folded quietly into a neighbouring PR. It is the one issue in the
  epic that ships unimplemented, and saying so is cheaper than being caught not saying so.

### What did not change

Worth stating, because a correction notice can read louder than it should. The architecture in §4
stands: zero new backend endpoints, zero CSP changes, the server builds calldata and the client signs.
Every issue from P0 through P6 shipped against the rules written for it, except where the four
amendments above say otherwise. The epic's estimate was wrong about a mechanism, not about a design.
