# Fallback Review and launch (POO-2183, rules v1)

Minimal, unstyled, temporary binding to the POO-2177 public hooks. Murilo owns POO-2172 Review and POO-2171 panels. No builder, canvas, Mandate or Review file is modified.

**fallback; merges only if POO-2172 Review is not on main by 09:00 BST; Murilo's page replaces it**.
Open as DRAFT only. Do not merge or deploy from this task. Confirmed date: October 4, 2026. Cutoff: 09:00 BST (08:00 UTC). Demo: 16:00 BST (15:00 UTC).

## Demo clicks

1. Run the existing real V2 environment with `NEXT_PUBLIC_FEATURE_FUND_CONTRACTS=on`, `NEXT_PUBLIC_MOCK_MODE=false`, existing server API/session/media credentials and configured wallets. Never put API keys in public variables.
2. Sign in with the manager wallet. Complete Mandate and Build with the demo pools/reserve below; save the draft in this browser. This browser's saved draft and original manager wallet are required.
3. In Manager Console, choose the V2 section and click **Review & launch drafts (v2)**. The link is in our slice-owned `FundExplorer` manager section; Murilo's `FundDraftsSlot`, `MandateDraftsList`, builder and canvas files remain untouched. Direct index URL: `/en/manager/fund-launch/review`.
4. Check the draft's name, London-time last-saved timestamp and readiness/blockers summary. Click **Review & launch** for that draft. For a launch already in progress, click **Resume** instead to open its existing journey. Launch status is wallet-scoped. Mandate storage itself is browser-local and has no wallet ownership metadata; the index explicitly discloses this rather than inventing an ownership filter.
5. Edit name, description, PNG/JPG logo, fees (Instant 0-10%), minimum and seed. Click **Refresh** for balance/catalog as needed. Check the whole-share seed preview and fixed investor terms.
6. Under **Default execution settings (fallback until block panels ship)**, select the exact Mandate pool/asset if ambiguous. Pool defaults: canonical finite aligned full range, slippage 1%. Untick Full range to edit aligned canonical ticks. Existing nonempty panel config is read-only and wins entirely.
7. Resolve every blocker. Click **Launch · N signatures** once. The existing launch entry freezes a snapshot and navigates to `/en/manager/fund-launch/<journeyId>`; click **Sign next step** there. Each wallet transaction is explicit. No signature is requested on index or Review mount.

## Confirmed demo catalog selections

From the orchestrator-provided fund #2 `mainnet-records/fund2/draft.json` (read October 4, 2026); these are selections, not hardcoded UI defaults:

- Arbitrum USDC/WETH v4 (42161): `0xfc7b3ad139daaf1e9c3637ed921c154d1b04286f8a82b805a6c352da57028653`.
- Robinhood USDG/WETH v4 (4663): `0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593`.
- Arbitrum Aave USDC reserve: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`; assetKey `arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831`.

Index readiness is a read-only estimate using saved Review, live catalog/balance and the same fallback preview; it does not persist Review, execution or allocate missing leaf budgets. Opening Review and launch revalidates. Wallet-local journeys remain reachable even if their saved Mandate draft was removed.

## Safety and seams

`applyFallbackExecutionAtLaunch` creates a separate immutable launch draft snapshot. It never calls the Mandate/canvas store; only `useV2ReviewDraft` persists Review data. The preview uses the same adapter without persisting anything. Panel execution overrides are discarded except already-explicit leaf budgets, so stale launch overrides cannot defeat panel settings. Missing leaf budgets remain blockers.

Pool identity and tickSpacing come from the saved catalog-backed Mandate pool row; the existing launch driver rereads the real pool before a trade. Tick alignment uses mathematical ceil/floor, including negative ticks. Empty means null/undefined or no own config keys; any partial panel configuration is authoritative and fails closed if incomplete. No inferred leaf allocations, pools outside the Mandate, unsupported chains/protocols or guessed swaps.

Aave Supply identity comes from the manager's explicit Mandate reserves and token rows, with explicit selection for ambiguity. The existing launch driver supports only the hub deposit asset, so non-base reserves are blocked here before launch. No slippage control is offered when no swap is needed; non-base Aave swaps require the owning executor to support them first.

`PP-MGR-SCR-007` route, `PP-MGR-CMP-083` component and `PP-MGR-LIB-047` helper are derived after the merged registry's existing maximums, outside Murilo's reserved ranges. Slice E claimed CMP-082 during final validation; only our component was renumbered, preserving its newly merged registry row. `manager.fallbackReview.*` is translated key-by-key across all 11 configured locales. Non-English translations need native review under the existing locale policy.

## Open questions

- Date and demo selections are confirmed above. Any additional ambiguous rows still require manager selection, never an inferred trade.
- When POO-2172 lands, remove/retire this separate fallback route rather than integrating it into Murilo's page. POO-2171 nonempty config already wins.

## Validation (October 4, 2026)

- Initial baseline: `696f24c7`. Final merge includes slice E `150f16d2`; registry has 621 artifact rows. Marker census is re-derived in `docs/INTEGRATION_POINTS.md`. Dependencies installed with `pnpm install --frozen-lockfile`; package/lockfile unchanged.
- `pnpm typecheck`, `pnpm lint` (zero errors; 84 existing warnings and one info), `pnpm i18n:check` (11 locales, 2519 source keys), `pnpm build`: passed on merged slice E. Build includes the new dynamic fallback route. Compilation produces existing dependency/webpack warnings.
- Touched launch directory and registry documentation tests: 22 files, 163 passed. Fallback alone: 33 added tests covering helpers, precedence, blockers, fee parsing, upload, launch failure and route gates.
- Initial full Vitest baseline: 763 files, 10203 passed, five pending, zero failed. Initial branch: 766 files, 10236 passed, same five pending, zero failed. Final slice E baseline: 767 files, 10231 passed, five pending, zero failed. Final branch: 770 files, 10269 passed, zero pending, zero failed. Failure and pending identities compared on both baselines: no new regressions. Pending-count variation is in existing tests; no existing test was edited by this slice.
- Main baseline was tested from an archived snapshot with exact-lockfile dependencies, inside this issue's own worktree. Removed that scratch before final typecheck/build because TypeScript includes nested source trees. No other worktree touched; no signatures, broadcasts, merges or deployment performed.
