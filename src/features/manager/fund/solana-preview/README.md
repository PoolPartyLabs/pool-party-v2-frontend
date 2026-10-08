# Local Solana strategy preview

`PP-MGR-SCR-009`, POO-2281 rules v2. The parent route owns the hidden entry and guarded exit. This feature owns an independent React reducer and drawing. Nothing here imports the EVM builder, mandate draft, network IDs, wallet clients or services.

The preview is temporary local state. Applying changes updates only the drawing's configuration. Leaving the preview discards it. The global unsaved-changes guard protects a changed drawing, while the local confirmation protects unapplied edits before another selection or addition. Every removable protocol has a separate X control and a confirmation.

The fixed structure is Arbitrum Deposit, Idle input, Idle output, Income and Withdraw, plus one Solana spoke. Each direction has one bridge. Solana Idle holds a USDC label. Operating cash is native SOL, with no balance, in a 144 × 96 card centered to the right of Idle. Fixed spine cards retain the reused 236 × 62 geometry. Pool SOL labels represent wrapped SOL, distinct from native operating cash.

Principal routes are gray. Raydium CLMM and Orca Whirlpools add input Swap, Collect fees and Swap auto; their fees use a separate green bus through the return Bridge to Income on the hub. Outgoing Income is gray. Kamino Supply USDC receives USDC directly and returns principal and interest to Idle on the gray route. Jupiter Swap is a manual local conversion drawing and has no LP collector. Automatic swaps and bridges are fixed explanatory steps. Hover highlights one complete path between nodes, including all bends.

Allocation is a whole percentage from 0 to 100, represented as integer basis points internally. The sum across all blocks cannot exceed 100%. Pair and conversion choices are drawing labels only. No live pool, reserve, mint, price, balance, yield, fee model, range, grid, liquidity, route or transaction identity is invented. Unavailable fields say "Not available". Supply-only wording describes the drawing, not an actual wallet debt position.

No launch, signing, transaction broadcasting, approval, API discovery, data simulation or browser persistence exists here. A blocked execution affordance explains that execution is unavailable and reports bounded blocked intent. Analytics reports view, first start, local Apply, abandonment, blocked intent and genuine render failures. There is no completion event. The render boundary preserves the parent reducer and allows retry after a real rendering exception without recording exception text.

Focused tests cover allocation validation and aggregate bounds, edit/application isolation, discard, removal, LP collector scope, global dirty registration, guarded transitions, bounded events and actual render failure recovery. Confirmation close restores the editable field on cancel and the current panel heading on a confirmed switch. Removing the selected block focuses the remaining screen controls. Storybook covers an empty drawing, mobile viewport and all protocol paths. Geometry and keyboard focus are reviewed through code and focused component tests. Browser visual verification was not performed and remains with Murilo.

## Design and brand sources

Design follows the 2026-10-05 Solana/Raydium and Orca/Kamino handoffs, superseded where specified by `protocol-research-solana-configure-manage-2026-10-07.md` in the PoolPartyV2Design project. Historical market fixtures in those handoffs are intentionally omitted from this local drawing.

Official marks are shipped under `public/protocols/solana-preview/`. Solana, Raydium, Orca and Kamino assets were copied from the PoolPartyV2Design `brand/external-logos/2026-10-05/` intake and its source manifest. Jupiter was retrieved from its official site on 2026-10-07. The marks are displayed beside protocol names to identify drawing blocks. Attribution does not imply endorsement or a trademark license.

