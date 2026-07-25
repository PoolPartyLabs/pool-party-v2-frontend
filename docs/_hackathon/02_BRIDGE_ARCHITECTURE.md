# Cross-chain bridge architecture

**How Pool Party moves a user's funds between chains to make an operation possible.**
Companion to [`00_IMPLEMENTATION_PLAN.md`](00_IMPLEMENTATION_PLAN.md) and
[`01_UNISWAP_INTEGRATION.md`](01_UNISWAP_INTEGRATION.md).

> This document is the **authority for everything cross-chain**. The vendored
> `.claude/skills/swap-integration/` skill (Uniswap's official skill, MIT) covers same-chain swapping
> and a decomposed swap-then-bridge flow; where the two could be read as overlapping, this file wins.

> ### Correction notice (POO-1054, 2026-07-25)
>
> This document originally described cross-chain funding as **Uniswap Chained Actions**: a server-held
> plan, advanced step by step with `PATCH /plan/:id`, recovered by reading `GET /plan/:id`. A
> read-only probe of the live Trading API established that we cannot obtain a `CHAINED` quote at all,
> and `POST /plan` requires one. The full evidence table is in
> [`01_UNISWAP_INTEGRATION.md` §1](01_UNISWAP_INTEGRATION.md#1-probe-evidence).
>
> Two things follow, and they are separable. **The route still works**: a same-token cross-chain pair
> quotes as `routing: "BRIDGE"` and settles as one transaction through `POST /swap`. **The
> orchestration moved**: multi-step routes are decomposed by our planner rather than by Uniswap's, and
> the two safety properties we were going to borrow from the server-held plan (`planId` as the
> idempotency key, `currentStepIndex` as the resume point) had to be replaced. [§3](#3-recovery-without-a-server-held-plan)
> is that replacement, and it is the most consequential section of this file.
>
> The Chained Actions material is preserved in [§1.5](#15-chained-actions-documented-but-not-available-to-us),
> marked as documented-but-unavailable. A confident description of a mechanism we never used would be
> the worst kind of inaccuracy in a submission whose whole claim is that the integration is real.

---

## 1. The mechanism: decompose in our planner

### 1.1 The three route shapes

Every funding route the planner produces is built from exactly two Trading API calls, `/quote` then
`/swap`, repeated per leg. There is no third call and no plan object.

| Source → target | `routing` | Legs | Settles |
|---|---|---|---|
| Same token, same chain (nothing to do) | n/a | 0 | immediately |
| Different token, same chain | `CLASSIC` | 1 swap | one receipt, seconds |
| **Same token, different chain** | `BRIDGE` | 1 bridge | source receipt, then **destination-chain arrival** |
| **Different token, different chain** | not routable (`404`) | 2: swap, then bridge | as above, sequentially |

The last row is the flagship demo case and the reason this section exists. `POST /quote` with
WETH (Polygon) → USDC (Arbitrum) answers `404 ResourceNotFound`. The pair is not offered as a single
route, so we build it out of two routes that are.

### 1.2 The flagship route, decomposed

Investor holds WETH on Polygon. Strategy is USDC on Arbitrum.

```
leg 0   approve    Polygon    WETH → Permit2                  (omitted when the allowance suffices)
leg 1   swap       Polygon    WETH → USDC          CLASSIC     seconds
leg 2   approve    Polygon    USDC → bridge spender           (omitted when the allowance suffices)
leg 3   bridge     Polygon    USDC → USDC Arbitrum  BRIDGE     source receipt, then arrival
────────────────────────────────────────────────────────────────────────────────
        the original invest then runs on Arbitrum, unchanged
```

Three properties of this decomposition are worth naming:

- **The middle is always USDC.** Every supported chain has USDC and it is the Across bridge asset, so
  the bridge leg is always same-token and therefore always routable. The planner never has to search
  for a bridgeable intermediary.
- **There is no destination-side swap.** Our target is USDC on the strategy's chain, which is what the
  bridge delivers. A route that needed one would be a third leg on the same pattern.
- **Leg 2 exists because `/check_approval` does not cover it.** That endpoint reports the Permit2
  allowance only; a `BRIDGE` route's `swap.to` is the bridge contract and needs its own ERC-20
  allowance. Skipping it reverts with `ERC20: transfer amount exceeds allowance`, which costs gas and
  strands the route. The rail reads `allowance(owner, swap.to)` on-chain before every bridge leg.

### 1.3 Each leg is quoted at execution time, from real balances

This is the rule that decomposition forces, and getting it wrong is how a route strands.

A quote for leg N+1 taken *before* leg N executes is a guess: the swap's actual output differs from
its quoted output by the realized slippage, and the quote expires (around 60 seconds) long before a
bridge settles anyway. So:

- **For pricing**, the planner quotes every leg up front. Those figures build the cost breakdown the
  user approves, and they are labelled as estimates.
- **For execution**, each leg is re-quoted when its turn comes, sized from **the balance the previous
  leg actually produced**, read on-chain. Not the quoted output. Not a stored intermediate.

The consequence is a property we get for free and should say out loud: **a plan is a pure function of
current on-chain holdings.** Re-deriving it is therefore naturally idempotent. If leg 1 already
executed, the fresh inventory shows USDC instead of WETH and the re-derived plan simply starts at the
bridge. This is the backbone of [§3](#3-recovery-without-a-server-held-plan).

The user is re-prompted if a re-quote is materially worse than the one they approved (UF-16 R5). A
better price needs no prompt; a worse one always does.

### 1.4 Where the bridge comes from

Bridge legs are quoted and executed through **Across Protocol**, fully abstracted by the Trading API.
We never talk to Across directly and we never pick a bridge provider. A `BRIDGE` quote carries
`quote.estimatedFillTimeMs`, the real expected fill time (Base to Arbitrum for USDC measured around
1000 ms), which is what the bridge step displays instead of an invented constant.

`slippageTolerance` does not govern a bridge leg. Across quotes it. Presenting a slippage allowance
over a bridge leg would be a lie in the cost breakdown, so bridge legs are excluded from that line
(UF-13 R3).

### 1.5 Chained Actions: documented, but not available to us

For the record, and because the epic was designed around it, this is the mechanism we did not get:

```
POST   /quote          routing: "CHAINED"    → price the whole route
POST   /plan           { routing, quote }    → planId, currentStepIndex, steps[]
PATCH  /plan/:planId   { stepIndex, proof }  → advance one step with its proof
GET    /plan/:planId   [?forceRefresh=true]  → poll state / re-quote remaining steps
```

Its step model, which our `FlowStep` mapping was designed against:

| `method` | Payload | What we would do |
|---|---|---|
| `SEND_TX` | `TX` | Broadcast via `executeBuiltTransaction`; proof is the `txHash` |
| `SIGN_MSG` | `EIP_712` | Sign typed data; proof is the `signature`. **No gas.** |
| `SEND_CALLS` | `EIP_5792` | Out of scope for v1 |

**We never obtained a `CHAINED` quote on any pair we can fund from**, and `/plan` takes one as its
body, so all three endpoints are unreachable for our key. Whether that is an account entitlement, a
chain-set limitation, or a route simply not offered for these pairs, we cannot tell from outside.

What survived: `stepMethodSchema` (`SEND_TX | SIGN_MSG | SEND_CALLS`) is still the wire contract
`ProvisioningStep.method` is typed off, and the decomposed rail still uses it to distinguish a
broadcast from a signature. The plan Zod schemas are kept in `src/lib/uniswap/schemas.ts` under an
`UNREACHABLE` block comment. The three server actions that called the endpoints were deleted, because
an action that cannot be called with any payload the API accepts is worse than an absent one: the next
author reads it as a capability the rail has.

---

## 2. Mapping onto the existing rail

The critical insight is unchanged by the correction: **we did not build an execution engine.** This
repository already has one.

`src/features/strategies/hooks/useWalletSignFlow.ts` runs an ordered list of awaitable steps and
gives, out of the box: per-step status (`idle | active | done | error | skipped`), per-step
transaction hashes, resume-from-failed-step retry, `retryFrom(key)` for targeted re-runs, a
pause-for-review handshake, and a stale-build ceiling. A funding leg maps **1:1** onto its `FlowStep`.

```
ProvisioningStep  ──buildPlanSteps()──►  FlowStep { key, run(ctx) }  ──►  useWalletSignFlow
```

`buildPlanSteps` (UF-14) is the whole adapter, and `ProvisioningPanel` already declares the prop for
it — `buildPlanSteps?: (plan) => FlowStep[]` — typed since the epic was designed and, until now,
passed by no production caller.

Each `run()`:

1. quotes the leg from the balance the previous leg produced ([§1.3](#13-each-leg-is-quoted-at-execution-time-from-real-balances)),
2. validates before broadcasting (`data` non-empty hex, valid addresses, `value` present and hex-safe,
   bridge-spender allowance sufficient),
3. records the leg in the journal **before** it broadcasts ([§3.4](#34-write-ordering-is-the-safety-property)),
4. executes the step (broadcast or sign),
5. waits for settlement, which for a bridge means destination-chain arrival, not a source receipt,
6. returns `{ txHash }` so the rail records it and renders the explorer link.

Step 3 is the only genuinely new obligation compared to a same-chain operation, and it replaces what
`PATCH /plan/:planId` would have done. There is no proof to submit anywhere, which also removes a
failure class we would otherwise have had to handle: a proof `PATCH` that fails *after* the money
moved.

### Chain switching is free

Every `SEND_TX` goes through `executeBuiltTransaction`, which is this codebase's **single broadcast
choke point** (`src/lib/tx/sendTransaction.ts`). Before every send it reads the wallet's actual chain
and, on mismatch, attempts one corrective `wallet_switchEthereumChain`, re-verifies, and otherwise
fails typed with `WRONG_CHAIN`. It also asserts the active account against the account the transaction
was built for (`WRONG_ACCOUNT`).

That existed because `eth_sendTransaction` carries no chain id and a wallet always broadcasts on its
current chain. It was written for single-chain operations, but it is exactly what a multi-chain route
needs, so **a Polygon leg followed by an Arbitrum leg switches networks correctly without a single
line of new switching logic.** We only had to make `WRONG_CHAIN` legible to users (UF-04), because it
was thrown but absent from the error catalog.

---

## 3. Recovery without a server-held plan

**This is the section POO-1038 implements.**

The original design delegated recovery to Uniswap: `planId` was the idempotency key, and
`GET /plan/:planId` was the authority on what had already happened. Neither exists. What follows is
the replacement, and it is worth stating plainly that it is not a downgrade: the safety property is
"never move the same money twice", and it is a poor idea to depend on a third party for a property we
can establish ourselves, from the chain, which is the only actual authority on whether a transaction
happened.

### 3.1 The chain is the source of truth

A funding plan is a pure function of current holdings ([§1.3](#13-each-leg-is-quoted-at-execution-time-from-real-balances)).
So the primitive recovery move is not "resume step N", it is **re-derive the plan from fresh on-chain
balances**. If a leg already executed, its effect is visible in the balances and the re-derived plan
does not contain it. Re-derivation cannot double-execute a *settled* leg, ever, because a settled leg
has already changed the input the derivation reads.

That closes the settled case completely. It leaves exactly one gap, and the journal exists for that
gap alone.

### 3.2 What the journal is for

A transaction that has been broadcast but has not settled is **invisible to a balance read**. Without
a record, "my balances have not changed" is indistinguishable from "nothing happened", and the
difference is a double bridge.

So the journal answers one question: *which transactions have I already put on a chain that the chain
has not finished reflecting?* It is a list of in-flight intents with their hashes. It is not an
execution plan, it is not a cache of calldata, and it is never trusted over the chain. When the
journal and the chain disagree, the chain wins and the journal is corrected.

### 3.3 The record

Stored in `localStorage` (not `sessionStorage`: a bridge takes minutes and users close tabs), under a
single namespaced, versioned key so a shape change can never be misread as the old shape.

```
key: "pp.funding.journal.v1"

FundingJournalStore {
  version: 1
  journals: FundingJournal[]        // bounded, see §3.7
}

FundingJournal {
  journalId:   string               // crypto.randomUUID(), minted when the user approves the plan
  wallet:      string               // lowercased; the SIWE-session address the plan was priced for
  createdAt:   number               // epoch ms
  updatedAt:   number               // epoch ms
  operation: {
    kind:          "invest" | "withdraw" | "collect" | "compound" | "move-range" | "close"
    targetChainId: number
    strategyId?:   string
  }
  legs: FundingLeg[]                // route order, which is execution order
}

FundingLeg {
  index:        number                       // position in the route
  kind:         "approve" | "swap-token" | "swap-gas" | "bridge"
  chainId:      number                       // the chain this transaction is broadcast on
  tokenIn:      string                       // address
  tokenOut:     string                       // address
  destChainId?: number                       // bridge legs only
  amountIn:     string                       // base units, DECIMAL string
  minAmountOut: string                       // base units, decimal string; quote output less fees
  status:       "planned" | "broadcast" | "settled" | "failed" | "unknown"
  nonceBefore?: number                       // §3.5, written before the wallet is prompted
  txHash?:      string                       // written the instant the wallet returns it
  broadcastAt?: number
  settledAt?:   number
  destBalanceBefore?: string                 // bridge legs only, base units; §3.6
}
```

**Money convention holds.** Every amount is a base-unit decimal string and every comparison is
`BigInt` arithmetic. No float touches any of this.

**What is deliberately NOT stored:** calldata, signatures, permit payloads, quote objects, API
responses, or anything else a replay could be built from. The journal holds *intent and outcome*.
Storing calldata would be storing something that must never be reused, since every leg is re-quoted at
execution time. Everything it does hold is either public chain data or the user's own address, so a
journal leaking to another script on the origin discloses nothing that an explorer does not.

### 3.4 Write ordering is the safety property

The entire mechanism rests on one ordering rule:

> The leg's `txHash` is written to the journal **synchronously, before** the code awaits the receipt.

`sendTransaction` resolves with the hash as soon as the node accepts the transaction, long before the
receipt exists. That resolution point is where the write goes. Concretely, per leg:

1. read `nonceBefore = eth_getTransactionCount(wallet, "latest")` on the leg's chain;
2. for a bridge leg, read `destBalanceBefore = balanceOf(wallet, tokenOut)` on the destination chain;
3. write the leg as `status: "planned"` with both values, and flush to `localStorage`;
4. prompt the wallet and broadcast;
5. the moment a hash comes back, write `status: "broadcast"` + `txHash` + `broadcastAt`, and flush,
   **before** awaiting anything;
6. await settlement, then write `status: "settled"` + `settledAt`.

Step 3 before step 4 is what makes the nonce test meaningful. Step 5 before the await is what makes
the receipt test possible.

### 3.5 Reconciliation on resume

On load, if a non-terminal journal exists for the currently connected wallet, the rail reconciles it
against the chain **before offering to do anything**. Per leg, in order:

| Journal state | Chain read | Verdict | Action |
|---|---|---|---|
| `settled` | (none needed) | done | skip |
| `broadcast`, has `txHash` | `getTransactionReceipt` → status `1` | settled on source | for a swap: done. For a bridge: go to [§3.6](#36-a-bridge-settles-on-the-destination-chain) |
| `broadcast`, has `txHash` | receipt status `0` | reverted; money did not move, gas did | mark `failed`, re-derive the plan from fresh balances |
| `broadcast`, has `txHash` | no receipt yet | still pending | **wait**, poll with backoff. Never re-broadcast |
| `broadcast`, has `txHash` | no receipt at the ceiling, and `getTransactionCount(latest) > nonceBefore` | ambiguous: something from this account mined | mark `unknown`, [§3.9](#39-the-residual-window-stated-honestly) |
| `broadcast`, has `txHash` | no receipt at the ceiling, and `getTransactionCount(latest) === nonceBefore` | dropped from the mempool | safe: re-derive the plan from fresh balances |
| `planned`, no `txHash` | `getTransactionCount(latest) === nonceBefore` | nothing was ever mined from this account | safe: re-derive and execute |
| `planned`, no `txHash` | `getTransactionCount(latest) > nonceBefore` | ambiguous | mark `unknown`, [§3.9](#39-the-residual-window-stated-honestly) |

Three rules bind the whole table:

1. **An ambiguous state is never resolved by broadcasting.** It is resolved by reading, or by asking.
   A re-broadcast is how a user pays twice, and a duplicate bridge deposit is not refundable by us.
2. **A journal for a different wallet is never acted on.** If the connected address does not match
   `journal.wallet`, the journal is left untouched and invisible. Account switching mid-bridge is a
   real user behaviour, and resuming another account's route would be the worst possible bug.
3. **Nothing auto-broadcasts on page load.** Reconciliation is a read. It produces a surfaced state
   ("you have funding in progress") and a Resume action the user presses. Silently continuing to move
   money because a tab reopened is not acceptable regardless of how safe the reconciliation is.

### 3.6 A bridge settles on the destination chain

A source-chain receipt with status `1` proves only that the funds **left**. Arrival is a separate
observation, on a different chain, minutes later.

Settlement test, polled with backoff:

```
balanceOf(wallet, tokenOut) on destChainId  −  destBalanceBefore  ≥  minAmountOut
```

**The delta against a recorded baseline is the point.** An absolute test (`balance >= amount`) is
wrong in both directions: it reports instant success for a user who already held the destination
token, and it never fires for a user whose arrival is netted against a concurrent spend. The baseline
is recorded before the broadcast precisely so the comparison is about *this* bridge.

`GET /swaps` can corroborate the source side but reports nothing about arrival, so it is a supplement,
not the test.

Polling is bounded: backoff from a few seconds to roughly 30 seconds, with a hard ceiling of about ten
minutes against an `estimatedFillTimeMs` typically measured in seconds. At the ceiling the leg is
**not** failed and **not** succeeded. It stays `broadcast`, the journal is retained, and the UI
degrades to "still settling, we will update you" with the source explorer link. It never spins
forever, never fakes success, and never re-broadcasts, which is exactly the failure the vendored
skill warns about: "duplicate bridge deposits result in double payment".

### 3.7 Lifecycle, hygiene and validation

- **Created** when the user approves the cost breakdown, not when the plan is computed. A plan the
  user never accepted has no in-flight transactions to track.
- **Retired** when every leg is `settled`, or when the user explicitly abandons the route. Retiring
  deletes the record.
- **Pruned** on every read: journals older than 24 hours, journals whose legs are all terminal, and
  anything beyond the most recent few are dropped. The store is bounded so it cannot grow without
  limit in `localStorage`.
- **Validated with Zod on every read**, and a parse failure discards the whole store rather than
  salvaging part of it. This blob influences money decisions, so it is untrusted input in exactly the
  sense provider responses are (UF-28 R6). Partial trust in a corrupt record is worse than starting
  clean, because starting clean falls back to re-deriving from the chain, which is always safe for
  settled legs.
- **Versioned in the key.** A `v2` shape lives at a `v2` key. A record written by a future version is
  never read by an older one.

### 3.8 Two tabs, one journal

A user can open the app in a second tab while a bridge is running, and both would see the same
journal. Guard it with a lightweight lease rather than a lock: the executing tab writes
`activeTabId` + `heartbeatAt` on the journal every few seconds, and a tab refuses to execute a journal
whose heartbeat is under 30 seconds old and not its own. A stale heartbeat means the other tab is
gone and the lease may be taken.

This is a *liveness* guard, not the correctness guard. Correctness still comes from §3.5: even if two
tabs raced, neither would broadcast a leg whose reconciliation is ambiguous.

### 3.9 The residual window, stated honestly

There is one gap this design does not close, and it should be documented rather than glossed:

**The wallet broadcast the transaction, and the app never learned the hash.** The user confirmed in
their wallet and the tab died before `sendTransaction` resolved. The journal has `planned` with a
`nonceBefore`, and the account's nonce has since moved. We cannot tell from that alone whether the
mined transaction was our leg or something else the user did from another app, and there is no RPC
method that maps a nonce back to a transaction hash.

The behaviour in that case is: mark the leg `unknown`, **do not broadcast**, and surface it. The user
is shown the account, the chain, the intended amount and a link to their address on the explorer, and
is offered the safe path, which is to re-derive the plan from current balances. Re-derivation is
correct whichever way the ambiguity resolves, because if the leg did execute, its output is already in
the balances and the new plan will not repeat it.

The window is one synchronous statement wide and it fails toward asking rather than toward spending.
That is the right trade, and pretending it does not exist would be worse than the window itself.

### 3.10 What the journal does not cover

The **operation itself** (the invest, withdraw, collect) is not a funding leg and is not journaled.
It stays a fresh, user-signed transaction built after provisioning settles (UF-21 R2), and its
ambiguous-broadcast handling is the pre-existing behaviour of that flow, unchanged by this epic.
Provisioning makes the operation possible; it never pre-authorizes it.

---

## 4. Failure modes

Every mode below has a defined behavior and a test.

### 4.1 Partial completion, the money is already moving

**The scenario:** leg 2 of 4 fails. The swap happened. The bridge did not. The user's funds are now
mid-route, in a token and on a chain they did not start with.

This was the single largest gap in the pre-existing design: a provisioning step carried **no
idempotency key**, while `flow.retry()` re-invokes the failed step verbatim. A retry after an
ambiguous failure could therefore **bridge twice**.

**The resolution** is [§3](#3-recovery-without-a-server-held-plan) in full: re-derive the plan from
fresh balances, and consult the journal only to identify transactions the chain has not yet reflected.
A settled leg cannot be repeated because it is no longer in the derived plan. An in-flight leg is
waited on, never re-sent.

### 4.2 Ambiguous broadcast, sent, receipt unknown

The transaction was submitted; the receipt never arrived (timeout, RPC drop, tab closed).

**Never re-broadcast to find out.** Resolve by reading: the receipt if we hold the hash, the account
nonce if we do not, the destination balance for a bridge. A re-broadcast is how a user pays twice.

### 4.3 Reload or killed tab mid-bridge

A bridge takes minutes; users close tabs. On next load the journal is reconciled (§3.5), the in-flight
bridge is recognized by its hash, and the destination poll resumes from where it left off. This is the
explicit regression test for UF-16 R4, and it is now a test of *our* recovery rather than of a
provider's.

### 4.4 Expired quote

Quotes have a TTL of roughly a minute and bridges are slow, so expiry mid-route is normal, not
exceptional. It is also structural under decomposition: leg 2's quote is stale by the time leg 1
settles, by construction ([§1.3](#13-each-leg-is-quoted-at-execution-time-from-real-balances)).

Re-quote from the real post-leg balance, **re-render the cost breakdown, and re-prompt when the price
moved materially against the user.** A user must never sign a materially different price than the one
they approved. Silently signing a refreshed quote is the failure mode that turns a good integration
into a support incident.

### 4.5 Stale build on the deferred operations

Withdraw, collect, move-range and close build their transaction **before** the provisioning gate fires
(the build-then-review handshake), then `resume()` afterwards. A multi-minute bridge can easily
outlive `MAX_BUILT_TX_AGE_MS` (4 minutes, against the server's 5-minute Permit2 `sigDeadline`).

The rail already refuses to send a stale build and rebuilds first. That path exists but has never been
exercised with a minutes-long pause in the middle, so UF-23 R2 covers it explicitly.

### 4.6 The gas chicken-and-egg

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
  native mid-route, which is the same trap one leg later.

Decomposition adds a per-leg version of the same check: a two-leg route pays gas twice on the source
chain, so the classifier sizes against the **whole route's** gas, not one transaction's.

### 4.7 Not-routable pairs

`404 ResourceNotFound` from `/quote` is a routing boundary, not an outage. It never retries and never
surfaces as "something went wrong". For a cross-chain pair it triggers decomposition; if the
decomposed legs are not routable either, the source is presented as unusable **with its reason**, on
the same principle as a BLOCKED gas chain.

### 4.8 Poll ceiling

Polling is bounded. At the ceiling the UI degrades to "still settling, we'll update you" with the
route recoverable from the journal. It never spins forever, and it never fakes success, a lesson taken
directly from an existing bug elsewhere in this codebase where a deposit "succeeds" after a 2500 ms
`setTimeout`.

---

## 5. What the user sees

| Rail state | Surface |
|---|---|
| Choosing sources | `FundingSourceSelector` — every token on every chain, with a gas badge per row |
| Reviewing cost | `ProvisioningCostBreakdown` — swap fee, bridge fee, per-step gas, price impact, slippage, "You pay", plus a *buy crypto instead* alternative |
| Executing | `ProvisioningPlanCard` + `WalletSteps` — numbered steps, live status, bridge ETA, per-leg explorer links |
| Bridging | The long step: ETA from `estimatedFillTimeMs`, explorer link, and a dismissal lock so the modal cannot be closed mid-route |
| Interrupted | On next load, "you have funding in progress", reconciled per §3.5, with an explicit Resume |
| Done | The original operation resumes with its original parameters |

The framing throughout is **"what do you want to spend"**, never "configure a bridge". The user picks
tokens; the route is an implementation detail we are responsible for. All copy ships in 11 locales
(UF-27), abstracts crypto jargon on the investor side, and states what a user can *do* in every
blocked or interrupted state.

---

## 6. Security posture

- **Every Uniswap call is server-side.** The key never reaches the client, so `connect-src` needs no
  bridge-provider entry. A PR that needs one has broken the boundary (UF-28 R1, R2).
- **Provider responses are untrusted input.** Zod-validated before they can influence a transaction;
  `data` asserted non-empty before any broadcast; `value` normalized from hex.
- **The journal is untrusted input too**, and for the same reason: it influences money decisions. Zod
  on every read, discard on any parse failure, and never trusted over the chain.
- **The journal holds no secret.** No calldata, no signatures, no permit payloads. Hashes, addresses
  the user owns, chain ids and amounts, all of which are public.
- **Approvals are sized to the plan**, never unbounded, including the bridge-spender approval that
  `/check_approval` does not report.
- **A Permit2 signature in a funding route is a money-moving authorization.** The signing surface is
  reviewed for clear-vs-blind signing: the user must be able to tell what each signature authorizes.
- **Price impact is gated.** Every provisioning swap leg is subject to the same ≥10% acknowledgement
  gate as an operation swap (UF-25). A poisoned thin-pool route must not be able to enter through the
  funding path, which is precisely how an earlier incident in this product turned $40 into $3. Bridge
  legs carry no AMM price impact and are excluded rather than treated as 0% and silently passing.
