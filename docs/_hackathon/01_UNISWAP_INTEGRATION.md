# Uniswap Trading API — integration reference

**Every endpoint we call, what we send, what we get back, and where it is used.**
Companion to [`00_IMPLEMENTATION_PLAN.md`](00_IMPLEMENTATION_PLAN.md). Cross-chain specifics live in
[`02_BRIDGE_ARCHITECTURE.md`](02_BRIDGE_ARCHITECTURE.md).

- **Base URL:** `https://trade-api.gateway.uniswap.org/v1`
- **Auth:** `x-api-key: <UNISWAP_API_KEY>` — **server-only**, never `NEXT_PUBLIC_`
- **Transport:** `src/lib/uniswap/client.ts` (`uniswapFetch`), `import "server-only"`
- **Callers:** `src/lib/uniswap/actions.ts` (`"use server"`) — the browser never talks to Uniswap directly

## Why every call is server-side

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
> `.claude/skills/swap-integration/` (MIT, pinned at `3ddd8a9d`). It is an excellent reference for
> same-chain swapping and its Permit2 field-rule matrix is reproduced below. Its React examples call
> the Trading API **from the client**; we deliberately do not. It also does not cover Chained Actions.

---

## Endpoint map

| Endpoint | Method | Where it is used |
|---|---|---|
| `/check_approval` | POST | Rail — does the source token need an ERC-20 approval to Permit2? |
| `/quote` | POST | Planner — pricing, gas info, route classification |
| `/swap` | POST | Rail — same-chain, produces the unsigned transaction |
| `/plan` | POST | Planner — cross-chain, creates the chained execution plan |
| `/plan/:planId` | PATCH | Rail — submit proof to advance a step |
| `/plan/:planId` | GET | Rail — poll state; **the recovery primitive** |
| `/swappable_tokens` | GET | Inventory — the allowlist for the funding-source picker |
| `/swaps` | GET | Rail — AMM transaction status |

---

## `POST /check_approval`

Returns approval calldata **only if an approval is actually required**. No calldata means the
allowance already covers the amount.

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

**Our handling.** Absent calldata maps to `{ skipped: true }` — a shape `useWalletSignFlow` already
models and renders as a skipped step, exactly like the existing `approve:USDC` step in `useInvest`
which self-skips when the allowance suffices. We do not invent a new "no-op step" concept.

**Allowance hygiene.** Approvals are sized to the plan, never unbounded. The reasoning is documented
at the call site (UF-28 R3).

---

## `POST /quote`

The planner's workhorse: pricing, **gas information**, and the route classification that decides
whether this is a same-chain swap or a cross-chain plan.

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

| `routing` | Meaning | Our path |
|---|---|---|
| `CLASSIC` | AMM swap | same-chain rail |
| `WRAP` / `UNWRAP` | native ↔ wrapped | same-chain rail |
| `BRIDGE` | cross-chain bridge | cross-chain rail |
| `CHAINED` | multi-step cross-chain | cross-chain rail (`/plan`) |
| `DUTCH_V2` / `DUTCH_V3` / `PRIORITY` | UniswapX (gasless, filled by market makers) | see below |

**`routing` is a discriminated union and an unknown value fails loudly** (UF-06 R1). Silently falling
through to the classic path with an unrecognized route is how you sign something you did not price.

**Gas info is the point.** `/quote` returns gas information *at quote time*. This retires a real
defect: `gasEstimateUsd` was hardcoded to `0.5` at `mapManagerStrategyDetail.ts:180`, and the only
genuine figure (`estimatedGasInUsd`) exists only *after* a build — but the provisioning gate runs
*before* the build. The gate finally gets a real number.

**UniswapX is out of scope for v1.** `DUTCH_*` and `PRIORITY` routes are gasless orders filled by
market makers and settle asynchronously through `/order` and `/orders`, which is a different lifecycle
from the one our rail models. The quote request pins the routing preference to the AMM path; a
UniswapX route arriving anyway is a typed, legible failure, never a silently mishandled one.

---

## `POST /swap` (same-chain)

Takes a quote (plus a Permit2 signature when one is required) and returns an unsigned transaction.

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
- `value` must be present (`"0"` is valid for a non-native swap).

`executeBuiltTransaction` then adds the two assertions this repo already enforces at its single
broadcast choke point (`src/lib/tx/sendTransaction.ts`): the **target chain** (`WRONG_CHAIN`, with one
corrective `wallet_switchEthereumChain` and a re-verify) and the **active account**
(`WRONG_ACCOUNT`). Cross-chain leg-to-leg chain switching is therefore free and centrally enforced —
we did not write a second switching path.

---

## `GET /swappable_tokens`

Which tokens can be swapped and bridged, and between which chains. This is the allowlist for the
funding-source picker: **a token we cannot route is never offered to the user.**

Cache-tagged (UF-07 R3) — it changes rarely and must not be re-fetched per keystroke.

---

## `GET /swaps`

AMM transaction status for same-chain legs. Cross-chain status comes from `GET /plan/:planId`
instead — see [`02_BRIDGE_ARCHITECTURE.md`](02_BRIDGE_ARCHITECTURE.md).

---

## Chains

| Chain | id | USDC | Role here |
|---|---|---|---|
| Arbitrum | 42161 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | strategy chain + funding source |
| Base | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | strategy chain + funding source |
| Polygon | 137 | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | strategy chain + funding source |

All three are supported by the Trading API and bridgeable via Across. They come from
`src/lib/chains/config.ts`, the single source of truth that already feeds wagmi, Privy, the CSP RPC
allowlist, USDC lookups and every balance fan-out. **No chain list is duplicated for this feature** —
the codebase already carries three copies of a network list (`provisioningView.ts:18-19`,
`src/features/wallet/networks.ts`, `src/mocks/data/pools.ts`) and UF-19 removes one rather than adding a fourth.

---

## Error handling

- Non-2xx produces a typed `UniswapApiError` carrying the upstream code and message. Callers never
  regex-match strings — this repository already learned that lesson with revert-string classification
  (`classifyTxError`), and a typed code on `error.cause.code` is what lets the existing slippage
  auto-retry work.
- Retries are bounded and cover the transient class only: `429`, `502`, `503`, `504`, `408`, network.
  A `4xx` business error never retries.
- Every attempt has an `AbortController` timeout, with a cumulative budget bounding all retries — a
  brief blip recovers, a sustained outage fails fast and contained rather than hanging a render.
- Provider responses are **untrusted input**: everything is Zod-validated before it can influence a
  transaction (UF-28 R6).
- The API key is never logged, never included in an error message, and never serialized into a
  returned value (UF-05 R6), with a test asserting it.

## Quote freshness

Quotes expire. This repository already has the machinery and we reuse it rather than inventing a
parallel one:

- Operations pause after their build step (`pauseAfterKey`) so the Review renders a real quote, and a
  countdown re-runs only that step (`useReviewCountdown`).
- A background re-quote failure is non-fatal: the last good quote stands and the next window retries.
- A built transaction older than `MAX_BUILT_TX_AGE_MS` (4 minutes, against the server's 5-minute
  Permit2 `sigDeadline`) is **never sent** — it is rebuilt first.

That last rule matters more here than anywhere else: a bridge can take minutes, so a provisioning wait
can easily outlive the freshness window of an operation that was built *before* provisioning started
(UF-21 R4, UF-23 R2).