| Mark | Official source | Adaptation |
| --- | --- | --- |
| Solana | [Solana mark in the Raydium UI source](https://raw.githubusercontent.com/raydium-io/raydium-ui/master/src/assets/icons/solana-text-logo.svg) | The design intake cropped the wordmark while retaining the three mark paths and gradients. |
| Raydium | [Raydium UI logo](https://raw.githubusercontent.com/raydium-io/raydium-ui/master/src/assets/icons/logo.svg) | Original mark. |
| Orca | [Orca official site](https://www.orca.so) | SVG mark extracted during design intake. |
| Kamino | [Kamino documentation logo](https://mintcdn.com/kamino-3d73a151/EHpt5rRzyV5R3dXt/images/logo/dark.svg) | The design intake retained the K mark. |
| Jupiter | [Jupiter official logo](https://jup.ag/svg/jupiter-logo.svg) | Original SVG, displayed at the component's size. |


## Typed catalog, POO-2291 S1

`solanaSchemas.ts` (PP-MGR-LIB-063) validates case-sensitive 32-byte base58 identities, native SOL lamports versus SPL mint amounts and exact raw-to-decimal strings. Read states keep declared sourceAsOf/slot/provenance. Confirmed zero requires raw zero and observed confirmed/finalized commitment. The schema does not attest accounts, owners or freshness.

`solanaCatalog.ts` (PP-MGR-LIB-064) keeps the same four venue choices consumed by previewModel, narrows Kamino to mainnet USDC Supply and separates Orca/Raydium/Jupiter. Holding was contract-only in S1; S5 adds a separate custody drawing control without changing the venue list. Catalog reads and execution are unavailable; neither fixture nor observed values may promote that catalog. Jupiter inspection keeps managed order/execute distinct from composable build and quote expiry distinct from blockhash validity. No actual quote/signing is added.

At S1 delivery, all 77 focused schema/catalog/model/screen/route tests, scoped Biome and TypeScript passed. Later delivered slices are recorded below; local Manage Screen/Canvas integration is merged in PR #142. POO-2239/2240/2261/2262 real wiring remains open.


## Kamino reads and account risk, POO-2291 S2 / POO-2290

`solanaKaminoReadModel.ts` (PP-MGR-LIB-072, POO-2291 S2) adds a separate pure Supply USDC read contract. It validates canonical local/program/market/reserve/position/obligation identity globally, then validates metadata and each quantity, USD, APY and reward stream independently. A malformed field becomes unavailable without erasing compatible siblings or exposing its raw text. Physical quantities fit u64; decimal zero uses its own shape and observed confirmed/finalized source. An empty rewards array is distinct from unknown rewards. No protocol APY ceiling or valuation is manufactured. The model is merged in PR #143; the read-only section now mounts in Configure and local Manage. Real reads/operations keep their existing gates.

The local Supply panel reuses PP-MGR-CMP-094 for full-account Current/After risk. Its account identity and reads are unavailable. Neither the USDC Supply drawing nor the absence of a Borrow block establishes No debt. Principal, interest and rewards remain separate data contracts. LP range/Collect, Borrow and Multiply are not added. The shared presenter retains verified scenarios/provenance when injected in a test harness; those fixtures do not become catalog or production data.

## Orca and Raydium ranges, POO-2291 S3/S4

`solanaRangeModel.ts` (PP-MGR-LIB-069) uses separate official protocol Q64 tick math. Orca and Raydium keep their own rounding, extreme-price rules and grids; canonical mint ordering compares the decoded public-key bytes. Human prices include the pool token decimals. Local inversion changes display orientation, while the saved ticks and current position remain canonical. Orca full-range-only pools reject custom ranges. A confirmed zero-liquidity position is distinct from an unavailable or stale read.

`SolanaRangePresenter.tsx` (PP-MGR-CMP-095) renders verified Current separately from the controlled draft, with grid-aligned presets, adjustments and locale-aware blur commits. Complete values wrap at rest and retain native labeled inputs for editing. Changing the canonical snapshot or losing editing capability clears pending field text without committing it. Sources, timestamps, slot, commitment and program are explicit; fixture provenance stays visible.

The Configure host mounts this section only for positive LP allocation. Zero or invalid allocation defers it. A missing or mismatched protocol context stays Not available; the production host seeds no prices or ticks. A verified context without a change handler is read-only. Estimated composition remains unavailable without a verified liquidity quote, rather than assuming a token split.

The pinned Rust-to-TypeScript math ports retain Apache-2.0 grants and upstream notices in `LICENSES/` and `THIRD_PARTY_NOTICES.md`. No protocol SDK proves Pool Party execution capability. Thirty-one focused range/model/host/screen tests pass. Scoped TypeScript and changed-file Biome are the validation scope; native browser acceptance stays with Murilo.

## Holding and Jupiter, POO-2291 S5

`solanaHoldingModel.ts` (PP-MGR-LIB-070) validates injected custody identities, exact u64 quantities, Buy/Sell intentions and separately inspected Jupiter quotes. Native SOL and WSOL remain distinct; explicit wrap/unwrap plans never become implicit swaps. Compatible input bypasses conversion. Sell destinations are Idle output and its principal Bridge, without LP fees or Income routing. Prices, USD valuation and allocation remain independently sourced.

`SolanaHoldingPresenter.tsx` (PP-MGR-CMP-096) keeps choice, Buy/Sell and review inline, with complete values and source provenance. `SolanaJupiterInspector` presents the quote independently: managed order/execute versus composable build, quote expiry versus blockhash validity, measured costs and their declared inclusion. Unknown, stale, unconfirmed and future-dated sources do not establish valid execution. Included-input fees are summed with BigInt and cannot exceed the total input. Confirm is always disabled.

The hidden local editor adds Holding separately from its four venue choices, using a generic custody icon. Its USDC drawing bypasses conversion; its WSOL drawing receives automatic input/output conversions on gray principal paths. No LP range, APY, Collect or account risk is added to custody. Configure passes null custody origin, reads, intentions, quotes and clock; drawing labels confer no financial identity. The standalone presenter accepts injected intentions but this slice contains no editable transaction amount form, market discovery, RPC or wallet operation.

Independent review caught a future transaction timestamp and included-input costs exceeding the input; both were reproduced before correction. Seventy-seven focused tests across model, presenter, catalog and hosts passed, along with scoped TypeScript, changed-file Biome and all11 locales. Test/Storybook fixtures remain isolated. Real custody, token discovery, quotes and execution stay POO-2239/2240/2261/2262; browser acceptance remains with Murilo.

## Local Manage foundation, POO-2291 S6

| Artifact | Responsibility | Foundation status |
| --- | --- | --- |
| PP-MGR-LIB-071, `solanaManageModel.ts` | Independent local instance/configuration/draft, canonical Current, bound After and operation journal | Reviewed pure state/projection; no external read or transaction execution |
| PP-MGR-CMP-097, `SolanaManagePresenter.tsx` | Complete Current/source values, draft settings, inline exclusive modes and Review, independently valid After and read-only journal | Controlled injected presenter, Confirm disabled |
| PP-MGR-CMP-098, `SolanaLocalManageHost.tsx` | Mounted per-instance retention, baseline synchronization, local budget and acknowledged drawing Apply | Integrated in Screen/Canvas; canonical reads/context/clock unavailable |

Canonical identity and local instance ID are distinct, so two instances of the same pool retain separate drafts, modes and review steps. Selecting or hiding preserves them. Drawing synchronization adds/removes only the corresponding owner; changed baselines preserve another dirty draft, while a baseline that reaches its draft clears the obsolete mode/review binding and invalidates After. Clean synchronized config and draft are separate copies. Canonical Current and journal are preserved. Physical quantities in Current/After fit u64, retain exact raw strings and do not pass through JavaScript floating-point amounts. A valid After requires the same canonical identity, base snapshot, revision, mode and explicit clock; no implicit clock establishes validity.

The presenter exposes Move range/Apply now or Create new position/New deposits only as exclusive local modes, with inline Review and unavailable transaction details. Verified protocol range context must match canonical Current ticks, rather than the edited draft. Sources, timestamps, slots, commitment and fixture provenance remain visible. `SolanaLocalManageHost` creates drawing-only instances and supplies unavailable Current/After plus null range context/clock. It keeps each presenter mounted while hidden; closing only calls the parent visibility callback.

`onApplyDrawing(localId, config): boolean` acknowledges one local drawing write. Apply validates whole percentages, aggregate drafts and the selected draft plus other blocks' applied baselines. Unapplied reductions in other drafts cannot fund that write. Only `true` releases the draft and reports local success; `false` preserves draft/Review and reports a bounded blocked intent. A non-null range is blocked without verified protocol context. Local Apply never writes canonical Current or the journal. Bounded intent callbacks contain only protocol and `edit/choose/review/apply/discard/rebase/blocked`; the config callback is application data and never analytics payload.

The foundation is merged in PRs #140/#141 and adds 60 `manager.solanaPreview.localManage` keys to each of the 11 configured locales. Screen now offers Configure/Manage without remounting the local host. Configure's unapplied edits require confirmation before mode changes; Manage drafts/Review survive selection, close and mode changes. All actual fixed/automatic/position nodes share the canvas geometry identity and inspectors. Fixed Hub overlay, decorative locks, explicit owner/network context and Back/Escape focus restoration use existing pieces. Configure retains its original position-only activation.

The drawing owner validates and acknowledges one instance write against applied baselines. Screen tracks bounded local mode/node/edit/review/apply intent through the existing consent-aware hook; rejected writes never emit applied success. Nothing signs, broadcasts or fills a financial read. The census is 700 registry rows and 529 markers in 304 files.

The isolated panels tree passed 18 presenter and 13 host tests, scoped TypeScript with the project test setup, changed-file Biome, all 11 locales and 22 documentation guards. The model was validated independently in PR #140. Integration passes 49 drawing/Screen/Canvas tests and 42 existing access/toggle/documentation checks; scoped TypeScript, changed-file Biome and all 11 locales pass; explicit instance-write/capacity regressions reproduced RED on main before GREEN. Applied-budget/rejected-acknowledgement regressions reproduced both failures before correction. Stories cover injected provenance/read states and standalone hidden/second-instance/narrow host states; they are not browser captures. No full-suite, build, native browser or complete-Manager acceptance is claimed. Real canonical reads, context/clock, quotes, authority, execution and journal recovery remain POO-2239/2240/2261/2262, with `CR-MGR-POO2291-S6` and existing compliance gates still blocking real enablement. Kamino metadata/APY/withdrawable/risk presentation remains the next ready visual slice.


## Kamino read-only panels, POO-2291 S2

`SolanaKaminoReadSection` (PP-MGR-CMP-099) preserves Program/Market/Reserve before Configure allocation, then Supply APY, available liquidity and deposit capacity. Manage shows position/obligation, Supplied, principal/interest/rewards, APY, Available to withdraw and independent full-account Current/After risk before local settings. Unknown rewards remain unavailable; a declared empty reward array is omitted. Exact quantity and independently sourced USD remain separate, with source/asOf/slot/commitment evidence when supplied. Risk binds to the validated canonical origin and the shared account-risk validator, so missing market metrics cannot erase a compatible risk read.

Production Configure and local Manage pass null origins/reads. There is no reserve selector, rate, amount, No debt claim or transaction inferred from the drawing. Supply/Withdraw/Claim and confirmation remain unavailable. Existing per-instance drafts, inline Review and hidden-pane retention remain unchanged; the Kamino-specific regression covers two independent drafts across selection/hiding. The section has no financial event or service call; the existing Screen/host owns bounded view/edit/blocked/error intents.

The combined isolated tree passed 69 model/presenter/Configure/local-Manage tests, scoped TypeScript, changed-file Biome and all 11 locales. Two missing-Manage regressions reproduced failures on the preceding main before mounting. Independent GPT-6.1-sol review found no remaining blocker. Authored unavailable/narrow stories are not rendered browser acceptance. Live metrics, authority, risk projections and execution remain POO-2239/2240/2261/2262 and POO-2290; Murilo performs browser acceptance.
