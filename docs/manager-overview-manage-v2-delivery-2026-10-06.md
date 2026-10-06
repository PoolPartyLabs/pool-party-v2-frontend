# Manager Overview + Manage V2 delivery plan

Updated: 2026-10-06. Owner: Murilo. Coordinator: Codex, with at most two GPT-6.1-sol workers. Epic: [POO-2116](https://linear.app/yeildbay/issue/POO-2116).

This plan implements the supported delta from the consolidated owner handoff `handoff-manager-overview-manage-v2-2026-10-06.md`. It builds on the existing Manage implementation, not a new fund executor. Source baseline: public frontend `PoolPartyLabs/pool-party-v2-frontend` main `d4fb6904d937aee22b7d534672084ca2cb10a1a1`. Backend source checked at `a8299b147eef1ab9b6ae9bc8c5498168006149e7`; source inspection does not certify a deployment.

## 1. Delivery boundaries

- Investor Invest keeps its current modal and provisioning. Strategies and Portfolio keep their existing experience and item-level V2 tag.
- The V1 manager host remains unchanged. The family switch mounts the new Overview only for V2 and the existing fund feature flag.
- Existing authorized Manage routes, position identities, holdings, range controls and inline panel are reused.
- Missing data or execution capabilities display **Not available**. A missing value is not zero. A local edit is not a saved policy or executed transaction.
- No browser journey, full local test suite, coverage, production build, wallet signing or deployment in this task. Murilo owns browser acceptance; Rafael owns deployment.

## 2. Reference frames

| Surface/state | Figma node |
|---|---|
| Overview ready | [8427:2831](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8427-2831) |
| Overview loading | [8429:2938](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8429-2938) |
| Overview first use | [8429:3164](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8429-3164) |
| Overview error | [8429:3366](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8429-3366) |
| Manage actions | [8335:2708](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8335-2708) |
| Move range | [8291:2563](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8291-2563) |
| Move review | [8334:2692](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8334-2692) |
| Aave allocation | [8296:2579](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8296-2579) |
| Future deposits | [8300:25774](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8300-25774) |

## 3. Ordered implementation and ownership

| Stage | Files / concrete changes | Dependencies | Tests / completion evidence |
|---|---|---|---|
| A. Audit and rules | This document, DESIGN_INTAKE, Linear POO-2245/2246/2247; review public main and actual API DTOs | Consolidated handoff, current source | Confirm existing implementation and exact missing capabilities. Complete. |
| B. Supported Manage corrections, POO-2246 v2 | `manage/manageModel.ts`, `ManageCanvas.tsx`, `ManageEntry.tsx`, `ManageBlockPanel.tsx` and matching tests | Existing typed fund and position reads | Native-only cash, metadata mismatch/case, retained holdings, shell loading, timeout/retry/late result. Implemented; 26 focused tests pass. |
| C. Overview source model, POO-2245 v1 | `overview/overviewModel.ts`, `useOverviewSetup.ts`, additive snapshot APIs in `mandateDraftStore.ts` and `launch/journey.ts` | Existing device-local drafts and manager-scoped launch journal | Duplicate draft/journey/core, other account, corrupt/blocked storage, completed launch without remote discovery, all-closed history, stale account reads. |
| D. Overview presentation, POO-2245 v1 | `overview/ManagerOverviewV2.tsx`, setup list, stories, `FundFamilySwitch.tsx`, independent profile action in manager `actions.ts` | Stage C, existing manager list and profile, shared chart/table primitives | Loading/error/partial/local-only states, responsive containment, real-mode unavailable metrics, existing navigation, V1 and investor boundary. |
| E. Shared integration/review | Configured manager locales, IDS_REGISTRY, INTEGRATION_POINTS, ANALYTICS_EVENTS, COMPLIANCE_REGISTER, manager README | B-D | Actual translations, no new financial completion event, lint, scoped TypeScript and affected tests. General TypeScript on CI if the local 2 GB heap is exceeded. |
| F. Authoritative financial reads | Extend V2 schemas/actions/model with AUM history, native cash, eligible queue and hub Income | Rafael: POO-2247 and POO-2230 | Shape/identity/freshness/units, missing vs zero, partial/error/stale responses, complete history evidence. Separate wiring PR after DTOs/deployed examples. |
| G. Move range confirmation | Extend `manageSchemas.ts`, `manageActions.ts` and existing inline panel; reuse signing/provisioning orchestration | Rafael: POO-2229; existing frontend POO-2228 | Verified post-close principal budgets, fee/cost/impact review, expiry and snapshot invalidation, sequential signing, partial close recovery and no replay. Separate execution PR. |
| H. Future deposit policy and allocation | Existing Create new position / New deposits only states, persisted versioned write/read and executor integration | Rafael: POO-2231 | Conflict/version/reload, policy consumed by future deposits, current position unchanged, lineage, allocation semantics and recovery. Separate policy PR. |

Worker 1 owns C-D. Worker 2 owns B. The coordinator owns A/E, independent profile loading, shared documentation/translations, cross-checks and all Slack/Linear/GitHub writes. Tests run in one process at a time. Work stays in clean isolated worktrees; unrelated checkout edits are preserved.

Small PR order: B first, C source model second, D/E presentation third. F/G/H remain separately tracked, capability-gated work. Do not combine unrelated API or contract changes into these frontend PRs.

## 4. Overview business and data contract

1. Match the V1-like hierarchy: greeting and primary Create strategy, Overview/My strategies/Investors/Earnings/Activity navigation, AUM/history, Continue setup, three summary values and a strategy table. Profile continues to the existing editable profile host.
2. A local draft is device-scoped, not proven wallet-owned. Join it to a launch by draft ID and the launch's normalized manager identity, never name, token symbols or array position.
3. An incomplete launch suppresses its duplicate draft and discovered core row. The core address alone does not establish a fully ready strategy. A completed local journal is also not authoritative remote readiness.
4. Preserve supplied Open, Closing and Closed state. Closed-only history is not first use. Existing verified Manage navigation can remain available while its destination enforces read/write capabilities.
5. First-use empty requires successful local reads and authoritative complete remote/history absence. Current discovery does not provide that guarantee. Missing discovery coverage must not become an onboarding claim.
6. Missing AUM, series, ready count or other financial metrics stays Not available. Do not sum arbitrary fund rows or reuse V1 financial aggregation. A history failure must not hide otherwise valid rows/setup.
7. The handoff's 30-point AUM curve and $125,000 values are explicit story/demo fixtures only. Production does not fall back to them.
8. Storage failures/corruption must be visible without deleting recoverable work. Reads do not overwrite malformed records.
9. Session/account changes hide prior-wallet reads immediately and discard late responses. Profile identity is fetched independently of V1 financials.
10. Reuse typed analytics: draft navigation/deletion, manager read errors and blocked intent; route owns page view. A navigation click does not settle any financial funnel.

## 5. Manage business and data contract

- Operating cash is exactly one native asset per chain, currently ETH for the integrated EVM chains. It stays **160 x 136 px** in every Manage state. Canvas E's 104px is a separate design.
- Stable metadata used for Idle/reserve/Income requires matching chain and actual mandate token address, case-insensitively. Robinhood labels must reflect actual USDG identity; never rename a served USDC position holding.
- Keep served holding order, raw amounts, decimals and token identity. Quantity and USD valuation are separate sources.
- Income means current **hub Arbitrum USDC**, not holder owed income, position fees, idle, gross minus shares, or a collection-round tuple.
- Preserve the current-position In range/Out of range indicator, neutral unknown state, 148 x 10 px track and fixed center marker. Draft ticks do not change current status.
- Keep symmetric paths and **Collect fees -> Swap auto -> Income**. Aave has no LP fee collector.
- The existing panel owns Move/Apply now and Create/New deposits only. Loading, edit, review, funding, signatures and recovery remain inline when supported.
- Preparation has a 30-second timeout, retains the draft, supports explicit retry and ignores late responses. It cannot imply transaction failure or authorize replay.
- Existing Move confirmation remains disabled until the complete execution contract is available. Future-deposit settings are not saved to localStorage as a substitute for a persisted policy.

## 6. API dependency evidence and acceptance gates

| Issue / owner | Missing contract | Gate to enable |
|---|---|---|
| [POO-2247](https://linear.app/yeildbay/issue/POO-2247), Rafael | Manager/family scope, readiness, all-status/history coverage, AUM total/series definition, currency/decimals/asOf, partial/stale/error state | Contract fixtures plus deployed authenticated examples. No guessed totals or first-use state. |
| [POO-2230](https://linear.app/yeildbay/issue/POO-2230), Rafael | Native token balance by vault/chain, eligible withdrawal queue in consistent units, actual current hub Income | Prove quantity provenance and reserve relationship; no double count, native/stable relabel or collection-round proxy. |
| [POO-2229](https://linear.app/yeildbay/issue/POO-2229), Rafael | Post-close spendable principal, fee collection semantics, required swap, network fee/impact, quote expiry, continuation/recovery state | Prove close confirmed/open failed, pending/unknown receipt, changed snapshot and safe retry without replay. |
| [POO-2231](https://linear.app/yeildbay/issue/POO-2231), Rafael | Future policy persistence/read/version/conflict and consumption by actual future deposits; allocation executor; position lineage | Prove reload/version conflict and preservation of existing position, then actual policy use by the executor. |

Current Move builder returns `protocolVersion` and an ordered `transactions` array. It accepts caller-supplied token amounts and produces close, optional swap and open. That is useful existing infrastructure, but it does not supply the full financial review and recovery model above. No on-chain experiment is needed to identify this DTO gap.

## 7. Verification and release record

- Manage TDD: initial six expected failures, final **26/26** across four affected files, one Vitest worker.
- Manage eight-file Biome pass and clean diff whitespace check.
- General local TypeScript hit its existing 2 GB heap limit. This is not a passing check; use scoped imports and remote CI, without increasing local workload.
- Overview source/presentation, locale and family-boundary results will be appended after implementation.
- Coordinator independently reviews source and tests before a small PR/merge. Deployment and browser acceptance are separate from merge.

## Implementation and review update

Stage B is merged as [PR #109](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/109), main `c71e27763842f64e315959a36f3f7232ac9a7fce`. CI lint/typecheck/i18n/config passed on its exact source head; heavy CI jobs were pending at merge. Existing dependency audit findings remain POO-249.

Stages C-D are implemented for the supported contracts. Root independently reviewed the source and a second GPT-6.1-sol worker cross-reviewed identity/dedup. Review corrected initial disconnected rendering, stalled reads, mismatched local draft IDs, invalid display dates and a second-read storage race. Raw corrupt payloads remain preserved, while only valid records are resumable. Shared Profile reads never load the V1 financial dashboard. All 11 locales configured in this public repository have actual translations; its config does not currently enable pt-PT. The fixture uses currently supported Arbitrum/Robinhood DTO identities rather than asserting live Base availability.

Stages F-H remain explicit API dependencies; this delivery does not claim their financial acceptance criteria are complete.

Validation after final source review: 13 source/storage/hook tests and 78 presentation/profile/actions/family/shell tests passed, one worker at a time. All 11 configured locales pass parity, ICU and usage; config check passes. File lint passes with the existing AppShell img warning. Scoped TypeScript reports no new-source error; its imported PortfolioView generic error is reproducible unchanged on the baseline checkout. CI is the general TypeScript gate. No browser/funding/signing or full local suite/build/coverage was run.

POO-2230 source verification: the backend returns the vault's scalar operatingCash ledger getter, not a native balance+decimals read. Public contract main `9e32ba98bd1dbc14de0256723336f93a40ad302a`, SpokeVaultBase.sol:250, marks native top-up disabled under DEC-187; ISpokeVault.sol:349 says the hub SpokeVault has no Operating Cash. This confirms that the current scalar must not be labelled ETH wei. The detailed evidence is linked in POO-2230.

Stage C is merged as [PR #110](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/110), main `4217ab80a059d1b6a3e124384d67d71f55b8e826`, after passing CI lint/typecheck/i18n/config. Stage D/E is the separate presentation change on top. Repository lint passes with 112 existing warnings and one info.
