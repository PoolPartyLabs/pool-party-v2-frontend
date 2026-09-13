/**
 * @id PP-CORE-CMP-046 (POO-1135, POO-1136, POO-1153, POO-1155, POO-1166, POO-1384, POO-1390,
 *   POO-1501, POO-1502, POO-1503, POO-1504, POO-1505, POO-1506, POO-1507, POO-1508, POO-1509,
 *   POO-1525, POO-1526, POO-1527, POO-1528, POO-1541, POO-1543, POO-1564, POO-1568, POO-1570,
 *   POO-1573, POO-1596, POO-1641, POO-1808, POO-1811, POO-1812)
 * @name ProvisioningPanel
 * @implements-rules-version v41 (POO-1927 rules v1) · v40 (POO-1808 rules v1)
 *   · v39 (POO-1812 rules v1: ONE buffer rate per run, derived from the
 *   slippage that run allows and spent by the seed, the route targets and the copy, with the
 *   ledger's budget pinned to the rate the run was SEEDED with)
 *   · v38 (POO-1811 rules v1) · v37 (POO-1641 rules v1) · v36 (POO-1596 rules v1) · v35 (POO-1573 rules v2) · v34 (POO-1570 rules v2) · v33 (POO-1568 rules v1) · v32 (POO-1543 rules v1) · v31 (POO-1528 rules v1) · v30 (POO-1527 rules v1) · v29 (POO-1526 rules v1) · v28 (POO-1541 rules v1) · v27 (POO-1505 rules v3) · v26 (POO-1508 rules v2) · v25 (POO-1564 rules v1) · v24 (POO-1525 rules v1) · v23 (POO-1506 rules v1) · v22 (POO-1507 rules v1) · v21 (POO-1504 rules v1) · v20 (POO-1503 rules v1) · v19 (POO-1509 rules v1) · v18 (POO-1390 rules v1) · v17 (POO-1384 / POO-1129 rules v4) · v16 (POO-1153 / POO-1129 rules v3) · v15 (POO-1166 / POO-1129 rules v3) · v14 (POO-1155 / POO-1129 rules v3) · v13 (POO-1136 / POO-1129 rules v3) · v12 (POO-1135 / POO-1129 rules v3) · v11 (POO-1088 rules v2) · v10 (POO-1087 rules v1) · v9 (POO-1048 rules v1) · v8 (POO-1047 rules v1) · v7 (POO-1044 rules v1) · v6 (POO-1043 rules v1) · v5 (POO-1042 rules v1) · v4 (POO-1041 rules v1) · v3 (POO-1037 rules v1) · v2 (POO-807 rules v1) · v1 (POO-1023 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The INLINE pre-flight provisioning body (epic POO-411, POO-418/POO-419). When an op is short on
 * gas / USDC / the right network, its modal swaps its confirm view for this panel (integration model
 * B, locked 2026-07-01): `confirm → provision (this panel) → pending (the op's own flow)`. The panel
 * is variant-agnostic — {@link ProvisioningPlanCard} renders whatever the plan needs (gas-only shows
 * "One step" + the swap-gas row with the inline gas selector; multi shows the full chain), and the
 * SAME card in `running` mode is the execution and failure surface (POO-1088). On success it calls
 * `onDone` so the host resumes the ORIGINAL op with its original parameters; cancelling returns the
 * host to its confirm.
 *
 * Surface-less by design (no Sheet/Dialog): the op modal owns the chrome. It reports `onLockChange`
 * so the host can lock dismissal while provisioning is in flight.
 *
 * POO-1023: the plan now resolves through the ONE mock/real seam via {@link useProvisioningPlan},
 * so whichever planner the toggle selects is the one that runs. It previously called
 * `mockComputePlan` directly, which meant the real planner could be wired and never called.
 *
 * POO-1037 (hackathon POO-1022): a bridge leg settles on ANOTHER chain, minutes after its source
 * transaction mines, so this panel can no longer assume a step resolves in a beat. The running bridge
 * row says how long it should take [R2], the dismissal lock holds for the whole wait [R5], and a wait
 * that outlives the rail's poll ceiling lands in a fourth phase, `settling`: not a failure, not a
 * success, and deliberately WITHOUT a retry, because `flow.retry()` re-invokes the failed step
 * verbatim and a bridge already in flight would be broadcast a second time [R3].
 *
 * POO-1041 (hackathon POO-1022): the panel renders the REAL rail. Two things were quietly wrong for
 * a real plan, and both are fixed here. The stepper's labels came from `plan.steps` while its
 * statuses and hashes came from the rail, and the rail expands one plan step into an approval PLUS
 * the leg, so the two lists were not the same length and never had been aligned [R6]; everything is
 * matched by KEY now, through the one view model. And a bridge leg's hash exists minutes before its
 * step returns, so a running transfer had no link on screen at all: `onLegBroadcast` is consumed
 * here, the instant the hash exists, and the row is verifiable while it is still moving [R2].
 *
 * POO-1042 (hackathon POO-1022): real mode is now a different, and honest, flow. With a live
 * {@link ProvisioningGateContext} the panel opens on the funding-source picker, and only quotes a
 * plan for what the user actually chose [R7]. Two things fall out of that, both of which the picker
 * alone could not do: a holding Uniswap cannot route to the operation's chain is not offered [R8],
 * and every chain on screen carries a gas verdict [R9]. And the CTA it opens is honest twice: the
 * picker's requirement is seeded conservatively, then RE-CHECKED against the quoted plan, which is
 * the only figure that is really what the user will pay. A plan that comes back short returns to the
 * picker with the real number, so the CTA never flips from enabled to disabled underneath anyone.
 *
 * POO-1043 (hackathon POO-1022): three pieces of finished work that no production caller reached are
 * mounted here, which is the difference between having built them and having shipped them. Its rule
 * numbers collide with POO-1042's, POO-1044's and POO-1047's, so every POO-1043 marker below is
 * written out in full.
 * POO-1043 [R9] {@link ProvisioningCostBreakdown} sits above the confirm, so the itemised price is
 * read before it is agreed to, and its TTL re-quotes through the same plan seam, never a second path.
 * POO-1043 [R7] the recovery journal is minted at the confirm and retired when the route completes,
 * never on a failure or at the bridge poll ceiling, where the record is exactly what recovery needs.
 * POO-1043 [R8] a materially worse re-quote is put to the user instead of aborting the leg: the
 * rail's refusal is the right default with nobody to ask, and a dead end once there is somebody.
 *
 * POO-1044 (hackathon POO-1022): the gas branch, made honest at both ends. A GAS-ONLY requirement
 * skips the funding picker [R1]: the gas swap is sized by the classifier and sliced off a holding
 * already on the operation's chain, so a picker would ask the user to choose between things that do
 * not change the plan. And a plan the operation cannot run is no longer offered [R3]: a chain with
 * no native coin fails the planner outright, and the panel says which network needs what, with the
 * buy-crypto escape instead of a retry that would reach the same verdict. That branch also stopped
 * discarding the planner's own error: it was rendering the FLOW's error (always null there), so
 * every planner failure showed the generic body regardless of the code the planner typed. POO-1044
 * also settles the inline gas selector, which POO-1042 left open: it stays a mock-mode-only control
 * [R6]/[R7], because in real mode the classifier sizes the top-up from a live quote and the
 * selector's fiat-minimum bounds have nothing to attach to.
 *
 * POO-1047 (hackathon POO-1022): the shipped `PriceImpactGate` (PP-STR-CMP-022) now stands between
 * this plan and its confirm. A funding route reaches the same AMMs an operation swap does, so
 * without it the funding path was the way AROUND the gate that POO-1011 put there after a poisoned
 * thin-pool route turned $40 into $3. One gate per PLAN, on the cost model's worst-AMM-leg figure,
 * with bridge legs excluded and a missing figure meaning no gate. Reused, not re-implemented: a
 * second copy of a money-safety threshold is a second thing that can be relaxed by accident. It is
 * independent of POO-1044's gas-only branch above and deliberately so: that branch opens straight on
 * the plan phase, so a swap-gas leg's price impact is gated exactly like any other AMM leg's.
 *
 * Mock mode passes no context and is byte-identical to before: it opens on the plan and settles it
 * with the local mock rail, inline gas selector included [R6]/[R7]. A fixture plan carries no price
 * impact, so the gate is absent there [R3].
 *
 * POO-1048 (hackathon POO-1022): the funnel. This panel IS the funding session, so it owns every
 * event after the gate: sources listed and selected, the route quoted and started, each leg as it
 * settles, and exactly one terminal outcome. The two emission rules are answers to defects this
 * repository has already shipped. [R3] the completion comes from the flow-status effect, which runs
 * only once every leg's `run()` has resolved, and never from the confirm click, which is what
 * `deposit_completed` does and why the deposit funnel counts intent as revenue. [R4] every terminal
 * failure emits, and a session that concluded neither way emits an abandonment on unmount, so the
 * funnel arithmetic closes instead of leaving `deposit_failed`-shaped holes. A bridge still in flight
 * at the poll ceiling is deliberately neither: the money is moving, we simply stopped watching.
 *
 * POO-1509 (epic POO-1498, rules v1): `Not enough gas` stops being a variant of the plan and becomes
 * an AUXILIARY SCREEN of its own ([R4]), and with it the gas amount picker leaves the funding flow
 * entirely ([R34]/[R35]).
 *
 * Two things were wrong at once and each was hiding the other. The designed `Not enough gas` screen
 * lived in `BuyGasModal` with zero production consumers, while the live gas-only path rendered a plan
 * CARD with an inline picker inside `Fund this transaction`. So the product had a screen nobody could
 * reach and a control the rules forbid, and neither looked broken from where the other one stood. The
 * body is now shared ({@link GasTopUpBody}), so the standalone modal and this branch cannot drift, and
 * the branch is reached in BOTH modes: gating it on a live `context`, as POO-1044 [R1] did, would make
 * mock mode the one place this screen never appears, and mock mode is what the previews run.
 *
 * Consequence worth stating rather than discovering: the five operations that spend no USDC (collect,
 * compound, withdraw, move-range, close) can only ever be gas-short, so this IS their provisioning
 * screen now. They lose the plan card's op-anchor row, because the Figma frame (`6550:569`) has no
 * such row; what they keep is the exit, which returns them to their own Review.
 *
 * The price-impact gate moved WITH the branch and that is not incidental: it was mounted in the plan
 * phase and nowhere else, so a screen change that forgot it would have quietly made the swap-gas leg
 * the one AMM route in the product with no POO-1047 acknowledgement.
 *
 * POO-1503 (epic POO-1498, rules v1): **the Confirm step is deleted.** The flow is `1 Where from` ->
 * `2 Choose tokens` -> `7 Running`, and step 2's CTA signs ([R3]/[R19], `Confirm and start` per D2).
 *
 * Everything the Confirm carried moved rather than vanished. The step list and the itemised `You pay`
 * block are behind `See details` on step 2 ([R18]), which is why the planner no longer waits for a
 * CONFIRMED selection: it quotes the LIVE one. That is a deliberate loosening of POO-1042 [R7], whose
 * substance survives (the fan-out runs for what the user picked, and is suspended entirely while step
 * 1's route question is open) but whose mechanism could not, because a disclosure of a plan cannot
 * precede the plan. The quote's `Refreshes in {seconds}s` moved to the top of step 2 rather than behind
 * the disclosure, because a price with a deadline the user cannot see is a price they will be
 * surprised by; the freshness loop itself is hosted by the panel ({@link QuoteFreshnessLoop}), not by
 * the disclosure's cost card, so the TTL re-quote fires while `See details` stays closed, which is
 * the default.
 *
 * **The price-impact acknowledgement is the one thing that can still interrupt, and re-homing it is the
 * load-bearing part of this change.** It was mounted in the `plan` phase and nowhere else, so deleting
 * that phase would have made the funding path the one AMM route in the product with no POO-1047 gate,
 * silently. It now renders as a blocking alert BEFORE step 2's screen when a start has been requested
 * and the quote came back at or past 10%: absent in the ordinary case, unavoidable in the catastrophic
 * one. `gateEngaged` is what stops acknowledging FROM being broadcasting: the checkbox clears `blocked`,
 * and without the flag the start effect would fire on the same commit, so a mis-click on a funds-at-risk
 * warning would send the route. The yes and the send are two acts.
 *
 * **The mock-mode plan screen is deleted with it (decision: Rafael, 2026-08-11, on the PR #835
 * review).** Keeping it was argued in this PR's first cut; the literal acceptance ("No Confirm route
 * exists", "`plan.*` keys stop being rendered") won. Mock mode has no inventory to pick and now no
 * Confirm to press either, so it SEEDS `startRequested` at mount and the start effect runs the mock
 * rail as soon as the plan resolves. What mock mode loses, knowingly, is the plan card, the itemised
 * `You pay` block and the `Buy crypto instead` peer option: the previews open on the execution
 * surface instead. `provisioning.plan.title` stays put, as the DialogTitle of six modals outside
 * this flow; the keys only this screen rendered (`cta`, `stepsCount`, `thenRuns`, `titleGasOnly`)
 * are removed from all 12 locales.
 *
 * POO-1504 (epic POO-1498, rules v1): the execution surface becomes {@link ExecutionCarousel}
 * (PP-CORE-CMP-071), one step at a time, and the bottom button becomes the RUN'S STATE ([R27]).
 *
 * The button is the part with a consequence beyond layout. `Processing` with cycling dots while the
 * rail works, `Done` and enabled once every leg has settled, and **pressing it is what resumes the
 * operation.** `onDone` used to fire the instant the last leg settled, so the host's modal moved on and
 * the `7f` all-done screen was never seen by anyone. What did NOT move is the completion event: the
 * funnel's `planCompleted`, the journal close and the balance refresh all still fire from the
 * flow-status effect on SETTLEMENT, which is premise 11 and POO-1048 [R3]. Only the handoff waits.
 *
 * The [R26] disclosure is assembled here rather than in the carousel, from the active ROW, because only
 * this panel knows whether a step grants an allowance or moves funds; the carousel renders it below its
 * window so every row keeps one height. `Keep this open.` ([R28]) moved under the state button and
 * disappears once the run is over, still suppressed on the fiat step (POO-1384).
 *
 * PP-INTEGRATION-POINT: `context` is the live wallet read (PP-CORE-LIB-057) and `buildPlanSteps` is
 * the live Uniswap rail (PP-STR-LIB-017), both bound by `useProvisioningGate` and both absent in
 * mock mode.
 *
 * ## Provisioning v3 mobile [M4], POO-1527
 *
 * `[M4.1]`/`[M4.2]` need NO code here: POO-1505 (merged) already makes the buy step's mini summary
 * replace the carousel while `onRampBuy` is set ([R30]) and defers {@link PaybisWidgetFrame}'s mount
 * to `buyIframeReady` ([R32]), and the sheet's bottom edge staying put while it grows falls out of
 * `Sheet`'s own `fixed inset-x-0 bottom-0` positioning (asserted in `provisioningSheet.test.tsx`).
 * Only the two mobile-only deltas below are this issue's.
 *
 * `[M4.3]`: the WHOLE pinned CTA ({@link StickyActionFooter}, not only its "Keep this open" line)
 * disappears while the buy step is active — the checkout owns the one primary action a screen may
 * have, and a pinned "Processing…" button behind it would be a second. `[M4.4]`: `onBuyActiveChange`
 * is a signal DELIBERATELY separate from `onLockChange` ([R13] keeps that one `false` during a buy on
 * purpose — leaving is safe and the journal keeps it resumable); this one is about an accidental drag
 * interrupting card entry, not dismissal safety, so the six hosts OR it into `disableSwipe` and pass
 * it bare into `Sheet`'s new `hideGrabHandle` prop (`PP-CORE-CMP-038`), which hides the handle
 * outright rather than merely disabling it — the general lock leaves the handle inert on purpose
 * (POO-1507 parity with the visible `X`); the buy step has no such reason to keep it visible at all.
 *
 * ## Provisioning v3 mobile [M5], POO-1526
 *
 * Every ghost/secondary exit button on this panel (Back, Cancel, Start new, Decline, Keep going,
 * Stop anyway, Raise to X% and retry, Stop here) is its own full-width row, so each carries an
 * EXPLICIT `min-h-11` (M5.2) rather than an invisible hit area. The one exception is the slippage
 * retry screen's `Custom` pill: it matches 3 non-interactive sibling pills of the same visual
 * height, so it gets the invisible-hit-area pattern (M5.1) instead, to avoid misaligning the row.
 *
 * POO-1528 closes the three controls M5 deferred to it. Below `sm`, on a host that mounts the
 * unified header, step 2's gear and the [R20] back link are no longer rendered here at all: the
 * header's own arrow and gear replace them, and those already carry the 44pt hit area. The two
 * controls still render for a host that has NOT adopted that header (`MoveRangeModal`,
 * `RemoveLiquidityModal`) and above `sm` everywhere, so they take the floor themselves rather than
 * relying on a header that may not be there: `min-h-11` on the back link (M5.2, its own row) and the
 * M5.1 invisible hit area on the gear (24px + 2×10px = 44). The gas-only screen's gear is never
 * replaced — that screen's Figma frame (`7303:768`) keeps its own gear, and it is not in the flow —
 * so it takes the same M5.1 expansion.
 *
 * `ExplorerTxLink`'s `text` variant, which the settling screen renders under that screen's Close, is
 * NOT deferred: it takes the M5.1 invisible hit area, biased upward so it cannot overlap the Close
 * ~8px above it (M5.3).
 *
 * ## Where the execution screen's explorer link lives (POO-1568 [R1])
 *
 * Below the state button, inside the pinned footer, as that button's secondary action — not in the
 * carousel's own slot, which sits ABOVE the footer and made a bare underlined line float over the
 * primary `Done` (Murilo's live-QA screenshot on the merged v3 epic). The panel resolves the row
 * itself, from the same `currentStepPosition` the carousel's window uses, and renders the link in
 * `ExplorerTxLink`'s `ghost` variant: the button's shape without its weight, so it reads one rank
 * below `Done` instead of competing with it. The settling screen's `text` link is unchanged.
 *
 * **Exactly one home, whatever the list is doing** (Rafael, 2026-08-13). The footer link is
 * UNCONDITIONAL, and the current step's row in the EXPANDED list is what yields: `rowLink` returns
 * nothing for it, so expanding the list no longer renders the running leg's `View on explorer` twice
 * against the identical transaction. Both the footer and that suppression read the one
 * `currentStepRow` binding, which is what stops the list and the footer from disagreeing about which
 * leg is current and dropping a link neither of them is covering. Every OTHER row keeps its own link
 * (POO-1037 [R2]: a leg that settled two steps ago is verifiable only from the list).
 */
"use client";

import { ChevronLeft, Settings2 } from "lucide-react";

import { useTranslations } from "next-intl";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { MockBadge } from "@/components/ui/MockBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Link, useRouter } from "@/i18n/navigation";
import { PROVISIONING_OP_TO_FLOW } from "@/lib/analytics/events";
import type { FundingExit } from "@/lib/analytics/provisioningFunnel";
import { useProvisioningFunnel } from "@/lib/analytics/provisioningFunnel";
import { requestBalanceRefresh } from "@/lib/balances/balanceRefresh";
import { apiNetworkForChain } from "@/lib/chains/config";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { reportClientError } from "@/lib/observability/reportClientError";
// POO-1573 [R5] (rules v2): the mint refuses an `ETH-BASE` order it could not price ETH for, so the
// failed-step body can name that cause instead of the generic "the purchase did not go through".
import { ONRAMP_ETH_UNPRICED_CODE, ONRAMP_SETTLING_CODE } from "@/lib/onramp/schemas";
// POO-1596: the SHIPPED order sizer, so this screen and `buildPlan` cannot disagree about which pair
// the purchase is. Pure and client-safe (no viem, no React, no I/O), the same way
// `standaloneOnRampPlan` imports it for `/deposit`.
import { sizeOnRampOrder } from "@/lib/onramp/sizeOnRampOrder";
import { useOnRampCurrencies } from "@/lib/onramp/useOnRampCurrencies";
import { useOnRampProvider } from "@/lib/onramp/useOnRampProvider";
import type {
  GasChoice,
  ProvisioningNeedInput,
  ProvisioningOrder,
  ProvisioningPlan,
} from "@/lib/provisioning";
import {
  computeProvisioningNeed,
  onRampRouteBuysGas,
  PAYBIS_MIN_USD,
  planPriceImpactPct,
  spendableTokenUsd,
} from "@/lib/provisioning";
// Type-only, therefore erased: `gateContext.ts` is `server-only` and this is a client component.
// The value crosses as data through `getProvisioningContextAction` (ADR 0003).
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
// The mock/real seam. Mock mode has no Paybis rail behind the on-ramp quote actions, so the buy-route
// quote is gated off there, the same way `PaybisWidgetFrame` gates the widget itself.
import { isMockMode } from "@/lib/services";
import type { TxError } from "@/lib/tx/diagnostics";
import { toTxError } from "@/lib/tx/diagnostics";
import { TransactionError } from "@/lib/tx/sendTransaction";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatUsd } from "@/lib/utils/format";
import { pickDefaultPaymentMethod, useBuyRouteQuote } from "../hooks/useBuyRouteQuote";
import { requestFundingRecoveryRecheck } from "../hooks/useFundingRecovery";
import { useProvisioningPlan } from "../hooks/useProvisioningPlan";
import type {
  ConfirmResumePurchase,
  ProvisioningRailOperation,
} from "../hooks/useProvisioningRail";
import { useProvisioningRail } from "../hooks/useProvisioningRail";
import { useReviewCountdown } from "../hooks/useReviewCountdown";
import { useSlippageAutoRetry } from "../hooks/useSlippageAutoRetry";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import { BRIDGE_PENDING_CODE } from "../lib/awaitBridgeSettlement";
import { measureBufferAsk } from "../lib/bufferLedger";
import {
  type OnRampBuyRequest,
  type PlanRailDeps,
  PROVISIONING_BUFFER_EXCEEDED_CODE,
  planRailSteps,
} from "../lib/buildPlanSteps";
// POO-1576: the row rules of the "Choose how to pay" step, pure so they are pinned by a test
// rather than by a screenshot.
import type { OnRampMethodRow } from "../lib/onRampMethodRows";
import { buildOnRampMethodRows, selectInstantMethods } from "../lib/onRampMethodRows";
import { DEFAULT_SLIPPAGE_PCT } from "../lib/slippage";
import { PriceImpactGate, usePriceImpactGate } from "./PriceImpactGate";
import { ExecutionCarousel, ProcessingDots } from "./provisioning/ExecutionCarousel";
import {
  currentStepPosition,
  progressFraction,
  remainingStepsLabel,
  settledSafe,
} from "./provisioning/executionCopy";
import { FundingRoutePicker } from "./provisioning/FundingRoutePicker";
import { FundingSourceSelector } from "./provisioning/FundingSourceSelector";
import type { FundingRouteKind } from "./provisioning/fundingRoutes";
import {
  CARD_ROUTE_KINDS,
  recommendedRouteKind,
  resolveFundingRoutes,
  shouldPickRoute,
} from "./provisioning/fundingRoutes";
import {
  fundingProgress,
  fundingSourceKey,
  reachesChain,
  seedBufferRate,
  seedRequiredUsd,
  spendableSources,
} from "./provisioning/fundingSelection";
import { GasTopUpBody } from "./provisioning/GasTopUpBody";
import type { GasFundingSource } from "./provisioning/gasSelection";
import { selectPreset, validateGas } from "./provisioning/gasSelection";
import { OnRampMethodStep } from "./provisioning/OnRampMethodStep";
import {
  PaybisWidgetFrame,
  type PaybisWidgetTerminalStatus,
} from "./provisioning/PaybisWidgetFrame";
import {
  ConnectedPrivyBuyStep,
  ONRAMP_CURRENCY_UNSUPPORTED_CODE,
  ONRAMP_NATIVE_UNAVAILABLE_CODE,
  ONRAMP_UNCOVERED_CODE,
} from "./provisioning/PrivyBuyStep";
import { ProvisioningCostBreakdown } from "./provisioning/ProvisioningCostBreakdown";
import { labelValues, ProvisioningPlanCard } from "./provisioning/ProvisioningPlanCard";
import { buildPlanView } from "./provisioning/provisioningView";
import { StickyActionFooter } from "./provisioning/StickyActionFooter";
import { SigningDisclosure } from "./SigningDisclosure";
import { settleOutcome, settleTxError, settleTxHash } from "./settle";
import { TransactionErrorActions, useTxErrorBody } from "./TransactionErrorActions";
import { TransactionStatus } from "./TransactionStatus";
// The rail's own status vocabulary, which `useWalletSignFlow` speaks. The stepper it was named for
// is no longer this panel's execution surface (POO-1088), but the flow still reports in it.
import type { WalletStepStatus } from "./WalletSteps";

/**
 * Panel phases: picking what to spend, executing, a recoverable error, and `settling`, a bridge still
 * in flight at the rail's poll ceiling (POO-1037 [R3]). `settling` is terminal for this panel but not
 * for the money: the route is recoverable and the operation is never resumed off it.
 *
 * POO-1503 [R3]: **`plan` is gone.** It was the Confirm screen, and the flow is now
 * `1 Where from` -> `2 Choose tokens` -> `7 Running` with nothing between the last choice and the
 * signature. What the Confirm carried did not vanish with it: the step list and the `You pay` block
 * moved behind `See details` on step 2 ([R18]), the back arrow is step 2's own, and the price-impact
 * acknowledgement became the exceptional alert it always was underneath rather than a screen.
 *
 * `sources` (POO-1042) exists only in real mode, where the user's own holdings are the funding. Mock
 * mode has no inventory, so it has nothing to pick and nothing to confirm: [R2] ("a step with a single
 * viable option is skipped, not shown") makes the honest behaviour a straight start once the plan
 * resolves, so `startRequested` is SEEDED at mount there and the start effect runs the mock rail the
 * moment the plan and the price-impact gate allow.
 *
 * The "Where from" screen (FundingRoutePicker, POO-1135) is NOT a `Phase`: it is rendered by the
 * `pickingRoutes` flag while `phase` stays `sources`, the same way `pickingSources` overlays the
 * source selector. It is unreachable in the crypto-only cut (the flag is off, so
 * `resolveFundingRoutes` returns at most one route).
 */
type Phase = "sources" | "pending" | "settling" | "error";

