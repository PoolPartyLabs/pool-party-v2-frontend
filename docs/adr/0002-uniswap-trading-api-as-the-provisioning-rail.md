# 0002. Uniswap Trading API as the provisioning swap + bridge rail

- Status: Accepted
- Date: 2026-07-24
- Linear: POO-1022 (epic), POO-1027 / POO-1034 / POO-1036
- PR: (this PR)

## Context

The pre-flight provisioning system (epic POO-411) is a complete front-end chassis with no engine. Its
contract has declared `bridge`, `swap-gas` and `swap-token` step types since it was designed
(`src/lib/provisioning/types.ts:26`), the calculator detects the wrong-network case
(`computeNeed.ts:70-71`), and all six operation modals mount the gate — but `computePlan`'s real
branch is `throw new Error("Provisioning planner is not wired yet")` (`planner.ts:29`) and
`buildPlanSteps`, the execution-rail prop, is passed by no production caller
(`ProvisioningPanel.tsx:101-118`).

The product consequence is concrete. After POO-303 removed the cross-network USDC aggregate, invest
reads the balance only on the strategy's chain, so a user holding $1,200 of USDC on Base looking at an
Arbitrum strategy sees **$0 spendable** and is deep-linked to `/deposit` to **buy more fiat**
(`InvestModal.tsx:589-600`). The wallet modal simultaneously advertises a cross-network total that no
operation can spend, with a disabled "coming soon" Swap button.

A 2026-07-23 integration audit framed the execution model as a binary:

- **Option A — backend builds the calldata.** Six new `pool-party-api` endpoints: `/bridge/quote`,
  `/bridge/build`, `/bridge/status`, `/bridge/chains`, `/route/quote`, `/swap/build`. Matches the
  house write pattern, but puts the entire rail behind another team's roadmap.
- **Option B — client-side aggregator SDK** (LI.FI, Across, Relay, Socket, Squid). No backend work,
  but no bridge provider is allowlisted in `src/lib/security/csp.ts` today, so it needs a CSP change
  and a security review, and it moves route selection and key handling into the browser.

The choice is expensive to reverse: it fixes where the routing intelligence lives, which team owns the
rail, what the security boundary is, and what has to change for every future chain or provider. Hence
an ADR rather than a PR note.

## Decision

**We integrate the Uniswap Trading API directly from the Next.js server layer, via Server Actions.**
Same-chain funding uses `/quote` + `/swap`; cross-chain funding uses **Chained Actions**
(`POST /plan`, `PATCH /plan/:id`, `GET /plan/:id`), whose bridge legs are quoted through Across and
fully abstracted by the API.

This is a third option the audit did not consider, and it dominates both on cost and on boundary
cleanliness:

1. **Zero new backend endpoints.** The whole rail ships from this repository. Option A's six endpoints
   disappear from the critical path.
2. **Zero CSP changes.** Nothing is fetched from the browser, so `connect-src` is untouched. This is
   also a standing invariant: a PR that needs a CSP entry for `trade-api.gateway.uniswap.org` has
   moved a call to the client and broken the secret boundary — treat it as a security regression, not
   a config gap.
3. **It matches the codebase's existing and only write pattern**: the server builds calldata, the
   client signs and broadcasts (`investActions.ts` → `useInvest` → `executeBuiltTransaction`). No new
   mental model, and every existing broadcast-time protection applies unchanged.
4. **We do not choose a bridge provider.** Uniswap abstracts Across. Swapping the underlying bridge
   later is their concern, not a migration for us.

The following rules bind every part of the rail:

1. **Server-only key, no exceptions.** `UNISWAP_API_KEY` has no `NEXT_PUBLIC_` prefix and is read only
   inside `import "server-only"` modules. See ADR 0003 for the full boundary.

2. **The client only signs and broadcasts.** It never selects a route, never prices a trade, and never
   holds a credential. Every Uniswap HTTP call is a Server Action.

3. **`planId` is the idempotency key.** Cross-chain plans are server-held. A step is never re-executed
   on-chain if the server already holds a proof for it; before any retry the rail re-reads
   `GET /plan/:planId` and resumes from the server's `currentStepIndex`, **never** from the client's
   local belief about where it failed. This closes a pre-existing defect where `flow.retry()`
   re-invoked the failed step verbatim with no idempotency key — a retry after an ambiguous failure
   could have bridged twice.

4. **Ambiguous broadcasts resolve by reading, never by re-sending.** If a transaction was submitted and
   the receipt never arrived, the resolution is `GET /plan/:planId`. A re-broadcast is how a user pays
   twice.

5. **Provider responses are untrusted input.** Everything is Zod-validated before it can influence a
   transaction, and `TransactionRequest.data` is asserted non-empty hex before any broadcast — an
   empty `data` reverts on-chain.

