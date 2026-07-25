# Uniswap Trading API — integration reference

**Every endpoint we call, what we send, what we get back, and where it is used.**
Companion to [`00_IMPLEMENTATION_PLAN.md`](00_IMPLEMENTATION_PLAN.md). Cross-chain specifics live in
[`02_BRIDGE_ARCHITECTURE.md`](02_BRIDGE_ARCHITECTURE.md).

- **Base URL:** `https://trade-api.gateway.uniswap.org/v1`
- **Auth:** `x-api-key: <UNISWAP_API_KEY>` — **server-only**, never `NEXT_PUBLIC_`
- **Transport:** `src/lib/uniswap/client.ts` (`uniswapFetch`), `import "server-only"`
- **Callers:** `src/lib/uniswap/actions.ts` (`"use server"`) — the browser never talks to Uniswap directly

> ### Provenance and correction notice (POO-1054, 2026-07-25)
>
> The first version of this file was written from the public Trading API documentation, before we
> held a key. On 2026-07-25 the live API was probed read-only with the real key, and three of its
> claims turned out to be wrong. This revision describes the API **as measured**, and keeps the
> Chained Actions material in [§9](#9-chained-actions-documented-but-not-available-to-us), clearly
> marked as documented-but-unavailable.
>
> The corrections, in order of consequence:
>
> 1. **Cross-chain with a different token is not routable in one call.** It answers `404`.
> 2. **`routing: "CHAINED"` is never returned**, so `POST /plan` cannot be reached at all.
> 3. **Cross-chain with the same token IS one call**: `routing: "BRIDGE"`, settled through `POST /swap`.
>
> Everything the epic needs still works. What changed is *where the multi-step logic lives*: in our
> planner rather than in Uniswap's. See the [ADR 0002 addendum](../adr/0002-uniswap-trading-api-as-the-provisioning-rail.md#addendum-2026-07-25--live-api-evidence-forces-decomposition-in-our-planner-poo-1054).

---

## 1. Probe evidence

Read-only. No signing, no broadcast, no state created upstream. Reproduce any row with the curl in
[§1.2](#12-reproducing-it); a Trading API key is the only thing you need that is not in this repo.

### 1.1 Results

| # | Request | Result | What it settles |
|---|---|---|---|
| P1 | `POST /quote` · WETH (Polygon 137) → USDC (Arbitrum 42161) | **`404 ResourceNotFound`** | Cross-chain **different-token** is not routable in one call. This is the flagship demo case, so the planner must decompose it. |
| P2 | `POST /quote` · USDC (Base 8453) → USDC (Arbitrum 42161) | `200`, `routing: "BRIDGE"`, `quote.estimatedFillTimeMs ≈ 1000` | Cross-chain **same-token** works, in one call, and carries a real ETA. |
| P3 | `POST /swap` with a `BRIDGE` quote | `200`, one `swap` transaction | A bridge settles as **one** transaction, on the same endpoint as a same-chain swap. |
| P4 | `POST /quote` · same-chain pair | `200`, `routing: "CLASSIC"`, `permitData` **present** | Same-chain is a permit-bearing classic swap, as documented. |
| P5 | `routing: "CHAINED"` | **never returned**, on any probed pair | `POST /plan`, `PATCH /plan/:id` and `GET /plan/:id` are unreachable: `/plan` requires a chained quote we cannot obtain. |
| P6 | `POST /swap` body: `{quote: <quote.quote>}` vs `{...<quote response>}` | both `200`, **identical calldata** | The wrapped and spread body shapes are interchangeable. We send the spread. |
| P7 | `POST /check_approval` | `200` · `{ requestId, approval, cancel }`; `approval: null` when none needed | The response shape, confirmed. `null` is the no-approval-required signal. |
| P8 | `swap.value` on every response | HEX string, e.g. `"0x00"` | The one amount on the wire that is **not** a decimal string. |

Corroboration, independent of our probe: Uniswap's own vendored skill
(`.claude/skills/swap-integration/references/trading-api-flows.md`) never uses Chained Actions
either. It decomposes into swap-then-bridge, and its closing section records that as of March 2026
the API returns "No quotes available" for a direct cross-chain swap. Two independent observations of
the same boundary.

### 1.2 Reproducing it

```bash
export UNISWAP_API_KEY=...            # the same key the server reads; never commit it
API=https://trade-api.gateway.uniswap.org/v1
WALLET=0x...                          # any address; a quote does not need a signature

# P1 — cross-chain, DIFFERENT token. Expect 404 ResourceNotFound.
curl -sS -o /dev/stderr -w '%{http_code}\n' "$API/quote" \
  -H "content-type: application/json" -H "x-api-key: $UNISWAP_API_KEY" \
  -d '{"tokenIn":"0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619","tokenInChainId":137,
       "tokenOut":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","tokenOutChainId":42161,
       "amount":"1000000000000000000","type":"EXACT_INPUT","swapper":"'"$WALLET"'"}'

# P2 — cross-chain, SAME token. Expect 200 with routing BRIDGE.
curl -sS "$API/quote" \
  -H "content-type: application/json" -H "x-api-key: $UNISWAP_API_KEY" \
  -d '{"tokenIn":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","tokenInChainId":8453,
       "tokenOut":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","tokenOutChainId":42161,
       "amount":"1000000","type":"EXACT_INPUT","swapper":"'"$WALLET"'"}' \
  | jq '{routing, eta: .quote.estimatedFillTimeMs, permit: (.permitData != null)}'

# P4 — same-chain. Expect 200, routing CLASSIC, permitData present.
curl -sS "$API/quote" \
  -H "content-type: application/json" -H "x-api-key: $UNISWAP_API_KEY" \
  -d '{"tokenIn":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","tokenInChainId":42161,
       "tokenOut":"0x82aF49447D8a07e3bd95BD0d56f35241523fBab1","tokenOutChainId":42161,
       "amount":"1000000","type":"EXACT_INPUT","swapper":"'"$WALLET"'"}' \
  | jq '{routing, permit: (.permitData != null)}'
```

`POST /swap` is also read-only in the sense that matters here: it returns unsigned calldata and
creates nothing upstream. It is safe to probe as long as you do not broadcast what it returns.

---

## 2. Why every call is server-side

The API key is a secret. This repository already has exactly one pattern for that
(`src/lib/api/client.ts`: `import "server-only"`, `x-api-key`, Zod-validated, bounded retry), and the
Uniswap client mirrors it. Three consequences worth stating up front:

1. **No CSP change.** Nothing is fetched from the browser, so `connect-src` in
   `src/lib/security/csp.ts` is untouched. If a PR ever needs a CSP entry for
   `trade-api.gateway.uniswap.org`, something has moved to the client and the secret boundary has been
   broken — treat it as a security regression, not a config gap.
2. **The client only signs and broadcasts.** This is the same split every existing write already uses:
   the server builds calldata, the wallet signs it (`investActions.ts` → `useInvest` →
   `executeBuiltTransaction`).
3. **The wallet address comes from the SIWE session**, never from an action argument.

> **Note on the vendored `swap-integration` skill.** We vendored Uniswap's official skill into
> `.claude/skills/swap-integration/` (MIT, pinned at `3ddd8a9d`). Its Permit2 field-rule matrix is
> reproduced below, and its cross-chain flow is now the closest published precedent for what we
> build. Its React examples call the Trading API **from the client**; we deliberately do not.

---

## 3. Endpoint map

| Endpoint | Method | Where it is used |
|---|---|---|
| `/check_approval` | POST | Rail — does the source token need an ERC-20 approval to Permit2? |
| `/quote` | POST | Planner — pricing, gas info, route classification, bridge ETA |
| `/swap` | POST | Rail — produces the unsigned transaction, for **both** same-chain and bridge legs |
| `/swappable_tokens` | GET | Inventory — the allowlist for the funding-source picker |
| `/swaps` | GET | Rail — AMM transaction status |

**Not in the map, and that is the point of this revision:** `POST /plan`, `PATCH /plan/:planId` and
`GET /plan/:planId`. See [§9](#9-chained-actions-documented-but-not-available-to-us).

---

## 4. `POST /check_approval`

Returns approval calldata **only if an approval is actually required**. The live response is
`{ requestId, approval, cancel }`, and `approval: null` means the allowance already covers the amount.

```jsonc
// request
{
  "walletAddress": "0x…",   // from the SIWE session, never from the client
  "token":         "0x…",   // the source token
  "amount":        "…",     // wei / native units, decimal string
  "chainId":       8453,
  "tokenOut":      "0x…",
  "tokenOutChainId": 42161
}
```

**Our handling.** `approval: null` maps to `{ skipped: true }` — a shape `useWalletSignFlow` already
models and renders as a skipped step, exactly like the existing `approve:USDC` step in `useInvest`
which self-skips when the allowance suffices. We do not invent a new "no-op step" concept. `cancel`
is the USDT-class "zero the allowance first" transaction and is handled the same way.

**Allowance hygiene.** Approvals are sized to the plan, never unbounded. The reasoning is documented
at the call site (UF-28 R3).

> **This endpoint covers Permit2 only.** A `BRIDGE` route's `swap.to` is the bridge contract, and it
> needs its **own** ERC-20 allowance, which `/check_approval` does not report. Broadcasting a bridge
> without it reverts with `ERC20: transfer amount exceeds allowance`. The rail must read
> `allowance(owner, swap.to)` on-chain before a bridge leg and insert an approval step when it is
> short. This is documented in the vendored skill (§4B-1, "bridge spender approval") and is a real
> money-losing footgun: the revert costs gas and strands the plan mid-route.

---

## 5. `POST /quote`

The planner's workhorse: pricing, **gas information**, the bridge ETA, and the route classification
that decides how the leg executes.

```jsonc
// request
{
  "tokenIn":  "0x…",  "tokenInChainId":  137,
  "tokenOut": "0x…",  "tokenOutChainId": 42161,
  "amount":   "1000000",          // decimal string
  "type":     "EXACT_INPUT",
  "swapper":  "0x…",
  "slippageTolerance": 2          // percent, from the settings gear
}
```

Response carries `quote`, `permitData` (may be `null`), and `routing`:

| `routing` | Observed | Meaning | Our path |
|---|---|---|---|
| `CLASSIC` | **yes**, same-chain, with `permitData` | AMM swap | `POST /swap` |
| `WRAP` / `UNWRAP` | not probed | native ↔ wrapped | `POST /swap` |
| `BRIDGE` | **yes**, cross-chain same-token | Across-backed bridge | `POST /swap`, then destination-chain settlement |
| `CHAINED` | **never** | multi-step cross-chain plan | unreachable, see §9 |
| `DUTCH_V2` / `DUTCH_V3` / `PRIORITY` | not probed | UniswapX (gasless, filled by market makers) | rejected, see below |

**`routing` is a discriminated union and an unknown value fails loudly** (UF-06 R1). Silently falling
through to the classic path with an unrecognized route is how you sign something you did not price.

### What a `404` means here

`POST /quote` with a cross-chain pair whose tokens differ answers `404 ResourceNotFound`. That is a
**routing boundary, not an outage**, and the two must not be conflated: retrying a `404` wastes the
budget and shows the user an error for a route that is simply not offered. `uniswapFetch` already
never retries a `4xx`. The planner treats it as "this pair is not directly routable" and decomposes
(see [`02_BRIDGE_ARCHITECTURE.md` §1](02_BRIDGE_ARCHITECTURE.md)).

### `estimatedFillTimeMs`

A `BRIDGE` quote carries `quote.estimatedFillTimeMs`, the real expected fill time, and Base to
Arbitrum for USDC measured around **1000 ms**. Two things follow:

- It is the ETA the bridge step shows. We do not invent a "2 to 5 minutes" constant.
- It is a *quote-time estimate*, not a guarantee. The rail still polls destination-chain settlement
  with a bounded ceiling, and still shows "still settling" rather than faking success at the ETA.

`quoteBodySchema` is `passthrough`, so this field already survives parsing untyped. POO-1034 / POO-1037
should declare it explicitly when they consume it.

**Gas info is the point.** `/quote` returns gas information *at quote time*. This retires a real
defect: `gasEstimateUsd` was hardcoded to `0.5` at `mapManagerStrategyDetail.ts:180`, and the only
genuine figure (`estimatedGasInUsd`) exists only *after* a build — but the provisioning gate runs
*before* the build. The gate finally gets a real number.

**UniswapX is out of scope for v1.** `DUTCH_*` and `PRIORITY` routes are gasless orders filled by
market makers and settle asynchronously through `/order` and `/orders`, which is a different lifecycle
from the one our rail models. The quote request pins the routing preference to the AMM path
same-chain; a UniswapX route arriving anyway is a typed, legible failure, never a silently mishandled
one. The preference is deliberately **not** pinned cross-chain, where `CLASSIC` would exclude
`BRIDGE`.

### An open question the probe did not settle

`quoteRequestSchema` rejects a cross-chain `EXACT_OUTPUT`. That constraint came from the Chained
Actions documentation, which §9 retires. The vendored skill quotes a **bridge** with
`type: "EXACT_OUTPUT"` (§4B-2), and provisioning is inherently exact-output shaped: "land exactly
$X on the target chain". The guard stands until a live probe settles it, tracked as a `PP-TODO` on
that schema. Relaxing it on the strength of a document is precisely the mistake this revision exists
to correct.

---

## 6. `POST /swap`

Takes a quote (plus a Permit2 signature when one is required) and returns an unsigned transaction.
**Same-chain and bridge legs both go here**; the only difference is what happens after the broadcast.

### Body shape

The probe sent the same quote two ways, `{quote: <quote.quote>}` and `{...<whole quote response>}`,
and got **identical calldata** back. Both are accepted. We send the spread, with `permitData`
stripped when it is `null`, because that is what the schemas and their tests are built around. The
earlier claim that the spread was *required* was wrong, and it is worth knowing the wrapped form
works: the vendored skill uses it, so its examples transfer directly.

### The Permit2 field-rule matrix

This is the part that is easy to get wrong, and the vendored skill documents it precisely.
**The API rejects `permitData: null`** — so `permitData` must be *stripped* from the spread and
re-attached explicitly, never passed through as `null`.

**CLASSIC routes** — `signature` and `permitData` travel together or not at all:

| Scenario | `signature` | `permitData` |
|---|---|---|
| Standard swap, no Permit2 | omit | omit |
| Permit2 swap | required | required |
| Invalid | present | missing |
| Invalid | missing | present |
| Invalid (API error) | any | `null` |

Branch on **presence of `permitData`**, not on the routing value. The probe found `permitData`
present on a live same-chain `CLASSIC` quote; the old rule ("always `null` on a chained quote")
described a route we never receive.

**UniswapX routes** — the order is already encoded in `quote.encodedOrder`, so `permitData` is for
local signing only and must **not** be sent:

| Scenario | `signature` | `permitData` |
|---|---|---|
| UniswapX order | required | **omit** |
| Invalid | any | present (schema rejects) |

### Signing the permit

Typed data is signed with the wallet's `signTypedData`. **Every uint must be a decimal string, never a
native `bigint`.** Privy embedded (social-login) wallets `JSON.stringify` the typed data before
signing, which throws on `bigint`; external wallets do not, so this fails for exactly one class of
user. It is a shipped, twice-learned defect in this codebase and is now a schema-level rule (UF-14 R2)
with a test that stringifies every payload and asserts no `bigint` survives.

### Pre-broadcast validation

Never broadcast a swap response unchecked (UF-06 R2, UF-14 R5):

- `data` must be non-empty hex — `""` or `"0x"` will revert on-chain. Re-fetch the quote instead.
- `to` and `from` must be valid addresses.
- `value` must be present, and it comes back as **hex** (`"0x00"`), not decimal. This is the single
  wire amount that breaks the repository's decimal-string money convention, so anything that does
  arithmetic on it, or hands it to a signer expecting decimals, has to normalize first. `BigInt()`
  parses both forms, which makes `BigInt(value)` the safe read.
- For a `BRIDGE` leg, additionally check `allowance(owner, swap.to)` on-chain (see §4).

`executeBuiltTransaction` then adds the two assertions this repo already enforces at its single
broadcast choke point (`src/lib/tx/sendTransaction.ts`): the **target chain** (`WRONG_CHAIN`, with one
corrective `wallet_switchEthereumChain` and a re-verify) and the **active account**
(`WRONG_ACCOUNT`). Cross-chain leg-to-leg chain switching is therefore free and centrally enforced —
we did not write a second switching path.

### The recipient is always the swapper

The Trading API takes no separate `recipient` for a cross-chain quote: the funds arrive at the
`swapper` address on the destination chain. That is exactly what we want, since the SIWE session
wallet is both sides of every provisioning route, but it is worth stating because it removes a whole
class of "where did the money go" question.

---

## 7. `GET /swappable_tokens`

Which tokens can be swapped and bridged, and between which chains. This is the allowlist for the
funding-source picker: **a token we cannot route is never offered to the user.**

Cache-tagged (UF-07 R3) — it changes rarely and must not be re-fetched per keystroke.

Note the limit: the allowlist says a token is routable, not that a *pair* is. P1 shows a pair of two
individually-swappable tokens that is not routable across chains. Pair-level feasibility is the
planner's job, not the allowlist's.

## 8. `GET /swaps`

AMM transaction status for same-chain legs. It reports the **source-chain** transaction. For a bridge
leg, source-chain success only proves the funds left; arrival is observed on the destination chain
(see [`02_BRIDGE_ARCHITECTURE.md`](02_BRIDGE_ARCHITECTURE.md)).

---

## 9. Chained Actions: documented, but not available to us

Uniswap documents a server-held plan for multi-step cross-chain routes:

```
POST   /quote          routing: "CHAINED"    → price the whole route
POST   /plan           { routing, quote }    → planId, currentStepIndex, steps[]
PATCH  /plan/:planId   { stepIndex, proof }  → advance one step with its proof
GET    /plan/:planId   [?forceRefresh=true]  → poll state / re-quote remaining steps
```

**We never obtained a `CHAINED` quote** (P5), on any pair we can fund from, and `POST /plan` takes a
chained quote as its body. The three endpoints are therefore unreachable for our key, not merely
unused. Whether that is an account-level entitlement, a chain-set limitation, or a route that is
simply not offered for these pairs, we cannot tell from outside, and it would be dishonest to present
the mechanism as something we used.

What this cost us, concretely: the three server actions that wrapped these endpoints
(`createPlan`, `advancePlan`, `getPlan`) were **deleted** (POO-1054 R3). Their Zod schemas are kept in
`src/lib/uniswap/schemas.ts`, flagged `UNREACHABLE` at the block boundary, because they cost nothing,
they document the shape if the capability is ever enabled, and `stepMethodSchema` is still the wire
contract `ProvisioningStep.method` is typed off.

What this cost us architecturally is the subject of
[`02_BRIDGE_ARCHITECTURE.md`](02_BRIDGE_ARCHITECTURE.md): `planId` was going to be our idempotency
key and `GET /plan/:planId` our recovery primitive. Both had to be replaced. The replacement is a
client-persisted leg journal reconciled against on-chain receipts, and it is arguably the stronger
design, because it does not delegate our own safety property to a third party.

---

## 10. Chains

| Chain | id | USDC | Role here |
|---|---|---|---|
| Arbitrum | 42161 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | strategy chain + funding source |
| Base | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | strategy chain + funding source |
| Polygon | 137 | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | strategy chain + funding source |

All three are supported by the Trading API and bridgeable via Across, and USDC is the bridge asset on
each, which is what makes the decomposed route work: the middle leg is always a same-token bridge.
They come from `src/lib/chains/config.ts`, the single source of truth that already feeds wagmi, Privy,
the CSP RPC allowlist, USDC lookups and every balance fan-out. **No chain list is duplicated for this
feature** — the codebase already carries three copies of a network list (`provisioningView.ts:18-19`,
`src/features/wallet/networks.ts`, `src/mocks/data/pools.ts`) and UF-19 removes one rather than adding a fourth.

---

## 11. Error handling

- Non-2xx produces a typed `UniswapApiError` carrying the upstream code and message. Callers never
  regex-match strings — this repository already learned that lesson with revert-string classification
  (`classifyTxError`), and a typed code on `error.cause.code` is what lets the existing slippage
  auto-retry work.
- Retries are bounded and cover the transient class only: `429`, `502`, `503`, `504`, `408`, network.
  A `4xx` business error never retries. `404 ResourceNotFound` on a quote is a routing boundary, and
  must reach the planner as one rather than as a generic failure.
- Every attempt has an `AbortController` timeout, with a cumulative budget bounding all retries — a
  brief blip recovers, a sustained outage fails fast and contained rather than hanging a render.
- Provider responses are **untrusted input**: everything is Zod-validated before it can influence a
  transaction (UF-28 R6).
- The API key is never logged, never included in an error message, and never serialized into a
  returned value (UF-05 R6), with a test asserting it.

## 12. Quote freshness

Quotes expire, around 60 seconds by the vendored skill's account, and every leg of a decomposed route
carries its own expiry. This repository already has the machinery and we reuse it rather than
inventing a parallel one:

- Operations pause after their build step (`pauseAfterKey`) so the Review renders a real quote, and a
  countdown re-runs only that step (`useReviewCountdown`).
- A background re-quote failure is non-fatal: the last good quote stands and the next window retries.
- A built transaction older than `MAX_BUILT_TX_AGE_MS` (4 minutes, against the server's 5-minute
  Permit2 `sigDeadline`) is **never sent** — it is rebuilt first.

That last rule matters more here than anywhere else: a bridge can take minutes, so a provisioning wait
can easily outlive the freshness window of an operation that was built *before* provisioning started
(UF-21 R4, UF-23 R2).

**Decomposition sharpens this.** Leg 2 of a decomposed route is quoted while leg 1 is still settling,
so its quote is stale by construction by the time it executes. The rail therefore quotes each leg
**at execution time, from the balance the previous leg actually produced**, and uses the pre-quoted
figures only for the cost breakdown the user approves. See
[`02_BRIDGE_ARCHITECTURE.md` §1.3](02_BRIDGE_ARCHITECTURE.md).