/** Accumulating context is unused (each step settles independently); kept generic for the runner. */
type PlanCtx = Record<string, unknown>;

/**
 * Where the buy-crypto escape hands off when a chain cannot pay for its own gas (POO-1044 [R3]).
 * The launched deposit surface, and the same destination the cost breakdown's peer option uses.
 */
const BUY_CRYPTO_HREF = "/deposit";

/**
 * POO-1136: the reconcile timed out with the purchase paid but not yet on-chain. Not a failure: the
 * money may still be landing, so the panel routes it to the existing `settling` phase, exactly as a
 * still-in-flight bridge does (POO-1037). Deliberately its OWN code, not the bridge one, so the
 * settling screen can say something true about a fiat purchase rather than about a bridge.
 *
 * POO-1808: the string now lives in `@/lib/onramp/schemas` (the on-ramp's pure client-safe half),
 * because the Privy rail's buy step rejects with the SAME code at its visible ceiling and both rails
 * must reach one settling screen rather than two spellings of it.
 */

/**
 * Map a terminal Paybis widget state to the throw the buy step propagates (POO-1136).
 *
 * POO-1390 [R3]: `reason` is the VENDOR's own explanation when it sent one. It replaces the generic
 * sentence because that sentence was ours, not theirs: a real production report (v1.3.0, reference
 * a99f6fa428df4fff86f04e1cba8acbb6) showed a user "The purchase did not complete" while Paybis' own
 * cause sat unread in the postMessage payload. Absent a reason the generic copy stands ([R5]).
 *
 * It lands on `TxError.message`, which is the RAW technical line the error-details box renders
 * verbatim, so it needs no translation. It is already masked and bounded by `parsePaybisWidgetReason`
 * before it gets here, which matters because this string also rides into the "Copy error" payload
 * that users paste into a private staff support ticket in our Discord.
 */
function onRampTerminalError(
  status: PaybisWidgetTerminalStatus,
  reason?: string,
): TransactionError {
  if (status === "timed-out") {
    return new TransactionError("The purchase was paid but has not landed on-chain yet", {
      code: ONRAMP_SETTLING_CODE,
    });
  }
  // rejected / cancelled / error / closed / unavailable: the purchase did not complete, so nothing
  // moved. Classifies to the generic `unknown` failure kind (no `TxErrorKind` is widened, keeping
  // `FAILURE_KEYS` exhaustive); the panel shows fiat-specific body copy for the buy row, and Try again
  // re-runs the buy — reusing the journaled `requestId` rather than minting a second one ([R7]).
  return new TransactionError(reason ?? "The purchase did not complete", {
    code: `ONRAMP_${status.toUpperCase()}`,
  });
}

/**
 * POO-1503 fix (#835): the ONE quote-freshness loop for step 2.
 *
 * On main the plan screen always mounted the cost card's `QuoteStatus`, whose `useReviewCountdown`
 * fired the TTL re-quote unconditionally. POO-1503 moved that card behind step 2's `See details`
 * disclosure, which is CLOSED by default, so nothing re-quoted while the disclosure stayed shut and
 * the header printed a static `Refreshes in {n}s` that never ticked and never fired: a user could sit
 * on step 2 for minutes and then sign against an arbitrarily stale on-screen price.
 *
 * This host runs the same countdown at the PANEL, mounted whenever the sources step is showing and a
 * plan exists, so the loop no longer depends on the disclosure at all. Its caller keys it on the
 * quote's `quotedAt`, the same remount contract as `QuoteStatus` in `ProvisioningCostBreakdown`: a
 * fresh quote restarts the window, and `active` pauses it while a re-quote is already in flight for
 * the same reason that component pauses.
 *
 * It renders nothing. The ticking seconds are reported up through `onTick` and DISPLAYED by the
 * selector's header (`quoteSeconds`) and by the disclosure's status line (`countdownSeconds`), both
 * fed from the same figure, so one quote is never described by two countdowns that disagree and
 * neither label runs a second timer.
 */
function QuoteFreshnessLoop({
  active,
  ttlMs,
  onRefresh,
  onTick,
}: {
  /** True while the quote on screen is current (the sources step is up and no re-quote is out). */
  active: boolean;
  /** The quote's own TTL, which sizes the window exactly as `QuoteStatus` sizes it. */
  ttlMs: number;
  /** The TTL elapsed: re-quote through the one plan seam (`requotePlan`). */
  onRefresh: () => void;
  /** The ticking remaining seconds, for the labels that display this countdown. */
  onTick: (seconds: number) => void;
}) {
  const { seconds } = useReviewCountdown({
    active,
    seconds: Math.max(1, Math.round(ttlMs / 1000)),
    onRefresh,
  });
  useEffect(() => {
    onTick(seconds);
  }, [seconds, onTick]);
  return null;
}

/**
 * What the panel hands the rail builder, so the rail can report what the flow structurally cannot.
 *
 * `useWalletSignFlow` only records a hash a step RETURNS, and a bridge leg does not return for
 * minutes after it broadcasts. The host owns the rail's dependencies (POO-1042) while the panel owns
 * what is on screen, so the reporter travels down with the plan rather than up through a prop.
 */
export interface PlanRailReporters {
  /** POO-1037's {@link PlanRailDeps.onLegBroadcast}, called the instant a leg has a hash. */
  onLegBroadcast: NonNullable<PlanRailDeps["onLegBroadcast"]>;
  /**
   * POO-1508 [R43] rules v2: the rail's {@link PlanRailDeps.consumeBuffer}. Synchronous, unlike the
   * two reporters below: nothing here waits on rendered UI, since within the buffer nobody is asked at
   * all. It still travels down with the plan rather than up through a prop, for the same reason the
   * reporter above does: the host owns the rail's dependencies, the panel owns the run-scoped tally.
   */
  consumeBuffer?: NonNullable<PlanRailDeps["consumeBuffer"]>;
  /**
   * POO-1136: run the fiat purchase for a `buy` step. Resolves from rendered UI (the embedded widget
   * has to mount for a settlement to happen), so it travels down with the plan rather than up through
   * a prop.
   */
  runOnRampBuy?: NonNullable<PlanRailDeps["runOnRampBuy"]>;
}

/** Public props for {@link ProvisioningPanel}. */
export interface ProvisioningPanelProps {
  /** Op + wallet requirement context (USD) that drives the plan. */
  input: ProvisioningNeedInput;
  /**
   * The live wallet context behind the gate decision (POO-1042): what can be spent, from where, and
   * whether each chain can pay its own gas. Present only in real mode, where it turns the panel into
   * "pick what to spend, then review the route"; absent (mock mode) the panel opens on the plan and
   * behaves exactly as it did.
   *
   * PP-INTEGRATION-POINT: read server-side by `getProvisioningContextAction` (PP-CORE-LIB-057) from
   * the SIWE wallet. Type-only across the boundary — never a value import.
   */
  context?: ProvisioningGateContext | null;
  /**
   * What the recovery journal records this route as (POO-1043 [R7]): the operation kind and, when
   * there is one, the strategy it funds. The target chain is read off {@link input}, so a host cannot
   * describe a route to a chain the gate did not evaluate.
   *
   * Absent, no journal is minted and the route executes exactly as it did before POO-1043. That is
   * the honest default for a host that has not been threaded yet: a record nobody can attribute to an
   * operation is a record nobody can reconcile.
   */
  operation?: Omit<ProvisioningRailOperation, "targetChainId">;
  /** Op anchor title, e.g. "Invest in Stable Yield". */
  opLabel: string;
  /** Provisioning succeeded → the host resumes the original op. */
  onDone: () => void;
  /** The user backed out → the host returns to its confirm view. */
  onCancel: () => void;
  /**
   * POO-1507 [R29] [D5]: the user confirmed `Stop anyway` on the mid-run confirmation. Unlike
   * {@link onCancel}, this does not return to a previous phase inside the same open surface: nothing
   * that already broadcast is undone, so the only honest response is to close the whole thing, exactly
   * as the host's own dismissal would if it were not locked. The host is expected to run the same
   * teardown its own close does (reset the rail, reset its phase for next time), which is why this is
   * separate from {@link onLockChange}'s reporting: that hook only tells the host it MAY act, this one
   * tells it to act now.
   *
   * Optional and falls back to {@link onCancel}, matching every other host-teardown callback here
   * ({@link onLockChange}, {@link onOpenSettings}): a host that has not been threaded yet still gets a
   * response to the press rather than a dead button, it simply steps back a phase instead of closing.
   */
  onStopRun?: () => void;
  /**
   * Override for the execution rail. Left absent in production: the panel binds the SHIPPED rail
   * itself (POO-1042 [R10], see {@link useProvisioningRail}), which is what finally retires the
   * 900 ms mock settle that ran in its place for the whole epic.
   *
   * The prop stays because the rail is the one dependency a test or a story has to be able to
   * replace: it signs and broadcasts. Bind the deps in a closure and forward `rail` into them:
   * `buildPlanSteps={(plan, rail) => buildPlanSteps(plan, { ...deps, ...rail })}`.
   */
  buildPlanSteps?: (plan: ProvisioningPlan, rail: PlanRailReporters) => FlowStep<PlanCtx>[];
  /** Reports whether provisioning is in flight, so the host can lock dismissal. */
  onLockChange?: (locked: boolean) => void;
  /**
   * POO-1527 [M4.4]: reports whether the fiat buy checkout is active, so a mobile host can disable
   * swipe-to-dismiss and hide the sheet's grab handle for its DURATION — separate from
   * {@link onLockChange}, which [R13]/POO-1384 deliberately does NOT hold during a buy (leaving is
   * safe and allowed; the journal keeps the purchase resumable). This is narrower: it is not about
   * whether leaving is *safe*, it is about an ACCIDENTAL drag interrupting someone mid-card-entry in
   * the vendor's iframe. The buy step's own frame keeps its own deliberate close control regardless.
   */
  onBuyActiveChange?: (active: boolean) => void;
  /**
   * POO-1528 [M6.1]: reports whether the `sources` step (where the gear lives, [R17], and nowhere
   * else in the flow) is the active phase, so a mobile host's own unified header knows when to show
   * ITS gear. The gear's rule ("here and nowhere else") does not change; this only tells an
   * externally-rendered header when "here" currently is.
   */
  onSourcesActiveChange?: (active: boolean) => void;
  /**
   * POO-1528 [M6.1]/[R20]: reports whether the `<` back-to-route-picker affordance applies right
   * now (`sources` phase, and a route was actually picked — `1d`'s no-route-picker-shown case has
   * nothing to go back to). A mobile host's header shows its back button only while this is `true`;
   * pressing it calls {@link ProvisioningPanelHandle.goBack}.
   */
  onCanGoBackChange?: (canGoBack: boolean) => void;
  /**
   * POO-1528: `true` once a host has mounted its OWN mobile header (back + gear included) alongside
   * this panel. Below `sm` that host's internal fallback controls this prop is normally responsible
   * for (a plain back link, `FundingSourceSelector`'s own gear) go quiet there, since duplicating
   * the same control in two places is worse than a control with two names. Above `sm` NOTHING
   * changes regardless of this prop — the fallback controls are the only ones that render there,
   * exactly as before. Defaults to `false`: a host that has not adopted the new header (today,
   * `MoveRangeModal` / `RemoveLiquidityModal`, which render no header in this phase at all) keeps
   * today's behaviour on every viewport, unchanged.
   */
  mobileHeaderMounted?: boolean;
  /**
   * POO-1502 [R17]: open the host's `TransactionSettingsDialog` from step 2's gear.
   *
   * Passed through rather than owned, and deliberately. Slippage and deadline already belong to the
   * operation modal (`InvestModal`, `CompoundModal`, `CollectModal`, `BuyGasModal` each hold the
   * state and render the dialog), and they reach the panel through `input.slippagePct`. A second
   * copy of that state here would be two sources for one number on the screen where the user tunes
   * it. [R17] scopes "nowhere else" to the PROVISIONING flow (murilo, 2026-08-11): the host modal
   * keeps its own gear, because POO-478 requires every transaction to carry slippage and deadline.
   *
   * Absent, step 2 renders no gear at all.
   */
  onOpenSettings?: () => void;
  /**
   * POO-1506 [R40]: the host's LIVE gear slippage, in percent — the state
   * {@link onOpenSettings}'s dialog commits into. `input.slippagePct` is a snapshot frozen at the
   * gate's `evaluate()`, so a value the user commits in that dialog from `8b`'s `Custom` pill could
   * never reach the run through it; this prop is how the commit arrives. It is read in exactly one
   * place: while `8b` is up, a change from the value it opened with re-targets the retry CTA to the
   * committed value (`Retry with {pct}% slippage`), and the CTA press is still the single act that
   * applies it — nothing rebuilds a running route silently.
   *
   * Absent (a host with no gear state, e.g. `SwapScreen`), `8b` offers only the one-step raise.
   */
  slippagePct?: number;
}

/**
 * POO-1507 [R29]: what a host calls when it wants to dismiss the panel (ESC / overlay / native X) and
 * must ask first whether that is safe. Only the panel knows whether a run is genuinely in flight — the
 * host's own `locked` flag ([R3] of POO-419) does not distinguish "mid-run" from "finished, waiting for
 * Done" — so the decision, and the confirmation UI itself, live here rather than being duplicated in
 * every one of the six op modals that render this panel.
 */
export interface ProvisioningPanelHandle {
  /**
   * Returns `true` when the host may proceed with its own close. Returns `false` when the panel
   * intercepted the attempt: the first call opens the `Stop here?` confirmation ([R29]); a second call
   * while it is already open closes it instead ([D6]: `Esc` — and a repeated X or overlay click — maps
   * to `Keep going`, so the keyboard can never leave without a decision).
   *
   * POO-1505/POO-1527 [R33]: returns `true` immediately, no confirmation at all, while the `buy` step
   * is active. `Stop here?`'s body is written for a wallet mid-signature ("if your wallet is asking
   * for a signature, decline it"), which is false for a fiat purchase: no signature of ours is ever
   * pending there, exactly the fact [R13] already uses to exempt the buy step from the dismissal
   * lock below. Asking a question whose only honest answer text does not apply is worse than not
   * asking, so this mirrors that exemption instead of writing a second, buy-aware copy of the dialog.
   */
  requestClose: () => boolean;
  /**
   * POO-1528 [R20]: returns to the route picker (`1 Where from`) from `2 Choose tokens`, for a
   * mobile host's own header to call from the back button it renders (see the panel's
   * `onCanGoBackChange` prop for when that button should even be shown). A safe no-op when there is
   * nothing to go back to — the same guard `onCanGoBackChange` itself reports.
   */
  goBack: () => void;
}

/**
 * POO-1576: how the "Choose how to pay" step answers the buy.
 *
 * A discriminated pair rather than `string | null`, because "continue" and "which method" are two
 * different facts and one of them is legitimately absent: the provider can return nothing to choose
 * between (Q3), and that buyer still continues, on the prefill `pickDefaultPaymentMethod` supplies
 * inside the rail. Collapsing the two onto one nullable string would make "no method" and "cancel"
 * the same value on a money path.
 */
type OnRampMethodDecision =
  | { kind: "continue"; paymentMethod?: string; currencyCodeFrom?: string }
  | { kind: "cancel"; paymentMethod?: undefined; currencyCodeFrom?: undefined };

/**
 * POO-1505 [R32]: how long the panel waits after the buy step opens before mounting
 * {@link PaybisWidgetFrame}. A pure MOUNT DEFER, not an animation duration — nothing here animates —
 * so the in-place collapse-and-expand gets its own frame(s) to settle and the vendor checkout never
 * starts loading mid-reflow. Exported so tests can assert the delay by name rather than a magic
 * number, the same convention {@link ExecutionCarousel}'s own timing constants use.
 */
export const BUY_EXPAND_MS = 160;

