# Strategy Builder delivery, 2026-10-04

Scope: POO-2116, Build panels POO-2171, Review POO-2172, integration POO-2196 and
the Limits follow-up POO-2197 (rules v2).
This document records the code delivery for the hackathon. Browser acceptance is owned by Murilo.

## Entry and supported path

Open `/en/manager/new` in the existing authenticated manager environment and select **V2** in the header.
The image needs `NEXT_PUBLIC_FEATURE_FUND_CONTRACTS=on` at build time. Real catalog and Review use
`NEXT_PUBLIC_MOCK_MODE=false` and the existing server API, session, media and wallet configuration.
Robinhood Chain also uses the existing `NEXT_PUBLIC_FEATURE_ROBINHOOD_CHAIN` build-time flag.
API credentials remain server-only. The dev host is `https://v2.dev.pool-party.xyz`; merging code does
not by itself prove that host runs the merged revision.

The supported alpha path is Mandate -> Build -> Review -> the existing launch journey:

1. Complete the mandate with Arbitrum, optionally Robinhood Chain, and the intended tokens/pools.
   Limits requires USDC plus another token with a positive allowance. No cap counts; an unset or
   explicit 0% token does not. Moving a Limits slider to 100% selects No cap and hides that slider.
2. In Build, add Uniswap v4 pool positions on either supported network and/or Aave USDC Supply on
   Arbitrum. Choose the catalog item, assign positive allocation and apply each panel's changes.
3. Confirm the plan's allocations and readiness. Next: Review persists Build before changing phase;
   storage failure stays in Build. Unapplied panel changes go through Apply/Discard guards.
4. In Review, check identity/logo, fees, minimum deposit, first deposit, estimate and signature preview.
   The first validation reason is visible and its field can be focused. Build issues return to Build.
5. Launch enters the existing checkpointed journey. Its driver owns wallet signatures, receipts,
   transits, report settlement and resume. Opening Review sends no transaction.

Saved drafts use `/manager/new?draft=<id>&phase=build` or `phase=review` and resume from the Manager
Console. Drafts are browser-local; do not expect them to move between browsers or devices. The
temporary fallback `/manager/fund-launch/review/[draftId]` remains available with its existing gate.

## Data and assets

| Surface | Source | Interpretation |
| --- | --- | --- |
| Token metadata and logos | `GET /api/v2/catalog/tokens?chainId=42161` or `4663` | Address, symbol, name, decimals, `logoUrl`, price and reason. Shared token renderer supplies fallback. |
| Pool picker and detail | `GET /api/v2/catalog/uniswap-v4/pools` and `/{poolId}?chainId=` | Bare lowercase bytes32 PoolId, PoolKey, spacing, tick, `sqrtPriceX96`, liquidity and eligibility. Current price derives from catalog sqrt price. |
| Pair filtering | `tokenAddress` and `secondTokenAddress`, then mandate/network intersection | Server pair match is unordered. Disabled/unavailable items cannot be used. |
| Pool metrics | API TVL/APR are intentionally unavailable | Do not convert liquidity into TVL or print fixture metrics in the real panel. |
| Aave | `GET /api/v2/catalog/aave-v3/reserves?chainId=42161` | Only canonical USDC on Arbitrum; APY, cap/supply and active/frozen/paused/availability gates. Missing or malformed APY is unavailable. |
| Network logos | `/networks/arbitrum.png`, `/networks/robinhood.png` | Existing network resolver. |
| Protocol logos | `/protocols/uniswap.svg`, `/tokens/aave.png` | Existing protocol resolver. |
| Applied panel config | `MandateDraft.plan` | Canonical pool ID and ticks; flat `fullRange`, `displayInverted`, `slippagePct`; Aave `assetKey=network:address`. Configuration and allocation are applied atomically. |
| Review persistence and balance | `useV2ReviewDraft` | Existing validation, hub USDC balance, staged logo upload, raw integer amount helpers and first-deposit estimate. |
| Flow fee before creation | Existing hook fallback of 25 bps | Labelled as an estimate until a created fund's fee configuration is available. |
| Create, spoke, profile, swaps and opens | Existing `startFundLaunch` and launch driver | Reuses API builders, server admin configuration and the existing transaction validation/signing boundary. |
| Progress | `useV2LaunchStatus`, launch journal, balances/transits/accepted reports | Resume existing checkpoints; never count broadcast as completion. |

## Regression checks

- Configured Uniswap fields and Apply gate share a single `usePanelPool` snapshot and Retry through
  `PanelBodyDefinition.Provider`. A failed read followed by Retry must update both.
- Quote inversion changes presentation only; stored ticks and token proportions remain canonical.
- Logo upload updates only `imageUrl` in the latest saved Review. It preserves edits made during the
  upload, works when the logo is the first Review edit, and does not recreate a deleted draft.
- Review's launch CTA prevents repeat entry, shows blockers, and resumes an existing journey.
- Build completion analytics fire after successful persistence. Launch completion remains owned by
  the existing settlement path, with no duplicate completion event in the new Review.
- Limits validates the minimum positive token allowance in both catalog modes. The mandatory
  deposit asset counts once; another network's mandatory deposit entry alone does not satisfy the
  second-token requirement. Existing drafts must meet the rule when continuing the builder.

## Delivery boundaries and ownership

No authenticated live API smoke was performed in this delivery session: suitable credentials were
not present in the relevant checkouts. The specification/code audit found coverage for required
panel properties; that is not a guarantee of deployed endpoint health. POO-2145 tracks the existing
host/key boundary. Rafael owns the signed rehearsal and backend deployment evidence.

Borrow is unavailable for launch. Its palette cleanup, slice PA0, was explicitly deferred by the
accepted demo plan; the current UI can still offer the block, and readiness/launch fail closed.
Aave Supply is a leaf and only USDC/Arbitrum is supported. Unknown network splits, unsupported
continuations and duplicate Aave opens remain blockers.

Spoke accepted-report settlement can take 14-19 minutes or longer. Keep the wait/resume experience
from PR #64; a long wait is not permission to recreate a fund or repeat a confirmed transaction.

Compliance entries CR-MGR-021 through CR-MGR-025 track caps/slippage, range estimates, Supply and
Review disclosures. The canonical `COMPLIANCE_REGISTER.md` controls launch readiness. The inherited
dependency audit failure is separate from feature validation; these PRs change no dependencies.

## Delivery evidence

The final merged PRs, commit IDs and composed validation results are recorded here at integration.
Murilo performs the complete browser journey and reports the outcome. Codex does not claim browser
verification or transaction execution.