6. **Reuse the rail, do not build one.** Uniswap plan steps map 1:1 onto the existing `FlowStep` in
   `useWalletSignFlow`, and every `SEND_TX` goes through `executeBuiltTransaction`, inheriting the
   `WRONG_CHAIN` corrective switch and the `WRONG_ACCOUNT` assertion. Cross-chain leg-to-leg chain
   switching therefore required **no new switching logic**. Adding a second execution path would
   fork the retry, status and safety semantics.

7. **UniswapX is out of scope for v1.** `DUTCH_V2` / `DUTCH_V3` / `PRIORITY` routes are gasless orders
   filled by market makers, settling asynchronously through a lifecycle the rail does not model.
   Quotes pin the AMM path; a UniswapX route arriving anyway is a typed, legible failure rather than
   something silently mishandled. Same for EIP-5792 `SEND_CALLS` plan steps.

8. **Funding swaps are gated on price impact like any other swap.** The existing `PriceImpactGate`
   (≥10% explicit acknowledgement) applies per plan. A poisoned thin-pool route must not be able to
   enter through the funding path — that is precisely how an earlier incident in this product turned
   $40 into $3. Bridge legs carry no AMM price impact and are excluded, rather than treated as 0% and
   silently passing.

## Consequences

**Positive.**

- The rail ships end to end from one repository, on one team's timeline.
- Three pre-existing defects close as a side effect: a fabricated pre-build gas estimate (hardcoded
  `0.5` at `mapManagerStrategyDetail.ts:180`, while the real figure only exists *after* a build and
  the gate runs *before* it — `/quote` returns gas info at quote time); the double-bridge retry risk;
  and the total absence of partial-completion recovery.
- The security boundary gets *simpler*, not more complex: one more server-only key, no new client
  network origin, no CSP surface.
- Arbitrum, Base and Polygon are all Trading-API supported and Across-bridgeable, so no chain in our
  configuration is left out.

**Negative, accepted.**

- **A third-party dependency on a critical path.** If the Trading API is down, provisioning is down.
  Mitigated by bounded retries with a cumulative timeout budget, and by failing *safe*: a planner
  failure leaves the operation behaving exactly as it does today (the gate does not trigger), so a
  degraded Uniswap never blocks a user who is already funded.
- **Rate limits and cost are now an operational concern** we did not previously have.
- **We inherit Uniswap's routing opinions.** We cannot hand-tune a route. Accepted: their routing is
  better than anything we would build, and the price-impact gate bounds the downside.
- **Bridges take minutes**, which the rail's one-promise-per-step model had never been asked to
  express. Handled by in-step polling plus server-held resume, not by changing the step model.
- **No mock fallback.** We deleted the mock planner (real-only decision), so there is no offline
  provisioning path. Unit tests use recorded fixtures, so the suite still runs offline; the *product*
  does not.

## Alternatives considered

**Option A, backend-built calldata.** Rejected on cost and ownership, not on architecture — it is a
perfectly good design. It requires six new endpoints in another repository before any frontend work
can be verified end to end, and it would still need a bridge-provider decision (CCTP vs a liquidity
network) whose fee, finality and status semantics differ enough to change the contract. Our decision
does not preclude it: the rail is behind `computePlan` and a Server Action, so moving the routing to
`pool-party-api` later is a swap of one implementation for another behind an unchanged seam.

**Option B, client-side aggregator SDK.** Rejected. It moves credential handling and route selection
into the browser, needs a CSP change plus a security review, and would be the only write path in the
product that does not go through the server-builds-calldata pattern.

**Do nothing / keep the mock.** Rejected. The chassis has been mock-only since it was designed, and the
product ships a screen that tells users with money on the wrong chain to go buy more.

## Addendum, 2026-07-25 — live API evidence forces decomposition in our planner (POO-1054)

- Status: Accepted (the decision above is **not** reversed; its mechanism is corrected)
- Linear: POO-1054
- ADRs are immutable. Everything above stands as written on 2026-07-24. This section records what
  changed and why, rather than rewriting the record.

### What we learned

The decision above was made from the public Trading API documentation, before we held a key. On
2026-07-25 the live API was probed read-only with the real key. Three results contradict the
"Decision" section:

1. `POST /quote` for a cross-chain pair with **different** tokens (WETH on Polygon → USDC on Arbitrum,
   the flagship case) answers **`404 ResourceNotFound`**. It is not routable in one call.
2. **`routing: "CHAINED"` was never returned** on any pair we can fund from. Since `POST /plan` takes
   a chained quote as its body, `POST /plan`, `PATCH /plan/:id` and `GET /plan/:id` are unreachable
   for our key.
3. Cross-chain with the **same** token quotes as `routing: "BRIDGE"` and settles as **one**
   transaction through `POST /swap`, carrying a real `estimatedFillTimeMs`.

Uniswap's own vendored skill corroborates the boundary independently: it decomposes into
swap-then-bridge rather than using Chained Actions, and records that a direct cross-chain swap
returned "No quotes available" as of March 2026. The full evidence table, with a reproducible curl, is
in `docs/_hackathon/01_UNISWAP_INTEGRATION.md` §1.

### What is unchanged