/** The inline provisioning body embedded by an op modal's provision phase. */
export const ProvisioningPanel = forwardRef<ProvisioningPanelHandle, ProvisioningPanelProps>(
  function ProvisioningPanel(
    {
      input,
      context,
      operation,
      opLabel,
      onDone,
      onCancel,
      onStopRun,
      buildPlanSteps,
      onLockChange,
      onBuyActiveChange,
      onSourcesActiveChange,
      onCanGoBackChange,
      mobileHeaderMounted = false,
      onOpenSettings,
      slippagePct: hostSlippagePct,
    },
    ref,
  ) {
    const t = useTranslations("strategies");
    const tCommon = useTranslations("common");
    // POO-1155: the deposit-from-external-wallet route is a handoff to the launched `/deposit` surface,
    // so it navigates rather than assembling a plan. Locale-aware router (never `next/navigation`).
    const router = useRouter();

    // [R7] What to ask for BEFORE a route exists: the bare shortfall plus a conservative buffer. The
    // quoted plan is the final word (see `quotedShortfallUsd` below); this only decides when the CTA
    // may open, and it deliberately over-asks so it can never close again.
    const need = useMemo(() => computeProvisioningNeed(input), [input]);

    /**
     * POO-1044 [R1]: a gas-only requirement has nothing to pick.
     *
     * The gas swap is sized by the classifier and taken from the largest routable holding ALREADY on
     * the operation's chain, so the funding picker would be asking the user to choose between things
     * that do not change the plan, to cover a requirement of a few cents. Skipping it puts the
     * one-step "One step" plan on screen directly, which is the flow POO-411 designed for this
     * case and the one the six op modals already branch on.
     *
     * The verdict is `computeProvisioningNeed`'s, so it is the same pure calculator the gate used to
     * decide to open at all: the panel cannot disagree with its host about which branch this is.
     *
     * ## POO-1509 [R4]: no longer real-mode-only
     *
     * It used to require a live `context`, because in mock mode the panel opened on the plan phase
     * anyway and the flag was only needed to SKIP the picker. Now that the branch renders a DIFFERENT
     * SCREEN (the auxiliary {@link GasTopUpBody} rather than a plan card), gating it on the mode would
     * make mock mode the one place `Not enough gas` is never reachable, which is the mode the previews
     * this design is reviewed on run in. The verdict is the same calculator either way.
     */
    const gasOnly = need.variant === "gas-only";

    // [R7] Real mode otherwise opens on the picker: the funding IS the user's own holdings, and a plan
    // they were never asked about is a route they cannot have reviewed.
    const [phase, setPhase] = useState<Phase>("sources");
    /**
     * POO-1503 [R19]: the user has asked for the run to start, and the panel is waiting only on the
     * things that are not theirs to decide (the plan resolving, and the price-impact acknowledgement if
     * the quote comes back catastrophic). It is the state that replaces the Confirm screen.
     *
     * In real mode only step 2's CTA and step 1's buy row set it, so nothing starts a route the user
     * did not ask for. Mock mode SEEDS it at mount (Rafael, 2026-08-11: the mock plan screen is
     * deleted per the literal acceptance, and with no inventory there is no picker either), so the
     * fixture route runs as soon as the plan resolves; asking for a press on a screen that no longer
     * exists would leave mock mode stuck on a skeleton forever.
     */
    const [startRequested, setStartRequested] = useState(context == null);
    /**
     * The funds-at-risk alert has been raised for this start request, so the run now needs an explicit
     * second press rather than starting the instant the box is ticked.
     *
     * Without it, acknowledging IS broadcasting: the checkbox clears `blocked`, the start effect fires on
     * the same commit, and a mis-click on a `>=10%` price-impact warning sends the route. The whole point
     * of POO-1047 is that the user says yes to the risk deliberately, so the yes and the send are two
     * acts. It is per start request, and the alert's ghost clears it along with the request.
     */
    const [gateEngaged, setGateEngaged] = useState(false);
    /**
     * POO-1504 [R27]: every leg has settled, so the bottom button reads `Done` and is enabled.
     *
     * It is the panel's, not the carousel's, because the button is the panel's and because the fact it
     * reports is the FLOW's terminal state rather than anything the rows can tell you: a route whose last
     * row is `done` may still be mid-`run()`.
     */
    const [runFinished, setRunFinished] = useState(false);
    const [gasChoice, setGasChoice] = useState<GasChoice | null>(null);
    /**
     * POO-1503 fix (#835): the ticking seconds of step 2's quote countdown, reported by
     * {@link QuoteFreshnessLoop} and displayed by BOTH labels that describe it (the selector's header
     * and the disclosure's status line), so the two can never disagree about the one quote on screen.
     */
    const [quoteSeconds, setQuoteSeconds] = useState<number | undefined>(undefined);
    const [txError, setTxError] = useState<TxError | null>(null);
    /**
     * POO-1506 [R40]: the raised tolerance from `8b`'s `Raise to {pct}% and retry`, overriding
     * {@link input}'s echoed value for the REST of this run. Local to the panel, mirroring `gasChoice`/
     * `effectiveGas` below: `input.slippagePct` is a snapshot frozen at the gate's `evaluate()` call
     * ([R17] scopes the gear to before execution starts), and nothing re-derives it once a route is
     * running, so a live override has to live here rather than round-trip through the host.
     */
    const [slippageRaisePct, setSlippageRaisePct] = useState<number | undefined>(undefined);
    const effectiveSlippagePct = slippageRaisePct ?? input.slippagePct;
    /**
     * POO-1812 [R3]: ONE rate per run, derived from the slippage this run will actually allow, and
     * read by every surface that shows or spends it: the seed, the route cards' target, the ledger's
     * budget and the `{pct}` in the copy. Derived here rather than in four places, because four
     * derivations of one number is how a row and a meter start disagreeing about the same cent.
     *
     * [R4]: it reads `effectiveSlippagePct`, so a mid-run raise re-seeds. A retry is otherwise
     * refused by a budget computed for the slippage the run no longer has.
     */
    const bufferRate = seedBufferRate(effectiveSlippagePct);
    /**
     * The SAME rate in integer basis points, derived once ([R3]).
     *
     * `rate * 10_000` in floating point is not an integer for 34 of the 201 slippage settings the
     * control accepts: 6%, the exact value a mid-run raise from 5% produces, lands on
     * `699.9999999999999`. A budget and an analytics row carrying that are numbers nobody can read
     * back, so the conversion happens here, once, and everything downstream either uses these basis
     * points or multiplies by `bufferRate` (never by a second conversion of it).
     */
    const bufferRateBps = Math.round(bufferRate * 10_000);
    /**
     * The live rate in bps, for the ledger callback below. A ref because that callback is memoised on
     * `[funnel]` and must keep its identity: adding the rate to its deps would rebuild the reporter
     * on every slippage change, and it is handed to the rail as a stable function.
     */
    const bufferRateBpsRef = useRef(bufferRateBps);
    bufferRateBpsRef.current = bufferRateBps;
    /** The slippage that produced it, reported beside it ([R6]). */
    const slippagePctRef = useRef(effectiveSlippagePct);
    slippagePctRef.current = effectiveSlippagePct;
    // [R2] Hashes of legs that have broadcast but not settled, keyed by rail step key. The flow cannot
    // hold these: it records a hash a step RETURNS, and a bridge leg returns minutes later.
    const [legHashes, setLegHashes] = useState<Record<string, string>>({});
    // [R4]/[R7] The picks, in PICK ORDER, which the planner treats as ROUTE order. Since POO-1503 this
    // is also what the planner QUOTES: `confirmedSelection` is gone, because a plan that only exists
    // after a Confirm click cannot feed a `See details` disclosure on the screen before it ([R18]).
    //
    // POO-1155: TARGET-CHAIN holdings arrive already selected and counted — they need no bridge and no
    // purchase, so making the user pick the money they are already standing on is pure friction (the
    // reported bug: 17.54 USDC on the strategy's own chain, greyed out). The native coin is left
    // UN-preselected: pre-spending someone's gas is not a safe default, though it stays offerable above
    // the floor as an explicit choice. Cross-chain holdings are not preselected either — a bridge is a
    // decision, not a default.
    const [selected, setSelected] = useState<string[]>(() =>
      context
        ? spendableSources(context.sources, context.gasByChain, context.targetChainId)
            .filter((source) => source.chainId === context.targetChainId && !source.isNative)
            .map(fundingSourceKey)
        : [],
    );
    // POO-1135: the route the user picked on the "Where from" screen, or null while it is still on
    // screen. Null with a genuine choice available (`shouldPickRoute`) is what keeps the picker mounted;
    // choosing a route advances past it. Unused in the crypto-only cut (the picker never shows).
    const [routeChoice, setRouteChoice] = useState<FundingRouteKind | null>(null);
    // POO-1384 [R15] The unverified in-flight purchase the mint is blocked on, with the resolver that
    // unblocks it. Null whenever nothing is being asked, which is almost always.
    const [resumePrompt, setResumePrompt] = useState<{
      startedAt: number;
      /** Paid changes the QUESTION: "keep waiting" vs "reopen the checkout". See [R16]. */
      paid: boolean;
      decide: (choice: "resume" | "new") => void;
    } | null>(null);
    const resumePromptRef = useRef<HTMLDivElement>(null);

    // POO-1507 [R29]: the `Stop here?` confirmation the host's dismissal attempt raises mid-run. Its
    // own boolean rather than folded into `resumePrompt`'s shape, because it interrupts THAT (an
    // attempt to close while it is already up is left alone — see `requestClose` below), it is not
    // itself an answer the rail is blocked on.
    const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
    const stopConfirmRef = useRef<HTMLDivElement>(null);

    /**
     * POO-1508 [R43] rules v2: how much of the run's shared price-move buffer
     * (POO-1812: the run's own computed rate, floored at 5%) has been consumed so far, in basis points, across
     * every leg. A ref rather than state: nothing renders off the running total itself, only off
     * whether the LATEST leg's re-quote pushed it over (see `consumeBuffer` below). Reset whenever
     * `plan` changes identity (declared further down), which is what makes a genuinely NEW run start
     * with a fresh budget while a same-run leg retry (`Try again`) keeps the running total.
     */
    const consumedBufferBpsRef = useRef(0);

    /**
     * POO-1812 [R4]: the rate this run was SEEDED with, in integer basis points, and the budget every
     * ask of the run is held against.
     *
     * Pinned when the run starts (beside the reset of the running total below) and deliberately NOT
     * read from `bufferRateBpsRef`: a mid-run raise moves the copy and the NEXT run's seed, never the
     * budget a live run is already being measured against. A budget that grew underneath an in-flight
     * run would re-open exactly what POO-1499 [R7] closed, a decision that can flip after the user
     * has been shown it, and it would make the series report headroom against a number the run was
     * never actually held to.
     */
    const seededBufferRateBpsRef = useRef(bufferRateBps);

    /**
     * POO-1811 [R1]: which ask this is within the run, so the emitted series can be read back in
     * order. It is the ASK ordinal and not a leg id, deliberately: the rail's `consumeBuffer` is
     * `(worseBps) => boolean` and carries no leg identity, and widening that signature would be a
     * contract change this measurement-only issue has no business making.
     *
     * It is NOT the leg's route position, and it must not be emitted as `leg_index`. `gateRequote`
     * (`buildPlanSteps.ts`) returns before it calls the consumer whenever the re-quote is not
     * materially worse, so a leg whose price held never asks and the ordinal skips it; a leg retried
     * after a failure asks twice and the ordinal counts both. It rides as `buffer_ask_index`. Reset
     * with the running total.
     */
    const bufferAskIndexRef = useRef(0);

    // POO-1136: the fiat purchase currently in flight, or null. Set by the buy step's `runOnRampBuy`,
    // it renders the embedded {@link PaybisWidgetFrame} beside the running plan card and holds the
    // resolvers the widget settles. Null whenever no purchase is open, which is almost always.
    /**
     * The Paybis `requestId` this session minted, if it got that far (POO-1403 [R1]).
     *
     * A ref rather than state: nothing re-renders when it changes, and it must outlive the
     * `onRampBuy` state that `fail()` nulls, because the dialog it feeds renders after that.
     */
    const mintedRequestIdRef = useRef<string | undefined>(undefined);

    /**
     * POO-1808 [R1]: WHICH rail serves this buy. `"paybis"` is today's path byte-for-byte, `"privy"`
     * is the new one, `"none"` means no buy leg was planned at all. Nothing is deleted here: D13
     * keeps the Paybis rail live until Privy is ready, and POO-1809 removes it.
     */
    const onRampRail = useOnRampProvider();
    const onRampRailRef = useRef(onRampRail);
    onRampRailRef.current = onRampRail;

    /**
     * POO-1808 [R2]: the second rail's settle/fail pair, held exactly as `onRampBuy`'s below.
     * Separate state rather than a widened `onRampBuy`, so the Paybis path's shape, and every suite
     * that drives it, are untouched.
     */
    const [privyBuy, setPrivyBuy] = useState<{
      order: ProvisioningOrder;
      settle: () => void;
      fail: (error: Error) => void;
    } | null>(null);

    const [onRampBuy, setOnRampBuy] = useState<{
      requestId: string;
      expectedToken: OnRampBuyRequest["expectedToken"];
      /**
       * [R7] The wallet the `requestId` was minted for, so the frame can JOURNAL the intent before the
       * widget opens. Carried down from the mint rather than read separately here: the journal is keyed
       * by wallet, and two independent reads of "the connected wallet" could disagree, which would file
       * the record under an address the resume lookup never queries.
       */
      wallet: string;
      settle: () => void;
      fail: (error: TransactionError) => void;
    } | null>(null);

    /**
     * POO-1576: the "Choose how to pay" step the buy is waiting on, or null.
     *
     * The step is a STATE of the running panel, not a route and not a dialog, for the same reason
     * `resumePrompt` above is: the answer has to be rendered for there to be one at all, and the rail
     * is holding a promise until it arrives. Held in state rather than a ref precisely because it
     * renders.
     *
     * `entry` keys the analytics dedupe, exactly as screen 1's own visit counter does: one entry per
     * buy today (a plan carries at most one), and a future retry counts as the fresh view it is.
     */
    const [methodChoice, setMethodChoice] = useState<{
      order: ProvisioningOrder;
      entry: number;
      decide: (decision: OnRampMethodDecision) => void;
    } | null>(null);
    /**
     * The row the buyer picked, or `undefined` while the shipped chooser's default still applies.
     *
     * Deliberately NOT seeded by an effect once the list lands: the effective selection is DERIVED
     * below (`pickDefaultPaymentMethod` is the fallback it has been since POO-1578), so a list that
     * arrives late, or one whose currency retires the buyer's pick, needs no state to be reconciled.
     */
    const [methodSelection, setMethodSelection] = useState<string | undefined>(undefined);
    /**
     * POO-1618 [R2]: the currency the buyer PROPOSED, or nothing while the server's own resolution
     * stands.
     *
     * It is the proposal and never the answer. The server validates it against the supported set for
     * the pair and echoes what it actually used, so everything on screen - the rows, their labels,
     * their minimums, their charges and the control's own value - reads
     * `buyRouteQuote.currencyCodeFrom` instead of this. A refused choice therefore changes nothing
     * except which currency was asked for, which is the only way one screen can avoid printing one
     * currency beside another's figures.
     */
    const [methodCurrency, setMethodCurrency] = useState<string | undefined>(undefined);
    const methodEntryRef = useRef(0);
    /**
     * Which (entry, method) pairs have already reported a blocked intent, so the notice re-rendering
     * does not re-report the same refusal. Picking a second blocked method IS a second refusal and
     * gets its own key.
     */
    const methodBlockedRef = useRef<Set<string>>(new Set());

    /**
     * POO-1564: the host closed this panel WHILE the vendor checkout was up. Sticky on purpose, and
     * a ref rather than state: `requestClose`'s buy branch below nulls `onRampBuy` (via `fail()`)
     * with the panel still mounted, so by the time the unmount cleanup reads `exitPhaseRef` the
     * re-render has already recomputed it back to `pending` — which silently reclassified the exact
     * cohort POO-1384's `buy > pending` ranking exists to keep separate ("did unlocking the modal
     * cost us purchases?", [R13]). Never reset: the close that sets it is the panel's teardown.
     */
    const closedDuringBuyRef = useRef(false);

    /**
     * POO-1505 [R32]: whether {@link BUY_EXPAND_MS} has elapsed since the buy step opened, so
     * {@link PaybisWidgetFrame} mounts only once the in-place expand's layout has settled and never
     * reflows the checkout mid-load (a mount defer — see {@link BUY_EXPAND_MS} — nothing animates).
     * `prefers-reduced-motion` skips the wait entirely: the defer exists to keep layout motion away
     * from the iframe load, and that user asked for no motion to be shielded from.
     */
    const [buyIframeReady, setBuyIframeReady] = useState(false);
    useEffect(() => {
      if (!onRampBuy) {
        setBuyIframeReady(false);
        return;
      }
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setBuyIframeReady(true);
        return;
      }
      const timer = setTimeout(() => setBuyIframeReady(true), BUY_EXPAND_MS);
      return () => clearTimeout(timer);
      // `onRampBuy` itself (not a boolean derived from it): a SECOND buy on the same panel (unreachable
      // today, a plan carries at most one) must re-arm the wait rather than reuse a stale `true` from
      // the first one's settled animation.
    }, [onRampBuy]);

    /**
     * POO-1505 [R30], a11y: the collapse UNMOUNTS the carousel, and the carousel contains a
     * keyboard-reachable control (its `aria-expanded` disclosure button). Removing the focused
     * element drops focus to `body` with no event fired, stranding a keyboard or screen-reader user
     * at the top of the document mid-flow. `carouselHadFocusRef` is sampled SYNCHRONOUSLY in
     * {@link runOnRampBuy}, right before the state set that unmounts the carousel — the only moment
     * both facts ("a collapse is about to fire" and "where focus is") exist at once — and this effect
     * then lands focus on the mini summary that took the carousel's place. Same effect-plus-ref shape
     * as the interrupting prompts above; scoped to the collapse only, because the mini summary is not
     * a place a user can put focus on their own, so the expand-back has nothing of ours to strand.
     */
    const carouselRegionRef = useRef<HTMLDivElement>(null);
    const buySummaryRef = useRef<HTMLDivElement>(null);
    /**
     * POO-1576: the method step's body, the middle link of the same focus relay.
     *
     * The step now unmounts the carousel BEFORE the mini summary exists, so the sample that used to
     * happen once (carousel -> mini summary) happens twice: carousel -> step at the ask, step ->
     * mini summary at the answer. Without the second hop a keyboard user who was moved onto the
     * step is dropped to `body` the moment they press Continue.
     */
    const methodStepRef = useRef<HTMLDivElement>(null);
    const carouselHadFocusRef = useRef(false);
    // POO-1576: the first hop of the relay. Same shape as the mini summary's below, and scoped the
    // same way: the step is not somewhere a user can put focus on their own, so nothing is stranded
    // when it closes on its own terms.
    useEffect(() => {
      if (!methodChoice || !carouselHadFocusRef.current) return;
      methodStepRef.current?.focus();
    }, [methodChoice]);

    /**
     * POO-1927 [R1]: the method step belongs to the Paybis rail, so the Privy rail ends it.
     *
     * The step is gated out of the render below, and that gate ALONE would strand the purchase:
     * `runOnRampBuy` is parked on the promise this `decide` resolves, so a step that stops being
     * rendered without being answered leaves the buy waiting on a question nobody can be asked any
     * more. Cancelling is the safe resolution and one the buyer already has copy for: nothing has
     * been minted, journaled or charged by this point (see `runOnRampBuy`), so it surfaces as the
     * shipped "Checkout closed. You can start again when you're ready."
     *
     * Reachable when the rail changes WHILE a purchase is up, because the buy branches on a ref
     * captured at call time (`onRampRailRef`) while the render reads the live hook. That is a
     * Dev-menu flip during the POO-1821 sandbox spike, not a hypothetical.
     *
     * Deliberately EMITS NOTHING, unlike the step's own `onCancel`, which reports
     * `funnel.methodAbandoned`. This is not an abandonment: nobody walked away, the rail moved under
     * them. And it is unreachable in production, where `isDevPanelEnabled()` is false and
     * `privyOnRamp` cannot change without a reload, so an event here would be a dead name in the
     * union and a dead row in the catalog. If the rail ever becomes switchable for a real buyer,
     * this branch needs its own event.
     */
    useEffect(() => {
      if (onRampRail !== "privy" || !methodChoice) return;
      methodChoice.decide({ kind: "cancel" });
    }, [onRampRail, methodChoice]);

    useEffect(() => {
      if (!onRampBuy || !carouselHadFocusRef.current) return;
      carouselHadFocusRef.current = false;
      buySummaryRef.current?.focus();
    }, [onRampBuy]);

    /**
     * POO-1048: the funding funnel. This panel is the session — it mounts only when a route is
     * actually being funded — so it is the surface that arms the abandonment guard, and every terminal
     * outcome below reports through it.
     *
     * `flow` comes from the journal's operation because that is the only description of the operation
     * the panel is given. Five of the six modals do not thread `operation` yet (only `InvestModal`
     * does), so those sessions report without it; `funding_gate_triggered` names the operation for all
     * six regardless, since the gate hook always knows it.
     */
    const exitPhaseRef = useRef<FundingExit>(phase);
    const funnel = useProvisioningFunnel({
      // POO-1171: convert the provisioning spelling to the analytics vocabulary at this boundary.
      ...(operation?.kind ? { flow: PROVISIONING_OP_TO_FLOW[operation.kind] } : {}),
      chainId: input.targetChainId,
      ...(operation?.strategyId ? { strategyId: operation.strategyId } : {}),
      abandonExit: () => exitPhaseRef.current,
    });

    // [R10] The real rail, bound to the connected wallet. Bound HERE rather than in the gate hook: this
    // panel is the only thing that signs, and it mounts only when provisioning actually runs, so an op
    // modal never needs wallet context just to decide whether to gate. Inert in mock mode, which is
    // what keeps the mock settle below as mock mode's behaviour.
    const boundRail = useProvisioningRail({
      // [R40] the live-overridable value, not the frozen `input` one — see `slippageRaisePct` above.
      ...(effectiveSlippagePct === undefined ? {} : { slippagePct: effectiveSlippagePct }),
      ...(operation ? { operation: { ...operation, targetChainId: input.targetChainId } } : {}),
    });
    const rail = buildPlanSteps ?? boundRail.buildSteps;

    const buildPlanStepsRef = useRef(rail);
    buildPlanStepsRef.current = rail;
    const railRef = useRef(boundRail);
    railRef.current = boundRail;
    const onDoneRef = useRef(onDone);
    onDoneRef.current = onDone;
    const onLockChangeRef = useRef(onLockChange);
    onLockChangeRef.current = onLockChange;
    const onBuyActiveChangeRef = useRef(onBuyActiveChange);
    onBuyActiveChangeRef.current = onBuyActiveChange;
    const onSourcesActiveChangeRef = useRef(onSourcesActiveChange);
    onSourcesActiveChangeRef.current = onSourcesActiveChange;
    const onCanGoBackChangeRef = useRef(onCanGoBackChange);
    onCanGoBackChangeRef.current = onCanGoBackChange;

    // [R8] The holdings that can REACH this operation's chain. This is REACHABILITY only, and is
    // deliberately NOT the stricter spendability of the exported `spendableSources`
    // (`fundingSelection.ts:119`), which also drops gas-BLOCKED chains. Named `reachableSources` so the
    // two definitions cannot be conflated (the same-name shadow POO-1145 removed): reconciling this to
    // spendability is a behaviour change that would move the LIVE `funding_sources_listed` series, so
    // it is a separate, documented decision (see docs/ANALYTICS_EVENTS.md), not a rename side effect.
    // The reads that gate money (`quotedShortfallUsd`, the confirm total) sum over SELECTED keys only,
    // and a BLOCKED row cannot be selected, so they are identical under either definition. The SELECTOR
    // is told the operation's chain (it cannot know it otherwise) so an unroutable holding is greyed and
    // explained rather than hidden, exactly as a BLOCKED row is.
    const reachableSources = useMemo(
      () =>
        context
          ? context.sources.filter((source) => reachesChain(source, context.targetChainId))
          : [],
      [context],
    );

    /**
     * POO-1135: the ONE authority on whether a buy route/leg exists. The SAME flag drives the planner's
     * `buy` step (`computePlanAction` -> `buildPlan.onRampEnabled`), so the plan behind a buy route and
     * the route the picker offers can never disagree. Off in the crypto-only cut, so `resolveFundingRoutes`
     * returns at most one route and the picker below is skipped, leaving the existing flow unchanged.
     *
     * Read through the CLIENT hook, not `isFeatureEnabled`: this is a client component, and only the
     * hook layers the Dev menu's QA overrides on top of the env baseline (`devOverrides.ts`). Reading
     * the env directly would make the picker the one surface a tester cannot turn on from the Dev menu,
     * which is the dogfood path this epic ships behind.
     */
    const { isEnabled } = useFeatureFlags();
    const onRampEnabled = isEnabled("fiatOnRamp");
    /**
     * POO-1501 [R9]: does this operation need a gas top-up at all? `1c` exists for when it does not.
     *
     * The verdict, NOT `gasEstimateUsd`. That figure is what the operation's transaction will COST on
     * the target chain (`gateContext.ts`), so it is positive even on a wallet already holding plenty,
     * and reading `> 0` would add a gas component to every route including the one state built to have
     * none. The gate classifies `targetChainId` alongside every source chain for exactly this question
     * (`gateContext.ts:73`, "a verdict for every source chain AND for targetChainId").
     *
     * Anything other than `OK` reads as "needs gas", which is the conservative direction: an absent or
     * degraded verdict asks for a top-up that may be unnecessary, rather than skipping one that is not.
     */
    const gasNeeded = context ? context.gasByChain[context.targetChainId]?.verdict !== "OK" : false;

    // POO-1166: seed from the operation's FULL requirement, never `need.usdcShortfallUsd`. The shortfall
    // is already net of the wallet's holdings, and POO-1155 then ALSO counts those same holdings as
    // covering sources, so seeding from it subtracted the on-target money once and added it back once —
    // the "counts the on-target holding twice" bug. The full requirement is the figure the server plans
    // against too (`planActions.ts` `requiredUsd = input.opRequiredUsdc`), so the route resolver, the
    // "Where from" header and the plan all reconcile. The conservative buffer stays: it is what keeps the
    // crypto-only cut's CTA from opening against a bare requirement it cannot actually cover once fees
    // land ([R7]); the on-ramp path shows the exact requirement instead (see the source selector below).
    //
    // POO-1543 fix: the gas component is now gated on `gasNeeded` (the SAME target-chain verdict
    // `resolveFundingRoutes` reads for the `tokens` / `tokens-plus-buy` rows), not the raw quoted
    // `gasEstimateUsd`. Before this, the header always added the quote's gas estimate regardless of
    // whether the wallet already had enough native gas to sign with, while the `tokens` route (whose
    // own amount this header is meant to introduce) added it only when the verdict said gas was
    // actually needed, so a wallet already holding enough gas saw "You need $1.11" above a card that
    // read "Use your $1.05", a real cent-level disagreement about the SAME requirement (murilo,
    // 2026-08-13).
    //
    // ⚠ What this shares with the rows is the PREDICATE, not the AMOUNT, and the residual is stated
    // here rather than implied closed. When `gasNeeded` is FALSE both sides add zero and the two
    // figures are now identical, which is the case the screenshot caught. When `gasNeeded` is TRUE
    // they still diverge: this header adds the quote's `context.gasEstimateUsd` (what the operation's
    // transaction will cost on the target chain) while `routeGasComponentUsd` gives the `tokens` /
    // `tokens-plus-buy` rows the constant `GAS_CUSTOM_MIN_USDC_USD` ($5, `computeNeed.ts:62`, the
    // lowest amount the USDC-funded gas control accepts) and the `buy` row
    // `BUY_ROUTE_NATIVE_RESERVE_USD` ($2). On a $100 operation with $0.50 of quoted gas that is
    // "You need $105.53" above "Use your $110.25", a $4.72 gap with the HEADER the lower of the two.
    // Reconciling the two figures is a sizing decision across the three live sizers, not a
    // mechanical patch, and it stays open on POO-1543 (see `CR-CORE-016`, `BLOCKING`).
    const seededRequiredUsd = seedRequiredUsd(
      input.opRequiredUsdc,
      gasNeeded ? (context?.gasEstimateUsd ?? 0) : 0,
      // POO-1812 [R2]: the opt-in. Absent, this call was the pre-1812 behaviour.
      effectiveSlippagePct,
    );
    const routes = useMemo(
      () =>
        context
          ? resolveFundingRoutes({
              sources: context.sources,
              gasByChainId: context.gasByChain,
              targetChainId: context.targetChainId,
              requiredUsd: seededRequiredUsd,
              onRampEnabled,
              // POO-1812 [R3]: the route cards' target uses the SAME computed rate as the seed.
              // This is the CLIENT rate travelling through the POO-1499 D9 seam; when that server
              // contract lands its value takes precedence and this stops being passed here.
              target: { transactionUsd: input.opRequiredUsdc, bufferRate },
            })
          : [],
      // `gasNeeded` is NOT read here since POO-1542 [B]: `resolveFundingRoutes` derives the per-route
      // gas question itself from `context`'s own `gasByChain` + `targetChainId`, so the panel's `1c`
      // frame flag stays out of the route maths. `input.opRequiredUsdc` is the one input that can move
      // on its own, and it decides the amount every row PRINTS.
      [context, seededRequiredUsd, onRampEnabled, input.opRequiredUsdc, bufferRate],
    );

    /**
     * POO-1153: the received-fixed [R10] charge for the buy route. `useBuyRouteQuote` prices what must
     * LAND and returns the authoritative `amountFrom` charge, the default method's label, and that
     * method's own minimum.
     *
     * ## The quoted amount is the amount the plan will actually order
     *
     * It is the buy route's shortfall FLOORED at `PAYBIS_MIN_USD`, which is exactly how
     * `buildPlan.buildOnRampSteps` sizes the real order through `sizeOnRampOrder` ([R6]:
     * `max(minUsd, requiredUsd + gasComponent)`). POO-1641 removed the 1% gross-up that used to sit
     * between the two, on both sides at once, so they still agree. The floor is not
     * cosmetic. [R10] exists so the user sees what Paybis will ACTUALLY charge, and a figure below the
     * smallest order this app can place is not a conservative estimate, it is a wrong one, and it errs in
     * the direction that surprises someone at the payment step: a small or gas-only requirement would
     * otherwise label roughly $3.30 against a $10 order. Understating a charge is the same failure class
     * as the "Buy with card" label that overpromised and the buy sized so the landed amount fell short.
     *
     * ## What this figure still cannot know, and does not pretend to
     *
     * It is PRE-PLAN pricing. The real order may be sized HIGHER by the gas component
     * (`sizeOnRampOrder`'s classifier figure, raised by the user's gas choice), and that is genuinely
     * plan-time information: the legs have not been quoted yet and the gas choice has not been made.
     * That gap stays, honestly labelled as the pre-plan price of the funding remainder. Only the floor is
     * closed here, because only the floor is knowable now.
     *
     * Gated so it fires only when a buy route is a genuine choice on screen (`shouldPickRoute`) and NOT
     * in mock mode, where there is no Paybis rail behind these actions and the calls could only fail.
     * That is the same seam `PaybisWidgetFrame` applies to the widget itself, and it is a real term in
     * the gate rather than an accident of the mock configs happening to leave `fiatOnRamp` off. It
     * DEGRADES on ANY failure to no figure, which is the picker's neutral-caption fallback: never an
     * error state, never a blocker, never a spinner that traps.
     *
     * POO-1626: "dev has no USDC-BASE pair, so the production-code quote 404s there" used to be the
     * example of that failure and is no longer true. pool-party-api (POO-1605) substitutes the sandbox
     * currency codes at its vendor boundary and restores ours on the way back, so a real-mode dev run
     * prices this pair. The mock-mode gate right above is untouched by that and remains the reason a
     * mock run never shows a charge. Dev now reaches WIDGET OPEN and stops: a sandbox purchase settles
     * on Sepolia while `EXPECTED_TOKEN_SCOPE` watches Base, so it never leaves the settling state
     * (POO-1627).
     */
    const buyRoute = useMemo(() => routes.find((route) => route.kind === "buy"), [routes]);
    /**
     * The CRYPTO side of the buy order in USD: what must LAND, floored at `PAYBIS_MIN_USD`, exactly
     * how `sizeOnRampOrder` sizes the real order. Named because it is both the received-fixed quote's
     * `amountTo` AND the currency-independent figure the method-minimum gate below compares
     * (POO-1512).
     *
     * POO-1641: it used to gross the shortfall up by 1% first, for a Pool Party cut out of the
     * delivery that does not exist (it is a partner-side configuration already inside the price
     * Paybis quotes, Rafael 2026-08-16). A $100 requirement therefore asked for $101.02 of USDC and
     * the buyer was charged for a dollar nobody receives.
     *
     * The floor is what makes dropping an upstream term safe: it clamps whatever it is handed, so no
     * order can now fall below the smallest one this app can place. It does move ONE thing, and
     * deliberately: a requirement in `(9.90, 10.00]` used to gross to `$10.01..$10.10` and so slipped
     * PAST the `buyOrderUsd <= PAYBIS_MIN_USD` gate below, silencing the method-minimum disclosure on
     * exactly the orders small enough for a method's own floor to reject. It now sits ON the floor and
     * the disclosure fires, which is what that gate was written to do.
     */
    const buyOrderUsd = buyRoute ? Math.max(PAYBIS_MIN_USD, buyRoute.shortfallUsd) : 0;
    /**
     * WHICH PAIR this purchase is, asked of the SHIPPED sizer (POO-1596; the shape POO-1513 landed
     * on `/deposit`).
     *
     * The hook defaults `currencyCodeTo` to `USDC-BASE`, and this screen used to take that default.
     * But a plan whose gas is funded by the on-ramp mints `ETH-BASE`: `buildPlan.buildOnRampSteps`
     * calls `sizeOnRampOrder({ standalone: false, gasFundedByOnRamp: needsGasBuy })`, and the mint
     * then lists for `order.currencyCode` (`useProvisioningRail` -> `resolveWidgetPrefill`). So the
     * row priced a charge on a pair the buyer is not billed on (the delta is the ETH-vs-USDC fee
     * schedule, not a fixed number), and named a method out of the WRONG list: an identifier absent
     * from the pair the mint lists for falls back to `pickDefaultPaymentMethod`, a card, which is
     * POO-1578 [R3]'s silent substitution arriving by a route nobody chose.
     *
     * ## Why it asks the sizer instead of restating its rule
     *
     * `currencyCode = needsGas ? "ETH-BASE" : "USDC-BASE"` is one line of `sizeOnRampOrder`, and
     * copying it here is exactly the second predicate POO-1513 refused to write: a screen and a
     * planner that decide the pair separately are free to drift, and the drift is invisible until a
     * buyer is charged for it. `onRampRouteBuysGas` is likewise the planner's OWN predicate
     * (POO-1542 [B], already shared with the `buy` row's reserve), not a copy: `buildOnRampSteps`
     * ORs `gasStillBlocked` into it, and that term requires a `BLOCKED` target verdict this helper's
     * target half already reads as not-OK, so the two decisions are the same decision.
     *
     * ## It cannot be read off the plan
     *
     * The obvious source would be the `buy` step's own `order.currencyCode`, and on THIS surface
     * there is no plan to read it from: `useProvisioningPlan` is suspended until `routeSettled`
     * (POO-1042 [R7]), which on a genuine route choice means until the user has picked one, and the
     * buy row is what they are picking BETWEEN. The sizer is the same answer, one step earlier.
     *
     * No context (a gas-only requirement, or before the gate resolves) means no `buy` route either,
     * so the hook is disabled and the pair is moot.
     */
    const { pair: buyPair, gasFirst: buyIsGasFirst } = useMemo(() => {
      /**
       * An ABSENT gas verdict is an ANSWER here, not a gap to be detected.
       *
       * `onRampRouteBuysGas` is `notOk(ONRAMP_CHAIN_ID) || notOk(targetChainId)`, and `computeNeed`'s
       * own docblock argues the absent case at length: no Base entry means no Base ETH, which is
       * exactly what forces the gas-first buy, since without Base gas the route cannot pay to bridge
       * out of Base at all. And a DEGRADED read never reaches this component: `gateContext` [R5]
       * resolves to NO context on any failure and reports it itself through
       * `observeGateContextFailure`, so a `context` in hand is by construction a clean read.
       */
      const { order, needsSwapToUsdc } = sizeOnRampOrder({
        requiredUsd: buyOrderUsd,
        standalone: false,
        gasFundedByOnRamp: context
          ? onRampRouteBuysGas(context.gasByChain, context.targetChainId)
          : false,
      });
      // Only the PAIR escapes. `order.fiatAmount` is deliberately NOT read: the plan sizes the same
      // order with the gas inputs this render does not hold (`classifierGasUsd`, the user's gas
      // choice), so the amount here would be a second, smaller figure for the same purchase.
      return { pair: order.currencyCode, gasFirst: needsSwapToUsdc };
    }, [buyOrderUsd, context]);

    /**
     * Whether the on-ramp reads may spend upstream quota at all: a live fiat rail, real data, and a
     * buy route on screen OR a method step mid-run.
     *
     * Extracted because TWO reads answer to it now (the quote/list, and POO-1621's supported fiat
     * set), and a control whose options are fetched on a different gate from the list they re-fetch
     * is a control that can be offered before there is anything to change. The step outlives screen
     * 1: the routes are still resolved during a run, but this states the dependency rather than
     * relying on that.
     */
    const onRampReadsEnabled =
      onRampEnabled &&
      !isMockMode &&
      (methodChoice !== null || (buyRoute !== undefined && shouldPickRoute(routes)));

    /**
     * POO-1576: once the method step is up, this hook answers for the order being MINTED.
     *
     * `buyOrderUsd` is deliberately PRE-PLAN pricing (see the block above): the real order can be
     * sized higher by the gas component, which is plan-time information the funding row does not
     * have. The method step does have it — the plan exists by then and the rail is holding its order
     * — so the step re-keys the amount rather than printing per-row charges for a figure that is not
     * what the card will be asked for.
     *
     * It costs no extra list: the METHODS effect keys on the PAIR and never on the amount, so the
     * list resolved while screen 1 was up stays exactly where it is and only the quote re-runs. That
     * is what lets the step open with rows already on screen instead of a spinner it is forbidden
     * from showing.
     */
    const buyRouteQuote = useBuyRouteQuote({
      amountToUsd: methodChoice ? Number(methodChoice.order.fiatAmount) : buyOrderUsd,
      // POO-1596: the pair the plan will actually mint, so the list the picker names methods from is
      // the list the mint resolves, by construction. Once the order itself is in hand it is read off
      // that, rather than off the sizer's prediction of it.
      currencyCodeTo: methodChoice ? methodChoice.order.currencyCode : buyPair,
      enabled: onRampReadsEnabled,
      // POO-1596 (POO-1513 X1, same answer): the received-fixed quote asks Paybis to deliver `amount`
      // OF `currencyCodeTo`. A dollar figure says that correctly for `USDC-BASE` and says nothing at
      // all for `ETH-BASE`, whose target is `gasFloorEth + fundingUsd / ethUsd`, solved at MINT time
      // against a live ETH price this client does not hold (POO-1573; the wallet's own ratio is
      // exactly 0 for the no-ETH wallet that leg serves). Pricing anyway would spend an upstream POST
      // asking for ~100 ETH. So the buy row keeps its shipped "shown at checkout" caption, which is
      // the same answer this screen already gives whenever the provider returns no figure. The LIST
      // still resolves, so the methods the row can name are unaffected.
      pricingEnabled: methodChoice
        ? methodChoice.order.currencyCode === "USDC-BASE"
        : !buyIsGasFirst,
      // POO-1618 [R2]/[R3]: the buyer's proposal, which re-lists the methods. Absent until they
      // touch the control, where the server's own resolution decides exactly as it always has.
      ...(methodCurrency === undefined ? {} : { currencyCodeFrom: methodCurrency }),
    });

    /**
     * POO-1621: the OPTIONS for that control, read from the server rather than hardcoded.
     *
     * On the SAME gate as the list it re-fetches, so the control is ready the moment the buyer
     * arrives at the step rather than becoming a control one round trip later. It costs one read per
     * funding session, cached an hour server-side and off the shared throttle bucket entirely.
     */
    const { currencies: supportedCurrencies } = useOnRampCurrencies({
      currencyCodeTo: methodChoice ? methodChoice.order.currencyCode : (buyPair ?? "USDC-BASE"),
      enabled: onRampReadsEnabled,
    });

    /**
     * POO-1576: the step's rows, from the live list and the quote that priced THIS order.
     *
     * The quote is admitted only when it answers for the order being minted. `useBuyRouteQuote`
     * publishes one commit behind the input that invalidated it, and an `ETH-BASE` order is not
     * denominated in the dollars `fiatAmount` carries at all, so a charge from either of those is a
     * figure for a different purchase. Withholding it costs the per-row prices and keeps the names,
     * the labels and the minimums, which is exactly the settled degrade (Q1: the charge is
     * opportunistic, never a claim we cannot support).
     */
    /**
     * POO-1129 A7-b: the methods this iteration may offer at all, before any of them is a row.
     *
     * Rafael: "defer both, we will add non-instant as an improvement in the future, not at the first
     * iteration." ELIGIBILITY rather than presentation, kept strictly upstream of the rows so
     * POO-1603 [R3] (a consumer may RENDER a vendor label and may not BRANCH on one) still holds
     * without exception for everything downstream.
     */
    const eligible = useMemo(
      () => selectInstantMethods(buyRouteQuote.methods ?? []),
      [buyRouteQuote.methods],
    );
    /**
     * The fail-open is invisible on screen: it renders as an ordinary unfiltered list, exactly like
     * a set that happened to be all-instant. So it is reported, or the rule is silently off and
     * nobody learns it for five days (which is precisely how POO-1601 billed every buyer in dollars).
     *
     * Keyed on the METHOD SET rather than fired from the memo above, because a memo may re-run for
     * reasons that are not a new answer, and a report per render is a report nobody reads.
     */
    const instantFilterReportRef = useRef<string | null>(null);
    useEffect(() => {
      if (!methodChoice || !eligible.failedOpen) return;
      const key = eligible.methods.map((method) => method.paymentMethod).join("|");
      if (instantFilterReportRef.current === key) return;
      instantFilterReportRef.current = key;
      // PP-INTEGRATION-POINT: the vendor's own `labels` vocabulary, which POO-1644 is capturing.
      reportClientError(
        "onramp.instant_filter_empty",
        new Error("No payment method carries the instant label; offering every method instead"),
        {
          methodCount: eligible.methods.length,
          currencyCodeFrom: buyRouteQuote.currencyCodeFrom,
          currencyCodeTo: methodChoice.order.currencyCode,
        },
      );
    }, [methodChoice, eligible, buyRouteQuote.currencyCodeFrom]);

    /**
     * POO-1576: the step's rows, from the ELIGIBLE list and the quote that priced THIS order.
     *
     * The quote is admitted only when it answers for the order being minted. `useBuyRouteQuote`
     * publishes one commit behind the input that invalidated it, and an `ETH-BASE` order is not
     * denominated in the dollars `fiatAmount` carries at all, so a charge from either of those is a
     * figure for a different purchase. Withholding it costs the per-row prices and keeps the names,
     * the labels and the minimums, which is exactly the settled degrade (Q1: the charge is
     * opportunistic, never a claim we cannot support).
     *
     * Withholding it also withholds every BLOCK (POO-1129 D3), which is the correct direction: the
     * refusal is a comparison against a charge, so no admissible charge means no refusal to make.
     */
    const methodRows = useMemo(() => {
      if (!methodChoice) return [];
      // POO-1612 publishes the whole answer as `quote`; `pricedFor` says which (amount, method) it
      // answers FOR. They are independent: POO-1576 widened `quote` to the branch where Paybis
      // priced nothing for the labelled method, so `quote` alone proves only that an answer came
      // back. The gate is therefore `pricedFor`, never the presence of `quote`.
      const priceable =
        methodChoice.order.currencyCode === "USDC-BASE" &&
        buyRouteQuote.pricedFor?.amountToUsd === Number(methodChoice.order.fiatAmount);
      return buildOnRampMethodRows({
        methods: eligible.methods,
        ...(priceable && buyRouteQuote.quote ? { quote: buyRouteQuote.quote } : {}),
      });
    }, [methodChoice, eligible.methods, buyRouteQuote.quote, buyRouteQuote.pricedFor]);

    /**
     * The row the step is actually offering to continue with, and it is never a refused one.
     *
     * DERIVED, never stored: `pickDefaultPaymentMethod` has been the FALLBACK since POO-1578, so a
     * list that lands after the step opened, or one whose currency retires the buyer's pick, is
     * reconciled by re-evaluating this rather than by an effect writing state back. That also means
     * `Continue` always has an answer, which is what keeps the informational state (Q3) proceeding
     * on the same prefill as before this issue.
     *
     * POO-1129 D3: the candidates are the REACHABLE rows, matching `/deposit`'s own `activeMethod`.
     * Being derived is what makes this airtight where an effect would race: the buyer can pick a row
     * while it is still unpriced and have the listing quote reveal a moment later that it misses its
     * floor, and there is no commit in between where the refused identifier is the value.
     *
     * Where `/deposit` then falls back to the whole list, this yields NOTHING when every row is
     * blocked, which is what disables `Continue` (POO-1609 [P38]/AC8, deferred by that hotfix to the
     * picker rebuild). Continuing there would open a checkout every method refuses.
     */
    const reachableMethods = useMemo(() => {
      const blocked = new Set(methodRows.filter((row) => row.blocked).map((row) => row.id));
      return eligible.methods.filter((method) => !blocked.has(method.paymentMethod));
    }, [eligible.methods, methodRows]);
    const selectedMethod =
      methodSelection !== undefined &&
      reachableMethods.some((method) => method.paymentMethod === methodSelection)
        ? methodSelection
        : pickDefaultPaymentMethod(reachableMethods)?.paymentMethod;
    const selectedMethodRow = methodRows.find((row) => row.id === selectedMethod);
    /**
     * POO-1618 [R3] + POO-1576 Q4: a new currency is a new LIST, so the pick made against the old
     * one goes with it.
     *
     * Q4 kept the selection across everything else (a gas choice, a slippage re-quote, a
     * back-navigation) and cleared it on exactly this, because the available methods legitimately
     * differ: a BRL buyer has no Trustly row to keep selected. Clearing here rather than in an
     * effect keeps it a consequence of the buyer's own action instead of a reaction to state that
     * moved, which is what stops a late list from silently dropping a pick nobody changed.
     */
    const chooseMethodCurrency = useCallback(
      (currencyCode: string) => {
        setMethodCurrency(currencyCode);
        setMethodSelection(undefined);
        funnel.methodCurrencyChanged(currencyCode);
      },
      [funnel],
    );
    /**
     * How many rows the step is showing, read by `requestClose` and by the view effect.
     *
     * A ref because it is a REPORT FIELD and never a trigger: as a dependency it would rebuild the
     * close handler and re-run the view effect every time the list resolved, which is precisely the
     * "one entry, one view" rule those two are written to keep.
     */
    const methodRowsRef = useRef(0);
    methodRowsRef.current = methodRows.length;

    /**
     * Where the gas would be paid from, which decides the presets and the floor (POO-1082 [R6]).
     *
     * Derived from the WALLET, not from the plan, on purpose: the plan is quoted with the gas choice,
     * so reading the source off it would be circular. Anything routable to convert means the on-chain
     * path ($5/$10, floor $5); nothing to convert means it has to be bought, and the fiat minimum
     * applies ($10/$25, floor $10).
     */
    const spendableUsd = spendableTokenUsd(input);
    const gasFundingSource: GasFundingSource = spendableUsd > 0 ? "usdc" : "card";
    // The gas being edited (or the $10 default); only a VALID explicit choice resizes the plan, so an
    // empty/invalid Custom never drops the swap-gas step or re-enables the CTA (review POO-409).
    const displayGas = gasChoice ?? selectPreset(10);
    const gasValidity = validateGas(displayGas, spendableUsd, gasFundingSource);
    const effectiveGas = gasChoice && gasValidity.ok ? gasChoice : undefined;
    /**
     * POO-1503 [R18]/[R19]: the plan is quoted WHILE STEP 2 IS ON SCREEN, for the live selection.
     *
     * This is what deleting the Confirm screen actually requires, and it is a deliberate loosening of
     * POO-1042 [R7], which suspended the planner until a selection was CONFIRMED so that "no plan is
     * quoted for a route nobody asked for". Two of step 2's rules cannot be satisfied under that
     * suspension: [R18] puts the step plan and the `You pay` block behind `See details` on step 2, and
     * both are plan-derived, so with no plan there is nothing to disclose; and [R19] makes step 2's CTA
     * sign, which cannot happen against a plan that does not exist yet.
     *
     * The spirit of [R7] survives because the selection IS the ask: the fan-out runs for what the user
     * has picked, changes only when they pick something else (discrete clicks, not keystrokes), and is
     * suspended entirely while the route question on step 1 is still open (`routeSettled`).
     *
     * POO-1023: it resolves through the ONE mock/real seam (computePlan), never mockComputePlan. The
     * seam is async, so the hook owns the pending/error lifecycle and the re-plan race guard.
     * POO-1044 [R1]: a gas-only plan is not suspended on a selection, because there is no selection.
     * POO-1043 [R9]: `refresh` is the cost breakdown's TTL re-quote, and `loading` is what tells it a
     * re-quote is running, so the itemised price re-resolves through this same seam and no other.
     */
    const routeSettled = !shouldPickRoute(routes) || routeChoice !== null;
    const {
      plan,
      loading: planLoading,
      error: planError,
      refresh: requotePlan,
    } = useProvisioningPlan(input, effectiveGas, {
      ...(context && !gasOnly ? { selection: selected } : {}),
      enabled: !context || gasOnly || routeSettled,
    });
    // POO-1508 [R43] rules v2: a genuinely new plan is a new run, so the buffer budget starts fresh.
    // A same-run leg retry (`Try again`) never changes `plan` identity, so the running total survives.
    // biome-ignore lint/correctness/useExhaustiveDependencies: `plan` is a deliberate reset trigger, not read inside the effect, the same pattern this file already uses elsewhere.
    useEffect(() => {
      consumedBufferBpsRef.current = 0;
      bufferAskIndexRef.current = 0;
      // POO-1812 [R4]: a NEW run seeds a new budget; a mid-run raise does not reach this line, because
      // `effectiveSlippagePct` is not an input to the plan and so cannot change its identity.
      seededBufferRateBpsRef.current = bufferRateBpsRef.current;
    }, [plan]);
    /**
     * POO-1135: what the CARD pays, which the selected sources therefore do not have to.
     *
     * `totalPayUsd` is the whole requirement ([R2]: `shortfallUsd + bufferUsd + feesUsd`), and a `buy`
     * step is paid by card, off-chain, from no funding source at all. Measuring the selection against
     * the gross total would score every fiat-funded remainder as unfunded — for the pure-buy route
     * (an empty selection) that is the ENTIRE total, so the re-check below fired on the one
     * route whose plan it was supposed to let through, and the panel hijacked it back to the source
     * selector. `buildPlan` zeroes its own `remaining` when it emits the buy, so the plan itself is the
     * assertion that this money is covered.
     *
     * Netted rather than suppressed: a mixed tokens-plus-buy plan whose purchase is genuinely too small
     * to close the gap still warns, with the honest figure, instead of being waved through.
     */
    const buyCoverageUsd =
      plan?.steps.reduce((sum, step) => (step.type === "buy" ? sum + step.amountUsd : sum), 0) ?? 0;
    /** What the SELECTED on-chain sources are measured against, once the card's share is off. */
    const sourcesMustCoverUsd = plan ? Math.max(0, plan.quote.totalPayUsd - buyCoverageUsd) : 0;

    /**
     * [R7] The re-check. The picker's CTA opened against a SEEDED requirement; the honest figure is
     * the quoted plan's own `totalPayUsd`, which only exists now. When the selection does not cover
     * it, we go back to the picker with the real number rather than showing a plan whose confirm the
     * user would be pressing on a route that strands. The CTA never flips under them: it is a
     * different screen, with its own enabled CTA and an explicit reason.
     */
    const quotedShortfallUsd =
      context && plan && routeSettled
        ? fundingProgress(reachableSources, selected, sourcesMustCoverUsd).remainingUsd
        : 0;
    const quotedPlanFallsShort = quotedShortfallUsd > 0;
    /**
     * POO-1570 [R2]: the buy route, chosen, and step 2 not yet behind it.
     *
     * The buy branch of the route handler deliberately never moves `phase` (see `onSelect` below),
     * because the POO-1503 start effect uses `phase === "sources"` as its idempotence guard. So
     * between the tap and the run there is a real window where `phase` still says `sources` — and
     * that tap is precisely what unblocks the quote, since `routeSettled` is what flips
     * `useProvisioningPlan`'s `enabled`. `pickingSources` had no term for that window and so rendered
     * step 2 for the whole `computePlan` round trip: the 1-2s "Choose tokens to convert" flash
     * reported from live QA (POO-1570), on the one route that has no step 2 at all.
     *
     * Worse than cosmetic, which is why this is a guard and not a transition: the flashed screen was
     * live. A tap on a token row reached `onSelectedChange`, which calls `setStartRequested(false)`
     * and seeds `selected` — silently cancelling the buy the user had just chosen and re-quoting as
     * a token route, with no error and nothing said ([R5]).
     *
     * The term is deliberately NOT `plan === null` (the shape this shipped as, PR #869 review). That
     * reading of "in flight" left step 2 rendering in two states this rule says it must not, and both
     * were measured rather than reasoned (`ProvisioningPanel.buyQuoteFlash.test.tsx`):
     *   - RE-ENTRY. `plan` survives a route change by design (the hook keeps the previous plan so the
     *     screen does not blank on a re-quote), so on a SECOND pass through the picker the term was
     *     already false at the tap and step 2 rendered, live, for the whole re-quote. Recorded phase
     *     sequence: `routes → sources → pending`.
     *   - ONE-COMMIT MOUNT. When the plan resolved, `plan !== null` flipped the term false while
     *     `phase` was still `sources`, mounting step 2 until the passive start effect moved the
     *     phase. Recorded sequence: `routes → loading → sources → pending`.
     * Both now record `routes → loading → pending`.
     *
     * So the window holds from the tap until the panel actually LEAVES step 2, which is what makes
     * [R1] literally true rather than true of the common path:
     *   - `planLoading`: the quote answering THIS tap has not landed. It covers the re-entry case,
     *     where the plan on hand belongs to the previous route and, measured against the buy's
     *     now-empty selection, reads as short. A stale plan is not this route's answer.
     *   - `!quotedPlanFallsShort`: once the buy's own plan HAS landed, the only thing that legitimately
     *     puts step 2 back on screen is the POO-1042 [R7] re-pick. That keeps [R9] intact by
     *     construction — the exit condition is the re-pick's own condition, not a second copy of it —
     *     and it holds the window across the commit between the plan landing and the start effect.
     *   - [R6] a quote that FAILS leaves `plan` null with `planLoading` false, and the planner error
     *     branch renders above this one either way, so a failure surfaces the error rather than
     *     stranding on step 2 (which is what it did before: `phase` never left `sources`).
     *
     * ACCEPTED COST, stated rather than discovered: the window no longer ends by itself. If the start
     * effect is ever prevented from firing on a non-short plan (a new guard added to it, a gate latch
     * that never clears), the user sits on the plain start skeleton below instead of on step 2. That
     * is the deliberate trade — a mute skeleton over a LIVE step 2 whose token rows silently cancel
     * the purchase the user just chose. The impact-gate alert is unaffected: it renders above this.
     */
    const buyQuoteInFlight =
      routeChoice === "buy" && startRequested && (planLoading || !quotedPlanFallsShort);
    // POO-1503 [R3]: step 2 is where a real-mode route lives until it starts. There is no Confirm phase
    // behind it any more, so this is `phase === "sources"` plus the re-priced re-entry, and the gas-only
    // requirement still skips it entirely (POO-1044 [R1] / POO-1509 [R4]).
    // POO-1570 [R1]: minus the one route whose whole point is that it has no step 2.
    const pickingSources =
      context != null &&
      !gasOnly &&
      !buyQuoteInFlight &&
      (phase === "sources" || quotedPlanFallsShort);

    // POO-1135: the "Where from" screen leads, but ONLY when the fiat on-ramp turns a single funding
    // option into a GENUINE choice (`shouldPickRoute`, i.e. more than one route). A quoted-short plan
    // still wins over it, and it disappears once the user has chosen a route. That yield is only safe
    // because `sourcesMustCoverUsd` above nets the card's share out first: without it a chosen buy
    // route quoted short against its own fiat leg and the re-pick took the screen straight back.
    // In the crypto-only cut the flag is off, so `routes` has at most one entry and this is always
    // false, leaving the existing sources-first flow untouched.
    const pickingRoutes =
      context != null &&
      !gasOnly &&
      routeChoice === null &&
      !quotedPlanFallsShort &&
      shouldPickRoute(routes);

    /**
     * POO-1541: screen 1 rendered — once per ENTRY to screen 1, not once per panel session.
     * `routeEntryRef` advances on each false→true edge of `pickingRoutes`, so the two live
     * back-to-screen-1 paths (the [R20] chevron on step 2 and the buy route's impact-gate ghost,
     * both `setRouteChoice(null)`) each produce a fresh `funding_route_viewed`, preserving the
     * picker's old per-mount semantics: `chosen` and `abandoned` are per-action, so a per-session
     * view would let the chosen/viewed ratio exceed 1 and read as a broken funnel. Within one entry
     * `PP-CORE-LIB-058`'s `emitOnce` still dedupes: the effect re-fires while the screen is up
     * (deps include `routes`/`gasNeeded`, which change as the quote resolves) but every call
     * repeats the entry key. The edge detection lives HERE, on the flag itself, rather than on the
     * two back handlers, so a future third way back to screen 1 cannot silently miss a reset.
     * Previously emitted from `FundingRoutePicker` itself via `useTrackView`, which is where
     * `flow`/`chain_id`/`strategy_id` were lost; the host is the one that HAS them.
     */
    const routeEntryRef = useRef(0);
    const wasPickingRoutesRef = useRef(false);
    useEffect(() => {
      if (pickingRoutes && !wasPickingRoutesRef.current) routeEntryRef.current += 1;
      wasPickingRoutesRef.current = pickingRoutes;
      if (!pickingRoutes) return;
      funnel.routeViewed({
        entry: routeEntryRef.current,
        count: routes.filter((route) => CARD_ROUTE_KINDS.includes(route.kind)).length,
        recommended: recommendedRouteKind(routes) ?? "none",
        gasNeeded,
      });
    }, [pickingRoutes, routes, gasNeeded, funnel]);

    /**
     * POO-1047 [R1]/[R4]: a funding route is a swap, so it is gated like one. The SAME `>=10%`
     * acknowledgement the operation modals have shown since POO-1011 (a poisoned thin-pool route that
     * turned $40 into $3) stands between this plan and its confirm, because the funding path reaches
     * the same AMMs and would otherwise be the way around it.
     *
     * Per PLAN, not per leg [R4]: the user acknowledges the route they are approving. The figure is the
     * cost model's own worst-AMM-leg aggregate, which is the number the breakdown above prints as
     * "Price impact", so the percent they are asked about is the percent they were shown. Bridge legs
     * contribute nothing to it [R5] and an absent or malformed figure means NO gate [R3] rather than a
     * blocked route.
     *
     * POO-1503 [R3]: with the Confirm screen gone there is no "above the confirm" left, so the gate
     * becomes what it always was underneath: a blocking, EXCEPTIONAL alert rather than a step. It is
     * rendered only when a start has been requested and the plan came back catastrophic (>=10%), which
     * is why deleting the Confirm did not delete the control. `blocked` is deliberately independent of
     * `active` in the hook, so the auto-start effect below cannot outrun the gate arming.
     */
    const priceImpactPct = useMemo(() => (plan ? planPriceImpactPct(plan) : undefined), [plan]);
    const impactGate = usePriceImpactGate(priceImpactPct, startRequested, {
      // Same conversion boundary as the funnel above: `operation.kind` is the provisioning spelling.
      ...(operation?.kind ? { flow: PROVISIONING_OP_TO_FLOW[operation.kind] } : {}),
      ...(operation?.strategyId ? { strategyId: operation.strategyId } : {}),
    });

    // [R6] What the rail will REALLY run: one approval per ERC-20 leg, then the leg. Only in real mode
    // — the mock settle runs the plan's own steps, and a fixture plan carries no legs to approve.
    const railSteps = useMemo(
      () => (plan && buildPlanStepsRef.current ? planRailSteps(plan) : undefined),
      [plan],
    );
    const railStepsRef = useRef(railSteps);
    railStepsRef.current = railSteps;

    // [R2] The journal seam's display half. Identity, not position: a leg's `index` is stable across
    // the plan, while its position in the rail shifts with every approval that precedes it.
    const onLegBroadcast = useCallback<PlanRailReporters["onLegBroadcast"]>((event) => {
      const key = railStepsRef.current?.find(
        (step) => step.kind === "leg" && step.leg?.index === event.leg.index,
      )?.key;
      if (!key) return;
      setLegHashes((prev) =>
        prev[key] === event.txHash ? prev : { ...prev, [key]: event.txHash },
      );
    }, []);

    /**
     * POO-1508 [R43] rules v2: consume `worseBps` of the run's shared buffer, synchronously, with
     * nobody asked. The rail calls this BEFORE any signature. Returning `true` (within the buffer)
     * lets the leg proceed at the worse price silently; `true` also BANKS the consumption, so a later
     * leg in the same run sees the running total. Returning `false` leaves the total untouched — a
     * rejected move was never sent, so it never happened against the budget — and the caller throws.
     */
    const consumeBuffer = useCallback<NonNullable<PlanRailReporters["consumeBuffer"]>>(
      (worseBps) => {
        // POO-1811 [R1]/[R2]: the arithmetic moved into `measureBufferAsk` unchanged, so the same
        // ask still gets the same answer, and the ask is now RECORDED. The ledger is pure and the
        // running total stays here, which is what keeps the measurement unable to steer sizing.
        const measurement = measureBufferAsk({
          askedBps: worseBps,
          consumedBps: consumedBufferBpsRef.current,
          // POO-1812 [R3]/[R4]: the budget is the rate this run was actually SEEDED with, in integer
          // basis points, so the measurement is read against a rate the run really used rather than
          // against a constant it may not have. Pinned, never `bufferRateBpsRef`: see the ref.
          budgetBps: seededBufferRateBpsRef.current,
          askIndex: bufferAskIndexRef.current,
        });
        consumedBufferBpsRef.current = measurement.cumulativeBps;
        bufferAskIndexRef.current += 1;
        funnel.bufferConsumed(planRef.current ?? null, measurement, {
          // POO-1812 [R6]: the tolerance IN FORCE at this ask and the rate it implies. A mid-run
          // raise reads here as a rate ABOVE the pinned budget, which is the divergence `FU-006`
          // has to see, rather than as a budget that moved under the run.
          ...(slippagePctRef.current === undefined ? {} : { slippagePct: slippagePctRef.current }),
          rateBps: bufferRateBpsRef.current,
        });
        return measurement.held;
      },
      [funnel],
    );

    /**
     * POO-1384 [R15]: hold the mint and ask, when an intent has aged out with no observed payment.
     *
     * The resolver lives in state, not a ref, because the prompt has to RENDER for there to be an
     * answer at all. Nothing has been signed and no widget is open when this is asked, so both answers
     * are safe.
     */
    const confirmResumePurchase = useCallback<ConfirmResumePurchase>(
      ({ startedAt, paid }) =>
        new Promise<"resume" | "new">((resolve) => {
          setResumePrompt({
            startedAt,
            paid,
            decide: (choice) => {
              setResumePrompt(null);
              resolve(choice);
            },
          });
        }),
      [],
    );

    /**
     * POO-1136: run the fiat purchase for a `buy` step. Two halves, composed here:
     *
     *   1. mint the `requestId` at execution time ([R8]) through the bound rail (`personal_sign` +
     *      `createOnRampRequestAction`), which RESUMES a journaled in-flight id when there is one ([R7]);
     *   2. render {@link PaybisWidgetFrame} for it and resolve when the purchase settles from the
     *      observed balance delta ([R4]/[R11]).
     *
     * It rejects on a terminal widget failure so the flow fails legibly, and on a reconcile timeout with
     * {@link ONRAMP_SETTLING_CODE}, which routes to the `settling` phase (the money may be in flight).
     * The resolver is held in state, not a ref, because the widget has to RENDER for a settlement to
     * happen at all.
     */
    const runOnRampBuy = useCallback<NonNullable<PlanRailReporters["runOnRampBuy"]>>(
      async ({ order, expectedToken }) => {
        /**
         * POO-1808 [R1]/[R2]: the second rail, and the only new branch in this function.
         *
         * Linear where the Paybis path is not: no method step (the checkout picks the method), no
         * mint (there is no requestId to resume), and the promise is settled by the step from the
         * OBSERVED DELTA ([R3]), never from a provider's claim. Everything below is unchanged and
         * still runs for `"paybis"`.
         */
        if (onRampRailRef.current === "privy") {
          return new Promise<void>((resolve, reject) => {
            setPrivyBuy({
              order,
              settle: () => {
                setPrivyBuy(null);
                resolve();
              },
              fail: (error) => {
                setPrivyBuy(null);
                reject(error);
              },
            });
          });
        }

        /**
         * POO-1576: ASK before minting.
         *
         * This is the behaviour change, and it sits here rather than on an earlier screen because
         * the order is what the buyer is choosing a method FOR, and only the rail holds it. The step
         * renders while this promise is pending, exactly as `confirmResumePurchase` does one line
         * below, and the checkout opens only once it resolves.
         *
         * `null` is the buyer backing out at the step, which ends the purchase the same way closing
         * the checkout does: nothing has been minted, nothing has been journaled, and nothing was
         * charged.
         */
        const decision = await new Promise<OnRampMethodDecision>((resolve) => {
          methodEntryRef.current += 1;
          // a11y: sample where focus is WHILE the carousel still exists, exactly as the mint below
          // has always done. The effect under this callback lands it on the step.
          carouselHadFocusRef.current =
            carouselRegionRef.current?.contains(document.activeElement) ?? false;
          setMethodChoice({
            order,
            entry: methodEntryRef.current,
            decide: (choice) => {
              // The second hop, sampled SYNCHRONOUSLY on the press for the same reason: this is the
              // only moment where "the step is about to unmount" and "focus is inside it" are both
              // true. It overwrites the first sample, which has already been consumed.
              carouselHadFocusRef.current =
                methodStepRef.current?.contains(document.activeElement) ?? false;
              setMethodChoice(null);
              resolve(choice);
            },
          });
        });
        if (decision.kind === "cancel") throw onRampTerminalError("closed");

        const { requestId, wallet } = await railRef.current.mintOnRampRequest(order, {
          confirmResume: confirmResumePurchase,
          // POO-1578 S2/S4: the buyer's choice is threaded to the quote and the mint. Absent when
          // the provider offered nothing to choose between, where `pickDefaultPaymentMethod` inside
          // the rail still prefills exactly as it did before this step existed.
          ...(decision.paymentMethod === undefined
            ? {}
            : { paymentMethod: decision.paymentMethod }),
          // POO-1618 [R2]: the flow's ONE currency resolution, carried to the mint instead of being
          // performed there a second time. Absent when the list never resolved, where the rail's own
          // resolution is still the only one there is.
          ...(decision.currencyCodeFrom === undefined
            ? {}
            : { currencyCodeFrom: decision.currencyCodeFrom }),
        });
        // POO-1403 [R1]: remember it for the error dialog. Deliberately never cleared on failure: the
        // whole point is that it survives to be shown AFTER the buy, or a later leg, has failed.
        mintedRequestIdRef.current = requestId;
        /**
         * POO-1505 [R30], a11y: the sample that decides whether the mini summary takes focus has
         * ALREADY happened, in `decide` above.
         *
         * It used to be taken here, because the collapse was one hop: the carousel was on screen
         * until the state set below replaced it. POO-1576 put a step in between, so by this line the
         * carousel has been gone for as long as the buyer took to choose and re-reading it would
         * report `false` for exactly the user this rule exists to protect. The reading moved to the
         * last moment the fact is still true, which is the press that closes the step.
         */
        return new Promise<void>((resolve, reject) => {
          setOnRampBuy({
            requestId,
            expectedToken,
            wallet,
            settle: () => {
              setOnRampBuy(null);
              resolve();
            },
            fail: (error) => {
              setOnRampBuy(null);
              reject(error);
            },
          });
        });
      },
      [confirmResumePurchase],
    );

    /**
     * POO-1506 [R40]: `rail` AND `effectiveSlippagePct` are both dependencies of the memo below (not
     * just read through the ref) so a slippage raise rebuilds these steps with the RAISED value baked
     * into each leg's `run()` closure. Without them, `retryFrom("build")` would keep re-running the OLD
     * closure and silently retry at the same tolerance that just failed.
     *
     * Both, not just one: in PRODUCTION, raising slippage changes `boundRail.buildSteps`'s own identity
     * (`useProvisioningRail`'s `slippagePct` dep), which `rail` alone would already catch — but a host
     * under test overrides `buildPlanSteps` directly (bypassing `boundRail` entirely, as every existing
     * suite in this file does), where `rail` is a fixed prop reference that never changes.
     * `effectiveSlippagePct` is what still forces the rebuild there, and it is also the more direct
     * statement of intent: rebuild when the tolerance the run executes against changes, not "rebuild
     * when a `useCallback` somewhere happens to have re-memoized".
     */
    // biome-ignore lint/correctness/useExhaustiveDependencies: rail/effectiveSlippagePct are read through buildPlanStepsRef.current/plan, not directly — intentional extra triggers, not unused deps. See the comment above.
    const flowSteps = useMemo<FlowStep<PlanCtx>[]>(() => {
      if (!plan) return [];
      const buildReal = buildPlanStepsRef.current;
      if (buildReal) return buildReal(plan, { onLegBroadcast, consumeBuffer, runOnRampBuy });
      // PP-MOCK: settle each provisioning step after a beat (always success in mock mode).
      return plan.steps
        .filter((step) => step.type !== "op")
        .map((step) => ({
          key: step.key,
          run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 900));
            if (settleOutcome() === "error") {
              const mockError = settleTxError();
              throw Object.assign(new Error(mockError.message), { code: mockError.code });
            }
            // POO-1136: a fiat `buy` mines NO on-chain transaction (the purchase is a card payment
            // inside the widget), so mock mode must not fabricate a hash for it either. Handing one
            // back would render a link to a transaction that does not exist and would make mock mode
            // the one place the hashless path the e2e harness hash-exempts is never exercised.
            return step.type === "buy" ? {} : { txHash: settleTxHash() };
          },
        }));
    }, [plan, onLegBroadcast, consumeBuffer, runOnRampBuy, rail, effectiveSlippagePct]);
    const flow = useWalletSignFlow<PlanCtx>(flowSteps, {
      fallbackErrorCode: "PROVISIONING_FAILED",
    });
    // Read by {@link startRun}, which is a stable callback: the flow object is rebuilt on every plan
    // change, and a handler that closed over it would start a run against a superseded step list.
    const flowRef = useRef(flow);
    flowRef.current = flow;

    /**
     * POO-1506 [R37]-[R41]: the ALREADY-SHIPPED slippage orchestration (`PP-STR-HOK-001`, POO-467 /
     * POO-499), consumed rather than reinvented. `flowName`/`strategyId` fall back for the two hosts
     * that do not yet thread `operation` (move-range, remove-liquidity): the auto-retry / [R42]
     * classification is unaffected either way, only the `tx_slippage_retry` event's own params would
     * under-report on those two until they do.
     *
     * `onOpenSettings` does NOT open the host's shared `TransactionSettingsDialog` — [R40] is explicit
     * that `8b` asks rather than "dumping the user in settings", and [R17] scopes that dialog to step 2,
     * before execution starts. It fires the [R40] blocked-intent event instead: exactly once per run,
     * the moment `8b` first has something to ask.
     */
    const slippageRetry = useSlippageAutoRetry({
      flow,
      flowName: operation?.kind ? PROVISIONING_OP_TO_FLOW[operation.kind] : "invest",
      strategyId: operation?.strategyId ?? "",
      slippagePct: effectiveSlippagePct ?? DEFAULT_SLIPPAGE_PCT,
      onOpenSettings: () => funnel.slippageRaiseBlocked(),
    });
    const currentSlippagePct = effectiveSlippagePct ?? DEFAULT_SLIPPAGE_PCT;
    /**
     * [R40] the `Custom` pill, wired: the host gear value `8b` OPENED with, captured so only a change
     * made while it is up — which is exactly a commit through the pill's settings dialog — reads as a
     * custom target. Comparing against the live value alone would not do: the host's gear state can
     * already differ from the running tolerance for older reasons (it never learns of `8b`'s own +1
     * raises, and a step-2 gear edit after `evaluate()` never reached `input`), and any of that stale
     * drift would masquerade as a commit the user just made. State set during render, not an effect,
     * so the first `8b` frame and the capture agree (same pattern as the dialog's own re-seed,
     * `TransactionSettingsDialog.tsx` POO-513 R1).
     */
    const [raiseAsk, setRaiseAsk] = useState<{ openedWithPct: number | undefined } | null>(null);
    if (slippageRetry.slippageError && raiseAsk === null) {
      setRaiseAsk({ openedWithPct: hostSlippagePct });
    } else if (!slippageRetry.slippageError && raiseAsk !== null) {
      setRaiseAsk(null);
    }
    /**
     * The tolerance the user committed in the settings dialog while `8b` was up, or nothing. When
     * set, it re-targets the retry CTA (`Retry with {pct}% slippage`) — INCLUDING a value below the
     * one that just failed: the dialog is the full custom range ([R40]), it floors at 0.1% and warns
     * above 5% / 20% itself, and silently ignoring a commit is exactly the shown-but-not-sent class
     * this wiring exists to kill. Nothing applies it until the CTA is pressed.
     */
    const customSlippagePct =
      raiseAsk !== null &&
      hostSlippagePct !== undefined &&
      hostSlippagePct !== raiseAsk.openedWithPct
        ? hostSlippagePct
        : undefined;
    /** [R40] the committed custom value when there is one, else one step above whatever is active NOW
     * (echoing a mid-run raise back into the next ask). Displayed on `8b`'s highlighted pill and its
     * CTA, and what the CTA press sends — one number for both, never two. */
    const suggestedSlippagePct = customSlippagePct ?? currentSlippagePct + 1;
    // The raise the user just asked for, held until `effectiveSlippagePct` actually reflects it: see
    // the `rail` dependency on `flowSteps` above for why retrying one tick early would silently re-run
    // the OLD (failed) tolerance. Never in the same handler as the raise itself.
    const [pendingSlippageRaise, setPendingSlippageRaise] = useState<number | null>(null);
    useEffect(() => {
      if (pendingSlippageRaise === null || effectiveSlippagePct !== pendingSlippageRaise) return;
      setPendingSlippageRaise(null);
      void flow.retryFrom("build");
    }, [pendingSlippageRaise, effectiveSlippagePct, flow]);
    function raiseSlippageAndRetry(pct: number) {
      setSlippageRaisePct(pct);
      setPendingSlippageRaise(pct);
    }

    // [R1]/[R6] The flow reports status and hashes positionally against `flowSteps`, which is the RAIL
    // order. Re-key them here, once, so every surface below reads them by step key and the two lists
    // can never drift apart again.
    const statusByKey = useMemo(() => {
      const byKey: Record<string, WalletStepStatus> = {};
      flowSteps.forEach((step, index) => {
        byKey[step.key] = flow.statuses[index] ?? "idle";
      });
      return byKey;
    }, [flowSteps, flow.statuses]);

    const txHashByKey = useMemo(() => {
      // The in-flight hashes first, so a settled step's own hash supersedes its broadcast record.
      const byKey: Record<string, string | undefined> = { ...legHashes };
      flowSteps.forEach((step, index) => {
        const hash = flow.txHashes[index];
        if (hash) byKey[step.key] = hash;
      });
      return byKey;
    }, [flowSteps, flow.txHashes, legHashes]);

    /**
     * POO-1927 [R2]: the LIVE rail is handed to the mapper, so the buy row credits whoever will
     * actually take the money.
     *
     * The plan was built by a `"use server"` action, whose flag read is env-pure and cannot see a
     * Dev-menu override, while the purchase itself branches on this same hook (`runOnRampBuy`). Left
     * to the plan's own record, a tester flipping `privyOnRamp` reads "Powered by Paybis" on a charge
     * Privy brokers through Stripe or MoonPay, which is the defect this issue is about. `"none"` is
     * dropped rather than forwarded: it means fiat is not offered, so there is no purchase to
     * attribute and the plan's own record stands.
     */
    const view = useMemo(
      () =>
        plan
          ? buildPlanView(plan, {
              railSteps,
              statusByKey,
              txHashByKey,
              ...(onRampRail === "none" ? {} : { onRampRail }),
            })
          : null,
      [plan, railSteps, statusByKey, txHashByKey, onRampRail],
    );

    /**
     * POO-1044 [R3]: the planner's failure, classified.
     *
     * `useProvisioningPlan` hands back a raw `Error`, and this panel used to render the planner branch
     * with the FLOW's `txError` (null there, always), so every planner failure showed the generic
     * "didn't go through" body and the code the planner went to the trouble of typing was discarded.
     * A blocked gas chain is exactly the failure that copy is useless for.
     */
    const planTxError = planError ? toTxError(planError, "PROVISIONING_FAILED") : null;
    // POO-461 R3: kind-aware error body (generic copy when the failure didn't classify). The flow's
    // error wins when there is one: the two branches are mutually exclusive, and a failure that
    // reached the wallet is the more specific of the two.
    const errorBody = useTxErrorBody(txError ?? planTxError);

    /**
     * POO-1403 [R1]/[R4]: the VENDOR's handle for THIS session's purchase, or nothing.
     *
     * ## Why this is the minted id and not a journal read (review of #768)
     *
     * The first revision re-derived it from the journal's newest record, gated on an `ONRAMP_*` error
     * code. Both halves were wrong, in opposite directions.
     *
     * It could print the WRONG id. Three failures carry an `ONRAMP_*` code while journaling nothing for
     * that attempt: a failed MINT (`ONRAMP_INVALID_REQUEST`, no purchase was ever created), a close
     * during the SDK wait (`ONRAMP_CLOSED`, `open()` never ran), and `open()`'s own refusals. The
     * journal keeps a record for 24h, so the newest one is then somebody's EARLIER, probably SETTLED
     * purchase. Support looks it up, finds a completed charge, and answers "yes, you were charged" for
     * an attempt where nothing was minted. That is a wrong answer to the exact question this feature
     * exists to answer, and it is worse than showing nothing.
     *
     * And it SUPPRESSED the id on the case that matters most. Once the buy settles, the swap, bridge
     * and invest legs run; a failure there carries `SLIPPAGE_EXCEEDED` or `PROVISIONING_*`, so the code
     * gate hid the Paybis reference precisely when the card HAD been charged and money had landed.
     * `DepositScreen` argues that same case as the reason for its ungated read, so the two surfaces
     * were giving opposite answers to one event.
     *
     * A ref of the id this session actually minted answers both: it is exactly this attempt's purchase,
     * it is `undefined` when this attempt minted nothing, and it survives whichever later leg failed.
     * It needs no gate, because a session that never minted has nothing to show. It also touches no
     * journal semantics, so it is not the double-charge decision the first revision assumed it was.
     */
    const paybisRequestId = mintedRequestIdRef.current;

    // POO-1048: what the user is actually looking at, for the abandonment report. Not simply `phase`,
    // because two branches below render something else: a plan that came back short returns to the
    // picker, and a planner failure renders the error state while the phase is still `plan`.
    // POO-1384: `buy` outranks `pending` while the vendor checkout is up. Both are the `pending` phase,
    // but only one of them is an exit this release created, and telling them apart is the only way to
    // answer "did unlocking the modal cost us purchases?".
    // POO-1503: `phase` alone stopped answering this. The state is `sources` from mount, but what is on
    // screen while it is `sources` depends on the mode: real mode shows step 2, and mock mode (plan
    // screen deleted, Rafael 2026-08-11) is the brief pre-start wait while the fixture plan resolves.
    // That moment still reports as `plan`: relabelling it `sources` would move a live series for no
    // behaviour change, and `sources` would name a screen mock mode never shows.
    // POO-1564: `closedDuringBuyRef` keeps `buy` reported after the host-side close nulls
    // `onRampBuy` on its way out — same ranking, read from the fact instead of the state it clears.
    // POO-1808: `privyBuy` is the SECOND rail's buy state, and it ranks exactly where `onRampBuy`
    // does. Reading only `onRampBuy` here would report every Privy-rail abandonment as `pending`,
    // which is the same series the POO-1384 note above says exists to tell those two apart.
    exitPhaseRef.current = planTxError
      ? "error"
      : quotedPlanFallsShort
        ? "sources"
        : onRampBuy || privyBuy || methodChoice || closedDuringBuyRef.current
          ? "buy"
          : !context && phase === "sources"
            ? "plan"
            : phase;

    // Read inside effects that must not re-run when they change: the plan changes on every re-quote
    // and the active step on every leg, and neither is a reason to re-report an outcome.
    const planRef = useRef(plan);
    planRef.current = plan;
    const activeKeyRef = useRef<string | undefined>(undefined);

    // POO-1508 [R43] rules v2: the buffer-exceeded prompt interrupts a running route: nothing the user
    // did put it on screen, so nothing moves focus to it either, and a decision nobody is told about
    // is not a decision. Focus goes to the dialog itself rather than to its retry button, so the label
    // and the body are announced BEFORE either answer is reachable. Same shape as the consent banner
    // (`ConsentBanner.tsx`), which is this codebase's one other interrupting dialog.
    const bufferExceededRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (txError?.code === PROVISIONING_BUFFER_EXCEEDED_CODE) bufferExceededRef.current?.focus();
    }, [txError]);

    // POO-1384 [R15]: same treatment as the re-quote prompt above, and for the same reason. Focus lands
    // on the dialog rather than a button, so the question is announced before either answer is reachable.
    useEffect(() => {
      if (resumePrompt) resumePromptRef.current?.focus();
    }, [resumePrompt]);

    // POO-1043 [R8]/[R15]: same treatment, for the same reason — a prompt nobody asked for gets focus
    // moved to it, not merely rendered, or a screen-reader user is never told it appeared at all.
    useEffect(() => {
      if (stopConfirmOpen) stopConfirmRef.current?.focus();
    }, [stopConfirmOpen]);

    /**
     * POO-1507 [R29]: what the host calls when it wants to dismiss the panel. See
     * {@link ProvisioningPanelHandle.requestClose}.
     *
     * Scoped to the PLAIN running view on purpose: `resumePrompt` and the POO-1508 buffer-exceeded
     * prompt are themselves blocking questions the rail is waiting on, and R29 does not say what
     * should happen if a close is attempted while one of THOSE is up. Left exactly as it was before
     * this rule (silently absorbed by the host's own `gate.locked` guard) rather than guessed at.
     */
    const requestClose = useCallback((): boolean => {
      // Nothing left in flight worth protecting: the run finished, failed, or moved past `pending`.
      if (phase !== "pending" || runFinished) return true;
      // `resumePrompt` and the buffer-exceeded prompt are themselves blocking questions the rail is
      // waiting on. Left exactly as before this rule — silently absorbed, dialog stays open, nothing
      // visibly changes — rather than stacking a second confirmation on top of one that is already up.
      if (resumePrompt || txError?.code === PROVISIONING_BUFFER_EXCEEDED_CODE) return false;
      /**
       * POO-1384 [R13]: the vendor checkout stays LEAVABLE, and deliberately without a `Stop here?`.
       * Nothing of ours is in flight, the user is inside Paybis' card form, and being trapped there
       * is the production report that rule exists to answer. What it must not stay is ORPHANED.
       *
       * The buy step awaits a promise that ONLY {@link PaybisWidgetFrame} can settle, and the host's
       * dismissal unmounts that frame — so leaving this way used to hang the rail forever on a
       * promise with nothing left alive to resolve it, behind an open journal record and a minted
       * `requestId`. That is the same class POO-1136 fixed for the widget's own `closed`, from the
       * other side of the modal, and it was reachable precisely BECAUSE [R13] releases the lock.
       *
       * So the exit is the frame's own X, reached from outside: fail the buy with `closed`, reset
       * the rail so the orphaned run loop cannot advance into the next leg (the same reasoning as
       * {@link stopAnyway}, which spells it out), and ask the recovery banner to re-read the journal
       * NOW rather than on the next load. Nothing was signed and nothing broadcast, so `true`: the
       * close proceeds.
       */
      /**
       * POO-1576: the method step is leavable for the SAME reason [R13] makes the checkout leavable,
       * and with more force: nothing is signed, nothing is broadcast, and nothing has even been
       * MINTED yet. It is a question, and a `Stop here?` on top of a question the user is already
       * being asked would be two competing decisions at once.
       *
       * It must not be orphaned either. The buy step is awaiting a promise only this state can
       * settle, so the close answers it (`cancel`) and resets the rail, exactly as the branch below
       * does for the widget. No journal re-check: nothing was minted, so there is no in-flight
       * intent to reconcile.
       */
      if (methodChoice) {
        // The same ranking the widget's own close uses, so the unmount's `funding_plan_abandoned`
        // still reports `funding_exit: "buy"` once the state below is cleared.
        closedDuringBuyRef.current = true;
        funnel.methodAbandoned(methodRowsRef.current);
        methodChoice.decide({ kind: "cancel" });
        flowRef.current.reset();
        return true;
      }
      if (onRampBuy) {
        // POO-1564: record the fact before `fail()` clears the state it is derived from, so the
        // unmount's `funding_plan_abandoned` still reports `funding_exit: "buy"` (see the ref's doc).
        closedDuringBuyRef.current = true;
        onRampBuy.fail(onRampTerminalError("closed"));
        flowRef.current.reset();
        requestFundingRecoveryRecheck();
        return true;
      }
      /**
       * POO-1808: the same exit for the second rail, and it is not optional. `privyBuy` holds a
       * promise only this state can settle, so a close that skipped this branch would orphan the run
       * loop behind a step that has already unmounted: the buy never resolves, the rail never
       * advances and never fails, and nothing in the journal names what it was funding.
       *
       * `closed` for the same reason the branch above uses it: nothing of ours is signed or
       * broadcast, so leaving is a thing the buyer is allowed to do. That is NOT a claim about their
       * card, and it never reaches a screen saying "cancelled" over a charge that may have gone
       * through: the intent record outlives this component, and POO-1833 is what resumes it in a
       * later session.
       */
      if (privyBuy) {
        closedDuringBuyRef.current = true;
        privyBuy.fail(onRampTerminalError("closed"));
        flowRef.current.reset();
        requestFundingRecoveryRecheck();
        return true;
      }
      // POO-1506: `8a` (auto-retrying notice) and `8b` (raise prompt) are the same class (murilo,
      // 2026-08-11). `8a` is a retry already in flight — exactly the mid-run state the interception
      // protects, except the question is already being answered. `8b` IS a blocking question with its
      // own `Stop here`; opening `Stop here?` on top of it would face the user with two competing
      // stop decisions at once.
      if (slippageRetry.autoRetrying || slippageRetry.slippageError) return false;
      if (stopConfirmOpen) {
        // [D6] A second attempt (Esc, another X click, an overlay click) while the confirmation is
        // already up maps to `Keep going` — it must resolve the question, not compound it, which is
        // what makes the keyboard unable to leave without a decision.
        setStopConfirmOpen(false);
        return false;
      }
      setStopConfirmOpen(true);
      // POO-1507 [R29]: the blocked-intent event, fired the instant the interception itself happens —
      // not on `Stop anyway`, which is a later, separate decision (see the funnel emitter's own doc).
      //
      // The `if (position)` guard DELIBERATELY drops the event when the rows are empty. `pending` is
      // only reachable through `startRun`, which requires a resolved plan, and a re-quote keeps the
      // previous plan mounted, so a row-less mid-run interception is not a state a user can produce.
      // If it ever occurs anyway, the interception itself still works (the dialog opens either way);
      // only the report is skipped, because emitting `leg_index: 0 of 0` would poison a live series
      // with a position that does not exist, which is worse than one lost count of an unreachable state.
      const position = currentStepPosition(view?.rows ?? []);
      if (position) funnel.runStopBlocked({ legIndex: position.index, legCount: position.total });
      return false;
    }, [
      phase,
      runFinished,
      resumePrompt,
      txError,
      methodChoice,
      onRampBuy,
      privyBuy,
      slippageRetry.autoRetrying,
      slippageRetry.slippageError,
      stopConfirmOpen,
      view,
      funnel,
    ]);
    // POO-1528 [R20]: the same transition the internal fallback link already makes
    // (`setRouteChoice(null)`), exposed so a mobile host's own header can drive it from a control it
    // renders itself. Guarded the same way `onCanGoBackChange` reports the button should even show,
    // so calling it when there is nothing to go back to is a safe no-op rather than a phase jump.
    //
    // POO-1570 [R5]: which is why it takes the `buyQuoteInFlight` term the signal took. The signal
    // says "hide the control"; the handle is what the host can still CALL — a header rendered one
    // commit earlier, a queued tap, a host that never adopted the signal. Unguarded, that call lands
    // mid-window with `startRequested` still true, dropping the user back on screen 1 with a
    // committed purchase behind them. "Guarded the same way" has to mean the same terms, or the
    // comment is the only thing keeping them together.
    const goBack = useCallback(() => {
      if (phase === "sources" && routeChoice !== null && !buyQuoteInFlight) setRouteChoice(null);
    }, [phase, routeChoice, buyQuoteInFlight]);

    useImperativeHandle(ref, () => ({ requestClose, goBack }), [requestClose, goBack]);

    /** [D6] `Keep going`: the safe default, and the one `Esc` and a repeated close attempt also reach. */
    function keepGoing(): void {
      setStopConfirmOpen(false);
    }

    /**
     * [R29] [D5] `Stop anyway`: nothing that already broadcast is undone, so this closes the whole
     * surface (never merely a phase back, which is what {@link onCancel} means everywhere else) and
     * pings the app-wide recovery banner to check the journal RIGHT NOW rather than on the next load —
     * the record the running route already wrote (POO-1043) is what it finds.
     *
     * The `reset()` is what makes the dialog's "will not start" TRUE rather than narrated. The hosts'
     * `onStopRun` resets THEIR op flow, not this panel's own {@link useWalletSignFlow} instance, whose
     * run loop is the thing actually executing the legs; its only cancellation is the run-id guard,
     * and nothing bumps the run id on unmount. Without this, the orphaned loop advanced when the
     * in-flight leg settled and called the NEXT leg's `run()` — in real mode a server build, a wallet
     * signature request and a broadcast, minutes after the user was told steps would not start.
     *
     * Safe for the money and for recovery, in that order: the in-flight leg's `run()` keeps executing
     * inside its own promise (only its RESULT is discarded), and the recovery journal is written
     * SYNCHRONOUSLY inside that `run()` — `planned` before the send, `broadcast` the moment there is a
     * hash (`buildPlanSteps.ts` §3.4) — so a broadcast that settles after this reset is still fully
     * journaled, which is exactly what the [D5] recheck then surfaces. The journal's open record is
     * untouched: it closes only on `flow.status === "success"`, and `reset()` goes to `idle`.
     */
    function stopAnyway(): void {
      setStopConfirmOpen(false);
      flowRef.current.reset();
      requestFundingRecoveryRecheck();
      (onStopRun ?? onCancel)();
    }

    // Report the in-flight lock to the host (no dismissal while provisioning runs). POO-1037 [R5]: a
    // bridge leg keeps the flow in `pending` for the WHOLE settlement wait, so the lock holds for it
    // with no extra state; the ceiling moves to `settling`, which releases it precisely because the
    // user is then free to leave and come back to a recoverable route.
    //
    // POO-1384 [R13]: the buy step is the ONE `pending` phase that does not hold it. Everything else
    // `pending` covers is one of OUR transactions mid-signature or mid-settlement, where a dismissal
    // orphans something on-chain. A buy is the user sitting inside the vendor's card checkout with
    // nothing of ours in flight, and abandoning it is a thing they are allowed to do. Reported from
    // production as being trapped in the modal: the lock was not even protecting the overlay there,
    // because the click that would reach it lands inside Paybis' iframe instead, so all it removed was
    // the escape. Leaving mid-buy is recoverable by design rather than a loss: the [R7] journal holds
    // the minted `requestId` for `ONRAMP_REQUEST_RESUMABLE_MS`, so coming back resumes the SAME
    // purchase instead of minting a second one beside the first one's funds, and the funnel's
    // unmount guard still emits `funding_plan_abandoned`.
    //
    // POO-1808: `privyBuy` releases the lock for exactly the same reason. The buyer is inside a
    // provider's own surface, ours holds nothing in flight, and a modal that cannot be dismissed
    // while a card checkout is up is the production trap [R13] was written after.
    useEffect(() => {
      onLockChangeRef.current?.(phase === "pending" && onRampBuy === null && privyBuy === null);
    }, [phase, onRampBuy, privyBuy]);

    // POO-1527 [M4.4]: a SEPARATE effect from the one above, on purpose. The lock effect's whole
    // point is that it does NOT hold during a buy ([R13]); this one reports the opposite fact for a
    // different reason (an accidental drag, not dismissal safety) and must not be folded into the
    // same callback or the two concerns start justifying each other's exceptions.
    // POO-1808: and the same on the second rail. The host disables its drag-to-dismiss on this
    // signal, and a checkout the buyer is typing card details into is exactly the moment an
    // accidental drag costs a purchase, whichever rail put it there.
    useEffect(() => {
      onBuyActiveChangeRef.current?.(onRampBuy !== null || privyBuy !== null);
    }, [onRampBuy, privyBuy]);

    /**
     * POO-1576, premise 11: the method step's VIEW, and its ERROR class.
     *
     * The view fires on the OPEN, with whatever the list has at that moment, on the same D1 rule
     * `funding_route_viewed` follows: a buyer who left while the figures were still in flight is a
     * buyer who saw this step. Both are keyed on the entry, so the step re-rendering as the quote
     * lands is not a second view and not a second degrade.
     *
     * The unavailable event deliberately covers "still resolving" as well as "unreadable", because
     * the screen cannot tell them apart (`useBuyRouteQuote` publishes no loading discriminator, by
     * design) and reporting only what it can prove would under-count the buyers who saw an empty
     * step. The upstream CAUSE, with its code, is reported separately by the hook.
     */
    useEffect(() => {
      if (!methodChoice) return;
      funnel.methodViewed({ entry: methodChoice.entry, count: methodRowsRef.current });
      if (methodRowsRef.current === 0) funnel.methodUnavailable(methodChoice.entry);
    }, [methodChoice, funnel]);

    /**
     * POO-1576 / POO-1129 D3, premise 11: the BLOCKED INTENT, from either of its two arrivals.
     *
     * One event, deduped per (entry, method), because the meaningful unit is one refusal per method
     * and not one per click or one per render. The two arrivals are genuinely different moments:
     *
     *   * the buyer ACTIVATES a row already known to be refused, which is a click the step declines
     *     (`onBlockedSelect`). `/deposit` cannot count this one, because its pinned quote only ever
     *     discovers a refusal through a selection it accepted first;
     *   * a row the buyer had ALREADY picked becomes refused when the listing quote lands, which is
     *     the effect below and is `/deposit`'s own path.
     *
     * Reported from a callback the host owns rather than from the row, so the component stays free
     * of the money rule that decided the refusal.
     */
    const reportMethodBlocked = useCallback(
      (row: OnRampMethodRow | undefined) => {
        if (!methodChoice || !row?.minimum) return;
        const key = `${methodChoice.entry}:${row.id}`;
        if (methodBlockedRef.current.has(key)) return;
        methodBlockedRef.current.add(key);
        funnel.methodBlocked({
          method: row.id,
          minimum: row.minimum.amount,
          // POO-1512: the floor's OWN currency. A EUR 500 minimum reported as USD is a wrong number.
          currency: row.minimum.currencyCode,
        });
      },
      [methodChoice, funnel],
    );
    /**
     * The second arrival: the pick the quote retired under the buyer. `methodSelection` still names
     * it (nothing writes state back, by design), while `selectedMethod` has already moved on, so the
     * two disagreeing IS the signal that a standing choice was refused.
     *
     * The unpriced case is deliberately still counted alongside it. That row is not blocked and
     * stays selectable, but the provider did decline to price the buyer's chosen method for this
     * order, and premise 11's class is the intent rather than the mechanism that answered it.
     */
    useEffect(() => {
      if (!methodChoice) return;
      if (methodSelection !== undefined && methodSelection !== selectedMethod) {
        const refused = methodRows.find((row) => row.id === methodSelection);
        if (refused?.blocked) reportMethodBlocked(refused);
        return;
      }
      if (selectedMethodRow?.unpriced) reportMethodBlocked(selectedMethodRow);
    }, [
      methodChoice,
      methodSelection,
      selectedMethod,
      selectedMethodRow,
      methodRows,
      reportMethodBlocked,
    ]);

    // POO-1528 [M6.1]: two SEPARATE effects, each reporting exactly one fact a mobile host's own
    // header needs, on the same "one signal, one name, one reason" precedent `onBuyActiveChange`
    // (POO-1527) already established over folding everything into one richer callback.
    //
    // POO-1570 [R4]: both carry the same `buyQuoteInFlight` term the body does. They report on
    // `phase`, and `phase` is exactly the state the buy route deliberately leaves untouched, so
    // without it a host's own header announces step 2 chrome (and a back control) for the whole
    // quote window while the body shows the skeleton. One fact, told the same way in both places.
    useEffect(() => {
      onSourcesActiveChangeRef.current?.(phase === "sources" && !buyQuoteInFlight);
    }, [phase, buyQuoteInFlight]);
    useEffect(() => {
      onCanGoBackChangeRef.current?.(
        phase === "sources" && routeChoice !== null && !buyQuoteInFlight,
      );
    }, [phase, routeChoice, buyQuoteInFlight]);

    // On success → resume the op; on failure → the recoverable error state. POO-1037 [R3]: a bridge
    // still in flight at the poll ceiling is NEITHER, so it branches before the error state ever
    // renders — its copy, and above all its absent retry, are the whole point.
    useEffect(() => {
      if (phase !== "pending") return;
      if (flow.status === "success") {
        // POO-1043 [R7] Every leg landed, so there is nothing in flight left to recover and a retained record
        // would read as "you have funding in progress" for a route that finished. Deliberately not
        // done on the failure or `settling` branches below: that is exactly when the record is needed.
        railRef.current.closeJournal();
        // POO-1128 [R4] restore (POO-1136): publish the app-wide balance invalidation once the route
        // lands, so the header chip and every other subscriber converge. PR 708 deleted the wizard that
        // carried the only funding-flow publish; a fiat purchase in particular moves the balance and
        // nothing was telling the rest of the app. Mirrors `DepositScreen.tsx`.
        requestBalanceRefresh();
        // POO-1048 [R3] The completion, from the only place that knows the route really landed: the
        // flow reaches `success` when every step's `run()` has resolved. Never from the confirm click,
        // which is where `deposit_completed` fires and why that funnel counts intent as revenue.
        if (planRef.current) funnel.planCompleted(planRef.current);
        /**
         * POO-1504 [R27]: the run is finished, and the STATE BUTTON says so; it does not hand the
         * operation back on its own any more.
         *
         * `onDone` used to fire here, so the host's modal moved on the instant the last leg settled and
         * the `7f` "all done" screen was never seen. The completion EVENT stays exactly where it was, on
         * settlement, because that is premise 11: only the handoff waits for the press.
         */
        setRunFinished(true);
      } else if (flow.status === "error") {
        // POO-1506 [R37]: a slippage failure NEVER lands on the generic failure screen, not on the
        // first attempt (which auto-retries, `autoRetrying`) and not on the second either (which asks
        // `8b` instead, `slippageError`) — stronger than the six transactional modals, which reuse their
        // shared error-phase UI with swapped copy for the second failure. Neither sub-state is terminal
        // for THIS funnel either: the run is waiting on a decision (raise or stop), not concluded, so
        // `planFailed` stays silent here exactly as it already does for the first attempt.
        if (slippageRetry.autoRetrying || slippageRetry.slippageError) return;
        setTxError(flow.error);
        // POO-1136: a fiat reconcile timeout is settling, not a failure, exactly as a still-in-flight
        // bridge is: the money may still be landing, so the panel never offers a retry that could
        // re-charge or re-broadcast it.
        const stillSettling =
          flow.error?.code === BRIDGE_PENDING_CODE || flow.error?.code === ONRAMP_SETTLING_CODE;
        // POO-1508 [R43] rules v2: the SAME class as the slippage guard above — the run's shared
        // buffer was exceeded, nothing was sent, and the run is waiting on a decision (retry this leg
        // or cancel), not concluded. Stays in `pending`, never the generic failure screen.
        const bufferExceeded = flow.error?.code === PROVISIONING_BUFFER_EXCEEDED_CODE;
        // POO-1048 [R4]: every terminal failure is reported, and a bridge still in flight at the poll
        // ceiling is NOT one. A buffer-exceeded leg is not terminal either (the money never left, and
        // the run waits behind the prompt's Try again / Cancel), but it IS a refusal to move the
        // user's money, and the per-leg decline it replaced reported on this exact series
        // (`PROVISIONING_REQUOTE_REJECTED`), so it reports too: without the row, how often the 5% cap
        // trips in production is unmeasurable. Reusing `funding_plan_failed` with the typed
        // `PROVISIONING_BUFFER_EXCEEDED` code keeps the series joinable rather than minting a new
        // event name; the funnel marking the session concluded is what stops the same exit ALSO
        // reporting as a bare `pending` abandonment on unmount, and a retried run that lands still
        // counts its completion (the funnel's stated failed-then-completed contract).
        if (!stillSettling) {
          funnel.planFailed(planRef.current, {
            ...(flow.error?.code ? { errorCode: flow.error.code } : {}),
            ...(activeKeyRef.current ? { stepKey: activeKeyRef.current } : {}),
          });
        }
        // POO-1128 [R4] restore (POO-1136): a settling terminal still moved money (a paid purchase, a
        // broadcast bridge), so publish the balance invalidation here too. A hard failure moved nothing,
        // so it does not.
        if (stillSettling) requestBalanceRefresh();
        setPhase(stillSettling ? "settling" : bufferExceeded ? "pending" : "error");
      }
    }, [
      flow.status,
      flow.error,
      phase,
      funnel,
      slippageRetry.autoRetrying,
      slippageRetry.slippageError,
    ]);

    // POO-1048 [R1] What the user was offered. The count and total are the REACHABLE ones
    // (`reachableSources`), not the rendered rows: "we listed six tokens and none of them could reach
    // the operation's chain" reads as zero, which is what the user experienced. POO-1145: deliberately
    // REACHABILITY, not the stricter spendability of `fundingSelection.ts` `spendableSources` (which
    // also drops gas-BLOCKED chains). Reconciling would move this LIVE series, so it stays as-is by
    // decision; both definitions are documented in docs/ANALYTICS_EVENTS.md.
    useEffect(() => {
      if (!context || gasOnly) return;
      funnel.sourcesListed({
        count: reachableSources.length,
        usd: fundingProgress(reachableSources, reachableSources.map(fundingSourceKey), 0)
          .selectedUsd,
      });
    }, [context, gasOnly, reachableSources, funnel]);

    // POO-1048 [R1] A quoted route, reported once per quote (a TTL re-quote is a new price, and the
    // emitter keys on the quote's own timestamp).
    useEffect(() => {
      if (plan) funnel.planQuoted(plan);
    }, [plan, funnel]);

    // POO-1048 [R4] The planner itself failed, so no route was ever priced. Keyed on the raw error
    // rather than on its classification: `toTxError` builds a new object every render, and an effect
    // keyed on that would report the same failure on every one of them.
    useEffect(() => {
      if (!planError) return;
      funnel.planFailed(planRef.current, {
        errorCode: toTxError(planError, "PROVISIONING_FAILED").code,
      });
    }, [planError, funnel]);

    // POO-1048 [R1]/[R3] A leg is reported when it is DONE, which the flow sets only after that step's
    // `run()` has resolved — for a bridge leg, after arrival was detected on the destination chain.
    // Not on broadcast: a hash exists minutes before the money does.
    useEffect(() => {
      if (!plan) return;
      for (const [key, status] of Object.entries(statusByKey)) {
        if (status === "done") funnel.legSettled(plan, key);
      }
    }, [plan, statusByKey, funnel]);

    // The plan step the flow is on, matched by KEY and never by index: the real rail expands one plan
    // step into an approval step plus the leg itself, so the two lists are not index-aligned.
    const activeStepKey = flowSteps[flow.activeStep]?.key;
    activeKeyRef.current = activeStepKey;
    const activePlanStep = plan?.steps.find((step) => step.key === activeStepKey);
    /**
     * The view row the wallet is asking about, which is what [R26]'s disclosure describes. Matched by
     * KEY like everything else on this surface: the rail expands one plan step into an approval plus its
     * leg, so a positional read would describe the wrong signature.
     */
    const activeRow = view?.rows.find((row) => row.status === "active");

    // [F4-R6] Was there a picker behind this plan? Only a real-mode, non-gas-only route has one.
    const canReturnToPicker = context != null && !gasOnly;

    /**
     * POO-1509 [R34]: **the funding flow no longer contains a gas amount picker at all.**
     *
     * This RETIRES POO-1085 [F2-R5], which put the selector on every plan carrying a gas step in both
     * modes, on the argument that it raises a floor rather than sizing the top-up
     * (`max(classifier, choice)`). That argument was sound and the control worked; what changed is the
     * flow it lived in. `Fund this transaction` is now two steps and neither of them is about gas: gas
     * rides in with the buy, the swap or the bridge, and the classifier sizes it from a live quote.
     * A control whose only job is to raise a floor nobody was asked about is a decision presented as a
     * choice, on the screen where the user is trying to approve something else.
     *
     * The picker is not deleted, it MOVED, to the one screen whose entire subject is gas
     * ({@link GasTopUpBody}, [R35]). `raiseTopUpToUsd` and the `max(classifier, choice)` planner term
     * are untouched and are exactly what the auxiliary screen still drives.
     */
    /**
     * Start the run. Named because two screens now begin it: the gas-only auxiliary body below, and
     * (from POO-1503) step 2's own CTA. It was inlined in the plan phase's confirm handler, which is
     * the screen that is going away, and a copy per host is a copy of the journal mint.
     */
    const startRun = useCallback(() => {
      // POO-1043 [R7] §3.7: the journal is minted when the user APPROVES the route, never when it is
      // quoted. A plan nobody accepted has no in-flight transactions to track, and a record of one
      // would surface as "you have funding in progress" for a route that never started.
      // POO-1048 [R1]/[R3] The route STARTED. Deliberately the only funnel event this click emits:
      // what happens next is settlement's to report.
      if (planRef.current) {
        funnel.planStarted(planRef.current);
        railRef.current.openJournal(planRef.current);
      }
      setPhase("pending");
      void flowRef.current.run();
    }, [funnel]);

    /**
     * POO-1503 [R19]: the run starts as soon as the last thing the user CAN decide is decided.
     *
     * This effect is what the Confirm screen used to be, minus the screen. It fires once the plan the
     * user asked for exists, covers what they picked, and carries no unacknowledged funds-at-risk
     * warning. Everything it waits on is a fact rather than a question:
     *   - `plan`: there is nothing to sign until the route is priced.
     *   - `!planLoading`: while a re-quote is in flight the mounted `plan` is the PREVIOUS quote
     *     (`useProvisioningPlan` keeps it so the screen does not blank), and after a selection change it
     *     is the previous SELECTION's route. Starting against it would approve, swap and bridge the
     *     sources the user just deselected, so the start waits for the plan that answers the current
     *     ask. On main this was structural (`confirmedSelection` pinned the quoted selection); with the
     *     Confirm gone it has to be a guard.
     *   - `!quotedPlanFallsShort`: a plan the selection does not cover goes back to step 2 with the real
     *     figure, which is POO-1042 [R7] and is why the CTA never flips under anyone.
     *   - `!impactGate.blocked`: >=10% price impact is answered before anything is broadcast, or not at
     *     all. The gate renders as an alert (below), never as a step.
     *   - `phase === "sources"`: a started run must not be started twice, and `startRun` moves the phase
     *     out of `sources` on its way, so this is the idempotence guard.
     * A gas-only requirement is excluded because it has its own screen and its own CTA (POO-1509 [R4]);
     * effects run regardless of an early return, so the guard has to be here rather than implied by the
     * render order.
     */
    useEffect(() => {
      if (gasOnly || !startRequested || phase !== "sources") return;
      if (!plan || planLoading || quotedPlanFallsShort) return;
      // The alert is up, or has been up for this request: the second press is the user's.
      if (impactGate.blocked) {
        setGateEngaged(true);
        return;
      }
      if (gateEngaged) return;
      startRun();
    }, [
      gasOnly,
      startRequested,
      phase,
      plan,
      planLoading,
      quotedPlanFallsShort,
      impactGate.blocked,
      gateEngaged,
      startRun,
    ]);

    /**
     * [R7]/[R8]/[R9] Pick what to spend. Reached in real mode only, on open and again whenever the
     * quoted plan turns out to cost more than the selection covers.
     *
     * The verdict map is passed through verbatim: it carries an entry for every source chain (the
     * gate context guarantees it), which is what makes POO-1039's "no verdict, still selectable"
     * fallback unreachable here rather than load-bearing.
     */
    // POO-1135: the "Where from" screen. Only reachable with the fiat on-ramp enabled (a buy route to
    // offer); the crypto-only cut never enters here. Choosing a route advances: `buy` funds the whole
    // requirement from the on-ramp (an empty selection, so `buildPlan` emits the buy leg for the full
    // shortfall), and the token routes go on to the source selector, which buys any remainder.
    if (pickingRoutes && context) {
      return (
        <div className="flex flex-col gap-4" data-testid="provisioning-panel" data-phase="routes">
          <FundingRoutePicker
            routes={routes}
            requiredUsd={seededRequiredUsd}
            opRequiredUsd={input.opRequiredUsdc}
            // [R9] Zero suppresses the breakdown affordance entirely, so the picker never renders an
            // empty disclosure. The figure itself is still the quote's, never a constant.
            gasUsd={gasNeeded ? (context.gasEstimateUsd ?? 0) : 0}
            // [R50] / POO-1499 D9: interpolated from the constant, never written into 12 locales.
            bufferPct={Math.round(bufferRate * 100)}
            // PP-INTEGRATION-POINT: [R10] the received-fixed on-ramp quote charge, LIVE via
            // `useBuyRouteQuote` (POO-1153): the backend's `amountFrom` for the default method, that
            // method's label, and its own minimum when the order sits at the app floor.
            //
            // Since POO-1596 F1 only the CHARGE is absent when the quote could not be priced (a pair
            // Paybis will not sell, a throttle, a timeout, or the deliberately unpriced gas-first
            // pair; POO-1626: "dev's absent USDC-BASE pair" stood in that list until POO-1605 taught
            // pool-party-api to substitute the sandbox codes, so dev prices this pair now).
            // The label and the minimum come from the METHODS list, which resolves
            // independently, so they legitimately survive a missing charge and the minimum row can
            // still render. The buy row then shows its neutral "shown at checkout" caption rather
            // than the FE shortfall: the quote never blocks the flow.
            buyChargeUsd={buyRouteQuote.chargeUsd}
            // POO-1512 [R7]: the charge is billed in the buyer's own currency now, so the row must
            // print the currency Paybis quoted rather than assuming dollars.
            buyChargeCurrency={buyRouteQuote.chargeCurrency}
            buyMethodName={buyRouteQuote.methodLabel}
            // PP-NOTE POO-1512: the gate is on the CRYPTO side (`buyOrderUsd`, the USD value of the
            // USDC this order must land), NOT on the method's fiat minimum. The fiat input currency
            // varies per buyer since POO-1512, so `methodMinUsd` (now in the buyer's own currency) is
            // no longer comparable to the USD constant `PAYBIS_MIN_USD`; the crypto side does not vary
            // and is the figure the app already reasons about (Rafael, 2026-08-10). The minimum is
            // surfaced when the order sits AT the app floor, the smallest order we place, where a
            // method's own minimum is what can still reject it; it stays informational, printed in its
            // own currency (buyMethodMinCurrency below).
            buyMethodMinUsd={
              buyRouteQuote.methodMinUsd !== undefined && buyOrderUsd <= PAYBIS_MIN_USD
                ? buyRouteQuote.methodMinUsd
                : undefined
            }
            buyMethodMinCurrency={buyRouteQuote.methodMinCurrency}
            onSelect={(kind) => {
              // POO-1541: one tap is the choice and the commitment at once ([R6]). `kind === recommended`
              // is `false` for `deposit` for free: `RecommendableRouteKind` excludes it, so the two can
              // never compare equal, which is the same "never followed" fact the picker used to spell
              // out explicitly.
              const recommended = recommendedRouteKind(routes) ?? "none";
              funnel.routeChosen({
                kind,
                recommended,
                followedRecommendation: kind === recommended,
              });
              // POO-1155: deposit-from-external-wallet is a handoff, not a plan. It navigates to the
              // launched web3 deposit surface (the same destination the blocked-gas escape and the cost
              // breakdown's peer option use), leaving the panel entirely.
              if (kind === "deposit") {
                router.push(BUY_CRYPTO_HREF);
                return;
              }
              setRouteChoice(kind);
              // POO-1503 [R3]: the case matrix routes a pure buy `1 -> Buy -> 7`, with no step 2 in
              // between, because there is nothing to choose: the on-ramp funds the whole requirement.
              // So this click IS the start. Clearing the selection is what makes it a pure buy, since
              // POO-1155 seeds target-chain holdings into it; `buildPlan` then emits the buy leg for the
              // full shortfall. The run still waits for the plan and for the price-impact gate, both in
              // the start effect above, so the click commits to a route rather than to a signature.
              if (kind === "buy") {
                setSelected([]);
                setStartRequested(true);
              } else {
                setPhase("sources");
              }
            }}
            onCancel={() => {
              // Premise 11: leaving without choosing is the abandonment signal for this screen, and it
              // is the only place it can be observed. The route count says what they walked away from.
              funnel.routeAbandoned(
                routes.filter((route) => CARD_ROUTE_KINDS.includes(route.kind)).length,
              );
              onCancel();
            }}
          />
        </div>
      );
    }

    /**
     * POO-1503 [R3] / POO-1047 [R1]: the funds-at-risk acknowledgement, and NOTHING else.
     *
     * This is the whole of what is left between the last choice and the signature, and it is reached
     * only when a start has been asked for and the quote came back at or past `>=10%` price impact. It is
     * not the Confirm screen wearing a different name: there is no plan card, no `You pay` block, no
     * itemisation, no back button and no second CTA to press in the ordinary case, because in the
     * ordinary case this screen does not exist at all. It is the POO-1011 alert, which has always been a
     * blocking exception rather than a step, finally rendered as one.
     *
     * Deleting the `plan` phase without this would have made the funding path the way around the gate
     * added after a poisoned thin-pool route turned $40 into $3, which is the specific outcome POO-1047
     * exists to prevent. The ghost returns to whichever screen the user came from, so refusing is always
     * possible: acknowledging is never the only way forward.
     */
    // `phase === "sources"` is what makes this a screen BEFORE the run rather than one over it: the CTA
    // moves the phase on, and without the guard the alert would still be rendering above the execution
    // surface it just started.
    if (view && phase === "sources" && startRequested && (impactGate.blocked || gateEngaged)) {
      return (
        <div className="flex flex-col gap-4" data-testid="provisioning-panel" data-phase="impact">
          {/* No heading and no MockBadge, deliberately. The gate is a `role="alert"` that carries its own
          title, so a second one above it would be a screen title for a screen that is an exception;
          and a fixture plan carries no price impact (POO-1047 [R3]), so mock mode never reaches here
          and has nothing to badge. */}
          <PriceImpactGate
            priceImpactPct={priceImpactPct}
            acknowledged={impactGate.acknowledged}
            onAcknowledgedChange={impactGate.setAcknowledged}
          />
          <StickyActionFooter>
            <Button
              data-testid="provisioning-confirm"
              className="w-full"
              size="lg"
              disabled={impactGate.blocked}
              onClick={startRun}
            >
              {t("provisioning.fundingSources.cta")}
            </Button>
            <Button
              variant="ghost"
              className="min-h-11 w-full"
              onClick={() => {
                // Withdraw the start request AND the engagement: without both, the effect above would
                // re-enter this screen the instant the user left it without acknowledging.
                setStartRequested(false);
                setGateEngaged(false);
                // POO-1135: a `buy` route never saw step 2 (it funds the whole requirement from the
                // on-ramp), so its ghost returns to "Where from". Clearing the choice re-shows the picker.
                if (routeChoice === "buy" && shouldPickRoute(routes)) {
                  setRouteChoice(null);
                  return;
                }
                if (canReturnToPicker) {
                  setPhase("sources");
                  return;
                }
                onCancel();
              }}
            >
              {canReturnToPicker
                ? t("provisioning.fundingSources.back")
                : t("provisioning.fundingSources.cancel")}
            </Button>
          </StickyActionFooter>
        </div>
      );
    }

    if (pickingSources) {
      // The labels' first paint, before the loop's first tick reports in: the full window, which is
      // exactly what the hosted hook holds at mount. Undefined with no plan, so no label renders.
      const fullWindowSeconds = plan ? Math.max(1, Math.round(plan.quote.ttlMs / 1000)) : undefined;
      const hostedQuoteSeconds = quoteSeconds ?? fullWindowSeconds;
      return (
        // POO-1109 [R5] Every phase root carries the same testid with a distinguishing `data-phase`,
        // so the harness waits on a state transition instead of on translated copy.
        <div className="flex flex-col gap-4" data-testid="provisioning-panel" data-phase="sources">
          {/* POO-1503 fix (#835): the freshness loop is hosted HERE, not inside the disclosure, so the
              TTL re-quote fires with `See details` closed, which is the default. Keyed on `quotedAt`
              (the `QuoteStatus` remount contract): a fresh quote restarts the window. */}
          {plan ? (
            <QuoteFreshnessLoop
              key={plan.quote.quotedAt}
              active={!planLoading}
              ttlMs={plan.quote.ttlMs}
              onRefresh={requotePlan}
              onTick={setQuoteSeconds}
            />
          ) : null}
          {quotedPlanFallsShort ? (
            <p
              className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
              role="status"
            >
              {t("provisioning.fundingSources.repriced", {
                amount: formatUsd(quotedShortfallUsd),
              })}
            </p>
          ) : null}
          {/* [R20] Back to step 1. Rendered only when the user actually CAME from step 1: in the
            crypto-only cut `resolveFundingRoutes` returns one route, the picker is skipped, and a
            back arrow would point at a screen that never existed.
            POO-1528: its final home, below `sm`, IS a mobile host's own header (Figma `7336:772`) —
            once `mobileHeaderMounted` says that header exists, this fallback goes quiet there
            (`sm:flex hidden`) rather than showing the same control twice. Above `sm` nothing
            changes: this stays the only back control on every host, upgraded or not. A host that
            has not adopted the header (`mobileHeaderMounted` absent/false) keeps it unconditional,
            exactly as before — which is why it now carries the M5.2 `min-h-11` itself (POO-1526
            deferred it here on the assumption the header would ALWAYS have replaced it; on those two
            hosts it never does, and a floor that depends on the host is not a floor). Its own row, so
            an explicit min-height and not an invisible hit area: an expanded box would reach into the
            16px gap the selector's gear expands into from below (M5.3). */}
          {routeChoice !== null ? (
            <button
              type="button"
              onClick={() => setRouteChoice(null)}
              className={cn(
                "-ml-1 flex min-h-11 w-fit items-center gap-1 rounded-md px-1 py-1 text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mobileHeaderMounted && "hidden sm:flex",
              )}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              {t("provisioning.fundingSources.back")}
            </button>
          ) : null}
          <FundingSourceSelector
            sources={context.sources}
            gasByChainId={context.gasByChain}
            targetChainId={context.targetChainId}
            // [R50] / POO-1499 D9: the disclosure interpolates the rate from the constant, so no
            // locale hard-codes a percentage that the server will eventually set.
            bufferPct={Math.round(bufferRate * 100)}
            // [R17] The host's dialog, opened from step 2's gear. Absent, no gear renders.
            {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
            // POO-1155: with the on-ramp available a short (or empty) selection still proceeds — Continue
            // buys the remainder rather than blocking, which is what made the greyed row fatal. In the
            // crypto-only cut (`onRampEnabled` false) the original coverage gate stands.
            allowShortfall={onRampEnabled}
            // POO-1166: with the on-ramp on, the header denominator is the operation's FULL requirement —
            // the liquidity the user asked for — and it never moves as the selection changes. It is
            // deliberately NOT `sourcesMustCoverUsd` here: on a buy route that figure nets the card's
            // share out (`totalPayUsd - buyCoverageUsd`) and so shrinks toward whatever the selection
            // covers, which produced "$34.68 of $34.89, $0.21 still to go" on a $100 deposit. The buy
            // funds the remainder, so the sources are measured against the pure requirement.
            //
            // POO-1641: the buy no longer carries a fee headroom over this figure, so the amount the
            // planner ORDERS and the "still to go" shown here are now the same number. What the user
            // is CHARGED can still exceed both, because that is Paybis's own quoted charge in their
            // own currency, which is a charge rather than a requirement and comes from the rail.
            //
            // The crypto-only cut is UNCHANGED (POO-1042 [R7]): there is no buy leg, so
            // `sourcesMustCoverUsd` equals the quoted `totalPayUsd` and does NOT shrink — it is the honest
            // re-pick figure the sources alone must cover, and the seed opens the CTA before it exists.
            requiredUsd={
              onRampEnabled
                ? input.opRequiredUsdc
                : quotedPlanFallsShort
                  ? sourcesMustCoverUsd
                  : seededRequiredUsd
            }
            // POO-1503 [R18]: the step plan and the `You pay` block, behind `See details`. This is where
            // the Confirm screen's contents went, and the disclosure hides only the HOW: the total the
            // selector prints above stays visible while it is collapsed. Absent until a plan exists,
            // which is what the eager quote above is for.
            {...(view && plan
              ? {
                  details: (
                    <div className="flex flex-col gap-4">
                      <ProvisioningPlanCard view={view} opLabel={opLabel} />
                      <ProvisioningCostBreakdown
                        plan={plan}
                        onRequote={requotePlan}
                        requoting={planLoading}
                        // POO-1503 fix (#835): display-only. The freshness loop is the panel's, above,
                        // so the card runs NO timer of its own here: two countdowns over one quote
                        // would disagree and would each fire their own re-quote.
                        {...(hostedQuoteSeconds === undefined
                          ? {}
                          : { countdownSeconds: hostedQuoteSeconds })}
                        buyAmountUsd={buyRouteQuote.chargeUsd}
                        buyAmountCurrency={buyRouteQuote.chargeCurrency}
                      />
                    </div>
                  ),
                }
              : {})}
            // POO-1503: `Refreshes in {seconds}` at the top of the step, beside the gear. It moved off
            // the Confirm screen with everything else, and it is the one thing on it that had to stay
            // VISIBLE rather than go behind the disclosure: a price with a deadline the user cannot see
            // is a price they will be surprised by. The seconds are the hosted loop's own ticking
            // figure, the same one the breakdown's status line displays, so one quote is never
            // described by two countdowns that disagree.
            {...(hostedQuoteSeconds === undefined
              ? {}
              : { quoteSeconds: hostedQuoteSeconds, requoting: planLoading })}
            // POO-1528: forwarded verbatim. `FundingSourceSelector` decides for itself what to hide
            // below `sm` on the strength of the SAME prop name and the SAME default (`false`,
            // changes nothing) — this panel does not interpret it, only relays it.
            mobileHeaderMounted={mobileHeaderMounted}
            selected={selected}
            onSelectedChange={(next) => {
              // POO-1503 fix (#835): a changed selection INVALIDATES any pending consent. The start
              // intent and the gate latch are answers to the PREVIOUS selection's quote, and
              // `useProvisioningPlan` keeps that stale plan mounted while the re-quote runs, so a
              // surviving `startRequested` would fire the start effect against a route the user just
              // walked away from. Main did this structurally (`onSelectedChange` cleared
              // `confirmedSelection`); with the Confirm gone, the clearing is explicit.
              setStartRequested(false);
              setGateEngaged(false);
              setSelected(next);
            }}
            onConfirm={() => {
              // POO-1048 [R1] What the user committed to, in count and in USD. The totals come from
              // the same micro-dollar helper the CTA gates on, so the funnel and the screen agree.
              funnel.sourcesSelected({
                count: selected.length,
                usd: fundingProgress(reachableSources, selected, 0).selectedUsd,
              });
              // POO-1503 [R19]: this signs. What it does NOT do is open a screen: the start effect above
              // takes over and runs as soon as the plan and the funds-at-risk gate allow.
              setStartRequested(true);
            }}
          />
          {/* POO-1503: `provisioning.plan.*` stops being RENDERED on desktop, and the keys stay put
            because `plan.title` is the DialogTitle of six modals outside this flow. Step 2 has its
            own `cancel`, which is the same word from the screen that owns it. */}
          <Button variant="ghost" className="min-h-11 w-full" onClick={onCancel}>
            {t("provisioning.fundingSources.cancel")}
          </Button>
        </div>
      );
    }

    if (phase === "pending") {
      // POO-1507 [R29]: the same three facts every time — computed here, once, rather than inside the
      // conditional below, so `requestClose` and the JSX read the identical numbers.
      const stopSettled = settledSafe(view?.rows ?? []);
      const stopPosition = currentStepPosition(view?.rows ?? []);
      const stopRemaining = remainingStepsLabel(view?.rows ?? []);
      // POO-1505 [R30]/[R32]: the buy step's mini summary reads the SAME position and progress
      // fraction the carousel's own bar uses ([R23]), computed once here for the same reason as above.
      const buyPosition = onRampBuy ? currentStepPosition(view?.rows ?? []) : null;
      const buyProgress = onRampBuy ? progressFraction(view?.rows ?? []) : 0;
      // POO-1568 [R1]: the row the carousel's window is showing — the leg in flight, or the last one
      // that ran once everything has settled. Resolved from the SAME `currentStepPosition` the window
      // itself uses, so the footer's explorer link below can never point at a different leg than the
      // step named directly above it.
      const currentStepRow = stopPosition
        ? view?.rows.find((row) => row.key === stopPosition.key)
        : undefined;
      // [R29] "will finish on its own" is only true of a step that has BROADCAST. The row's `txHash`
      // is that fact: a value-moving leg's hash is reported the instant it broadcasts (`legHashes`,
      // [R2]) and rides the row. A step still building, or sitting in the user's wallet waiting for
      // a signature, has no hash, and nothing about it finishes on its own — so it gets the other
      // body, which says nothing has moved and to decline any signature request still open. An
      // approval mid-broadcast also lands there (the rail only reports LEG hashes in flight), and
      // "has not moved any funds yet" stays true of it: an approval moves nothing.
      const stopCurrentBroadcast = Boolean(currentStepRow?.txHash);
      // POO-1508 [R43] rules v2: computed once here for the same reason as the three facts above.
      const bufferExceeded = txError?.code === PROVISIONING_BUFFER_EXCEEDED_CODE;
      /**
       * POO-1927 [R1]: whether the PAYBIS method step is on screen, which needs the rail and not
       * only a pending choice.
       *
       * `methodChoice` alone was safe by construction rather than by rule: only the Paybis branch of
       * `runOnRampBuy` ever sets it, because the Privy branch returns before that line. Privy's own
       * modal owns method selection, so on that rail this step must not exist, and stating the
       * condition here is what makes it true of the MOUNT rather than of one code path. The effect
       * above resolves the stranded choice; this is what keeps the step off screen meanwhile.
       */
      const methodStepUp = methodChoice !== null && onRampRail !== "privy";
      return (
        <div className="flex flex-col gap-4" data-testid="provisioning-panel" data-phase="pending">
          {/* POO-1576: the method step owns the screen's heading while it is up ("Choose how to
            pay"), so this one yields rather than stacking a second title above a question. Every
            other `pending` state keeps it exactly as before. */}
          {methodStepUp ? null : (
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-lg">
                {t("provisioning.exec.title")}
              </h3>
              {/* POO-807 R1: the mock-mode indicator on the execution view. It used to arrive with
                `WalletSteps`, which carried its own; mounted here now that the card is the surface. */}
              <MockBadge />
            </div>
          )}
          {/* POO-1576: the step between the buy amount and the vendor checkout. It replaces the
            carousel and the state footer while it is up, for the same reason the checkout itself
            does (POO-1527 [M4.3]): the screen asking the question owns the one primary action. */}
          {methodStepUp && methodChoice ? (
            <OnRampMethodStep
              containerRef={methodStepRef}
              rows={methodRows}
              loading={buyRouteQuote.methodsLoading}
              {...(buyRouteQuote.currencyCodeFrom
                ? { currencyCode: buyRouteQuote.currencyCodeFrom }
                : {})}
              {...(supportedCurrencies ? { currencies: supportedCurrencies } : {})}
              onCurrencyChange={chooseMethodCurrency}
              {...(selectedMethod ? { value: selectedMethod } : {})}
              onSelect={setMethodSelection}
              // POO-1129 D3: a refused activation is REPORTED and never stored. Routing it through
              // `setMethodSelection` would park an identifier in state that can never be the value.
              onBlockedSelect={(paymentMethod) =>
                reportMethodBlocked(methodRows.find((row) => row.id === paymentMethod))
              }
              onContinue={() => {
                funnel.methodChosen({
                  ...(selectedMethod ? { method: selectedMethod } : {}),
                  count: methodRows.length,
                });
                methodChoice.decide({
                  kind: "continue",
                  ...(selectedMethod ? { paymentMethod: selectedMethod } : {}),
                  // POO-1621 defect 1 / CR-CORE-023: the currency the LIST was resolved for, so the
                  // mint stops resolving its own. `resolveWidgetPrefill` re-resolves from scratch on
                  // a received-fixed order, and two resolutions seconds apart can disagree across a
                  // cache expiry - printing one currency on this screen and billing another. It is
                  // the SERVER's echo and never the buyer's proposal, so a refused choice reaches
                  // the widget as the currency the buyer was actually shown.
                  ...(buyRouteQuote.currencyCodeFrom
                    ? { currencyCodeFrom: buyRouteQuote.currencyCodeFrom }
                    : {}),
                });
              }}
              onCancel={() => {
                funnel.methodAbandoned(methodRows.length);
                methodChoice.decide({ kind: "cancel" });
              }}
            />
          ) : null}
          {/* POO-1043 [R8] The price moved against the user between approving the route and signing this leg,
            which is STRUCTURAL here rather than exceptional: every leg is re-quoted at execution time
            from the balance the previous one really produced. Nothing has been signed yet, so both
            answers are safe, and the leg is held until one of them arrives. */}
          {/* POO-1384 [R15]: the in-flight purchase we cannot verify. Asked, never assumed.
            `paidAt` records what we OBSERVED, and money moves without us observing it: a bank
            transfer, where the user leaves for their banking app long before `completed`; a 3DS
            redirect, which unloads the page and its listener; a dismissal mid-checkout, which this
            same release now permits; or a fifth parser drift on a channel that has silently dropped
            events in four prior releases. Resuming blind reopens an id Paybis may have expired (the
            "Session timed out" dead end); minting blind opens a SECOND purchase beside funds that may
            still be landing (the double charge). Only the user knows which, so the user is asked.
            Nothing is signed and no widget is open at this point, so both answers are safe. */}
          {resumePrompt ? (
            <div
              ref={resumePromptRef}
              role="alertdialog"
              aria-labelledby="provisioning-resume-title"
              aria-describedby="provisioning-resume-body"
              tabIndex={-1}
              className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 focus-visible:outline-none"
            >
              <p id="provisioning-resume-title" className="font-semibold text-sm text-warning">
                {t(
                  resumePrompt.paid
                    ? "provisioning.onramp.resume.paidTitle"
                    : "provisioning.onramp.resume.title",
                )}
              </p>
              <p id="provisioning-resume-body" className="text-muted-foreground text-sm">
                {t(
                  resumePrompt.paid
                    ? "provisioning.onramp.resume.paidBody"
                    : "provisioning.onramp.resume.body",
                  {
                    minutes: Math.max(
                      1,
                      Math.round((Date.now() - resumePrompt.startedAt) / 60_000),
                    ),
                  },
                )}
              </p>
              <div className="flex flex-col gap-2">
                <Button className="min-h-11 w-full" onClick={() => resumePrompt.decide("resume")}>
                  {t(
                    resumePrompt.paid
                      ? "provisioning.onramp.resume.keepWaiting"
                      : "provisioning.onramp.resume.resume",
                  )}
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11 w-full"
                  onClick={() => resumePrompt.decide("new")}
                >
                  {t("provisioning.onramp.resume.startNew")}
                </Button>
              </div>
            </div>
          ) : null}
          {/* POO-1508 [R43]/[R56] rules v2: the run's shared price-move buffer was exceeded, so this
            leg was never sent. `Try again` re-fetches a fresh quote and retries THIS leg only — legs
            already settled earlier in the run are untouched, this is not a full plan re-derivation.
            [R55]: no tinted fill; colour lives only on the title sentence that names what happened. */}
          {txError?.code === PROVISIONING_BUFFER_EXCEEDED_CODE ? (
            <div
              ref={bufferExceededRef}
              role="alertdialog"
              aria-labelledby="provisioning-buffer-title"
              aria-describedby="provisioning-buffer-body"
              tabIndex={-1}
              className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3 focus-visible:outline-none"
            >
              <p id="provisioning-buffer-title" className="font-semibold text-sm text-warning">
                {t("provisioning.requote.title")}
              </p>
              <p id="provisioning-buffer-body" className="text-muted-foreground text-sm">
                {/* [R56]: the buffer's OWN reserved percentage, not this leg's specific movement — the
                  user was told before broadcasting anything that up to this much could be absorbed;
                  this screen only appears once that reserve is spent. */}
                {t("provisioning.requote.body", {
                  pct: Math.round(bufferRate * 100),
                })}
              </p>
              <div className="flex flex-col gap-2">
                <Button
                  className="min-h-11 w-full"
                  onClick={() => {
                    setTxError(null);
                    void flow.retryFrom("build");
                  }}
                >
                  {t("provisioning.requote.accept")}
                </Button>
                <Button variant="ghost" className="min-h-11 w-full" onClick={onCancel}>
                  {t("provisioning.requote.decline")}
                </Button>
              </div>
            </div>
          ) : null}
          {/**
           * POO-1507 [R29]: the ONE confirmation in this flow. Named exactly three things — what
           * already settled and is safe, what the running step will finish on its own, and what will
           * not start — because the middle one is the fact a user needs to NOT re-send money they
           * already sent, and it is the one a shorter version always drops first.
           *
           * [D6] No `X` here: `keepGoing`/`stopAnyway` are the only two exits, deliberately, so a
           * dismiss attempt while this is open (including a repeat `Esc`) resolves the question via
           * `requestClose` rather than opening a second way out.
           */}
          {stopConfirmOpen ? (
            <div
              ref={stopConfirmRef}
              role="alertdialog"
              aria-labelledby="provisioning-stop-title"
              aria-describedby="provisioning-stop-body"
              tabIndex={-1}
              className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 focus-visible:outline-none"
            >
              <p id="provisioning-stop-title" className="font-semibold text-sm text-warning">
                {t("provisioning.exec.stop.title")}
              </p>
              <div
                id="provisioning-stop-body"
                className="flex flex-col gap-1 text-muted-foreground text-sm"
              >
                {/* [R10]'s "never a guess" rule applies here too: nothing settled yet renders no line
                  at all, rather than a false `$0.00 already went through`. */}
                {stopSettled.kind === "amount" ? (
                  <p>
                    {t("provisioning.exec.stop.settled", { amount: formatUsd(stopSettled.usd) })}
                  </p>
                ) : stopSettled.kind === "unknown" ? (
                  <p>{t("provisioning.exec.settledSafeUnknown")}</p>
                ) : null}
                {stopPosition ? (
                  <p>
                    {stopRemaining
                      ? t(
                          stopCurrentBroadcast
                            ? "provisioning.exec.stop.body"
                            : "provisioning.exec.stop.bodyNotSent",
                          {
                            index: stopPosition.index,
                            total: stopPosition.total,
                            restCount: stopRemaining.count,
                            rest: stopRemaining.label,
                          },
                        )
                      : t(
                          stopCurrentBroadcast
                            ? "provisioning.exec.stop.bodyLastStep"
                            : "provisioning.exec.stop.bodyNotSentLastStep",
                          {
                            index: stopPosition.index,
                            total: stopPosition.total,
                          },
                        )}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Button className="min-h-11 w-full" onClick={keepGoing}>
                  {t("provisioning.exec.stop.keepGoing")}
                </Button>
                <Button variant="ghost" className="min-h-11 w-full" onClick={stopAnyway}>
                  {t("provisioning.exec.stop.stopAnyway")}
                </Button>
              </div>
            </div>
          ) : null}
          {/* POO-1506 [R38] (`8a`): the FIRST slippage failure auto-retries from the build step, and the
            modal stays right here — this notice is the only thing that says so, while the carousel
            underneath keeps showing the same step re-running. Not a `role="alertdialog"` like the
            prompts above: nothing is being asked, there is nothing to answer. */}
          {slippageRetry.autoRetrying ? (
            <p className="rounded-xl bg-warning/10 px-4 py-3 text-center text-sm text-warning">
              {t("flow.slippage.retryNotice", { value: slippageRetry.slippagePct })}
            </p>
          ) : null}
          {/* POO-1504 [R21]: ONE step visible at a time, in a clipping vertical carousel, with the whole
            list one tap away. This replaces the plan card in `running` mode (POO-1088 [F5-R1]) and the
            reason is P46: four step bodies on screen at once reads as difficulty, and difficulty read
            at a glance is abandonment. What POO-1041 [R6] established is untouched, because the
            carousel reads the SAME key-matched `PlanView` rows, so it still cannot light up a step
            other than the one the rail is running, and the per-leg explorer link and bridge ETA still
            ride on the rows they describe.
            POO-1506 [R37]/[R39] (`8b`): hidden on the SECOND slippage failure, which replaces it with
            the raise prompt below rather than layering a question over a list still mid-run.
            POO-1508 [R43]: hidden when the run's buffer was exceeded too, for the same reason.
            POO-1505 [R30]: hidden while the buy step is up too, replaced by the mini summary below —
            the same "one thing at a time" reason `8b` already hides it for. */}
          {view &&
          !slippageRetry.slippageError &&
          !bufferExceeded &&
          !onRampBuy &&
          !methodChoice ? (
            /* The wrapper exists for the ref alone (the carousel forwards none): it is what lets
               `runOnRampBuy` ask "was focus in here?" the instant before the buy step unmounts it. */
            <div ref={carouselRegionRef}>
              <ExecutionCarousel
                view={view}
                opLabel={opLabel}
                // POO-1508 [R48]/[R59]: quiet text, not a bordered button — the flow abstracts chains
                // away, and a bordered CTA pointing at a block explorer contradicts that on every row,
                // not only the settling screens.
                //
                // POO-1568 [R1], second half (Rafael, 2026-08-13): the CURRENT step is skipped here,
                // because the footer below already carries its link. Expanding the list used to put
                // the running leg's `View on explorer` on screen TWICE, once in its own row and once
                // under the state button, pointing at the identical transaction. The footer link is
                // the unconditional one and this is the copy that yields, so the leg in flight has
                // its link in exactly one place whatever the list is doing. Every other row keeps
                // its own, which is the whole point of POO-1037 [R2]: a leg that settled two steps
                // ago is verifiable only from the list.
                //
                // The suppression reads `currentStepRow`, the SAME lookup the footer link renders
                // from, so the two cannot disagree about which leg is current and drop the link from
                // a row the footer is not covering.
                rowLink={(row) =>
                  row.explorerNetwork && row.txHash && row.key !== currentStepRow?.key ? (
                    <ExplorerTxLink
                      network={row.explorerNetwork}
                      hash={row.txHash}
                      variant="text"
                    />
                  ) : null
                }
                // [R26] `What am I signing?` only when the step needs a WALLET signature, and below the
                // window so carousel rows keep one height. Never for the fiat buy: the user is in the
                // vendor's card form and no signature of ours is pending (POO-1136).
                {...(activeRow && activeRow.type !== "buy"
                  ? {
                      disclosure: (
                        <SigningDisclosure
                          why={
                            activeRow.isApproval && activeRow.tokenSymbol
                              ? {
                                  name: t("sign.explain.approve.name"),
                                  body: t("sign.explain.approve.body", {
                                    token: activeRow.tokenSymbol,
                                  }),
                                }
                              : {
                                  name: t("sign.explain.confirm.name"),
                                  body: t("sign.explain.confirm.body"),
                                }
                          }
                        />
                      ),
                    }
                  : {})}
              />
            </div>
          ) : null}
          {/* POO-1505 [R30]/[R32]: the buy step's mini summary, replacing the step list while the vendor
            checkout takes the space it frees ([R30]). One line: a liveness spinner (the carousel's own
            [R57] convention, reused rather than re-invented), `Buying {token}`, the amount, and
            `Step N of M`, with the SAME [R23] progress fraction the carousel's bar uses, on the
            summary's own top edge per spec. It appears in place — no enter animation — which is why
            it carries no transition classes. `tabIndex={-1}` is where the collapse effect above lands
            focus when the carousel unmounted while holding it. */}
          {onRampBuy && view ? (
            <div
              ref={buySummaryRef}
              tabIndex={-1}
              className="flex flex-col gap-2 focus-visible:outline-none"
              data-testid="provisioning-buy-mini-summary"
            >
              <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300"
                  style={{ width: `${Math.round(buyProgress * 100)}%` }}
                />
              </div>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-5 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
                />
                <p className="min-w-0 flex-1 truncate text-foreground text-sm">
                  {activeRow ? t("provisioning.stepsRunning.buy", labelValues(activeRow)) : null}
                  {activeRow?.amountUsd !== undefined ? ` · ${formatUsd(activeRow.amountUsd)}` : ""}
                </p>
                {buyPosition ? (
                  <p className="shrink-0 text-muted-foreground text-xs">
                    {t("sign.stepOf", { current: buyPosition.index, total: buyPosition.total })}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          {/* POO-1506 [R39]/[R40] (`8b`): the SECOND slippage failure of this run. Not a `role="alertdialog"`
            focus-trap like the resume and buffer-exceeded prompts above: nothing interrupted the user
            out of nowhere here, they are already looking at this exact screen when it fails a second
            time. */}
          {slippageRetry.slippageError ? (
            <div className="flex flex-col gap-4" data-testid="provisioning-slippage-raise">
              <div>
                <p className="font-semibold text-foreground text-lg">
                  {t("flow.slippage.errorTitle")}
                </p>
                <p className="mt-1 text-muted-foreground text-sm">
                  {t("flow.slippage.errorBody", { value: slippageRetry.slippagePct })}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {/* [R40] the current value and one step below it are shown for context — this is what
                    just failed — never as alternate choices: raising is the only path this screen
                    offers, so only the suggested (one step up) pill is interactive. */}
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  {t("invest.settings.slippageLabel")}
                </p>
                {/* `formatPercent` takes an already-percent value (`7.4` → "7.4%") — never divide by
                    100 here. One decimal, because tolerances are allowed one (a custom 2.5% failure
                    must not print pills reading 2% / 3% while the CTA applies 3.5). */}
                <div className="flex gap-2">
                  <span className="flex-1 rounded-full border border-border px-3 py-2.5 text-center text-muted-foreground text-sm">
                    {formatPercent(Math.max(0, slippageRetry.slippagePct - 1))}
                  </span>
                  <span className="flex-1 rounded-full border border-border px-3 py-2.5 text-center text-foreground text-sm">
                    {formatPercent(slippageRetry.slippagePct)}
                  </span>
                  <span className="flex-1 rounded-full border border-primary bg-primary px-3 py-2.5 text-center font-semibold text-primary-foreground text-sm">
                    {formatPercent(suggestedSlippagePct)}
                  </span>
                  {/* [R40]'s only other real action: the full custom range, via the SAME dialog step 2's
                      gear already opens ([R17] scopes "nowhere else" to before execution — this is
                      during it, and reusing the one existing custom-slippage input beats a second one).
                      A committed value re-targets the CTA below (see `customSlippagePct`). Only when
                      the host wired the dialog: without `onOpenSettings` the pill would be a button
                      that does nothing. */}
                  {onOpenSettings ? (
                    // [M5.1] This pill matches 3 non-interactive sibling pills of the same visual
                    // height, so the 44pt target is an invisible expanded hit area (POO-840 R2),
                    // not a taller box that would break the row's alignment.
                    <Button
                      variant="ghost"
                      className="relative flex-1 rounded-full border border-border px-3 py-2.5 text-muted-foreground text-sm after:absolute after:-inset-3.5 after:content-['']"
                      onClick={onOpenSettings}
                    >
                      {t("invest.settings.custom")}
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                {t("provisioning.slippage.raiseCost")}
              </p>
            </div>
          ) : null}
          {/* POO-1136: the embedded Paybis widget, mounted while the `buy` step is settling. It reports
            the observed delta ([R4]) or a terminal state; the buy step's `runOnRampBuy` promise is
            what resolves. Mock mode gates the frame off internally (there is no SDK behind it).
            POO-1505 [R32]: gated on `buyIframeReady` too, so the iframe mounts only once the mini
            summary's expand animation has settled and never reflows the checkout mid-load. */}
          {/* POO-1808 [R2]: the second rail's buy step, in the slot the frame occupies for Paybis. It
            owns the whole purchase (baseline, coverage, checkout, observation) and settles the same
            `runOnRampBuy` promise the frame settles on the other rail. */}
          {/* POO-1808 [R7]: `buyerCurrency` is the SERVER-resolved one, the same echo the Paybis
            method step reads (`buyRouteQuote.currencyCodeFrom`, POO-1512's ONE resolution per
            flow), never `order.fiatCurrency`, which the planner writes as a constant "USD". The
            step refuses a currency the rail cannot charge in rather than defaulting it, and falls
            back to USD only where no resolution arrived at all. `analytics` uses the same
            `operation.kind` conversion boundary the funnel and the impact gate use, so the step's
            blocked intents carry the flow they belong to (premise 11). */}
          {privyBuy ? (
            <ConnectedPrivyBuyStep
              order={privyBuy.order}
              {...(buyRouteQuote.currencyCodeFrom
                ? { buyerCurrency: buyRouteQuote.currencyCodeFrom }
                : {})}
              analytics={{
                ...(operation?.kind ? { flow: PROVISIONING_OP_TO_FLOW[operation.kind] } : {}),
                ...(operation?.strategyId ? { strategyId: operation.strategyId } : {}),
              }}
              onSettled={() => privyBuy.settle()}
              onFailed={(error) => privyBuy.fail(error)}
            />
          ) : null}
          {onRampBuy && buyIframeReady ? (
            <PaybisWidgetFrame
              requestId={onRampBuy.requestId}
              expectedToken={onRampBuy.expectedToken}
              // [R7] The journal seam. Without the wallet the frame's `open()` records nothing, and a
              // tab that dies in the paid-but-not-landed window leaves no in-flight intent: the reload
              // then mints a FRESH requestId while the first purchase's funds are still moving, which
              // is the double charge PP-CORE-LIB-067 exists to prevent.
              wallet={onRampBuy.wallet}
              onSettled={() => onRampBuy.settle()}
              onTerminal={(status, reason) => onRampBuy.fail(onRampTerminalError(status, reason))}
            />
          ) : null}
          {/* POO-1504 [R27]: the bottom button IS the run's state. `Processing` with cycling dots and
            disabled while the rail is working, `Done` and enabled once every leg has settled (`7f`).
            It is the ONLY thing on this screen that changes what pressing does, which is why it says
            what the run is rather than what the user should do.

            The completion itself is NOT this click: `funnel.planCompleted`, the journal close and the
            balance refresh all fire from the flow-status effect on SETTLEMENT (premise 11, POO-1048
            [R3]). What the press does is hand the operation back to its host, so the user sees the
            funding finish before their modal moves on.
            POO-1506 [R39]: hidden on the SECOND slippage failure, whose own actions (`Raise to {pct}%
            and retry` / `Stop here`) take this slot instead — a state button reading `Processing…`
            underneath a screen asking the user to decide something would be two conflicting messages.
            POO-1508 [R43]: hidden when the run's buffer was exceeded too, for the same reason — the
            buffer prompt carries its own `Try again` / `Stop` actions inline.
            POO-1525: "take this slot" is literal. Both footers render HERE, as the phase root's last
            child, never inside the `8b` card: `position: sticky` cannot escape its containing block,
            so a footer nested in the ~350px raise card could only pin within that card, not to the
            sheet bottom. One bottom element either way.
            POO-1527 [M4.3]: the WHOLE pinned footer is gone during the buy step, and for a stronger
            reason than the two above — the checkout mounted above OWNS the primary action, and a
            pinned "Processing…" / "Done" button below it would be a second primary CTA on screen at
            once, which P1 forbids outright. Tested first, so neither footer can slip back in: the
            `8b` branch is unreachable during a buy (the buy step is not a swap leg and cannot raise
            a slippage error), so this only ever removes the state button, and it returns the instant
            the buy step ends — the mini summary and this footer are mutually exclusive on the same
            `onRampBuy` boolean. */}
          {onRampBuy || methodChoice ? null : slippageRetry.slippageError ? (
            <StickyActionFooter>
              {/* The committed custom value gets its own copy: `Raise to {pct}%` would be a lie for
                  a custom target below the tolerance that just failed, and the custom path is the
                  user's own number rather than this screen's suggestion either way. */}
              <Button
                className="min-h-11 w-full"
                onClick={() => raiseSlippageAndRetry(suggestedSlippagePct)}
              >
                {customSlippagePct !== undefined
                  ? t("provisioning.slippage.customCta", { pct: suggestedSlippagePct })
                  : t("provisioning.slippage.raiseCta", { pct: suggestedSlippagePct })}
              </Button>
              <Button variant="ghost" className="min-h-11 w-full" onClick={onCancel}>
                {t("provisioning.slippage.stop")}
              </Button>
            </StickyActionFooter>
          ) : bufferExceeded ? null : (
            <StickyActionFooter>
              <Button
                data-testid="provisioning-exec-state"
                className="w-full"
                size="lg"
                disabled={!runFinished}
                onClick={() => onDoneRef.current()}
              >
                {runFinished ? (
                  t("provisioning.exec.stateDone")
                ) : (
                  <ProcessingDots label={t("provisioning.exec.stateProcessing")} />
                )}
              </Button>
              {/* POO-1568 [R1]: the running leg's explorer link, AFTER the state button and inside the
                same footer, so it reads as that button's own secondary action. It used to render in
                the carousel's slot, which sits above this footer, and Murilo's live-QA screenshot is
                what that looks like: a bare underlined line floating over the primary CTA. The
                `ghost` variant is why it can sit here at all — the bordered `button` variant would
                be a second CTA competing with `Done`, and `text` is the loose line just removed.
                Renders nothing on its own when the current step has no hash to link (a step still
                building, or waiting in the wallet), which is `ExplorerTxLink`'s no-fake-data rule
                rather than a condition this call site has to restate. Deliberately UNCONDITIONAL
                otherwise: the expanded list's copy of this same link is the one that yields (see
                `rowLink` above), so the leg in flight has its link here whether the list is open or
                shut, and the user never has to expand anything to find it. */}
              <ExplorerTxLink
                network={currentStepRow?.explorerNetwork}
                hash={currentStepRow?.txHash}
                variant="ghost"
              />
              {/* [R28] / [F5-R3] Every leg needs a signature, so leaving is how a route strands halfway,
                and the line sits under the state button rather than under the list. Gone once the run
                has finished: there is nothing left to keep open for. (The buy-step suppression this
                comment used to document is now moot: the whole footer is gone during buy, per M4.3
                above, not just this line.)
                Last in the footer, below POO-1568's link: this is a caption for the whole pinned
                block, and the two controls above it are the primary action and its secondary one. */}
              {runFinished ? null : (
                <p className="text-center text-muted-foreground text-xs">
                  {t("provisioning.exec.keepOpen")}
                </p>
              )}
            </StickyActionFooter>
          )}
        </div>
      );
    }

    // [R3] Still settling: the funds left, they have not landed, and we stopped watching. Never framed
    // as a failure, never as a success, and never offering the retry that would re-broadcast it. The
    // explorer link is the honest answer to "is my money actually moving": it points at the SOURCE
    // chain, which is where the transaction we hold a hash for exists.
    if (phase === "settling") {
      // POO-1136: a fiat purchase that has not landed says so about a PURCHASE, not a bridge, and has no
      // source-chain hash to link (the payment was a card charge inside the widget).
      const fiatSettling = txError?.code === ONRAMP_SETTLING_CODE;
      const sourceChainId =
        activePlanStep?.leg?.chainId ?? activePlanStep?.chainId ?? activePlanStep?.fromChainId;
      return (
        <TransactionStatus
          testId="provisioning-settling"
          phase="pending"
          title={t(
            fiatSettling
              ? "provisioning.onramp.settlingTitle"
              : "provisioning.bridge.settlingTitle",
          )}
          body={t(
            fiatSettling ? "provisioning.onramp.timedOut" : "provisioning.bridge.settlingBody",
          )}
        >
          {/* POO-1508 [R48]/[R59]: a quiet TEXT link, below the primary Close, not a bordered button
            above it. The flow abstracts chains away; a bordered CTA pointing at a block explorer most
            users cannot read contradicts that, and it stays reachable for the ones who can. */}
          <Button variant="ghost" className="min-h-11 w-full" onClick={onCancel}>
            {t("provisioning.bridge.settlingClose")}
          </Button>
          {fiatSettling ? null : (
            <ExplorerTxLink
              network={sourceChainId === undefined ? undefined : apiNetworkForChain(sourceChainId)}
              hash={txError?.txHash}
              variant="text"
              className="mx-auto"
            />
          )}
        </TransactionStatus>
      );
    }

    /**
     * [F5-R5]/[F5-R6]/[F5-R7] Step failed (Figma `6550:703`): the same card, stopped where it stopped.
     *
     * The cause is on the ROW that carries it, with the plan's own figures ([F5-R6]), so the headline
     * is free to answer the only question that matters at this moment: what happened to my money.
     */
    if (phase === "error") {
      // The failed row by its DISPLAY index, which is what the badge column shows. Counting the plan's
      // own steps instead would drift the moment the rail inserts an approval row.
      const failedRow = view?.rows.find((row) => row.status === "error");
      const settled = settledSafe(view?.rows ?? []);
      /**
       * What a failed BUY row says, by cause.
       *
       * POO-1573 [R5]: an ETH order that could not be priced never opened at all, so it gets its own
       * sentence rather than "did not go through".
       *
       * POO-1808 [R7]: the Privy rail adds three more, and they are here rather than only in the
       * step because the step's own copy is unmountable. Its `onFailed` rejects the leg in the same
       * React batch that would have painted the refusal, so this screen is what the buyer actually
       * reads. All three are FACTS about what can be bought (this rail sells no native coin, nobody
       * will sell here today, we cannot charge in your money) rather than failures of an attempt,
       * which is why none of them uses the generic body whose promise is "you can try again". The
       * currency the two currency-bearing sentences name is the SERVER-resolved one, the same value
       * the step is given.
       */
      const buyCurrency = (buyRouteQuote.currencyCodeFrom ?? "USD").toUpperCase();
      const buyFailureBody =
        txError?.code === ONRAMP_ETH_UNPRICED_CODE
          ? t("provisioning.onramp.ethUnpricedBody")
          : txError?.code === ONRAMP_NATIVE_UNAVAILABLE_CODE
            ? t("provisioning.onramp.nativeUnavailable")
            : txError?.code === ONRAMP_UNCOVERED_CODE
              ? t("provisioning.onramp.uncovered", { currency: buyCurrency })
              : txError?.code === ONRAMP_CURRENCY_UNSUPPORTED_CODE
                ? t("provisioning.onramp.currencyUnsupported", { currency: buyCurrency })
                : t("provisioning.onramp.failedBody");
      return (
        <div className="flex flex-col gap-4" data-testid="provisioning-error" data-phase="error">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-lg">
                {failedRow
                  ? t("provisioning.exec.failedTitle", { index: failedRow.index })
                  : t("flow.error.title")}
              </h3>
              {/* POO-807 R1: previously inherited from `TransactionStatus`; mounted explicitly now. */}
              <MockBadge />
            </div>
            {/* [F5-R5] What already settled and is safe, or nothing at all. Never a `$0.00` and never
              a guess (parent [R10]): `settledSafe` returns `unknown` rather than a total it cannot
              substantiate. With nothing settled the line is the kind-aware body instead, which says
              the same "no funds were moved" AND names the cause, so classifying the failure still
              buys the user something on this screen. */}
            <p className="mt-1 min-w-0 break-words text-muted-foreground text-sm">
              {settled.kind === "amount"
                ? t("provisioning.exec.settledSafe", { amount: formatUsd(settled.usd) })
                : settled.kind === "unknown"
                  ? t("provisioning.exec.settledSafeUnknown")
                  : // POO-1136: a fiat purchase that did not complete moved no funds; its own copy says so
                    // in the on-ramp's own terms, rather than the generic wallet-transaction body.
                    // POO-1573 [R5] (rules v2): one cause gets its own sentence, because the buy never
                    // opened at all. The mint refuses an ETH order it could not price rather than
                    // silently falling back to a dollar charge, and "did not go through" would leave
                    // the user retrying with no idea what to expect.
                    // POO-1808: `buyFailureBody` carries the second rail's refusals. See its own
                    // comment above: the step paints that copy for about one batch before its
                    // `onFailed` swaps the panel to this screen, so without it the buyer reads
                    // "try again" for a rail that will refuse identically every time.
                    failedRow?.type === "buy"
                    ? buyFailureBody
                    : errorBody}
            </p>
          </div>
          {view ? (
            <ProvisioningPlanCard
              view={view}
              opLabel={opLabel}
              mode="running"
              execution={{
                // [F5-R2] With the route stopped, an unstarted step is "Not started", never "Waiting".
                routeFailed: true,
                ...(txError?.kind === undefined ? {} : { errorKind: txError.kind }),
                // [F5-R6] The plan's OWN tolerance, so the slippage line quotes what this user set.
                ...(plan?.slippagePct === undefined ? {} : { slippagePct: plan.slippagePct }),
              }}
            />
          ) : null}
          {/* [F5-R7] Retry semantics are untouched: the same handler, the same rail behaviour.
              POO-1525: deliberately NOT wrapped in `StickyActionFooter`. `TransactionErrorActions` is
              shared by five other flows' `TransactionStatus` (invest/collect/compound/withdraw), and
              it returns its error-details box and its buttons as one Fragment with no seam to pin only
              the buttons from outside. Pinning it means editing that shared component, which reaches
              well past this issue's provisioning-only scope; tracked as a fast-follow rather than
              silently dropped. */}
          <TransactionErrorActions
            onRetry={() => {
              setPhase("pending");
              void flow.retry();
            }}
            error={txError ?? undefined}
            surface="provisioning"
            {...(paybisRequestId ? { paybisRequestId } : {})}
          />
          {/* [F5-R7] The ghost the design closes on. Leaving is a real answer to a failed route, and
            without it the only ways out were retrying and the modal's X. */}
          <Button variant="ghost" className="min-h-11 w-full" onClick={onCancel}>
            {t("provisioning.plan.back")}
          </Button>
        </div>
      );
    }

    // POO-1023 [R3]: the seam is async, so surface a planner failure as a recoverable error rather than
    // a plan card that never fills.
    if (planTxError) {
      // POO-1044 [R3]: a chain with no native coin is not a transient failure, so it does not get the
      // retry that every other failure gets. Re-planning would ask the same classifier the same
      // question and reach the same verdict, so offering it would be theatre. What the user can
      // actually do is buy crypto, which is the second of the two escapes UF-10 attaches to a BLOCKED
      // verdict. The first, moving native in from another network, is the funding rail itself and is
      // not reachable from a chain that cannot originate a transaction.
      const blocked = planTxError.kind === "gasBlocked";
      return (
        <TransactionStatus
          testId="provisioning-error"
          phase="error"
          title={t("flow.error.title")}
          body={errorBody}
        >
          {blocked ? (
            <div className="flex w-full flex-col gap-2">
              {/* This epic writes no on-ramp code: the CTA hands off to the launched /deposit
                surface, exactly as the cost breakdown's peer option does (POO-1040 [R3]). */}
              <Link
                href={BUY_CRYPTO_HREF}
                className="flex w-full items-center justify-center rounded-md bg-primary px-6 py-3 text-center font-medium text-base text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("provisioning.costs.buyCrypto.cta")}
              </Link>
              <Button variant="ghost" className="min-h-11 w-full" onClick={onCancel}>
                {t("provisioning.plan.cancel")}
              </Button>
            </div>
          ) : (
            <TransactionErrorActions
              onRetry={onCancel}
              error={planTxError}
              surface="provisioning"
            />
          )}
        </TransactionStatus>
      );
    }

    /**
     * POO-1509 [R4]: `Not enough gas` is AUXILIARY, so it is a different screen rather than a variant
     * of the plan.
     *
     * The case matrix routes both gas-only rows here (`USDC on target, no gas` and `No gas on any
     * network`), and this is the branch that makes [R34] true instead of aspirational: with the picker
     * gone from the plan phase, the ONLY surface in the product that asks for a gas amount is this one,
     * whose whole subject is gas.
     *
     * It reaches all seven hosts, because every one of them renders this panel for its gas-only case,
     * and `onCancel` is what returns the user to the operation they came from. The standalone
     * {@link BuyGasModal} shares the body, so the two entry points cannot drift.
     *
     * The itemised {@link ProvisioningCostBreakdown} is deliberately NOT here: fees stay abstracted
     * into the conversion note (2026-06-30), and its TTL re-quote buys nothing on a few cents of gas
     * that the rail re-quotes per leg at execution time anyway (`requoteAtExecution`,
     * `REQUOTE_MATERIAL_BPS`). The {@link PriceImpactGate} IS here, because a swap-gas leg reaches the
     * same AMMs as any other and POO-1047 exists so no funding path is the way around it.
     */
    if (gasOnly) {
      /**
       * The figure the CTA prints is the figure that EXECUTES. Only an explicit VALID choice resizes
       * the plan (`effectiveGas` above), so the untouched $10 default preset is display seeding while
       * the rail runs the plan's own sized swap-gas leg: `raiseTopUpToUsd(verdict.topUp, choice)`,
       * often cents. `plan.gas.amountUsd` is that sized figure (`assemblePlan` writes the top-up
       * total there, and the mock planner mirrors it with the effective choice), so the CTA reads it,
       * and the in-edit choice stands in only while the re-quote that choice triggered is resolving.
       *
       * Kept from the POO-1509 review (PR #839): printing the edited value made the CTA state an
       * amount that was not the amount about to execute.
       */
      const executedGasUsd = planLoading
        ? (gasChoice?.amountUsd ?? plan?.gas?.amountUsd ?? displayGas.amountUsd)
        : (plan?.gas?.amountUsd ?? displayGas.amountUsd);
      return (
        <div className="flex flex-col gap-4" data-testid="provisioning-panel" data-phase="gas">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-lg">
                {t("provisioning.gas.title")}
              </h3>
              {/* POO-807 R1: the mock-mode indicator, as on every other phase root. */}
              <MockBadge />
            </div>
            {/* The gear the Figma frame carries (`7303:768`), and it is not a contradiction of [R17]'s
              "nowhere else in the flow": this screen is NOT in the flow. It is auxiliary, it signs a
              swap, and POO-478 requires every transaction to carry slippage and deadline. Same host
              dialog step 2 opens, so there is one copy of that state. Shape copied from
              `FundingSourceSelector`'s gear rather than `TransactionModalHeader`, whose `DialogTitle`
              would be a second one inside the host's dialog and would throw on the `/swap` screen,
              which mounts this panel outside a Dialog. */}
            {onOpenSettings ? (
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label={t("invest.settings.title")}
                // POO-1526 [M5.1] / POO-1528: this gear is NOT one the unified header replaces (the
                // header's gear is scoped to the `sources` step, and this screen is auxiliary), so it
                // takes the house invisible hit area instead: 24px + 2×10px = the 44pt floor, visual
                // size and row alignment unchanged. Nothing interactive sits within 10px of it — the
                // sheet's `X` and its own expanded box end ~60px above this row (M5.3).
                className="relative shrink-0 rounded-md p-1 text-muted-foreground transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings2 className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <GasTopUpBody
            value={displayGas}
            onChange={setGasChoice}
            balanceUsd={spendableUsd}
            source={gasFundingSource}
            confirmDisabled={impactGate.blocked}
            ctaAmountUsd={executedGasUsd}
            onConfirm={startRun}
            onDismiss={onCancel}
          >
            <PriceImpactGate
              priceImpactPct={priceImpactPct}
              acknowledged={impactGate.acknowledged}
              onAcknowledgedChange={impactGate.setAcknowledged}
            />
          </GasTopUpBody>
        </div>
      );
    }

    /**
     * The quote, in flight. Gate on `view`, never on the hook's `loading`: a re-quote keeps the previous
     * plan mounted while the new one resolves, and unmounting the subtree on every re-quote is what made
     * multi-digit gas amounts impossible to type before POO-1509 moved that control out.
     *
     * POO-1570 [R3]: this branch is where the chosen buy route now waits, so it says what it is
     * waiting for. The line is scoped to `buyQuoteInFlight` rather than bolted onto the skeleton,
     * because the SAME branch is mock mode's first paint, where no route has been chosen and
     * "Preparing your purchase" would be a claim about something the user never asked for.
     *
     * PP-A11Y: the message is the region's NAME, not only its content. `aria-label` overrides the
     * accessible name of this `role="status"` region, so a generic "Loading" label was the one thing
     * assistive tech was guaranteed to get and the sentence the sighted user reads was the one it
     * was least likely to announce. The label carries whichever of the two is actually on screen.
     */
    if (!view) {
      return (
        <div
          className="flex flex-col gap-4"
          role="status"
          aria-label={
            buyQuoteInFlight ? t("provisioning.routes.buy.preparing") : tCommon("loading")
          }
          data-testid="provisioning-panel"
          data-phase="loading"
        >
          {buyQuoteInFlight ? (
            <p className="text-muted-foreground text-sm">
              {t("provisioning.routes.buy.preparing")}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      );
    }

    /**
     * A route with its start requested, waiting only on the effect above: step 2's CTA was pressed in
     * real mode, or mock mode's seeded start is about to fire ([R3]: the mock plan screen is deleted,
     * so between the fixture plan resolving and the run there is no screen left to show). One frame at
     * most, so it renders the skeleton rather than a screen: every question has been answered.
     */
    return (
      <div
        className="flex flex-col gap-4"
        role="status"
        aria-label={tCommon("loading")}
        data-testid="provisioning-panel"
        data-phase="loading"
      >
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  },
);
ProvisioningPanel.displayName = "ProvisioningPanel";
