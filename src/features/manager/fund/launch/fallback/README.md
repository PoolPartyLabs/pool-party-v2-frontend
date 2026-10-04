# Fallback Review and launch (POO-2183, rules v1)

Minimal, unstyled, temporary binding to the POO-2177 public hooks. Murilo owns POO-2172 Review and POO-2171 panels. No builder, canvas, Mandate or Review file is modified.

**fallback; merges only if POO-2172 Review is not on main by 09:00 BST; Murilo's page replaces it**.
Open as DRAFT only. Do not merge or deploy from this task. The brief does not specify the calendar date for the 09:00 BST cutoff and 16:00 BST demo; confirm it before any landing decision (work started October 4, 2026).

## Demo clicks

1. Run the existing real V2 environment with `NEXT_PUBLIC_FEATURE_FUND_CONTRACTS=on`, `NEXT_PUBLIC_MOCK_MODE=false`, existing server API/session/media credentials and configured wallets. Never put API keys in public variables.
2. Sign in with the manager wallet. Complete Mandate and Build, save the draft in this browser. Copy `draftId` from the existing builder URL. This browser's saved draft and original manager wallet are required.
3. Open `/en/manager/fund-launch/review/<draftId>` directly. Slice E's v2 draft list was not on main at implementation time, so this PR does not add a competing list or edit its files. The heading is "Review & launch (v2)".
4. Edit name, description, PNG/JPG logo, fees (Instant 0-10%), minimum and seed. Click **Refresh** for balance/catalog as needed. Check the whole-share seed preview and fixed investor terms.
5. Under **Default execution settings (fallback until block panels ship)**, select the exact Mandate pool/asset if ambiguous. Pool defaults: canonical finite aligned full range, slippage 1%. Untick Full range to edit aligned canonical ticks. Existing nonempty panel config is read-only and wins entirely.
6. Resolve every blocker. Click **Launch · N signatures** once. The existing launch entry freezes a snapshot and navigates to `/en/manager/fund-launch/<journeyId>`; click **Sign next step** there. Each wallet transaction is explicit. No signature is requested on Review mount.

## Safety and seams

`applyFallbackExecutionAtLaunch` creates a separate immutable launch draft snapshot. It never calls the Mandate/canvas store; only `useV2ReviewDraft` persists Review data. The preview uses the same adapter without persisting anything. Panel execution overrides are discarded except already-explicit leaf budgets, so stale launch overrides cannot defeat panel settings. Missing leaf budgets remain blockers.

Pool identity and tickSpacing come from the saved catalog-backed Mandate pool row; the existing launch driver rereads the real pool before a trade. Tick alignment uses mathematical ceil/floor, including negative ticks. Empty means null/undefined or no own config keys; any partial panel configuration is authoritative and fails closed if incomplete. No inferred leaf allocations, pools outside the Mandate, unsupported chains/protocols or guessed swaps.

Aave Supply identity comes from the manager's explicit Mandate reserves and token rows, with explicit selection for ambiguity. The existing launch driver supports only the hub deposit asset, so non-base reserves are blocked here before launch. No slippage control is offered when no swap is needed; non-base Aave swaps require the owning executor to support them first.

`PP-MGR-SCR-007` route, `PP-MGR-CMP-082` component and `PP-MGR-LIB-047` helper are derived after the merged registry's existing maximums, outside Murilo's reserved ranges. `manager.fallbackReview.*` is translated key-by-key across all 11 configured locales. Non-English translations need native review under the existing locale policy.

## Open questions

- Confirm the calendar date of the conditional 09:00 BST cutoff and 16:00 BST demo.
- Confirm the demo Mandate's exact pool and hub deposit Aave reserve; ambiguous rows require manager selection, never an inferred trade.
- When POO-2172 lands, remove/retire this separate fallback route rather than integrating it into Murilo's page. POO-2171 nonempty config already wins.
