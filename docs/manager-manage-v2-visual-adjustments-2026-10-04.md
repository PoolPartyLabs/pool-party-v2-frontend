# Manage V2 visual adjustments: implementation plan

Issue: [POO-2232](https://linear.app/yeildbay/issue/POO-2232), rules v1, under POO-2116. Base: public frontend main `9442b920`. Source: owner's complete 199-line incremental handoff dated 2026-10-04, `handoff-manager-v2-ajustes-visuais-2026-10-04.md`. It supersedes earlier visual geometry while the main Manage handoff retains the financial rules.

## Sources and scope

[Initial actions](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8335-2708), [Move](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8291-2563), [Review](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8334-2692), [Aave](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8296-2579), [future deposits](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8300-25774), [In/Out variants](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8346-2765).

The five states share one graph. This slice changes geometry and current-position status presentation. It enables no transaction, changes no range math/allocation, and does not resolve POO-2228/2229/2230/2231.

## Stages, files and dependencies

| Stage | Owned files | Change | Dependency / verification |
|---|---|---|---|
| 1. Geometry | `manage/manageLayout.ts`, `.test.ts` | Center the deposit/withdraw spine on strategy branch anchors, not lateral cash extents. Align single-spoke Bridge/Idle/input Swap/position/Collect. Keep cash at 160 × 136 px, lateral gap 24 px; grow liquidity cards to 176 × 232 px. Align principal/income bend centerlines. | Existing LAYOUT constants and typed ManageModel. Test symmetry, aligned centers, nonoverlap, bounds, shared bend height and fee-conversion presence; do not snapshot every coordinate. |
| 2. Current range status | `manage/manageModel.ts`, `.test.ts` | Normalize current open position.uniswap.inRange to available in/out or unavailable, bound to core/chain/position identity. | Existing authorized positionsSummary. No new RPC or draft-derived value. Test true/false/missing/closed/Aave and identity. |
| 3. Presentation | `manage/ManageCanvas.tsx`, `.test.tsx`, `.stories.tsx` | Status text+dot and decorative 148 × 10 px bar, 148 × 4 px track, fixed 2 × 10 px center mark at x73. Use success/destructive or neutral unavailable; cash/card radius 16 px. Preserve existing holdings/logos and Build spoke styling. | Existing translated manager.operate.inRange/outOfRange and manager.manageV2.notAvailable. No new locale key. Test semantic text, no slider/progress role, no Aave indicator and selection stability. |
| 4. Review and delivery | This document, DESIGN_INTAKE, IDS_REGISTRY, feature README, integration/compliance notes | Record accepted differences from Figma, checks and unchanged unavailable operations. Review both implementation slices and merge a focused PR. | One local test process/worker, scoped TypeScript, lint. No local full suite/build/coverage or browser walkthrough. |

A GPT-6.1-sol worker owns only stage 1; coordinator owns stages 2-4 and checks. Work stays in the existing clean isolated worktree; unrelated original-workspace changes remain untouched.

## Visual and data contract

- Cash cards remain 160 × 136 px, padding 12 px, vertical gap 8 px, radius 16 px. Spoke remains Build surface-raised (#2A2A2A), border #333333, dash 5/5. Canvas uses #171717. Cash alone uses periwinkle alpha 16/42.
- The reference has hub x312, Aave x200, spoke x424 and output centers x178/x446. These describe the single-spoke fixture, not app-wide absolute positions. Larger graphs grow from calculated anchors and keep fixed-size cards.
- The compact indicator sits below the existing holdings/value. Its fixed center marker conveys no price, percentage, balance or composition. Current-position status is independent of edited ticks/presets/future policy.
- A missing valid status uses existing Not available and neutral styling. Aave has no range indicator. The required fund-read error is handled by ManageEntry before rendering; no failed read turns green by default.
- The 1520 px artboard is not an app min-width. Existing stacked layout, 360 px panel, 220 px desktop list and viewport pan/fit remain.

## Mandatory difference from the Figma draft

Figma places gray/green bends at y884 and outputs at y932 without a fee-conversion pill. Code already includes Collect fees -> Swap auto -> Income. Keep conversion, allocate explicit space for it and use a shared derived return-bend anchor. Do not force y884, hide the pill or route a principal line through it. Final computed fixture dimensions and the remaining design reconciliation are recorded with verification below.


## Delivered geometry and accepted design difference

All implementation stages are complete. The reference fixture uses these computed values:

| Element | Delivered geometry |
|---|---|
| Deposit / hub Idle / Withdraw axis | x312 |
| Aave / straight spoke axes | x200 / x424, each 112 px from the hub |
| Withdrawal output / Income centers | x178 / x446, each 134 px from the hub |
| Spoke cash | x536, y368, 160 × 136 px; 24 px right of Idle |
| Liquidity position | 176 × 232 px |
| Spoke group | 392 px wide, with height derived from contents |
| Retained fee Swap | x348, y884, 176 × 26 px |
| Shared final return bend | y934; principal bypasses the fee Swap to its left |
| Output cards / Withdraw top | y982 / y1198 |
| Whole reference graph | 736 × 1284 px |

The fee conversion adds 50 px to the final return/output section compared with the supplied drafts. The principal detour preserves the two distinct ports 24 px apart, and the final gray/green bends share one stroke centerline. These dimensions are graph-space coordinates; the viewport still controls pan, zoom and fit.

For multiple positions/chains, direct horizontal gray and green spans are checked against each other. Where they would overlap, separate upstream buses and outer trunks add 48 px before a shared final bend. Same-tone joins and perpendicular crossings are allowed; collinear cross-tone fusion and routes through cards are rejected by regression tests. The reference single-spoke graph does not need these extra buses.

Design reconciliation remains: add the existing fee-conversion pill and its resulting vertical space to the five Figma drafts. No fee conversion was removed to match an outdated graph.

## Validation and review

- 55 distinct focused tests passed: 53 across Manage model/layout/canvas/screen/panel and the existing CanvasViewport; 2 documentation count guards. Initial new status/geometry tests failed before implementation. Review found and reproduced the multi-return overlap, then its added regression passed with the routing correction.
- Scoped TypeScript includes the changed Manage sources, stories and tests and their imports. Biome checks only the changed TypeScript files. Localization validation passed for all 11 current public-repository locales (2,845 source keys); existing range/unavailable translations are reused.
- The real Manage panel test covers preset editing, Move selection, inline Review and future-deposit selection while preserving the live canvas geometry/status. Existing keyboard focus, selection and responsive stacking tests remain green.
- GPT-6.1-sol performed an independent code review. Full local suite, coverage, build and browser checks were intentionally excluded at the owner's request. This is code/test evidence, not a claim of browser or pixel-level validation.
- Existing documentation census drift was corrected while updating the required registries: 668 artifact rows and 501 integration markers across 289 source files. No new artifact IDs, integrations or locale keys were introduced.
- Analytics: no new events. This change adds a decorative read-only indicator and geometry to an existing screen; ManageScreen and the existing panel retain ownership of view, selection and operation events. No completion event or executable capability was added.

Financial dependencies POO-2229/2230/2231 remain open under POO-2228. This delivery does not enable Move signing, future-deposit persistence, allocation execution, new cash sources or Income operations.
