# 0009. Frontend-only Solana visual preview

- Status: Accepted
- Date: 2026-10-07
- Linear: [POO-2281](https://linear.app/yeildbay/issue/POO-2281), rules v2
- Supersedes: [ADR 0008](0008-server-authorized-experiment-access.md) for the visual-preview delivery

## Context

Murilo explicitly replaced the API-dependent preparation with a simpler local editor on October 7.
The public application must retain the ordinary V1/V2 selector. Existing real Solana wallet, launch
and catalog work remains separate. The owner authorized multiple accounts without a new cohort API.

## Decision

Mount an isolated visual editor on `/manager/new`, behind the existing `fundContracts` release gate.
Three presses of already-selected V2 within one second reveal V2 Solana. Use an in-memory store with
server snapshot `standard`. Keep `ContractFamily`, its persistence and EVM draft schemas unchanged.
The host registers only on the builder route and resets on account/logout/family/route changes.

Use the existing unsaved-changes guard for entry and exit. Delayed callbacks must match both host
and intent generation. Reuse presentation-only canvas pieces, not the EVM draft/catalog controllers.
Store local configuration only in component memory. No API/RPC, wallet, grant, launch or signing
operation is imported by the visual editor. Show Not available for absent market data and execution.

Keep `solanaSpoke` default off for future real integration. The local visual mode does not enable
it. Real binding, catalog, quotes, provisioning and recovery continue under POO-2262/2261/2239/2240.
No existing integration authorization or deployment claim is changed by this decision.

## Consequences

The owner can test presentation now without an API dependency. Every account on the existing route
can reveal the same local editor. The gesture is discoverable, not an access restriction. No local
choice can produce a transaction or reclassify an EVM fund. Leaving or reloading discards preview
configuration with the existing warning while EVM saved drafts remain unchanged.

The earlier unmounted grant DTO/loader are removed before release; their artifact IDs remain retired.
ADR 0008 stays immutable as decision history. If restricted real execution is requested later,
define its authorization and discovery scope independently before wiring it.

## Alternatives considered

- New API cohort grants: deferred by the owner to avoid blocking visual testing.
- A third ContractFamily value: conflates a visual experiment with persisted EVM contract identity.
- Reusing the EVM draft controller: would query EVM catalogs and overwrite unrelated draft storage.
