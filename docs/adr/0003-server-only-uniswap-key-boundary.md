# 0003. Server-only boundary for the Uniswap API key

- Status: Accepted
- Date: 2026-07-24
- Linear: POO-1022 (epic), POO-1024, POO-1029, POO-1050
- PR: (this PR)

## Context

ADR 0002 adopts the Uniswap Trading API as the provisioning swap and bridge rail. That introduces
`UNISWAP_API_KEY`, a credential with real cost and rate-limit exposure attached to it.

The obvious implementation is the one Uniswap's own documentation shows, and the one their official
`swap-integration` skill demonstrates in its React examples: call the Trading API from a client
component. It is simpler, it avoids a server round-trip per quote, and it is what most integrations do.

It is also wrong for this codebase, and the reason is structural rather than stylistic. This repository
already draws a hard line: **secrets live behind `import "server-only"`**. `PP_API_KEY` and
`ANALYTICS_API_URL` are read only inside `src/lib/api/client.ts`, which begins with `import "server-only"`
(line 38), and every write already follows *server builds calldata, client signs*
(`investActions.ts` → `useInvest` → `executeBuiltTransaction`).

There is a specific trap here. `src/lib/provisioning/planner.ts` currently sits **in the client
bundle** — the barrel `src/lib/provisioning/index.ts` is imported by `"use client"` components — so
adding an `apiFetch` call to it does not fail at review, it fails at build. And a `NEXT_PUBLIC_`-
prefixed key would not fail at all: it would ship to every browser silently and work perfectly in
testing. That asymmetry is what makes this worth an ADR: the wrong choice is invisible.

## Decision

**`UNISWAP_API_KEY` is server-only. Every Uniswap HTTP call happens in a Server Action. The browser
signs and broadcasts, and never holds a credential.**

1. **No `NEXT_PUBLIC_` prefix, ever.** The variable is `UNISWAP_API_KEY`, read only inside modules that
   begin with `import "server-only"`, exactly like `PP_API_KEY`.

2. **The transport is `src/lib/uniswap/client.ts`**, mirroring `src/lib/api/client.ts`: `server-only`,
   `x-api-key` injected per request, Zod-validated responses, bounded retry on the transient class,
   and an `AbortController` budget across attempts.

3. **The only public surface is `src/lib/uniswap/actions.ts`** (`"use server"`). Each action returns a
   typed `{ ok: true, … } | { ok: false, code, message }` and never throws across the RSC boundary,
   matching the shipped `BuildTxResult` pattern.

4. **The wallet address comes from the SIWE session, never from an action argument.** A client-supplied
   address is ignored, not merely validated.

5. **The provisioning module is split along the boundary.** Types and pure math (`types.ts`,
   `computeNeed.ts`, the gas classifier, the cost model) stay client-importable and free of viem,
   React and I/O. Anything touching a secret or the network moves behind the action boundary. The
   client barrel must not re-export anything that transitively imports `server-only`.

6. **`pnpm build` is a required gate on any PR touching this boundary.** `pnpm typecheck`, `lint`,
   `test` and `i18n:check` all pass happily while a `server-only` module leaks into a client bundle.
   Only the Next build catches it. This is a known, previously-paid-for lesson in this repository.

7. **No CSP entry for `trade-api.gateway.uniswap.org`, and that is load-bearing.** Because nothing is
   fetched from the client, `connect-src` in `src/lib/security/csp.ts` is untouched. The absence is a
   *test of the invariant*: if a future PR needs that origin allowlisted, a call has moved to the
   browser and this ADR has been violated. Reviewers should treat such a diff as a security regression,
   not a config gap.

8. **The key never appears in output.** Not in logs, not in an error message, not serialized into a
   returned object. Enforced by a unit test on the client, plus a build-output grep asserting the key
   is absent from the client bundle (POO-1050 R1).

## Consequences

**Positive.**

- The key cannot leak to a browser, because it is never in one.
- No new client network origin, so the CSP surface does not grow — and the CSP still ships
  Report-Only, meaning a wrong allowlist would fail *silently* today. Not needing one avoids that
  failure mode entirely.
- Server Actions can cache. `listSwappableTokens` is cache-tagged rather than re-fetched per
  keystroke in the funding-source selector.
- One consistent story across the whole product: every credential is server-side, every write is
  server-built and client-signed.

**Negative, accepted.**

- **A server round-trip per quote.** Quotes are already re-fetched on a 10-second Review countdown, so
  the cost is bounded and the pattern is familiar. Not free, but small.
- **Uniswap's own examples do not apply verbatim.** The vendored `swap-integration` skill shows
  client-side React hooks; ours must be adapted. This is recorded in the skill's provenance header and
  in `.claude/skills/INDEX.md` so nobody copies the client pattern by accident.
- **Rate limits are now per-server, not per-user.** All traffic shares one key, so a burst is a shared
  bucket. This product has been bitten by exactly this before with a shared backend API key, so the
  transient-retry class and timeout budget are sized with it in mind.
- **A hot path depends on our own server being up**, not just Uniswap's. Acceptable: every other write
  in the product already does.

## Alternatives considered

**Client-side calls with a public key.** Rejected. It would be the only credential in the product
exposed to a browser, it needs a CSP change, and the failure mode is invisible — a `NEXT_PUBLIC_` key
works flawlessly in every test and leaks in production.

**A proxy API route (`/api/uniswap/*`) instead of Server Actions.** Rejected as redundant. It is the
same boundary with more surface: a hand-rolled route needs its own auth, validation and rate limiting,
whereas a Server Action inherits the session and the typed-result contract the codebase already uses.

**Putting the key in `pool-party-api` and proxying through `apiFetch`.** Rejected for now, though it
remains open. It would centralize the credential for every client (including the future white-label
APIs), but it reintroduces the cross-repo dependency ADR 0002 exists to avoid. Because the boundary is
already an action, moving the transport later does not change any caller.

## References

- ADR 0002 — Uniswap Trading API as the provisioning rail
- `docs/10_SECURITY.md` and the `frontend-security` skill — the server-only secret boundary
- `src/lib/api/client.ts` — the pattern being mirrored
- `docs/_hackathon/01_UNISWAP_INTEGRATION.md` — endpoint reference