The **decision** stands in full. We still integrate the Uniswap Trading API directly from the Next.js
server layer via Server Actions. Rules 1, 2, 5, 6, 7 and 8 of the Decision section are unaffected, and
so is every consequence and every rejected alternative: Option A still costs six endpoints in another
repository, Option B still moves credentials into the browser, and ADR 0003's secret boundary is
untouched (nothing about this correction adds a client-side call or a CSP entry).

What changed is **where the multi-step orchestration lives**: in our planner rather than in Uniswap's.
That is a mechanism, not a decision, which is precisely why this is an addendum and not a superseding
ADR.

### What is corrected

**The Decision paragraph.** "Cross-chain funding uses Chained Actions (`POST /plan`, `PATCH /plan/:id`,
`GET /plan/:id`)" is wrong. Cross-chain funding uses `/quote` + `/swap`, exactly like same-chain, once
per leg. A same-token cross-chain pair is one leg; a different-token pair is decomposed by our planner
into a source-chain swap to USDC followed by a same-token USDC bridge. USDC exists on all three
supported chains and is the Across bridge asset, so the middle leg is always routable.

**Rule 3, `planId` is the idempotency key.** Void: there is no `planId`. This is the load-bearing loss,
because rule 3 was the answer to a real pre-existing defect (a provisioning step carried no idempotency
key while `flow.retry()` re-invokes the failed step verbatim, so an ambiguous failure could double-
bridge).

The replacement is a **client-persisted leg journal reconciled against on-chain receipts**, specified
in `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3 for POO-1038. Its logic:

- A plan is a pure function of current on-chain holdings, so **re-deriving it from fresh balances is
  inherently idempotent**. A settled leg cannot be repeated, because it has already changed the input
  the derivation reads. This closes the settled case with no bookkeeping at all.
- The only gap left is a transaction that is broadcast but not yet reflected in a balance. The journal
  covers exactly that gap: it records each leg's intent, its `nonceBefore`, and its `txHash` written
  synchronously the instant the wallet returns it, before any await.
- Recovery is then a read: `getTransactionReceipt` when we hold a hash, `getTransactionCount` when we
  do not, and a destination-chain balance delta for bridge arrival. An ambiguous state is never
  resolved by broadcasting.

**Rule 4, ambiguous broadcasts resolve by reading, never by re-sending.** Unchanged in substance, but
the thing being read is the chain rather than `GET /plan/:planId`.

### Consequences of the correction

**Positive.**

- We stopped depending on a third party for our own safety property. The chain is the authority on
  whether a transaction happened, and it is the authority we can always reach.
- One less failure class: there is no proof to `PATCH`, so a proof submission cannot fail *after* the
  money moved.
- Recovery survives Uniswap being down. A server-held plan would not have.
- The rail collapses to two endpoints, `/quote` and `/swap`, for every route shape.

**Negative, accepted.**

- **We own the orchestration**, including per-leg re-quoting, bridge-arrival detection and the journal.
  That is real code we would not have written, and it is the honest cost of the correction.
- **`/check_approval` covers Permit2 only.** A bridge leg's spender needs its own on-chain allowance
  check, which the abstracted plan would have handled for us.
- **A residual ambiguity window remains**: the wallet broadcast and the app never learned the hash. It
  is one synchronous statement wide, it fails toward asking the user rather than toward spending, and
  it is documented rather than hidden (`02_BRIDGE_ARCHITECTURE.md` §3.9).

### Code retired by this addendum

`createPlan`, `advancePlan` and `getPlan` were deleted from `src/lib/uniswap/actions.ts` along with
their tests, and POO-1029 rules [R4], [R5] and [R7] retire with them (that file goes to rules v2). The
plan Zod schemas are kept in `src/lib/uniswap/schemas.ts` under an `UNREACHABLE` block comment: they
cost nothing, they document the shape should Chained Actions ever be enabled for our key, and
`stepMethodSchema` is still the wire contract `ProvisioningStep.method` is typed off.

### Open question

`quoteRequestSchema` rejects a cross-chain `EXACT_OUTPUT`. That constraint was taken from the Chained
Actions documentation this addendum retires, and the vendored skill quotes a **bridge** with
`EXACT_OUTPUT`. Provisioning is inherently exact-output shaped ("land exactly $X on the target
chain"), so the guard may be costing us the natural request shape. It stands until a live probe
settles it, tracked as a `PP-TODO` on that schema and flagged to POO-1034. Relaxing it on the strength
of a document is the mistake this addendum exists to correct.

## References

- `docs/_hackathon/00_IMPLEMENTATION_PLAN.md` — the plan of record
- `docs/_hackathon/01_UNISWAP_INTEGRATION.md` — endpoint-by-endpoint reference, and the probe evidence
- `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` — the decomposed route, its failure modes, and the leg journal
- ADR 0003 — the server-only key boundary
- `.claude/skills/swap-integration/` — Uniswap's official skill, vendored (MIT); same-chain swapping
  plus a decomposed swap-then-bridge flow, and the closest published precedent for what we build
