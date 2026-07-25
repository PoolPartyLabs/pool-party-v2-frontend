# Cross-chain bridge architecture

**How Pool Party moves a user's funds between chains to make an operation possible.**
Companion to [`00_IMPLEMENTATION_PLAN.md`](00_IMPLEMENTATION_PLAN.md) and
[`01_UNISWAP_INTEGRATION.md`](01_UNISWAP_INTEGRATION.md).

> This document is the **authority for everything cross-chain**. The vendored
> `.claude/skills/swap-integration/` skill (Uniswap's official skill, MIT) covers same-chain swapping
> only and says nothing about Chained Actions. Where the two could be read as overlapping, this file wins.

---

## 1. The mechanism: Uniswap Chained Actions

A cross-chain funding route is not one transaction. It is an ordered plan of two to four steps that
run on **two different chains**, with a bridge in the middle that takes minutes to settle.

Uniswap models this as a server-held plan:

```
POST   /quote          routing: "CHAINED"    → price the whole route
POST   /plan           { routing, quote }    → planId, currentStepIndex, steps[]
PATCH  /plan/:planId   { stepIndex, proof }  → advance one step with its proof
GET    /plan/:planId   [?forceRefresh=true]  → poll state / re-quote remaining steps
```

Bridge legs are quoted through **Across Protocol** and fully abstracted by the API — we never talk to
Across directly, and we never pick a bridge provider.

### A typical route

Investor holds WETH on Polygon. Strategy is USDC on Arbitrum.

```
step 0   SEND_TX    Polygon    approve WETH → Permit2          (omitted if allowance suffices)
step 1   SEND_TX    Polygon    swap WETH → USDC
step 2   SEND_TX    Polygon    bridge USDC → Arbitrum          ← minutes
step 3   SEND_TX    Arbitrum   (destination swap, if needed)
─────────────────────────────────────────────────────────────
         the original invest then runs, unchanged
```

### Step methods

| `method` | Payload | What we do |
|---|---|---|
| `SEND_TX` | `TX` | Broadcast via `executeBuiltTransaction`; proof is the `txHash` |
| `SIGN_MSG` | `EIP_712` | Sign typed data; proof is the `signature`. **No gas.** |
| `SEND_CALLS` | `EIP_5792` | **Out of scope for v1** — fails with a typed, legible error rather than silently skipping a step |

### Constraints, from the API docs, enforced as invariants

- **`EXACT_INPUT` only.** Chained Actions do not support exact-output. The request type rejects it
  cross-chain, so this cannot be discovered at runtime.
- **`permitData` is always `null` on a chained quote.** Asserted rather than optionally handled — and
  never forwarded, since the API rejects an explicit `null` (see `01_UNISWAP_INTEGRATION.md`).
- **`slippageTolerance` does not apply to a bridge leg.** Across quotes it. Presenting a slippage
  allowance over a bridge leg would be a lie in the cost breakdown, so bridge legs are excluded from
  that line (UF-13 R3).
- **`SIGN_MSG` steps incur no gas** and contribute zero to the gas estimate.
- **A plain `GET /plan/:id` re-quotes the remaining steps** when the active step is in progress — it is
  not a free read. Poll deliberately with backoff, never in a tight loop.

---

## 2. Mapping onto the existing rail

The critical insight: **we did not build an execution engine.** This repository already has one.

`src/features/strategies/hooks/useWalletSignFlow.ts` runs an ordered list of awaitable steps and
gives, out of the box: per-step status (`idle | active | done | error | skipped`), per-step
transaction hashes, resume-from-failed-step retry, `retryFrom(key)` for targeted re-runs, a
pause-for-review handshake, and a stale-build ceiling. A Uniswap plan step maps **1:1** onto its
`FlowStep`.

```
Uniswap plan step  ──buildPlanSteps()──►  FlowStep { key, run(ctx) }  ──►  useWalletSignFlow
```

`buildPlanSteps` (UF-14) is the whole adapter, and `ProvisioningPanel` already declares the prop for
it — `buildPlanSteps?: (plan) => FlowStep[]` — typed since the epic was designed and, until now,
passed by no production caller.

Each `run()`:

1. executes the step (broadcast or sign),
2. validates before broadcasting (`data` non-empty hex, valid addresses, `value` present),
3. submits its proof via `PATCH /plan/:planId`,
4. returns `{ txHash }` so the rail records it and renders the explorer link.

### Chain switching is free

Every `SEND_TX` goes through `executeBuiltTransaction`, which is this codebase's **single broadcast
choke point** (`src/lib/tx/sendTransaction.ts`). Before every send it reads the wallet's actual chain
and, on mismatch, attempts one corrective `wallet_switchEthereumChain`, re-verifies, and otherwise
fails typed with `WRONG_CHAIN`. It also asserts the active account against the account the transaction
was built for (`WRONG_ACCOUNT`).

That existed because `eth_sendTransaction` carries no chain id and a wallet always broadcasts on its
current chain. It was written for single-chain operations — but it is exactly what a multi-chain plan
needs, so **step 2 on Polygon followed by step 3 on Arbitrum switches networks correctly without a
single line of new switching logic.** We only had to make `WRONG_CHAIN` legible to users (UF-04),
because it was thrown but absent from the error catalog.

---

## 3. Failure modes

This is where a bridge integration is won or lost. Every mode below has a defined behavior and a test.

### 3.1 Partial completion — the money is already moving

**The scenario:** step 2 of 4 fails. The swap happened. The bridge did not. The user's funds are now
mid-route, in a token and on a chain they did not start with.

This was the single largest gap in the pre-existing design: a provisioning step carried **no
idempotency key**, while `flow.retry()` re-invokes the failed step verbatim. A retry after an
ambiguous failure could therefore **bridge twice**.

**The resolution:** `planId` **is** the idempotency key.

- A step is never re-executed on-chain if the server already holds a proof for it.
- Before any retry, the rail re-reads `GET /plan/:planId` and resumes from the server's
  `currentStepIndex` — **never** from the client's local belief about where it failed.
- `PATCH` with a proof for an already-advanced step is a no-op returning current state, not an error.

The authority on "what has happened" is the server-held plan, not client memory. That is what makes
retry safe.

### 3.2 Ambiguous broadcast — sent, receipt unknown

The transaction was submitted; the receipt never arrived (timeout, RPC drop, tab closed).

**Never re-broadcast to find out.** Resolve by reading plan state. A re-broadcast is how a user pays
twice.

### 3.3 Reload or killed tab mid-bridge

A bridge takes minutes; users close tabs. Because plan state lives server-side, the plan is re-fetched
and execution continues from `currentStepIndex`. This is the explicit regression test for UF-16 R4.

### 3.4 Expired quote

Quotes have a TTL and bridges are slow, so expiry mid-plan is normal, not exceptional.

Re-quote via `?forceRefresh=true`, **re-render the cost breakdown, and re-prompt.** A user must never
sign a materially different price than the one they approved. Silently signing a refreshed quote is
the failure mode that turns a good integration into a support incident.

### 3.5 Stale build on the deferred operations

Withdraw, collect, move-range and close build their transaction **before** the provisioning gate fires
(the build-then-review handshake), then `resume()` afterwards. A multi-minute bridge can easily
outlive `MAX_BUILT_TX_AGE_MS` (4 minutes, against the server's 5-minute Permit2 `sigDeadline`).

The rail already refuses to send a stale build and rebuilds first. That path exists but has never been
exercised with a minutes-long pause in the middle, so UF-23 R2 covers it explicitly.

### 3.6 The gas chicken-and-egg

A chain with **zero native balance can originate no transaction at all.** Not the approval, not the
swap, not the bridge. Funds there are unreachable from that chain.

Every candidate source chain is classified before it can be selected:

| Native balance | Verdict | Behavior |
|---|---|---|
| ≥ estimated (approval + swap + bridge) cost | **OK** | Selectable |
| Above zero but short | **TOP-UP** | Prepend a `swap-gas` step on that chain, sized from a live quote with headroom |
| Exactly zero | **BLOCKED** | Cannot originate. Shown greyed **with its reason**, offering: bridge native in from a chain that has gas, or buy crypto |

Two design commitments here:

- **A blocked chain is shown, never hidden.** Omitting the row makes the user's own money look like it
  does not exist. Showing it greyed with a reason is the difference between a bug and a boundary.
- **The gas swap must leave headroom.** Sizing it to exactly the estimate strands the user at zero
  native mid-plan — which is the same trap one step later.

### 3.7 Poll ceiling

Polling is bounded. At the ceiling the UI degrades to "still settling, we'll update you" with the plan
recoverable. It never spins forever, and it never fakes success — a lesson taken directly from an
existing bug elsewhere in this codebase, where a deposit "succeeds" after a 2500 ms `setTimeout`.

---

## 4. What the user sees

| Rail state | Surface |
|---|---|
| Choosing sources | `FundingSourceSelector` — every token on every chain, with a gas badge per row |
| Reviewing cost | `ProvisioningCostBreakdown` — swap fee, bridge fee, per-step gas, price impact, slippage, "You pay", plus a *buy crypto instead* alternative |
| Executing | `ProvisioningPlanCard` + `WalletSteps` — numbered steps, live status, bridge ETA, per-leg explorer links |
| Bridging | The long step: ETA, explorer link, and a dismissal lock so the modal cannot be closed mid-route |
| Done | The original operation resumes with its original parameters |

The framing throughout is **"what do you want to spend"**, never "configure a bridge". The user picks
tokens; the route is an implementation detail we are responsible for.

---

## 5. Security posture

- **Every Uniswap call is server-side.** The key never reaches the client, so `connect-src` needs no
  bridge-provider entry. A PR that needs one has broken the boundary (UF-28 R1, R2).
- **Provider responses are untrusted input.** Zod-validated before they can influence a transaction;
  `data` asserted non-empty before any broadcast.
- **Approvals are sized to the plan**, never unbounded.
- **A Permit2 signature in a funding plan is a money-moving authorization.** The signing surface is
  reviewed for clear-vs-blind signing: the user must be able to tell what each signature authorizes.
- **Price impact is gated.** Every provisioning swap leg is subject to the same ≥10% acknowledgement
  gate as an operation swap (UF-25). A poisoned thin-pool route must not be able to enter through the
  funding path — that is precisely how an earlier incident in this product turned $40 into $3. Bridge
  legs carry no AMM price impact and are excluded rather than treated as 0% and silently passing.
