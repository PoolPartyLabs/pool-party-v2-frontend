# Manager Manage V2 implementation plan

Owner: Murilo. Source: complete Manager Manage V2 handoff dated 2026-10-04 (882 lines), final owner rules R01-R23. Epic: [POO-2116](https://linear.app/yeildbay/issue/POO-2116). Baseline: public frontend main `e9330ef4`. All work is additive to V2. No contract deployment or wallet signing is part of this implementation session.

## Product contract

The launched fund opens a live canvas with synchronized position list and Manage block. Move range means Apply now; Create new position means New deposits only. Choosing Move removes the Create alternative until Back to actions. Every phase remains in the panel, including review, funding, pending and recovery when its integration is available. The immutable launch mandate cannot be edited here.

Use real quantities, token identities and served USD values. Missing data says Not available; zero is a valid read, never a fallback. Income is the hub USDC balance, not holder entitlement, uncollected position fees or idle. Operating cash belongs to each chain and remains 160 x 136 px. Uniswap flows include Collect fees -> Swap auto -> Income.

## PR sequence and ownership

| Order / issue | Files and delivery | Dependencies | Focused validation |
|---|---|---|---|
| 1 / [POO-2226](https://linear.app/yeildbay/issue/POO-2226) | `manager/fund/manage/ManageScreen.tsx`, `ManageCanvas.tsx`, `manageModel.ts`, `manageLayout.ts`; Build viewport initial scale; V2 manager route | Existing authorized fund reads, live core+chain+position key; no symbol-based lineage | Model amount/zero/missing/identity tests, graph fee flow and fixed geometry, family/ownership and mobile code tests |
| 2 / [POO-2227](https://linear.app/yeildbay/issue/POO-2227) | `ManageBlockPanel.tsx`, `manageDraft.ts`, `useManagePosition.ts`; reuse PriceRangeField and FundSlippageControl | Exact position metadata and current catalog PoolId; canonical ticks; one in-session draft per identity | Inversion-only/restored range, two paths/captions, Back/discard, no Dialog, unsupported/closed/liquidity states, stale reads |
| 3 / [POO-2228](https://linear.app/yeildbay/issue/POO-2228) | `lib/api/v2/manageSchemas.ts`, `manageActions.ts`; strict manager session boundary and inline review result | Deployed POO-2139 exact DTOs, preview effects/budgets and recovery evidence | Ownership, foreign identity, spacing, missing inputs, 409/503, no POST/signing for unproven budget |
| 4 / API follow-ups | Future policy save/read/version and allocation executor; authoritative cash/queue/income; full Move preview/recovery | Rafael supplies the missing authoritative contracts; UI remains explicitly unavailable until verified | No local-only save success, no duplicated principal/reserve, no replay of confirmed close; future deposit policy integration tests |

Root coordinates integration, docs, translations, Linear and Slack. Canvas worker owns shell/model/geometry; API worker owns typed server boundary. Max three active agents including coordinator. Tests run with one worker, one process at a time.

## Current API evidence and implementation decision

The frontend already has V2 reads and a server-only admin boundary. The current backend Move range builder returns an ordered transaction array and requires `eth_simulateV1`. It does not yet return the reviewed budget/cost/impact contract or a continuation/recovery contract required by this handoff. A successful initial sequence simulation does not prove a later continuation can reuse the original quote after a partial execution.

Therefore the current delivery implements the authorized metadata/review boundary and displays the unresolved execution capability as Not available. It does not manufacture open budgets from current position holdings, does not expose a V1 executor, does not sign or announce success. The API source audit at `a8299b147eef1ab9b6ae9bc8c5498168006149e7` is recorded in [POO-2229](https://linear.app/yeildbay/issue/POO-2229). It is source evidence, not a fresh authenticated production probe.

Future-deposit save and immediate allocation require independent contracts. A frontend slider cannot stand in for an executable allocation policy. Current allocation is read-only where that contract is missing; Aave keeps its timing UI without falsely saving or moving capital.

## Layout and accessibility

Desktop retains position list, canvas and 360px Manage panel. Smaller screens stack the same inline regions without redirecting to V1 or opening a modal. A textual position list supports keyboard/touch use. Pan/zoom reuses Build, initializes at 100%, and does not reset on panel phase changes. Actions are 44px minimum; range controls keep the Build behavior with a larger touch variant. Current app shell and footer are reused.

## Analytics and documentation

Reuse `strategy_manage_viewed`, `strategy_move_range_started`, `tx_flow_abandoned`, `app_cta_blocked`, and `app_error_shown`; emit submitted/completed only when their real operation exists and settles. No raw wallet, transaction payload or amount is added. Add all English keys and actual translations to all configured locales (11 on this public branch). Update IDS_REGISTRY, DESIGN_INTAKE, INTEGRATION_POINTS, ANALYTICS_EVENTS, COMPLIANCE_REGISTER and feature README per slice.

## Verification boundary

Run focused new tests and relevant V1/Invest/Build regressions, lint, typecheck, i18n/config checks. The owner excluded browser walkthroughs, full suites and heavy local builds/coverage. Code-level responsive coverage is not a claim of a browser or mainnet execution test. Every PR receives independent coordinator review; never mark unavailable backend acceptance criteria as delivered.

## Dependency decisions and delivery sequence

- [POO-2229](https://linear.app/yeildbay/issue/POO-2229), Rafael: authoritative post-close budgets, effect/fee/impact preview and continuation after partial Move execution. Initial `eth_simulateV1` success and transaction calldata alone do not supply these contracts.
- [POO-2230](https://linear.app/yeildbay/issue/POO-2230), Rafael: native-only operating cash per chain (superseded by the 2026-10-06 handoff), eligible withdrawal queue and actual hub USDC Income. `payoutReserve` is usable; `incomeCollection.heldDollars` is collection-round state, not proven total Income.
- [POO-2231](https://linear.app/yeildbay/issue/POO-2231), Rafael: persisted future-deposit policy, version/conflict/consumption semantics, allocation executor and block-to-position/replacement lineage.

Implementation PRs are split into: (1) authorized API reads/review boundary, (2) pure model/layout and shared viewport, (3) rendered canvas/screen and translations, (4) inline panel and range state, (5) authorized route/shell activation and final documentation. This keeps each dependency reviewable before the live entry changes.

## Acceptance status of this supported slice

| Handoff criteria | Current implementation / remaining dependency |
|---|---|
| AC01-AC07 | Authorized entry, live position identity, list/canvas/panel selection, holdings/logos, shared tick editor, two action paths and preserved Back drafts. |
| AC08-AC10 | All available phases are inline; selection/edit/review never move funds. Confirmation is disabled. No V1 endpoint receives V2 identity. |
| AC11-AC12 | Not available. Execution, gas provisioning, journal, partial/unknown recovery depend on POO-2229. No simulated completion is presented. |
| AC13-AC14 | Future-policy save and allocation execution are Not available under POO-2231. Aave timing remains visible, current allocation is read-only. |
| AC15 | Hub freeIdle is a token quantity; denominator is shareAssets and reserve is not added to free capital. Spoke free-idle semantics remain unavailable. |
| AC16-AC18 | Fixed per-chain cash cards, withdrawal reserve and correct unavailable states are delivered. Missing cash split/queue/hub Income remain POO-2230. |
| AC19-AC20 | Collect fees -> Swap auto -> Income is shown as a descriptive graph, not proof of an executed swap or new enforcement. No caps-enforcement claim is added. |
| AC21-AC23 | Loading/error/retry/empty and account/core guards, stacked small-screen layout, touch/keyboard controls, translations and focused regression evidence. Browser smoke and financial execution are not claimed. |

Drafts live in mounted panels keyed by core + chain + position key. Switching selected blocks preserves edits. Same-position refresh errors preserve last good metadata while disabling dependent actions and offering Retry. A 30-second watchdog prevents indefinite position/entry loading. Leaving the route ends these in-memory, unsubmitted drafts; no persisted policy is claimed.

## Implementation evidence, 2026-10-04

Source frames: [initial actions](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8335-2708), [Move](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8291-2563), [future deposits](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8334-2692).

- [PR #98](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/98): authorized API boundary.
- [PR #99](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/99): holdings model and graph geometry.
- [PR #100](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/100): rendered canvas, selection and translations.
- [PR #101](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/101): inline block/range state. Route activation and documentation follow in the final integration PR.

Verification: 134 distinct focused tests across 14 files passed across the final Manage/shared-controls and entry/investor/shell runs (87 and 50 test executions, with three prior entry cases overlapping). Tests use one worker and no file parallelism. Scope includes exact identity, malformed API DTOs, metadata retry, stale review, per-position drafts, keyboard focus, zero/missing values, fixed geometry, Build control defaults, account switches, sign-out/reauthentication, investor Details and shell layout restoration.

Scoped TypeScript for changed sources/tests and their imports passed. Repository lint passed with 112 existing warnings and one info; all 11 locales passed parity, ICU and usage; config check passed. Full local TypeScript exceeded the 2 GB heap limit. Remote lint/typecheck/i18n/config passed for the first two dependency PRs; audit reports existing package vulnerabilities, with package.json and pnpm-lock.yaml unchanged. No full local test suite, coverage, build, browser walkthrough, wallet signature or mainnet transaction was performed. Remote heavy jobs are independent CI checks, not local execution evidence.

Independent review found and corrected retained-metadata retry visibility, read-capability review invalidation, request watchdogs and baseline validation. The coordinator additionally locked same-wallet sign-out/reauthentication with a red-to-green regression. This delivers the supported frontend slice; AC11-14 and missing data sources remain dependent on the issues above.

The [2026-10-06 consolidated plan](manager-overview-manage-v2-delivery-2026-10-06.md) adds Overview and supersedes Operating cash with native-only display. Manage remains 160 x 136 px.
