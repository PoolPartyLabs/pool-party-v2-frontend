# Analytics Events

## Shared V2 local Solana events, October 8, 2026 (POO-2301 rules v1)

Delivery boundary: PRs #146/#148/#149/#150/#151/#152/#153 are merged. This delivery connects
the shared panel/Review foundation to the existing Mandate → Build → Review route, retains the
local Build/Manage host across phases and applies the route/account/exit guards described below.
This wizard change is pre-merge code delivery, without a deployment or native-browser visual
acceptance claim. Live Solana data, quotes, wallet operations and public launch remain
Not available; `solanaSpoke` stays off.

This delivery connects the shared Mandate → Build → Review shell to the registered builder route. The event
names from POO-2281 rules v2 remain bounded local intents; `PP-MGR-SCR-009` is a historical
standalone harness, not the route emitter. Standard public V2 continues to emit its existing
`builder_*` taxonomy. The local binding maps those shell/Build actions to `solana_preview_*`.

| Event | When it fires | Key params | Emitting artifact |
|---|---|---|---|
| `solana_preview_entered` | The selected-V2 gesture passes the navigation guard on the registered builder route | none | PP-CORE-CMP-075, ContractFamilyToggle |
| `solana_preview_exited` | Explicit hidden-mode exit or family switch passes the current route/session guard | none | PP-CORE-CMP-075, ContractFamilyToggle; PP-MGR-SCR-002, BuilderRouteSwitch |
| `solana_preview_viewed` | Local mandate starts; Build mounts once per retained instance; local Review mounts | none | PP-MGR-SCR-002, FundStrategyBuilderScreen / BuildScreen; PP-MGR-CMP-102, LocalSolanaReview |
| `solana_preview_interacted` | Shared mandate/Build/Review interaction or local Manage edit, choice, review, discard or rebase | none for mapped shell/Configure events; `preview_protocol`, `preview_action`, `preview_mode=manage` for Manage callbacks | PP-MGR-SCR-002, FundStrategyBuilderScreen / BuildScreen; PP-MGR-CMP-102, LocalSolanaReview |
| `solana_preview_started` | First block added to an empty local Build session | none | PP-MGR-SCR-002, FundStrategyBuilderScreen / BuildScreen |
| `solana_preview_applied` | A valid shared local save/Apply is acknowledged in session memory; Manage Apply receives accepted shared-plan acknowledgement | none for mapped shell/Configure events; `preview_protocol`, `preview_action=apply`, `preview_mode=manage` for Manage | PP-MGR-SCR-002, FundStrategyBuilderScreen / BuildScreen |
| `solana_preview_abandoned` | The local session owner is disposed from Mandate, Build or Review without an explicit exit; render fallback/retry is not disposal | `has_local_changes`, derived from the shared draft dirty state or last-reported pending Configure/Manage edits | PP-MGR-SCR-002, FundStrategyBuilderScreen / LocalBuilderBinding |
| `solana_preview_blocked` | Shared mandate/plan guards, unapplied edits, rejected Manage acknowledgement, unavailable logo upload, seed Max or Launch blocks intent | none for direct Build/Review blocks; bounded `error_code` for mapped shell blocks; `preview_protocol`, `preview_mode=manage` for Manage | PP-MGR-SCR-002, FundStrategyBuilderScreen / BuildScreen; PP-MGR-CMP-102, LocalSolanaReview |
| `solana_preview_error` | Shared local save/Build error mapping reports a bounded failure, or a genuine local child-render error reaches the reused boundary | bounded `error_code`; render errors also carry `error_origin=app`, `has_local_changes` | PP-MGR-SCR-002, FundStrategyBuilderScreen / BuildScreen; PP-MGR-SCR-009, SolanaPreviewRenderBoundary |

Only the shared owners emit through `useAnalytics().track()` / `useTrackView`. The mounted Manage
host reports bounded protocol/action intentions, never its configuration callback arguments.
`preview_protocol` is `kamino`, `jupiter`, `raydium`, `orca` or `holding`; Holding identifies custody
configuration rather than a venue. A rejected Apply emits blocked intent and no applied event.
Local save and Apply acknowledge memory, not browser/backend persistence or financial settlement.
No wallet, mint, pool, local/canonical ID, amount, pair, quote, exception text or transaction data is sent.
There is no submitted/completed Solana execution event.

Historical POO-2291 S5/S6 presenters also support bounded mode/node vocabulary in their standalone
harnesses. The shared route forwards protocol/action/manage-mode from Manage and no field-level
parameters from Configure/Review. Standard EVM abandonment keeps its existing phase rules.

The local session owner now records disposal from every phase, including Review, with truthful
`dirty || pending` metadata. Explicit exit suppresses abandonment and disarms its guard. The reused
`SolanaPreviewRenderBoundary` catches real local render errors without exception text. Because the
shared draft owner stays outside it, retry retains applied plan and Review fields and does not emit
abandonment. The owner keeps its unsaved-changes guard during fallback. Unapplied inner panel
edits may be lost when a render exception unmounts the shell; the last reported pending state
remains available to the guard/abandonment event, not as a promise to restore those fields.

Accepted Header and Save & exit paths acknowledge local disposal only after route/account host and
intent generation validate the user's consent. Stale acceptance cannot close a successor session.
Route/account changes remain abandonment/reset, rather than accepted local exit. The owner retains
last pending metadata during fallback; retry restores applied draft/Review, not unapplied inner fields.
Local Review keeps numeric fee/minimum/seed intentions but no EVM financial or signing promise.
Upload, Max and Launch are observable blocked intents and perform no file/storage/wallet operation.

## V2 launch journey (POO-2181, rules v2)

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `builder_launch_signature` | Successful wallet transaction broadcast or profile message signature; never server-only work or rejected prompts | `chain_id`, `step_kind` | PP-MGR-HOK-019, launch driver observer |
| `builder_launch_completed` | All journal steps confirmed; persisted completion marker prevents repeats on resume | none | PP-MGR-HOK-019 |
| `builder_launch_failed` | A launch step or execution attempt fails | `step_kind`, sanitized `error_code`, `error_origin` | PP-MGR-HOK-019 |

Review owns its launch-click event. This journey does not emit it. These events carry no addresses, transaction hashes, draft IDs or amounts. The existing consent-gated pseudonymous analytics identity is unchanged.

Living catalog of every tracked event in the Pool Party Frontend. Kept in sync with the typed `AnalyticsEvent` union in `src/lib/analytics/events.ts` (the `consistency-checker` skill enforces this). Taxonomy and rules: `docs/09_ANALYTICS.md` + the `analytics-tracking` skill. Naming: `02_NAMING_CONVENTION.md` Part H.

Convention: `<area>_<object>_<action>`, snake_case, max 40 chars. Transactional flows use `started` then `submitted` then `completed` (or `failed`). "Emitting artifact" is the `PP-` ID that fires the event; filled in as features are built.

## Auth and wallet

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `auth_signin_started` | User taps Continue with Google | | PP-AUTH-SCR-001 |
| `auth_signin_completed` | Privy session established | `user_id`, `chain_id` | PP-AUTH-SCR-001 |
| `auth_signin_failed` | Sign-in error | | PP-AUTH-SCR-001 |
| `auth_wallet_ready_viewed` | Privy embedded-wallet ready screen shown | | PP-AUTH-SCR-003 |
| `auth_logout` | User logs out | | PP-PROF-SCR-001 |
| `wallet_connect_started` | User starts a connector attempt | | PP-AUTH-SCR-004 |
| `wallet_connect_completed` | External wallet connected | `user_id`, `chain_id` | PP-AUTH-SCR-004 |
| `wallet_connect_failed` | Connection error or rejection | | PP-AUTH-SCR-004 |
| `wallet_disconnected` | Wallet disconnected | | PP-PROF-* |

## Dashboard and portfolio

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `home_viewed` | Home rendered | | PP-DASH-SCR-001 |
| `portfolio_viewed` | Portfolio rendered | | PP-PORT-SCR-001 |
| `portfolio_sort_changed` | Positions sort column/direction changed (POO-829 R7) | | PP-PORT-SCR-001 |
| `position_detail_viewed` | A position opened | `strategy_id`, `position_id` | PP-PORT-* |

