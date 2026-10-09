# 0011. Shared V2 builder with a local Solana binding

- Status: Accepted
- Date: 2026-10-08
- Linear: [POO-2301](https://linear.app/yeildbay/issue/POO-2301), rules v1
- Supersedes: [ADR 0009](0009-local-solana-visual-preview.md) for presentation and local drawing state

## Context

The previous preview replaced the V2 wizard with a separate Add-toolbar screen. Murilo
requires the same Mandate, Build and Review journey, palette, canvas and Configure panel,
with Solana-specific spokes and protocol bodies. Existing Solana math, read models and
presenters remain useful. The owner continues to authorize frontend-only testing.

## Decision

Render one V2 builder presentation with separate standard and local bindings. The standard
binding keeps existing EVM draft/catalog/recovery and Review behavior. The local binding
owns isolated drawing state and descriptor choices; it never mounts EVM catalog, wallet,
launch or upload effects. Solana choices are not serialized as EVM `v2Selection`.

Reuse the selected-V2 three-click gesture and existing account/route/exit guards. Preserve
case-sensitive Base58 identities, native SOL versus WSOL and strict EVM execution schemas.
Missing pool identities, prices, reserves, quotes and transactions remain unavailable.
Visual readiness may open local Review without claiming financial execution readiness.

## Consequences

The same interaction structure is maintained in both runtimes, avoiding divergent screens.
Shared registries and identity helpers must distinguish local Solana descriptors from
executable EVM selections. A local saved drawing is not an on-chain fund or a wallet journal.
No authorization, backend service or real Solana execution is introduced.

ADR 0009's gesture, frontend-only boundary and reset safeguards remain applicable. Its
standalone presentation and component-only drawing implementation are superseded here.

## Alternatives considered

- Keep the separate preview: contradicts the owner's requested experience.
- Pass a catalog prop while mounting the EVM draft hook: still starts EVM effects in local mode.
- Add Solana to EVM launch schemas: misclassifies local visual intent as executable fund configuration.

## Delivery reconciliation, October 9, 2026

Delivery boundary: PRs #146/#148/#149/#150/#151/#152/#153 are merged. This delivery connects
the shared panel/Review foundation to the existing Mandate → Build → Review route, retains the
local Build/Manage host across phases and applies the route/account/exit guards described below.
This wizard change is pre-merge code delivery, without a deployment or native-browser visual
acceptance claim. Live Solana data, quotes, wallet operations and public launch remain
Not available; `solanaSpoke` stays off.

PR #146 delivered React Flow infrastructure; PRs #148/#149 adopted it in Manage and Build. Other
CanvasViewport callers keep the native default unless explicitly opting in. PR #150 delivered the
dormant Solana domain. PR #151 added explicit local 236 × 62 USDC Idle and 144 × 96 native SOL cash,
with a 32 px lateral gap and shared center. Cash is handleless decoration with unavailable quantity
and independent USD valuation. Standard Build remains without cash.

The shared V2 palette and Configure/Manage controls remain the only editor presentation; no
separate Add toolbar returns. Exact Base58 selects preserve mint identity. Local Review keeps
editable numerical intentions, with no seed quote, EVM economics, signing or public launch promise.
Unavailable upload, Max and Launch emit bounded blocked intent without side effects.

The local owner survives render fallback so applied draft/Review survive retry. Unapplied inner
panel fields may be lost; last pending metadata still protects leaving. Accepted Header and Save &
exit disposal acknowledges only generation-validated consent. Account/route reset remains
abandonment. First-party source-available licensing and upstream MIT/Apache/artwork boundaries
remain as recorded in LICENSE and THIRD_PARTY_NOTICES. No real financial permission is introduced.
