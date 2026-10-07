# Local Solana preview

POO-2281, rules v2. The Manager builder can reveal a frontend-only Solana editor with three
presses of the selected V2 segment within one second. This package shares its in-memory mode
between the header and the route. It has no storage, API grant, catalog, wallet or signing code.

| Artifact | Responsibility |
|---|---|
| `PP-CORE-LIB-124`, `solanaPreviewMode.ts` | Pure three-press gesture with a one-second window. |
| `PP-CORE-LIB-125`, `solanaPreviewStore.ts` | Route/account generation, guarded activation/exit and reactive sibling state. |

The existing `fundContracts` gate and `/manager/new` host own the entry. `ContractFamily` remains
`v1 | v2`; this mode never writes `pp.contractFamily` or an EVM draft. Account keys reset state;
they are not an allowlist. A hidden gesture is discoverable and provides no authentication.

Only the third press requests the existing navigation guard. Stay preserves the current screen.
Leave applies the transition only while the captured route/account generation and intent still
match. A new intent invalidates a previous pending callback. Route exit, V1 selection, logout,
account changes and reload clear the preview. Selecting V2 normally does not count as a reveal press.

`PP-CORE-LIB-122/123`, the earlier API-grant proposal, were removed before release when Murilo
simplified the scope. Their identifiers are retired. POO-2282 is canceled for this delivery.
[ADR 0009](../../../docs/adr/0009-local-solana-visual-preview.md) records the current decision and
supersedes [ADR 0008](../../../docs/adr/0008-server-authorized-experiment-access.md) for visual editing.
Real Solana execution remains a separate integration under POO-2262.

Run focused tests:

```bash
pnpm exec vitest run src/lib/experiments/solanaPreviewMode.test.ts src/lib/experiments/solanaPreviewStore.test.tsx src/features/manager/fund/BuilderRouteSwitch.solana.test.tsx --maxWorkers=1 --no-file-parallelism
```

The toggle owns entered/exited events. The local editor owns view, local configuration, abandonment,
blocked intent and real render errors. No wallet/mint/financial amount or transaction completion
is part of preview telemetry.
