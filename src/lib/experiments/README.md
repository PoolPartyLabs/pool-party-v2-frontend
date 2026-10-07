# Restricted experiment access

POO-2281, rules v1. This package prepares multi-account Solana preview access. It has no mounted
provider, Server Action, route, toggle handler or wallet operation. Public V1/V2 behavior remains
the existing behavior. See the [delivery plan](../../../docs/solana-preview-preparation-plan-2026-10-07.md)
and [ADR 0008](../../../docs/adr/0008-server-authorized-experiment-access.md).

| Artifact | Responsibility |
|---|---|
| `PP-CORE-LIB-122`, `access.ts` | Strict versioned DTO, expiry and explicit capability checks. Client validation is not authentication. |
| `PP-CORE-LIB-123`, `fetchExperimentAccess.ts` | Unmounted server-only loader, server flag checks, current Bearer forwarding and minimal denial on failure. |
| `PP-CORE-LIB-124`, `solanaPreviewMode.ts` | Pure in-memory reveal preference, independent of `ContractFamily` and EVM draft storage. |

## API proposal, pending POO-2282

`GET /api/v1/experiments/solana-preview/access`, through the existing `apiFetch` transport. The
transport adds its server credential; the loader forwards the current session Bearer. There is
no client wallet argument. The API must validate the session signature/expiry and current cohort
membership. The legacy permissive `AccessTokenGuard` is not suitable authorization.

The normal `{ "data": ... }` response envelope contains one of these payloads:

```json
{
  "schemaVersion": 1,
  "experiment": "solana-preview",
  "status": "allowed",
  "capabilities": ["preview"],
  "expiresAt": "2026-10-07T13:01:00Z"
}
```

```json
{
  "schemaVersion": 1,
  "experiment": "solana-preview",
  "status": "denied",
  "capabilities": [],
  "expiresAt": null
}
```

The allowed timestamp is an illustrative contract value, not a live grant. Allowed capabilities
are `preview`, `catalog` and `execute`. Every allowed response requires `preview`; `catalog` and
`execute` are independent explicit permissions. Unknown versions, experiments, fields, duplicate
or unsupported capabilities and invalid timestamps fail closed. No profile, cohort list or token
is returned by this package.

The loader requires real mode plus server-resolved `fundContracts` and `solanaSpoke`, and uses
`revalidate: 0`. Missing configuration/session/endpoint, rejected token, error, malformed response
or elapsed grant produces the minimal denial. There is no previous-grant or public-profile fallback.
The proposed API response is `Cache-Control: private, no-store`; the API owner must confirm this
contract and grant lifetime. A maximum 60-second lifetime bounded by session expiry is a review
recommendation, not an implemented or approved rule. Every protected operation must independently
check live membership, rather than treating the client DTO as execution authority.

## Required client host behavior before mounting

Capture a session/account generation when starting a grant read. Clear the grant and mode
immediately on logout/account change, and discard responses from an earlier generation. Next
cookies are snapshots of one request: rereading them in the loader does not observe another
browser request changing sessions. The corresponding mock test covers only a changed token source
within the same call. Expiry must close the preview; focus and session changes must revalidate.

Only an approved host may feed the preference model. Three explicit presses of the already selected
V2 segment within 1,000 ms reveal `v2-solana`; dirty work blocks activation. Account/family changes,
denial or expiry clear the mode. `accountKey` identifies reset generations, not permission. The model
has no persistence, exit UI, catalog, provider or networking; those belong to later slices.

## Focused validation

```bash
pnpm exec vitest run src/lib/experiments/access.test.ts src/lib/experiments/fetchExperimentAccess.test.ts src/lib/experiments/solanaPreviewMode.test.ts src/lib/features/registry.test.ts src/lib/features/resolve.test.ts --maxWorkers=1 --no-file-parallelism
```

Keep server transport imports out of client barrels. No product analytics event is emitted until
a host is mounted. Later hosts must add view, activation/exit, abandonment, blocked-intent and error
events without raw identity or mint data.
