# Fallback Review and launch (POO-2183, rules v1)

Minimal, unstyled, temporary binding to the POO-2177 public hooks. Murilo owns POO-2172 Review and POO-2171 panels. No builder, canvas, Mandate or Review file is modified.

**fallback; merges only if POO-2172 Review is not on main by 09:00 BST; Murilo's page replaces it**.
Open as DRAFT only. Do not merge or deploy from this task. The brief does not specify the calendar date for the 09:00 BST cutoff and 16:00 BST demo; confirm it before any landing decision (work started October 4, 2026).

## Demo clicks

1. Run the existing real V2 environment with `NEXT_PUBLIC_FEATURE_FUND_CONTRACTS=on`, `NEXT_PUBLIC_MOCK_MODE=false`, existing server API/session/media credentials and configured wallets. Never put API keys in public variables.
2. Sign in with the manager wallet. Complete Mandate and Build, save the draft in this browser. Copy `draftId` from the existing builder URL. This browser's saved draft and original manager wallet are required.
3. Open `/en/manager/fund-launch/review/<draftId>` directly. Slice E landed on main during final validation, but its Manager Console reuses Murilo's existing `FundDraftsSlot` / `MandateDraftsList` rather than providing a slice-owned draft list. Those files are outside this new-files-only scope, so this PR documents the direct URL instead of changing them. The heading is "Review & launch (v2)".
4. Edit name, description, PNG/JPG logo, fees (Instant 0-10%), minimum and seed. Click **Refresh** for balance/catalog as needed. Check the whole-share seed preview and fixed investor terms.
5. Under **Default execution settings (fallback until block panels ship)**, select the exact Mandate pool/asset if ambiguous. Pool defaults: canonical finite aligned full range, slippage 1%. Untick Full range to edit aligned canonical ticks. Existing nonempty panel config is read-only and wins entirely.
6. Resolve every blocker. Click **Launch · N signatures** once. The existing launch entry freezes a snapshot and navigates to `/en/manager/fund-launch/<journeyId>`; click **Sign next step** there. Each wallet transaction is explicit. No signature is requested on Review mount.

## Safety and seams

`applyFallbackExecutionAtLaunch` creates a separate immutable launch draft snapshot. It never calls the Mandate/canvas store; only `useV2ReviewDraft` persists Review data. The preview uses the same adapter without persisting anything. Panel execution overrides are discarded except already-explicit leaf budgets, so stale launch overrides cannot defeat panel settings. Missing leaf budgets remain blockers.

Pool identity and tickSpacing come from the saved catalog-backed Mandate pool row; the existing launch driver rereads the real pool before a trade. Tick alignment uses mathematical ceil/floor, including negative ticks. Empty means null/undefined or no own config keys; any partial panel configuration is authoritative and fails closed if incomplete. No inferred leaf allocations, pools outside the Mandate, unsupported chains/protocols or guessed swaps.

Aave Supply identity comes from the manager's explicit Mandate reserves and token rows, with explicit selection for ambiguity. The existing launch driver supports only the hub deposit asset, so non-base reserves are blocked here before launch. No slippage control is offered when no swap is needed; non-base Aave swaps require the owning executor to support them first.

`PP-MGR-SCR-007` route, `PP-MGR-CMP-083` component and `PP-MGR-LIB-047` helper are derived after the merged registry's existing maximums, outside Murilo's reserved ranges. Slice E claimed CMP-082 during final validation; only our component was renumbered, preserving its newly merged registry row. `manager.fallbackReview.*` is translated key-by-key across all 11 configured locales. Non-English translations need native review under the existing locale policy.

## Open questions

- Confirm the calendar date of the conditional 09:00 BST cutoff and 16:00 BST demo.
- Confirm the demo Mandate's exact pool and hub deposit Aave reserve; ambiguous rows require manager selection, never an inferred trade.
- When POO-2172 lands, remove/retire this separate fallback route rather than integrating it into Murilo's page. POO-2171 nonempty config already wins.

## Validation (October 4, 2026)

- Initial baseline: `696f24c7`. Final merge includes slice E `150f16d2`; registry has 621 artifact rows. Marker census is re-derived in `docs/INTEGRATION_POINTS.md`. Dependencies installed with `pnpm install --frozen-lockfile`; package/lockfile unchanged.
- `pnpm typecheck`, `pnpm lint` (zero errors; 84 existing warnings and one info), `pnpm i18n:check` (11 locales, 2508 source keys), `pnpm build`: passed. Build includes the new dynamic fallback route. Compilation produces existing dependency/webpack warnings.
- Touched launch directory and registry documentation tests: 20 files, 150 passed. Fallback alone: 33 added tests covering helpers, precedence, blockers, fee parsing, upload, launch failure and route gates.
- Initial full Vitest baseline: 763 files, 10203 passed, five pending, zero failed. Branch: 766 files, 10236 passed, same five pending, zero failed. Failure and pending identities compared: no new regressions. Full comparison is repeated after the slice E merge before the DRAFT PR.
- Main baseline was tested from an archived snapshot with exact-lockfile dependencies, inside this issue's own worktree. Removed that scratch before final typecheck/build because TypeScript includes nested source trees. No other worktree touched; no signatures, broadcasts, merges or deployment performed.