## Strategies

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `strategy_list_viewed` | Explore list rendered | | PP-STR-SCR-001 |
| `strategy_filter_applied` | A risk/category filter changed | `risk_level` | PP-STR-SCR-001 |
| `strategy_sort_changed` | Sort column changed | | PP-STR-SCR-001 |
| `strategy_detail_viewed` | Strategy detail rendered | `strategy_id`, `risk_level` | PP-STR-SCR-002 |
| `strategy_invest_started` | Invest flow opened | `strategy_id` | PP-STR-MOD-* |
| `strategy_invest_submitted` | Invest amount confirmed | `strategy_id`, `value`, `currency` | PP-STR-MOD-* |
| `strategy_invest_completed` | Investment confirmed | `strategy_id`, `value`, `usd_value_at_time` | PP-STR-MOD-* |
| `strategy_invest_failed` | Invest error | `strategy_id` | PP-STR-MOD-* |
| `strategy_invest_resumed` | Invest reopened at Confirm & sign after a Deposit & invest top-up (POO-494 R6) | `strategy_id`, `value`, `usd_value_at_time` | PP-STR-MOD-001 |
| `strategy_collect_started` | Collect opened | `position_id` | PP-STR-MOD-* |
| `strategy_collect_completed` | Yield collected | `position_id`, `value`, `usd_value_at_time` | PP-STR-MOD-* |
| `strategy_collect_failed` | Collect error | `position_id` | PP-STR-MOD-* |
| `strategy_withdraw_started` | Withdraw opened | `position_id` | PP-STR-MOD-* |
| `strategy_withdraw_submitted` | Withdraw confirmed | `position_id`, `value` | PP-STR-MOD-* |
| `strategy_withdraw_completed` | Withdraw confirmed on-chain | `position_id`, `value`, `usd_value_at_time` | PP-STR-MOD-* |
| `strategy_withdraw_failed` | Withdraw error | `position_id` | PP-STR-MOD-* |
| `strategy_share_opened` | Share-yield modal opened from the Owned detail | `strategy_id`, `position_id` | PP-STR-SCR-002 |
| `strategy_share_period_changed` | Earnings window switched (24h/7d/30d) | `strategy_id`, `share_period` | PP-STR-MOD-009 |
| `strategy_share_target_clicked` | A share destination chosen (X/Telegram/WhatsApp/Instagram) | `strategy_id`, `share_target`, `share_period` | PP-STR-MOD-009 |
| `strategy_share_link_copied` | Referral link copied from the share modal | `strategy_id`, `share_period` | PP-STR-MOD-009 |
| `strategy_share_card_saved` | Yield Receipt PNG exported | `strategy_id`, `share_target`, `share_period` | PP-STR-MOD-009 |
| `strategy_share_export_failed` | Yield Receipt PNG export (or the native file-attach) failed on Save or a share target (POO-906 R5); surfaced to the user, ids only in params | `strategy_id`, `share_target`, `share_period` | PP-STR-MOD-009 |
| `strategy_launch_submitted` | Manager Launch strategy (create pool) confirmed — fired once from the Launch-confirm approve (the build→review→sign flow start, before the signatures). Carries the pool id (the strategy has no id yet at launch). | `strategy_id` (pool id) | PP-MGR-SCR-002 |

## Manager, fund builder (Mandate)

The fund-contracts builder's first phase (POO-2122, epic POO-2119): five list-picking screens that
fix a fund's mandate (networks, protocols, tokens, pools, caps) before anything is built. **Nothing
in this phase signs a transaction**, which is what decides the shape of the funnel below: its only
settlement is the draft reaching storage, so `builder_mandate_completed` waits for the write and not
for the last Next.

Two of the eight exist because something did NOT happen, and they are the ones that make the rest
readable. `builder_mandate_blocked` is the only trace a refusal leaves at all: Next stays enabled
when the product says no (R6, design rule P36), so without it a manager stopped by the Pools step
is indistinguishable from one who lost interest. `builder_mandate_abandoned` is what closes the
arithmetic, `started` = `completed` + `abandoned`, and its `draft_saved` separates the session that
LOST work from the one that parked it, which point at opposite fixes.

