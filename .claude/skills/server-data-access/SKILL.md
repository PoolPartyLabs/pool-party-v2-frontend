---
name: server-data-access
description: Blueprint for the real-data counterpart to mocks: reading and writing the pool-party-api and analytics backends directly from Next server actions (apiFetch / analyticsFetch, server-only; there is no separate BFF service). Zod schema then a "use server" action (wallet from session) then typed data, with throttle-aware caching and revalidateTag invalidation. Use when wiring a mocked surface to real data or reviewing a data/server-action change. Pairs with mock-service-blueprint and wallet-operation-flow.
---

# Server data access

Mocks are the visual/design harness; this skill is their real twin. There is **no separate BFF service**: Next **server actions call the api / analytics backends directly** from server-only code. Every read/write goes through a Zod schema (the API contract), a `"use server"` action that derives the wallet from the session, and `apiFetch`/`analyticsFetch`. Each mocked-but-not-real surface needs a wiring task; this is how you land it and flip the `isMockMode` ternary. See `docs/ARCHITECTURE_STATE.md` for which surfaces are already real vs mock-by-default.

## Anatomy of a READ seam

`*Schema.ts` (zod contract) → `fetchXxx.ts` (`import "server-only"`, calls `apiFetch`, maps API shape → FE domain) → `actions.ts` (`"use server"`, wallet from session, Bearer header) → consumed by a Server Component (mock-mode SSR) **or** a client data hook (real mode, see the `usePositions` shape in `react-component-blueprint`).

Reference: `src/features/portfolio/actions.ts` → `src/lib/portfolio/fetchPositions.ts` → `src/lib/portfolio/positionsSchema.ts`. The action never trusts a client wallet: `const wallet = await getSessionWallet(); if (!wallet) return [];` and forwards `await getAuthHeader()`.

## Anatomy of a WRITE seam

Writes use the **build-tx** pattern (server builds calldata, client signs + sends, see `wallet-operation-flow`), not server-side fund moves. The action POSTs and returns a `builtTxSchema`-validated `BuiltTx`; it does **not** revalidate. After the tx confirms, the **client** calls a thin `"use server"` `revalidateTag` wrapper, then `router.refresh()`.

Reference: `src/features/manager/operations/createPoolAction.ts` (build) + `src/lib/strategies/revalidateStrategies.ts` (`revalidateTag(STRATEGIES_CACHE_TAG)`), called from `InvestModal.tsx` on success. The tag constant is exported from the fetcher so producer and invalidator share one source.

## `apiFetch` options contract

`src/lib/api/client.ts` (`import "server-only"`):
- `method` (default `GET`), `body` (auto-JSON), `headers` (e.g. Bearer), `network` (legacy Arbitrum/Base → `PP_API_URL_LEGACY` when set), `schema` (zod, validates the unwrapped payload), `unwrapData` (default true), `revalidate` (GET-only cache seconds), `tags` (GET-only, requires `revalidate`).
- Always injects `x-api-key` from `PP_API_KEY`; base URL `${PP_API_URL}/api/v1/${path}`.
- Unwraps the inner `data` only when `{ data }` is the sole key; `204` → `null`.

**`analyticsFetch`** (`src/lib/analytics-api/client.ts`) differs: env `ANALYTICS_API_URL`, no key; **no `/api/v1` prefix** (root-mounted); **no envelope unwrap**; error body `{ error|reason, message }` (vs pp_api `{ code, message }`); **`revalidate` defaults to 60** and every GET is cached; **no retry**; no `network`/`tags`.

## Caching & throttle rules

Why it matters: pp_api has a per-IP NestJS throttler and all SSR shares one container IP, so re-fetching on every navigation tripped 429 → error boundary.

- **pp_api**: no-store by default. Add `revalidate` + `tags` **only** to **wallet-independent, slow-moving** reads (e.g. the strategy catalog, `revalidate: 60`, tag `"strategies"`). Per-wallet reads (positions, balances) **omit** `revalidate` so they stay fresh.
- **analytics**: caches all GETs (default 60). Per-wallet analytics reads can cache because the address is in the URL; use short windows for fast-changing reads (e.g. `revalidate: 10`).
- **Never cache** writes (non-GET ignore `revalidate`/`tags`) or anything that must be instantly fresh.