All five steps live under one pathname (`/manager/new`), so `page_viewed` sees one screen where
there are five: `builder_mandate_step_viewed` is the per-step denominator every rate here is
measured against, and it fires per VISIT, counting a revisit through Back again.

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `builder_mandate_started` | The builder opened on a mandate that was never saved: no draft id in the URL, or an id naming a draft that is gone. Once per session, after the draft store has been read. A RESUMED draft deliberately does not fire it, so the denominator stays "a manager began a mandate" rather than "a manager opened the builder again" | `networks_count`, `protocols_count`, `tokens_count`, `pools_count` (the starting mandate: the hub, the two required protocols and the deposit token) | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx`) |
| `builder_mandate_step_viewed` | A Mandate step became the visible one. Per step VISIT, not per mount and not per render: Back is part of how the Mandate is used, and a denominator that ignored a revisit would make every per-step refusal rate look better than it is | `step` (`networks`, `protocols`, `tokens`, `pools`, `limits`) | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx`) |
| `builder_mandate_step_submitted` | Next was accepted on a step, including the LAST one (where it is followed by the completion attempt rather than by another step). Carries the four counts AT that moment, which is what turns "managers drop at Tokens" into "managers drop at Tokens holding two tokens" | `step`, `networks_count`, `protocols_count`, `tokens_count`, `pools_count` | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx`) |
| `builder_mandate_blocked` | The product refused something the manager asked for: Next on a step that cannot be left (Pools with no pool, Limits with an unanswered cap or no positively allowed token besides USDC), a selection a reducer refused (the 16-slot ceiling, a hooked pool, a row that is not live yet), or Save with a name that fails the 10-to-50 rule. **The CTA is never disabled**, so this event is the entire record of the refusal: there is no click to count, no error to log and no failed request anywhere | `step`, `block_reason` (`nothing_selected`, `cap_missing`, `token_allowance_required` (POO-2197 rules v2), `no_slots`, `has_hook`, `coming_soon`, plus `price_unknown` for an unpriced token and `name_invalid` for the draft name, both folded onto the reasons POO-1172 already defines so one series answers the question across both builders) | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx`); the step bodies report through `onBlocked` and never emit |
| `builder_mandate_completed` | The mandate was finished AND persisted. Fires only after `save()` answered `{ ok: true }`, never on the last Next and never on the dialog's click: persistence is this phase's only settlement, and a mandate that was not written down does not survive a reload. At most one per session | `step` (always `limits`), `networks_count`, `protocols_count`, `tokens_count`, `pools_count` | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx`) |
| `builder_mandate_abandoned` | The builder unmounted without completing and without a Save & exit. `draft_saved` is the dimension worth having: `false` means work was lost and is a product defect we can act on, `true` means a manager parked a named draft they will probably come back to. Since POO-2157 `true` also requires nothing unsaved at unmount: a draft saved once and edited afterwards (a selection, or a Build plan edit before a Back: Mandate) reads `false`, where it used to read `true` while its edits were lost, so the series is not continuous across that change. Since POO-2157 a session that ends on the Build canvas reports `builder_build_abandoned` instead: the mandate under it is already closed | `step` (where they actually left, read at unmount rather than captured), `draft_saved` | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx`) |
| `builder_draft_saved` | A draft reached storage, from Save & exit or from the completion path (a Save & exit from the Build canvas included, with `step` the draft's last Mandate step, `limits`). `first_save` splits the two questions: `true` is the conversion (a mandate became a thing that survives a reload, and it is the one with the naming dialog in front of it), `false` measures how often managers park work mid-flow | `step`, `first_save` | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx`) |
| `builder_mandate_error` | A draft could not be written: storage quota, blocked site data, a private window. The manager keeps everything they chose and stays on the step. One code for every cause, because the browser does not tell us which and three codes we cannot distinguish would be three guesses. Also carries the Pools step's catalog read (POO-2125), in two codes, both `upstream` and both raised through `PoolsStep`'s `onError` prop so every emission still leaves from the shell: `POOLS_FETCH_FAILED` is the read the step DREW an error state for, with the Try again under it, and `POOLS_UNIVERSE_FETCH_FAILED` is a pool-universe measurement that failed beside a search the manager is still reading, where nothing is drawn and nothing is offered to retry. Splitting them keeps the drawn code countable: while the universe was unknown, one failed search reported it twice, once for the visible read and once for the measurement, then again on every retry. In the universe view one read serves both, so a failure there is one event with the drawn code. Both are deliberately distinct from an empty result, which is a fact about the mandate rather than about us. And the Console's refused DELETE (POO-2127): `DRAFT_DELETE_FAILED` / `app`, its own code rather than a reuse of the save's, because a save that fails loses work the manager just did while a delete that fails leaves a draft they wanted gone sitting in the list, and only one of the two asks them to retry anything | `step`, `error_code` (`DRAFT_SAVE_FAILED`, `DRAFT_DELETE_FAILED`, `POOLS_FETCH_FAILED`, `POOLS_UNIVERSE_FETCH_FAILED`), `error_origin` (`app`, `upstream`) | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx`), PP-MGR-CMP-044 (`MandateDraftsList.tsx`, the refused delete) |

## Manager, fund builder (parked drafts)

A mandate that was parked lives in the Console's Drafts card, which is the only way back into it
and the only way to throw it away (POO-2127, epic POO-2119).

The two events below exist because `builder_mandate_abandoned{draft_saved:true}` stops one step
short of the question being asked: a saved abandonment says work was parked, not whether it was
ever resumed. **Without `builder_draft_deleted` every parked mandate reads as a pending success**,
which is the reading most likely to be wrong.

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `builder_draft_opened` | Open was pressed on a draft in the Console's Drafts card. Fires on the press rather than on the builder mounting, because the press is the intent and a navigation that fails to mount is exactly the case worth seeing. Since POO-2157 the Open of a completed draft last saved in the Build phase lands on the Build canvas | `step` (where the draft was parked, which is where the manager is about to land) | PP-MGR-CMP-044 (`MandateDraftsList.tsx`) |
| `builder_draft_deleted` | A draft was removed, after the confirm dialog was answered Delete. Never on opening the dialog: a cancelled delete is not a delete, and counting it would turn hesitation into a decision | `step` (where the draft was parked when the manager gave up on it; the step they could not get past is the actionable half of a deletion) | PP-MGR-CMP-044 (`MandateDraftsList.tsx`) |

**Retired:** `builder_build_landing_viewed` (POO-2127) counted arrivals on the Build landing, which
POO-2157 replaced with the Build canvas. Its series ends there; `builder_build_viewed` below counts
arrivals on the canvas from then on, so the two are one question before and after the canvas
shipped, not one continuous series.

## Manager, fund builder (Build phase)

The fund builder's second phase (POO-2157, epic POO-2144, coordinator default D20): the canvas
where a closed mandate becomes a plan of blocks. Like the Mandate, **nothing in this phase signs a
transaction**, so its only settlement is persistence. Review does not exist yet, so
`builder_build_submitted` and `builder_build_completed` are deliberately NOT declared: there is no
Review to submit to and no write that opens it. They arrive with the Review handoff, `completed` on
the save that opens Review and never on the click.

The canvas events are named after the GESTURE, not the reducer behind it (a Borrow inserted at a
port is a block added `via: port`, not a flow insert), so "managers add networks and never place a
block on them" reads straight off the series. **Next: Review is never disabled**, so
`builder_build_blocked` is the entire record of the canvas saying no: its reason is either the plan
reducer's own refusal or one of the twelve ordered Next: Review checks (S7's six, with the six
launch readiness checks of POO-2184 before the last), one value per inline notice. The
configuration panel (POO-2187) adds a block's own funnel: `configured` (Use), `applied` (Apply
changes landed, with the fields it changed), `discarded` (the edit abandoned), and two kinds of
blocked intent, `leave_blocked` (an exit refused while changes were not applied) and `limit_hit`
(the Allocation stopped at its ceiling).
`builder_build_abandoned` closes the phase's arithmetic: a Build visit ends in a Save & exit
(`builder_draft_saved`), an abandonment, a Back: Mandate or an Edit mandate link (the Mandate step
it lands on counts the return in `builder_mandate_step_viewed`, and leaving from there is a
`builder_mandate_abandoned`), or, later, a completion. Everything below is emitted only
through `useAnalytics().track()` / `useTrackView`. Values are plan ids (`uniswapV4Pool`,
`arbitrum`), never translated labels.

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `builder_build_viewed` | The Build canvas mounted: the last Next completed the mandate, a `?phase=build` link or a Console Open resumed a completed draft, or the manager walked forward again from an Edit mandate link. Once per visit, via `useTrackView`. Replaces `builder_build_landing_viewed` | `blocks_count` (cards placed: position blocks, never the app's Swap · auto or a Collect fees pill), `spokes_count` (networks other than the hub on the canvas) | PP-MGR-SCR-002 (`build/BuildScreen.tsx`) |
| `builder_build_started` | The first block was placed on a plan that held none (from a menu, the palette or a port). At most once per visit. The phase's denominator: a manager who arrives and never places anything shows as viewed and not started | none | PP-MGR-SCR-002 (`build/BuildScreen.tsx`) |
| `builder_block_added` | A position block reached the canvas: chosen in an Add protocol menu, dropped from the palette, or a Borrow chosen in the menu of the port under a Supply. Fires only when the reducer accepted it | `block_kind` (`uniswapV4Pool`, `aaveSupply`, `aaveBorrow`; the coming-soon kinds can never be added), `network` (`arbitrum`, `robinhood`), `via` (`template`, `palette`, `port`) | PP-MGR-SCR-002 (`build/BuildScreen.tsx`, from `useBuildCanvas`) |
| `builder_network_added` | A spoke network was added from the Add network menu (its group and its Bridge appear) | `network` | PP-MGR-SCR-002 (`build/BuildScreen.tsx`) |
| `builder_network_removed` | A spoke with no chain was removed from the close control on its chip | `network` | PP-MGR-SCR-002 (`build/BuildScreen.tsx`) |
| `builder_flow_block_inserted` | A manager Swap or a Collect fees was inserted at an insert port (menu or palette drop). Never for a Borrow, which is a `builder_block_added` with `via: port` | `block_kind` (`swap`, `collectFees`), `slot` (`before`, `after`) | PP-MGR-SCR-002 (`build/BuildScreen.tsx`) |
| `builder_block_removed` | A block was removed: Remove block in the configuration panel, or Delete / Backspace on the selected card, both of which open the panel's confirm first (POO-2187, P10, DP11), so it fires only when the confirm's Remove block landed. The I6 cascade goes with the block (its Swap · auto, its Collect fees, the Borrow under a Supply), and on a spoke the spoke's share comes down to what its chains still hold | `block_kind` (the block the manager removed, not the cascade), `cascade_count` (how many other steps went with it) | PP-MGR-SCR-002 (`build/BuildScreen.tsx`) |
| `builder_block_configured` | `Use` in the configuration panel (Mode 2) wrote the kind's defaults, the pool or the asset picked from the mandate, as the block's applied config with a share of 0% (POO-2187, P7, DP1). Fires only when the plan took it; a refused Use is a `builder_build_blocked` with the reducer's reason | `block_kind`, `network` | PP-MGR-SCR-002 (`build/BuildScreen.tsx`), from PP-MGR-HOK-014 (`build/panel/usePanelDraft.ts`) |
| `builder_block_applied` | Apply changes landed: the panel's draft (the config, the chain's share and, on a spoke, the spoke's share) reached the plan in one write (POO-2187, P3, P5). Never on the click alone: a refused Apply keeps the draft and is a `builder_build_blocked` | `block_kind`, `fields_changed` (comma-joined, fixed order: `pool`, `asset`, `range`, `quote`, `slippage`, `allocation`) | PP-MGR-SCR-002 (`build/BuildScreen.tsx`), from PP-MGR-HOK-014 (`build/panel/usePanelDraft.ts`) |
| `builder_block_discarded` | **Abandonment** of a block's edit: Discard in the status row, or Discard changes in the leave notice, dropped a draft that differed from what is applied (POO-2187, P5, P6) | `block_kind` | PP-MGR-SCR-002 (`build/BuildScreen.tsx`), from PP-MGR-HOK-014 (`build/panel/usePanelDraft.ts`) |
| `builder_block_leave_blocked` | **Blocked intent.** The manager tried to leave a block holding changes not applied (another block, the canvas background, an Edit mandate link, Back, Next: Review, Save & exit, the stepper) and the panel kept the selection and showed its notice (POO-2187, P6). Once per refusal; the exit runs after Apply changes or Discard changes | `block_kind` | PP-MGR-SCR-002 (`build/BuildScreen.tsx`), from PP-MGR-HOK-014 (`build/panel/usePanelDraft.ts`) |
| `builder_block_limit_hit` | **Blocked intent.** A gesture brought the Allocation slider up to its ceiling, which is under 100 (POO-2187, P8). Says which ceiling stopped it, so "managers run into their own mandate caps" reads apart from "the strategy is full" | `block_kind`, `limit` (`mandate_cap`: a protocol cap of the mandate, `network_cap`: a network cap, `parent_share`: what the other blocks under Idle input already take) | PP-MGR-SCR-002 (`build/BuildScreen.tsx`), from PP-MGR-CMP-064 (`build/panel/AllocationSlider.tsx`) |
| `builder_build_blocked` | **Blocked intent.** The canvas refused a gesture (a disabled menu row, a port with nothing to insert, an insert or an add the plan rules refuse, Add network with no network left), the configuration panel's Use or Apply changes was refused by the plan (POO-2187, review M4 of PR #54: a pool or asset no longer in the mandate, a share over what is left, a range off the pool's grid; the panel says why under the list or in the status row), or Next: Review refused. A palette drop released anywhere but a lit target is not a refusal and reports nothing. Next: Review runs its checks in order and reports the first that fails: an empty plan, a block or network no longer in the mandate, a coming-soon block, an empty block, shares over the capital above them, then the launch readiness checks of `planReadiness` (PP-MGR-LIB-028, POO-2184): a pool picked but not finished (no range or slippage), a chain with no whole share above 0%, a network holding more than its blocks take (an emptied one included), a chain with more than one position or anything under a Supply, the same reserve supplied twice on one network, a Swap outside a pool; a plan that passes them all is told Review is not available yet. Each refusal shows its own inline notice (`fundBuilder.canvas.review.*`) | `block_reason`: the plan's reasons `not_in_mandate`, `coming_soon`, `borrow_needs_supply`, `no_network_left`, `network_on_canvas`, `slot_not_allowed`, `share_exceeds_parent`, `auto_owned`, `spoke_not_empty`, `unknown_target`, and Next: Review's `review_empty_plan`, `review_invalid_block`, `review_coming_soon_block`, `review_empty_block`, `review_over_share`, `review_incomplete_block`, `review_zero_share`, `review_unused_spoke_share`, `review_stacked_positions`, `review_duplicate_reserve`, `review_unsupported_swap`, `review_unavailable` (closed union `AnalyticsBuildBlockReason`) | PP-MGR-SCR-002 (`build/BuildScreen.tsx`) |
| `builder_build_abandoned` | The builder unmounted while the Build canvas was on screen, without a Save & exit. Replaces the `builder_mandate_abandoned` such a session used to report: the mandate under it is already closed | `draft_saved` (`false` when plan edits made since the last save were left behind, which is the loss worth acting on; a Build draft was always saved once), `blocks_count` | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx`) |
| `builder_build_error` | A draft could not be written from the Build phase (Save & exit): storage quota, blocked site data, a private window. The manager stays on the canvas with the plan. Same single code as the Mandate's, for the same reason: the browser does not say which cause. Also, once per visit, the canvas opened a draft whose stored plan this build cannot read (a newer build's, or one edited by hand): the canvas shows empty, says so and keeps the stored plan untouched until a save carries a new one (D18) | `error_code` (`DRAFT_SAVE_FAILED`, `PLAN_UNREADABLE`), `error_origin` (`app`). Deliberately the repo's error fields rather than the `{error_reason: storage}` of the issue's D20 text: `sanitizeParams` keeps only `<DOMAIN>_<REASON>` codes, and the Mandate's error already uses them | PP-MGR-SCR-002 (`FundStrategyBuilderScreen.tsx` the save, `build/BuildScreen.tsx` the unreadable plan) |

**Retired:** `builder_block_restored` (POO-2157) counted Undo on the "Block removed" toast. POO-2187
replaced the immediate remove and its toast with the configuration panel's confirm (handoff P10,
decision DP11), so there is nothing left to undo; its series ends there, and
`builder_block_removed` now carries `cascade_count`.

## Transaction flows (cross-modal)

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `tx_slippage_retry` | A slippage-classified tx failure auto-retries once (fired on the AUTOMATIC retry only, never on a user-initiated retry). No error message/code in params, per the privacy rule. | `flow` (invest/withdraw/collect/compound/moveRange/removeLiquidity), `strategy_id` | PP-STR-HOK-001 (useSlippageAutoRetry) |
| `tx_impact_gate_blocked` | A quoted route at or above 10% price impact requires explicit risk acknowledgement. Once per active gate engagement, from derived blocked state. POO-2198 activates the gas-only provisioning gate while its auxiliary screen is visible, including before any start request; leaving that screen deactivates consent. | `flow`, `strategy_id` (where supplied by the host), `metric_name` (`price_impact_pct`), `metric_value` | PP-STR-CMP-022 (`usePriceImpactGate`), hosted by PP-CORE-CMP-046 (`ProvisioningPanel`) |
| `tx_impact_gate_acknowledged` | The user explicitly checks the risk acknowledgement. Unchecking and programmatic consent resets do not emit. Checking enables the gated CTA without starting execution; confirmation remains a separate action. | `flow`, `strategy_id` (where supplied by the host), `metric_name` (`price_impact_pct`), `metric_value` | PP-STR-CMP-022 (`usePriceImpactGate`) |
| `wallet_action_blocked` | SwitchNetworkAction: the operation's chain is not in the wallet at all, so no switch can reach it: a WalletConnect session (Ledger Live) carries only the networks its owner paired. Fires once per rendered failure, when the manual switch action mounts on a `chainUnavailable` error. NOT fired for `wrongChain`, which is not blocked, just one prompt away. / SiweFailureNotice: the SIWE handshake refused a wallet and the blocking notice rendered (POO-1461). Fires once per failure OCCURRENCE, keyed on the failure object rather than on the mount, because this notice lives above every route and re-renders for the whole life of the page. Only for the two kinds POO-1425 made non-fatal: `unsupported-chain` (the wallet is on a network we do not serve, and since POO-1449 only after the app has already tried to move it and failed, so this now counts users who are GENUINELY blocked rather than every wrong initial network) and `user-rejected` (the human dismissed the prompt). NOT fired for `auth-rejected` or `unavailable`, which still raise to a route error boundary and are already counted there as `app_error_shown`. No wallet address, `reference`, `recoveredSigner` or `signedEncoding` in the payload, per POO-243 [R3]; that detail lives on the first-party `auth.siwe_failed` report instead. | `block_reason` (`chain_unavailable`, `unsupported_chain`, `user_rejected`) | PP-STR-CMP-026 (SwitchNetworkAction), PP-AUTH-CMP-004 (SiweFailureNotice) |

## Savings

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `savings_list_viewed` | Savings markets list rendered | | PP-SAV-SCR-001 |
| `savings_market_viewed` | A market detail rendered | `market_id` | PP-SAV-SCR-002 |
| `savings_deposit_started` | Deposit opened | `market_id` | PP-SAV-* |
| `savings_deposit_submitted` | Deposit confirmed | `market_id`, `value` | PP-SAV-* |
| `savings_deposit_completed` | Deposit confirmed on-chain | `market_id`, `value`, `usd_value_at_time` | PP-SAV-* |
| `savings_deposit_failed` | Deposit error | `market_id` | PP-SAV-* |
| `savings_withdraw_started` | Withdraw opened | `market_id` | PP-SAV-* |
| `savings_withdraw_submitted` | Withdraw confirmed | `market_id`, `value` | PP-SAV-* |
| `savings_withdraw_completed` | Withdraw confirmed | `market_id`, `value`, `usd_value_at_time` | PP-SAV-* |
| `savings_withdraw_failed` | Withdraw error | `market_id` | PP-SAV-* |

## Buy tokens

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `token_list_viewed` | Buy-tokens list rendered | | PP-TOK-SCR-001 |
| `token_detail_viewed` | Token detail rendered | `token_symbol` | PP-TOK-SCR-002 |
| `token_buy_started` | Buy ticket opened | `token_symbol`, `order_type` | PP-TOK-MOD-* |
| `token_buy_submitted` | Buy confirmed | `token_symbol`, `order_type`, `value` | PP-TOK-MOD-* |
| `token_buy_completed` | Buy filled or placed | `token_symbol`, `order_status`, `token_amount`, `usd_value_at_time` | PP-TOK-MOD-* |
| `token_buy_failed` | Buy error | `token_symbol` | PP-TOK-MOD-* |
| `token_sell_started` | Sell ticket opened | `token_symbol`, `order_type` | PP-TOK-MOD-* |
| `token_sell_submitted` | Sell confirmed | `token_symbol`, `order_type`, `value` | PP-TOK-MOD-* |
| `token_sell_completed` | Sell filled or placed | `token_symbol`, `order_status`, `token_amount`, `usd_value_at_time` | PP-TOK-MOD-* |
| `token_sell_failed` | Sell error | `token_symbol` | PP-TOK-MOD-* |

## Predictions

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `prediction_market_viewed` | A prediction market rendered | `prediction_id` | PP-PRED-SCR-* |
| `prediction_bet_started` | Bet ticket opened | `prediction_id`, `side`, `outcome` | PP-PRED-MOD-* |
| `prediction_bet_submitted` | Bet confirmed | `prediction_id`, `side`, `value` | PP-PRED-MOD-* |
| `prediction_bet_completed` | Bet placed | `prediction_id`, `outcome`, `value`, `usd_value_at_time` | PP-PRED-MOD-* |
| `prediction_bet_failed` | Bet error | `prediction_id` | PP-PRED-MOD-* |
| `prediction_cashout_completed` | Position cashed out | `prediction_id`, `value`, `usd_value_at_time` | PP-PRED-* |

## Perps

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `perp_market_viewed` | Perp market/trade page rendered | `perp_market` | PP-PERP-SCR-* |
| `perp_leverage_changed` | Leverage changed | `perp_market`, `leverage` | PP-PERP-MOD-* |
| `perp_trade_started` | Order ticket opened | `perp_market`, `side` | PP-PERP-MOD-* |
| `perp_trade_submitted` | Order confirmed | `perp_market`, `side`, `leverage`, `value` | PP-PERP-MOD-* |
| `perp_trade_completed` | Order opened | `perp_market`, `side`, `leverage`, `usd_value_at_time` | PP-PERP-MOD-* |
| `perp_trade_failed` | Order error | `perp_market` | PP-PERP-MOD-* |
| `perp_position_closed` | Position closed | `perp_market`, `value`, `usd_value_at_time` | PP-PERP-MOD-* |