## Error model

`src/lib/api/errors.ts`: `ApiError { status, code }` (upstream/network; `status 0` = network) and `ApiParseError { status: 422, code: "SYSTEM_PARSE_ERROR", issues }` (contract drift). Retry is **GET-only** over `{429,502,503,504}`, max 2, capped backoff honoring `Retry-After`; writes never replay. Surface by catching the typed error and mapping `code`/`status`: swallow a per-wallet `404 → []` where expected; analytics writes map codes to a discriminated outcome union rather than throwing.

## Mock-vs-real wiring

`src/lib/services/index.ts`: `export const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE !== "false"` (unset = mock). Each service is `isMockMode ? mockX : mockX` today, both branches point at the mock; the ternary is the single type-safe cutover. Mark the seam `// PP-INTEGRATION-POINT: <real replacement>`. **Rule:** each mocked-but-not-real surface needs a wiring task, build the real `fetch*`/action twin (this skill), then flip the ternary.

## Copy-paste skeletons

```ts
// fooSchema.ts
export const apiFooSchema = z.object({ items: z.array(z.object({ id: z.string() })) });

// fetchFoo.ts
import "server-only";
export async function fetchFoo(wallet?: string, auth: Record<string, string> = {}) {
  if (!wallet) return [];
  try {
    const r = await apiFetch(`foo/${wallet}`, { schema: apiFooSchema, headers: auth }); // per-wallet → no revalidate
    return r ? r.items.map(mapFoo) : [];
  } catch (e) { if (e instanceof ApiError && e.status === 404) return []; throw e; }
}

// actions.ts
"use server";
export async function getFooAction() {
  const wallet = await getSessionWallet(); if (!wallet) return [];
  return fetchFoo(wallet, await getAuthHeader());
}
// shared read adds { revalidate: 60, tags: [FOO_TAG] }
```

```ts
// buildFooTxAction.ts (write = build-tx; see wallet-operation-flow)
"use server";
export async function buildFooTxAction(input: FooInput) {
  const wallet = await getSessionWallet(); if (!wallet) return null;
  return apiFetch("portfolio/build/foo-tx", {
    method: "POST", body: { ...input, wallet },
    schema: builtTxSchema, network: input.network, headers: await getAuthHeader(),
  }); // no cache, no retry (non-GET)
}
// client, after the tx confirms: await revalidateFooAction(); router.refresh();  // → revalidateTag(FOO_TAG)
```

## Reviewer checklist

- [ ] Zod `schema` passed to every `apiFetch`/`analyticsFetch` (parse failure throws `ApiParseError`).
- [ ] `import "server-only"` on the fetcher; `"use server"` on the action; client never imports the client module.
- [ ] Wallet from `getSessionWallet()`, not a client arg; Bearer via `getAuthHeader()`.
- [ ] `revalidate` + `tags` only on wallet-independent reads; per-wallet pp_api reads no-store; never on writes.
- [ ] Writes are non-GET (no retry, no replay); invalidate via a `"use server"` `revalidateTag` wrapper sharing the exported tag, called client-side after confirmation.
- [ ] Correct client: pp_api (unwrap, `/api/v1`, `x-api-key`, retry) vs analytics (no unwrap, root mount, `{error,message}`, default cache).
- [ ] Errors mapped by typed `code`/`status` (404→[] where expected; writes → outcome union).
- [ ] `// PP-INTEGRATION-POINT` on the seam; mock twin exists; `isMockMode` flipped or a wiring task tracks it.

## Anti-patterns

- Fetching the backend from a Client Component or a mock service (data access is server-only).
- Caching a per-wallet read, or a write; or no-storing the shared catalog (re-introduces the 429 storm).
- Trusting a client-supplied wallet address instead of the session.
- Returning unparsed/`any` data (no schema), or swallowing `ApiParseError` (it signals real contract drift).
- Retrying or replaying a write.