## Cards

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `card_explore_viewed` | Explore cards rendered | | PP-CARD-SCR-* |
| `card_detail_viewed` | Card detail rendered | `card_issuer` | PP-CARD-SCR-* |
| `card_request_started` | Request flow opened | `card_issuer` | PP-CARD-* |
| `card_request_completed` | Card requested | `card_issuer` | PP-CARD-* |
| `card_topup_started` | Top-up opened | `card_issuer` | PP-CARD-* |
| `card_topup_completed` | Top-up confirmed | `card_issuer`, `value`, `usd_value_at_time` | PP-CARD-* |
| `card_freeze_toggled` | Card frozen/unfrozen | `card_issuer` | PP-CARD-* |

## Deposit

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `deposit_started` | Deposit screen opened | | PP-DEP-SCR-001 |
| `deposit_method_selected` | Onramp method chosen | `deposit_method` | PP-DEP-* |
| `deposit_submitted` | Deposit confirmed | `deposit_method`, `value` | PP-DEP-* |
| `deposit_completed` | Deposit credited | `deposit_method`, `value`, `usd_value_at_time` | PP-DEP-* |
| `deposit_failed` | Deposit error | `deposit_method` | PP-DEP-* |
| `deposit_crypto_started` | Crypto-transfer path opened | | PP-DEP-* |
| `deposit_crypto_completed` | Crypto deposit credited | `token_symbol`, `token_amount`, `usd_value_at_time` | PP-DEP-* |
| `tx_amount_blocked` | **This screen's blocked intent (premise 11). POO-1609 (second and standing reversal, 2026-08-14) replaced the raise this event used to fire on.** The buyer ACTIVATED a payment-method row whose provider minimum their order does not reach; the product refuses the activation rather than raising the order to clear it (there is no raise any more, and the row renders BLOCKED, unselectable, before this fires). Fires on the refusal itself, exactly once per activation, and only on an activation: it is a click-time event with no latch, because the refusal stores nothing that could be counted twice (#897's `blockGuardRef` existed to de-duplicate an EFFECT and went with it). Deliberately NOT fired for the auto-picked default, which the buyer never chose: since PP-DEP-SCR-001 rules v2 a below-floor method cannot BE the active method at all (`activeMethod` filters the refused set before `pickDefaultPaymentMethod` runs), so there is no silent default refusal left to report. Not fired once the purchase is running (the amount step, where the row lives, is gone by then). No `value`: the order is USDC to receive and the floor is fiat in the buyer's own currency, so one number cannot carry both. **POO-1642 (2026-08-16) added the screen's SECOND blocked intent to this same name, under two new reasons.** The buyer pressed `Confirm & pay` and the product refused to mint, because the journal holds a purchase intent for this wallet that it cannot verify: `purchase_paid_unsettled` (we observed the payment and it has not landed) or `purchase_unverified` (we never saw it paid, and it is past `ONRAMP_REQUEST_RESUMABLE_MS`). It fires on the INTERCEPTION, exactly once per question, and never on either answer: `Resume` / `Keep waiting` and `Start a new purchase` are two answers to ONE blocked attempt, and counting them separately would lose the denominator, which is how often we interrupt a buyer at all. Split into two reasons because they point at opposite fixes: a paid intent that never landed is our settlement observer missing a delta, while an unverified one asks whether our own 15-minute resumability window is too short. This one CAN fire after the purchase is running (the mint is where the question is asked), unlike the row-refusal case above. Same `deposit_method` when the provider gave a list to name one from. **POO-1624 (2026-08-17) added the screen's THIRD blocked intent, on the CRYPTO path this time.** `transfer_unobserved`: the buyer pressed "I've sent the funds" asking us to confirm their transfer landed, and the product answered that it cannot, because nothing watches the address (POO-604). It fires once per arrival at that wait, in real mode only, de-duplicated by a ref because it is an EFFECT rather than a click (the `blockGuardRef` role POO-1609's own removal retired). Deliberately NOT `deposit_failed`: nothing failed, the transfer is very probably arriving, and folding a missing OBSERVATION into the fiat funnel's failure rate would corrupt the one number week one reconciles against Paybis' own dashboard. Its count is the denominator for whether extending POO-1129's balance-delta reconcile to the crypto path is worth building; it replaces the `deposit_crypto_completed` rows that used to be emitted by a timer. No `value`: the whole point is that we hold no measured figure. **POO-1794 (2026-09-04) added the screen's FOURTH blocked intent, back on the FIAT path.** `onramp_disabled`: the buyer pressed `Confirm & pay` in REAL mode while the `fiatOnRamp` flag was dark, so the on-ramp is not launched and there is no purchase to make; the confirm refuses rather than fabricating a `deposit_completed` for a purchase that never happened (the defect this issue closed, and a premise-11 violation). It fires on the refusal itself, once per press, and CONCLUDES the abandonment, so it is the deposit funnel's fifth settlement term: `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`. Deliberately NOT `transfer_unobserved` (a real flow missing its watcher, reconciled against Paybis' dashboard) and NOT `deposit_failed` (nothing failed, because nothing ran). A non-zero count is the alarm that a real buyer met a dark on-ramp before the flag was flipped. **POO-1806 (2026-09-04) added an INVEST emitter under an existing reason.** `PP-STR-MOD-001` (`InvestModal`) reports `exceeds_balance` when settle-then-size refuses: the investor asked for an amount that was never below the minimum, the fresh balance came up short, and the sized figure landed under the platform minimum, so the build does not run and a screen explains why (ADR-0005). Deliberately NOT `below_minimum`, which this taxonomy defines as being about what the USER entered; the invest surface still emits that one, from its own latch, for an amount typed under the minimum. The two run as separate `useTxAmountBlocked` calls so one refusal loop cannot re-fire the other's latch. **POO-1808 (2026-09-05) added the PROVISIONING buy step's four, on the Privy rail, which is the first emitter of this name outside `/deposit`.** All four fire BEFORE a checkout opens, and all four are facts about what can be bought rather than failures of an attempt, which is why none of them reaches the generic "try again" copy. `onramp_native_unavailable`: the gas-first leg asks for the native coin and this rail does not sell it (POO-1820), so it is refused rather than sent to a checkout that cannot fill the order; the count is what tells whoever takes the paymaster-versus-disclosure decision how often a real buyer hits the wall. `onramp_uncovered`: POO-1805's probe answered that no provider will sell to this buyer, in this currency, for this amount, right now; deliberately separate from the native one because they point at opposite fixes (a capability gap versus a coverage gap). `onramp_currency_unsupported`: the SERVER-resolved buyer currency is not one the rail can charge in, and the alternative was the POO-1512 class, a silent fallback to dollars that charges someone in money nobody chose for them and looks like a successful purchase from every angle we can see. `onramp_baseline_unreadable`: the destination `balanceOf` failed, so there is no zero mark to subtract a delivery from and the CTA will not open a checkout; it is the only one of the four with no refusal screen behind it (the buyer just sees a line that never resolves), which is exactly why it is reported, and it fires once per mount because it is a read that failed rather than something the buyer did. These four carry `flow` (the operation being provisioned, e.g. `invest`) and `strategy_id` rather than `deposit_method`: there is no method picker on this rail, the checkout picks the method itself. **POO-1807 (2026-09-04) added `/deposit`'s FIFTH and SIXTH blocked intents, on the same Privy rail, from `PP-DEP-SCR-001`.** `onramp_uncovered` on this surface: the coverage probe (`PP-CORE-LIB-108`) answered that nobody will sell to this buyer, in this currency, at this amount, so the confirm refuses BEFORE any checkout opens (same reason as the provisioning step's above, same probe, a different host). Deliberately not `deposit_failed` (nothing ran) and not `below_minimum` (that is our own floor; this is the market's answer, and the two lead to different actions). `onramp_unverified`, which only `/deposit` reports: the ADR-0006 VISIBLE observation window closed with no provider claim and no on-chain delta, so the screen is released on an honest state rather than a cancellation. **Neither CONCLUDES the abandonment**, unlike `transfer_unobserved` and `onramp_disabled`: they are denominators, like `below_minimum`. The flow is not over when they fire, because the PASSIVE window (`PP-CORE-LIB-110`) keeps observing for the rest of the session and may still settle the purchase, so concluding at the visible ceiling would let one `deposit_started` produce two settlement terms. The identity is therefore unchanged at five terms: `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`, with a released screen resolving later as `completed` (the delta landed) or `abandoned` (the buyer left). That `abandoned` then covers a buyer who paid and is waiting is a known imprecision, recorded here rather than papered over: the alternative, a sixth settlement term, double-counts every late settlement. `onramp_paid_unsettled` is declared alongside them for the released-`settling` case. **POO-1807's review (2026-09-05, from the POO-1801 review's F10) added `/deposit`'s SEVENTH, which is the same `onramp_currency_unsupported` the provisioning step reports.** The rail does not sell in the buyer's own currency, or the server chain that resolves one (`PP-CORE-LIB-096`) could not answer, so the confirm refuses before any checkout opens. What it replaced was a silent `?? "usd"` at the host, which opened a dollar-denominated checkout for a buyer whose money is not dollars: the POO-1512 [R5] defect with a new rail behind it. Kept apart from `onramp_uncovered` because the two point at opposite fixes and one of them is ours, so folded together an outage in currency resolution would read as demand from an unserved country. A DENOMINATOR, like the two above: nothing ran, nothing was charged, and the abandonment is not concluded. `/deposit` does not report `onramp_native_unavailable` or `onramp_baseline_unreadable`: the first is the provisioning step's gas leg, which this screen has none of, and an unreadable baseline here disables the CTA rather than refusing a press, so there is no attempt to count. | `flow` (`deposit`, `invest`, or the provisioned operation: `withdraw`, `collect`, `compound`, `create_pool`, `move_range`, `close_position`), `block_reason` (`below_minimum`, `exceeds_balance`, `purchase_paid_unsettled`, `purchase_unverified`, `transfer_unobserved`, `onramp_disabled`, `onramp_native_unavailable`, `onramp_uncovered`, `onramp_currency_unsupported`, `onramp_baseline_unreadable`, `onramp_paid_unsettled`, `onramp_unverified`), `deposit_method` (fiat rail only), `strategy_id` (invest and provisioning) | PP-DEP-SCR-001, PP-STR-MOD-001, PP-STR-CMP-029 |

## Universal Funding (provisioning funnel)

Epic POO-1022 · issue POO-1048. Pay for any Pool Party operation with any token on any supported chain: the funnel measures whether a user who holds the money somewhere else can find it, choose it, and land it on the operation's chain. Every event is emitted by **PP-CORE-LIB-058** (`src/lib/analytics/provisioningFunnel.ts`), the single definition of the funnel; the gate hook and `ProvisioningPanel` only call it.

**Shared params.** `flow` (the operation: invest / withdraw / collect / compound / move-range / close), `chain_id` (the chain the operation runs on), `strategy_id` where there is one. `route_shape` ∈ `same-chain` (a swap where the operation lives) · `cross-chain` (one bridge of an asset already held) · `decomposed` (a swap feeding a bridge, which is what a different-token cross-chain pair becomes, since the Trading API answers `404` to it). `leg_count` counts executable steps and never the `op` display anchor. `value` is USD with `currency: "USD"`.

**Never in a payload:** a wallet address, a token address, or a transaction hash. `user_id` (server-HMAC, consent-gated) rides along exactly as on every other event.

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `funding_gate_triggered` | The pre-flight gate decided the operation cannot proceed unfunded. Fired from the gate hook, so all six operations are covered even if the user never reaches the panel. `value` = what is MISSING (USDC + gas shortfall), not what the operation is worth. No `route_shape`: before a route is quoted there is no shape, and guessing one would report an intention as a fact. | `flow`, `chain_id`, `value` | PP-CORE-HOK-017 |
| `funding_sources_listed` | The funding-source picker rendered. `source_count` / `value` are the SPENDABLE sources (routable to the operation's chain), so "six tokens listed, none of them can get there" reads as zero. Once per session. | `source_count`, `value` | PP-CORE-CMP-046 |
| `funding_sources_selected` | The user committed to a selection. Totals come from the same micro-dollar helper the CTA gates on. | `source_count`, `value` | PP-CORE-CMP-046 |
| `funding_plan_quoted` | A priced plan came back. Once per quote, keyed on the quote's own `quotedAt`, so a TTL re-quote is reported (it is a new price the user then approves) and a re-render is not. | `route_shape`, `leg_count`, `value` | PP-CORE-CMP-046 |
| `funding_plan_started` | The user approved the route and execution began. **The only funnel event the confirm click emits.** | `route_shape`, `leg_count`, `value` | PP-CORE-CMP-046 |
| `funding_leg_settled` | One leg SETTLED, i.e. its `run()` resolved, which for a bridge means arrival was detected on the destination chain. Never on broadcast: a hash exists minutes before the money does. Once per leg however many renders observe it. | `leg_kind`, `leg_index`, `route_shape`, `value` | PP-CORE-CMP-046 |
| `funding_plan_completed` | Every leg settled. **[R3]** Fired from the flow-status effect, never from a click, and at most once per session. Still fires for a route that failed, was retried, and landed. | `route_shape`, `leg_count`, `value` | PP-CORE-CMP-046 |
| `funding_plan_failed` | A terminal failure: a rejected or reverted leg, or a planner failure (a BLOCKED gas chain) that priced no route at all. **[R4]** Fires on EVERY terminal failure, so a retry that fails again is a second event. A bridge still in flight at the poll ceiling is deliberately NOT one. Typed `error_code` only, never error text. | `error_code`, `route_shape`, `leg_kind`, `leg_index` | PP-CORE-CMP-046 |
| `funding_plan_abandoned` | The session ended with no outcome recorded: the user cancelled, closed the modal, or left a bridge still settling. Emitted on unmount, so `started = completed + failed + abandoned`. | `funding_exit` (`sources`/`plan`/`pending`/`settling`/`error`) | PP-CORE-CMP-046 |
| `funding_route_viewed` | Screen 1, "Where from", appeared (POO-1501). Fires on the OPEN rather than on the arrival of the figures, so a session that left while the quote was still in flight is counted (D1); it does NOT fire when the picker renders nothing, which is every gate open in the crypto-only cut where `resolveFundingRoutes` returns one route. `funding_route_count` counts CARD routes only: the deposit ghost link ([R7]) hands off to another surface entirely and is not one of the options being compared. `funding_route_recommended` is `"none"` on a one-card screen, a real value and not a gap ([R6]). **POO-1541:** moved out of `FundingRoutePicker` into the panel's own effect, so it now carries the shared params like every other row in this table. **Fires once per ENTRY to screen 1, never once per panel session:** the [R20] back chevron on step 2 and the buy route's impact-gate ghost both return to screen 1 mid-session, and each return emits a fresh view (the panel advances an entry key on every false-to-true edge of `pickingRoutes`, and the funnel's `emitOnce` dedupes within an entry only). This preserves the picker's original per-mount semantics, so the series is continuous across POO-1541; `chosen` and `abandoned` are per-action, so a per-session view would let chosen/viewed exceed 1. | `flow`, `chain_id`, `funding_route_count`, `funding_route_recommended`, `funding_gas_needed` | PP-CORE-CMP-046 (`ProvisioningPanel`) + PP-CORE-LIB-058 (emitter) |
| `funding_route_chosen` | The user tapped a route. One tap is the whole interaction, so this is the choice and the commitment at once. `funding_route_followed_recommendation` is the point of the pair: `Recommended` ([R6]) is a claim the product makes about the fewest-steps path, and without it route choices could be counted forever without ever learning whether the chip moves any of them. The deposit link reports as `deposit` and never as followed, since it can never carry the chip. **POO-1541:** moved out of `FundingRoutePicker` into the panel's `onSelect` handler. | `flow`, `chain_id`, `funding_route`, `funding_route_recommended`, `funding_route_followed_recommendation` | PP-CORE-CMP-046 (`ProvisioningPanel`) + PP-CORE-LIB-058 (emitter) |
| `funding_method_viewed` | POO-1576: the "Choose how to pay" step appeared, between the buy amount and the Paybis checkout. The funnel had no step for HOW a buyer pays because the app never asked: `resolveWidgetPrefill` prefilled a card by regex and sent it to the mint. This is the VIEW class and the step's START at once, deliberately and on the same reasoning `funding_route_viewed` carries: the screen opens with its list and there is no separate starting gesture, so a second event would be a duplicate under another name. Fires on the OPEN rather than on the arrival of the figures, so a buyer who left while the quote was still in flight is counted. Once per ENTRY to the step (one per run today; a future retry would count as the fresh view it is). | `flow`, `chain_id`, `funding_method_count` | PP-STR-CMP-028 (`OnRampMethodStep`) + PP-CORE-CMP-046 (host) + PP-CORE-LIB-058 (emitter) |
| `funding_buy_started` | POO-1813 [R3]. The fiat checkout was ASKED to open: the call itself, not the gesture and not a purchase. It is the denominator every later rate is measured against. Emitted once per attempt by the adapter, on the PRIVY rail; the Paybis rail keeps its own events until POO-1809 retires it, so this series describes one rail and `rail` is carried anyway, because a conversion rate that silently mixes two providers is worse than two rates. | `rail`, `attempt_id`, `fiat_currency` | PP-CORE-LIB-111 (called by PP-CORE-HOK-035) |
| `funding_buy_submitted` | POO-1813 [R3]. The provider CLAIMED it charged. Named `submitted` and never `completed` on purpose: funds take minutes to arrive and this says nothing about money existing. `moved` carries the classifier's verdict, and the two values are not a confidence ranking: on the Stripe path a charged card and an abandonment are the same rejection (ADR-0006), so a real charge lands on `maybe`, while the popup providers still report `provider-confirming` and arrive as `confirmed`. Nothing branches on the difference. The Privy rail only; see `funding_buy_started`. | `rail`, `attempt_id`, `fiat_currency`, `moved` | PP-CORE-LIB-111 (called by PP-CORE-HOK-035) |
| `funding_buy_failed` | POO-1813 [R1]/[R3]. A hard no: nothing was charged and nothing is coming. `reason` is the classifier's own string and `error_code` its 1:1 mapping, never folded, so `popup_blocked` and `not_authenticated` stay separable (they call for opposite fixes). An unmapped reason reports `ONRAMP_UNMAPPED` rather than throwing, so a provider that adds a rejection message cannot break a purchase through the analytics path. `attempt_id` is absent when the adapter refused before minting one, because there is no purchase to join to. The Privy rail only; see `funding_buy_started`. | `rail`, `attempt_id`, `fiat_currency`, `reason`, `error_code` | PP-CORE-LIB-111 (called by PP-CORE-HOK-035) |
| `funding_buy_settled` | POO-1813 [R4]. **The only honest money-in number in the repository.** Fires on the OBSERVED balance delta (`PP-CORE-LIB-110`) and never on the promise resolving, a modal closing or a provider status. The figures are what POO-1811's purchase half needs: the gap between `requested_usd` and `prefill_usd` is OUR buffer, the gap between `prefill_usd` and `delivered_usd` is the provider's spread. `prefill_usd` is OMITTED, never zeroed, for a buyer we prefilled nothing for (a non-USD purchase carries no `defaultAmount` at all), so the buffer query skips that row instead of averaging a figure nobody asked for. `fiat_currency` is what the card was CHARGED in, not the currency the USD figures are sized in. `value` mirrors `delivered_usd` because the honest GA4 value is what arrived. The Privy rail only; see `funding_buy_started`. | `rail`, `attempt_id`, `fiat_currency`, `requested_usd`, `prefill_usd`, `delivered_usd`, `value`, `currency` | PP-CORE-LIB-111 (called by PP-DEP-SCR-001 and PP-STR-CMP-029) |

**Known baseline shift (POO-1025, documented here because it moves an existing funnel).** `strategy_invest_submitted` now fires for cross-chain-funded invests that previously early-returned to `/deposit` and never entered the invest funnel at all. The `started → submitted → completed` conversion baseline steps up and a cohort is reclassified from deposit-intent to invest-start. Inherent to the feature working; anything trending against the old baseline will show a discontinuity at the flag flip.

## Rewards

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `reward_program_viewed` | A rewards program rendered | `reward_program` | PP-REW-SCR-001/002/003 |
| `reward_referral_shared` | Referral link/code shared (share or copy) | | PP-REW-CMP-012/014 |
| `reward_claimed` | Quacks claimed — Say Quack check-in / Duck Shoot boost | `value` | PP-REW-SCR-001 / PP-REW-MOD-001 |

## Tools

The Uniswap v4 hook risk scan at `/tools` (PP-TOOLS-SCR-001, hackathon). Every event is emitted by **PP-TOOLS-CMP-001** (`src/features/tools/HookRiskScreen.tsx`); nothing else in the feature tracks, and the API route (PP-TOOLS-API-001) deliberately does not, because a route handler has no consent context.

**Shared params.** `chain_id` (the chain the hook is deployed on) and, on the two failure events, `error_code`.

**Never in a payload: the hook address.** It is a raw EVM address, which `sanitizeParams` (PP-SECURITY [R3]) would strip anyway; it is also not a question these events answer. What is being measured is whether a scan that a user asked for ever produced a report.

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `tools_hookrisk_viewed` | The Tools screen rendered. Once per mount, via `useTrackView`. | | PP-TOOLS-CMP-001 |
| `tools_hookrisk_started` | The user pressed Analyze with a well-formed address, so a scan was requested. The only event the click emits. | `chain_id` | PP-TOOLS-CMP-001 |
| `tools_hookrisk_completed` | **The report is in hand** and on screen, whether freshly scanned or served from the 24 h cache. Never on the click, and never when the scan merely started: a scan takes minutes and can fail, so a completion fired at the click would report a 100% success rate for a tool that has real failure modes. A FAILED GATE still completes here, because hookrisk exits 2 with a full report and that report is the output the user came for. | `chain_id` | PP-TOOLS-CMP-001 |
| `tools_hookrisk_failed` | The scan could not finish, so there is no report: no verified source, the source did not compile, the host is missing part of the toolchain, a timeout, or the poll lost its job. `error_code` is the job's own code, never a message. | `chain_id`, `error_code` | PP-TOOLS-CMP-001 |
| `tools_hookrisk_blocked` | **Blocked intent.** The user asked for a scan and the product said no before any work started: a malformed address, or a chain we do not read. Distinct from `failed`, which is a scan that was attempted. | `chain_id`, `error_code` | PP-TOOLS-CMP-001 |

## App and navigation

| Event | When it fires | Key params | Emitting artifact |
|-------|---------------|-----------|-------------------|
| `page_viewed` | Route changed (custom; **GA4 native `page_view` is canonical** for reports — this is optional/secondary) | `page_path` | PP-CORE-* (provider) |
| `locale_changed` | Locale switched | `previous_locale`, `locale` | PP-CORE-CMP-021 |
| `contract_family_toggled` | The header's V1 / V2 contract-family toggle CHANGED the chosen family, which decides whether `/manager/new` renders the live Uniswap v3 single-pool builder or the fund-contracts (V2) one (POO-2120 [R5]). Fires on a change, never on a press: pressing the already-selected segment emits nothing, so the series counts builders entered rather than clicks on a control. `app`-level rather than `manager_`, because the control lives in the shell beside the RewardsPill and is reachable from every screen; which screen it was is already `page_location`. Only exists while the `fundContracts` flag is on | `family` (the family switched TO, `"v1"` or `"v2"`; never a from/to pair, the previous family is the previous row) | PP-CORE-CMP-075 (`ContractFamilyToggle.tsx`) |
| `web_vitals` | A Core Web Vital reported | `metric_name`, `metric_value`, `metric_rating` | PP-CORE-* (provider) |
| `app_error_shown` | An error boundary/state shown | `error_code` | PP-CORE-CMP-019 |


### Fund Review assembly (POO-2195, PP-MGR-CMP-077, rules v1)

| Event | Emitting artifact | Settlement / parameters |
|---|---|---|
| `builder_review_view` | PP-MGR-CMP-077 `ReviewPhase` | Entry into real Review; family v2 |
| `builder_review_field_changed` | PP-MGR-CMP-077 `ReviewPhase` | Field ID only (`review_field`), no content or monetary input |
| `builder_launch_clicked` | PP-MGR-CMP-077 `ReviewPhase` | Launch or Resume intent; family v2 |
| `builder_launch_blocked` | PP-MGR-CMP-077 `ReviewPhase` | First field / Build reason; field ID and classified error code |
| `builder_review_abandoned` | PP-MGR-CMP-077 `ReviewPhase` | Leaves Review without starting or resuming launch |
| `builder_review_error` | PP-MGR-CMP-077 and PP-MGR-SCR-002 | Draft, balance retry, logo, save or launch-entry error; safe classified code |
| `builder_build_submitted` | PP-MGR-SCR-002 | Ready Build requests persisted Review entry |
| `builder_build_completed` | PP-MGR-SCR-002 | Only after the save opening Review succeeds |

The existing launch journey exclusively emits launch signature, completion and failure.
Review never declares a settlement on a click or a broadcast.

## Investor V2 unavailable host (POO-2217)

PP-STR-MOD-001 reuses `strategy_invest_started` on open, `tx_amount_blocked` with `block_reason=v2_execution_unavailable` from the disabled capability, and `tx_flow_abandoned` on close/unmount while unavailable. No V2 `submitted` or `completed` event can fire from this host. Error and signature classes are inapplicable until execution is enabled in POO-2219. Existing V1 emitters remain unchanged. No wallet address is added to analytics.

POO-2215 reuses Strategies list/filter/sort/navigation events and `portfolio_viewed` through TrackView in PP-STR-CMP-038. PP-STR-SCR-006 (POO-2216) emits `strategy_detail_viewed`, `app_error_shown` for sanitized public/personal read failures, and `app_cta_blocked` for unavailable actions. Its operations use the shared Invest host; no unavailable action emits a financial completion. No raw wallet is added.

POO-2223: `FundComposition` (PP-STR-CMP-040) is passive and reuses the parent `strategy_detail_viewed`. The owner-approved local Follow/Following interaction creates no server-side relationship and emits no persistent-follow or financial completion event. Existing Details error/blocked transaction events are unchanged.

## Manager Manage V2 supported boundary (POO-2226/2227/2228)

| Existing event | Emitter | Trigger / parameters |
|---|---|---|
| `strategy_manage_viewed` | PP-MGR-SCR-004 ManageScreen | Authorized screen mount; `family=v2`, `surface=manager`, hub `chain_id`. |
| `strategy_block_selected` | PP-MGR-SCR-004 ManageScreen | Selects an actual canvas/sidebar node; `family=v2`, `surface=manager`, bounded `node_kind`, `chain_id`. No node, position, token, core or wallet identity. |
| `strategy_move_range_started` | PP-MGR-CMP-086 ManageBlockPanel | First choice of Move for the current draft; `flow=moveRange`, chain and family. |
| `tx_flow_abandoned` | PP-MGR-CMP-086 | Removing/unmounting an origin with a started Move before submission. Inspecting another node keeps the origin mounted and emits no abandonment. |
| `app_cta_blocked` | PP-MGR-SCR-004, PP-MGR-CMP-086 | Owner requirement or unavailable Move/future-policy/allocation/queue capability; classified reason only. Queue Retry does not reload the authorized screen. |
| `app_error_shown` | PP-MGR-SCR-004, PP-MGR-CMP-086 | Sanitized entry/position/review read error. No upstream message, raw wallet or payload. |

No submitted/completed event exists in this slice because no financial action or persisted future policy is executable. Do not emit completion when a draft is edited or review is shown. Execution instrumentation belongs with POO-2229/2231 wiring and must remain receipt/persistence driven.

### Build auxiliary configuration (POO-2237, 2026-10-05)

Emitter PP-MGR-SCR-002 reuses builder_block_applied, builder_block_discarded, builder_block_leave_blocked and builder_build_blocked via PP-MGR-HOK-014. The bounded block_kind union adds spoke; fields_changed adds tokenIn and tokenOut. These describe local draft edits only. No new funnel or settlement event is introduced. PP-MGR-CMP-087 delegates outcomes to the existing draft controller; no hover, zoom or per-field token identity is transmitted.

## Manager Overview V2, 2026-10-06 (POO-2245 v1)

| Event | Emitter | Trigger |
|---|---|---|
| builder_draft_opened | PP-MGR-SCR-001 ManagerOverviewV2 | Existing local draft resume navigation, with step only. |
| builder_draft_deleted | PP-MGR-SCR-001 ManagerOverviewV2 | Confirmed successful local deletion. |
| builder_mandate_error | PP-MGR-SCR-001 ManagerOverviewV2 | Failed local deletion, bounded error code. |
| app_error_shown | PP-MGR-SCR-001 ManagerOverviewV2 / OverviewProfile | Sanitized read failure or timeout. |
| app_cta_blocked | PP-MGR-SCR-001 ManagerOverviewV2 | Manager session needed. |

Page view remains route-owned. The read/navigation surface starts no financial transaction, so submitted/completed/transaction abandonment are intentionally not emitted here. Existing profile and launch destinations own their funnels. No wallet, draft name, raw error or financial amount is added to these events.

## Investor V2 execution, 2026-10-06 (POO-2248 v1)

Emitter: PP-STR-MOD-001, `FundInvestModal.tsx`. Existing event names only.

| Event | Trigger |
|---|---|
| strategy_invest_started | Open the V2 Invest host. |
| tx_amount_blocked | Invalid precision/value, first-deposit minimum, or missing verified execution session. |
| tx_review_reached | Prepared approval/deposit review is visible. |
| strategy_invest_submitted | Explicit deposit confirmation intent, before protected rebuild; approval is excluded. This is not settlement. |
| tx_signature_requested | Wallet submission begins for approval/deposit, with bounded step kind. |
| strategy_invest_failed | Sanitized controller error. |
| strategy_invest_completed | Confirmed deposit receipt only; no simulated amount/value parameter. Funding and approval are excluded. |
| tx_flow_abandoned | Close/unmount before terminal outcome; unknown transaction uses pending exit. |

The shared provisioning gate/panel retain their existing funnel. Raw previews, wallet addresses, signed payloads and journal contents are not sent to analytics.

> Delivery history: the following sections preserve the previously published contracts and
> censuses. Their delivery-time future work is superseded by the current shared-binding notes above.

## Local Solana editor (POO-2281, rules v2)

| Event | When it fires | Key params | Emitting artifact |
|---|---|---|---|
| `solana_preview_entered` | Guarded selected-V2 gesture enters the local editor on the registered builder route | none | PP-CORE-CMP-075, ContractFamilyToggle |
| `solana_preview_exited` | Explicit label, Back to EVM builder or family switch exits the active local editor after the guard | none | PP-CORE-CMP-075, ContractFamilyToggle; PP-MGR-SCR-002, BuilderRouteSwitch |
| `solana_preview_viewed` | Local editor mounts once | none | PP-MGR-SCR-009, SolanaStrategyPreviewScreen |
| `solana_preview_interacted` | Configure/Manage mode, Manage node selection/close or local edit/choice/review/discard/rebase; local Apply after drawing acceptance | bounded `preview_mode`, `preview_action`, `preview_protocol`, `node_kind`, `has_local_changes` when applicable | PP-MGR-SCR-009, SolanaStrategyPreviewScreen |
| `solana_preview_started` | First local block is added in this editor session | `preview_protocol` | PP-MGR-SCR-009, SolanaStrategyPreviewScreen |
| `solana_preview_applied` | Valid local configuration is applied to the drawing | `preview_protocol`, `has_local_changes` | PP-MGR-SCR-009, SolanaStrategyPreviewScreen |
| `solana_preview_abandoned` | An edited drawing unmounts without persistence | `has_local_changes` | PP-MGR-SCR-009, SolanaStrategyPreviewScreen |
| `solana_preview_blocked` | Invalid individual/aggregate allocation, unapplied edits or unavailable execution blocks intent | `preview_protocol` when applicable, `preview_reason`, `has_local_changes` | PP-MGR-SCR-009, SolanaStrategyPreviewScreen |
| `solana_preview_error` | A genuine child-render error reaches the retry boundary | bounded `error_code`, `error_origin`, `has_local_changes` | PP-MGR-SCR-009, SolanaPreviewErrorBoundary |

POO-2291 S5 extends the bounded `preview_protocol` vocabulary to `holding` alongside `kamino`, `jupiter`, `raydium` and `orca`. Holding identifies a custody drawing, not a venue. No mint, pool, account, quantity or quote is tracked. Local Apply is a drawing event and never financial settlement.

POO-2291 S6 adds `preview_mode` (`configure`, `manage`) and `preview_action` (`mode`, `select`, `close`, `edit`, `choose`, `review`, `apply`, `discard`, `rebase`). Only the screen emits these via the consent-aware hook. The persistent host reports bounded intentions to that owner; it never tracks configuration arguments. Rejected drawing acceptance emits blocked intent and no applied event. Node family describes inspection only, without node/local/canonical identifiers. No financial completion is introduced.

Block parameters are limited to `kamino`, `jupiter`, `raydium`, `orca`, `holding`. Reasons are bounded enums.
All emissions use the existing consent-aware `useAnalytics().track()` path. No wallet, mint, local
amount, pair, exception text or transaction data is emitted. Apply describes a local drawing change;
there is no submitted/completed financial funnel because the editor cannot submit an operation.

### Shared local Solana Review capability intents (POO-2301 v1, October 9, 2026)

PP-MGR-CMP-102 LocalSolanaReview emits solana_preview_viewed on entry, solana_preview_interacted on an accepted field edit, and solana_preview_blocked for unavailable Add logo, Max and Launch. These controls are focusable/tappable through the existing soft-blocked Button; no file or wallet action occurs. The future shared route owner retains session abandonment/error and local acknowledgement events. No financial completed event is emitted. Standard Review retains its existing event owners.

Delivery continuation: this delivery connects the shared wizard route and retained Build/Manage
host. The activation described as future work in the published foundation above is included here.
Applied plan/Review survive retry; unapplied inner-panel fields can be lost after a render exception,
while the last pending metadata continues guarding leave. No deployment, native-browser acceptance
or live Solana capability is asserted.

## Manager market-reference Charts (POO-2309, rules v1)

| Event | When it fires | Key params | Emitting artifact |
|---|---|---|---|
| `manager_chart_viewed` | Charts opens for the current private origin/locale | `chart_context`, `chart_market` | PP-MGR-CMP-103, StrategyChartSurface |
| `manager_chart_closed` | Return to Strategy flow, identity/locale change, phase hiding or unmount ends that visit | `chart_context`, `chart_market` | PP-MGR-CMP-103, StrategyChartSurface |
| `manager_chart_blocked` | Unsupported/missing identity or non-price block prevents a chart | `chart_context`, `chart_market`, `chart_reason` | PP-MGR-CMP-103, StrategyChartSurface |
| `manager_chart_failed` | Current provider frame has no data or no boot within 20 seconds | `chart_context`, `chart_market`, `chart_reason` | PP-MGR-CMP-103, StrategyChartSurface |
| `manager_chart_retried` | Explicit Try again creates a new provider instance | `chart_context`, `chart_market` | PP-MGR-CMP-103, StrategyChartSurface |

Context is `build`, `manage` or `solana-local`; market is `eth-usdc`, `sol-usdc` or `unavailable`. Reasons are bounded selection/configuration/block/pair/lending causes, `no_data` or `load_timeout`. Private origin identities, wallet/fund/pool addresses, mint, quantities, user text and vendor payloads are never emitted. Submitted/completed funnel: none, this is analysis only; closing is the presentation abandonment signal. Boot is not candle/financial confirmation.
