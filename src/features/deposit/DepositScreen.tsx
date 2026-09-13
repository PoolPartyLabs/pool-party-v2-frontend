/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow
 * @analytics-events deposit_started, deposit_method_selected, deposit_submitted,
 *   deposit_completed, deposit_failed, deposit_crypto_started, deposit_crypto_completed,
 *   deposit_address_copied, tx_amount_preset_used, tx_amount_blocked,
 *   funding_method_currency_changed
 *
 * `funding_buy_settled` is deliberately NOT in that list even though this screen causes it: the
 * header is the set of names this FILE pushes, and the row is pushed by the shared emitter
 * (`PP-CORE-LIB-111`), which carries the header for the whole family. Same arrangement as
 * `ProvisioningPanel` and `provisioningFunnel.ts`, and `scripts/analytics-check.ts` enforces it in
 * both directions.
 *
 * POO-1813 [R2]/[R4], the two additions this screen makes on the PRIVY rail only. The purchase
 * funnel's `settled` row is pushed from the OBSERVED delta and from nothing else, because the
 * adapter that reports the other three rows never sees a balance. And `deposit_method_selected` carries the only choice this rail can honestly report,
 * `onramp` or `crypto`: the provider owns the payment-method picker inside its own surface and never
 * tells us which one was used. The PAYBIS rail is untouched by both, and keeps its own
 * payment-method identifiers on that same name until POO-1809 retires it.
 *
 * POO-1807 [R10], the funnel on the Privy rail. Premise 11 is easy to break here, because
 * `addFunds` resolves with the PROVIDER'S CLAIM that it charged, which reads exactly like a success
 * and is not one (ADR-0004). So `deposit_completed` fires only on the observed delta, carrying that
 * delta as `value`, and never when the checkout promise resolves.
 *
 * The three new `block_reason`s (`onramp_unverified`, `onramp_uncovered`,
 * `onramp_currency_unsupported`) are DENOMINATORS, not settlement terms, and deliberately do not
 * conclude the abandonment. The passive observation window keeps observing for the rest of the SAME
 * SESSION and may still settle the purchase, so concluding at the visible ceiling would
 * let one `deposit_started` produce two settlement terms. (It does not yet survive a reload: the
 * cross-session resume is POO-1833's, and until it lands a buyer who closes the tab is only
 * reconcilable by hand from the intent record.) The identity is therefore unchanged:
 * `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`, with a
 * released screen resolving later as `completed` or `abandoned`.
 *
 * POO-1174 (rules v2: [R5] names the PICKED network resolved through the deposit-local chain-id
 * map rather than `useChainId()`, and [R3] is the full 9-step exit mapping). Two additions, both
 * in the funnel's integrity core:
 *
 * 1. **Abandonment**, as `tx_flow_abandoned{flow:"deposit"}` rather than a `deposit_abandoned`
 *    name, because the taxonomy already chose the cross-flow event plus a discriminator. Week one
 *    reconciles `deposit_completed` against Paybis's own dashboard, the only independent source
 *    this programme gets, and without an abandonment a missing completion is indistinguishable
 *    from a broken emitter. `conclude()` is called on every terminal outcome so
 *    `started = completed + failed + abandoned` closes. **Amended by POO-1624 (rules v1): that
 *    identity now needs a FOURTH term on one path.** The real-mode crypto wait is terminal for this
 *    screen but is neither a completion nor a failure, so `conclude()` fires there without a
 *    `deposit_crypto_completed` beside it. The buyer is counted by
 *    `tx_amount_blocked{block_reason:"transfer_unobserved"}`, which is what closes the identity as
 *    `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`, whose last
 *    term POO-1794 added for the real-mode fiat refusal below. Stated here as well as on the
 *    `docs/ANALYTICS_EVENTS.md` row, because anyone reconciling week one reads this header first.
 * 2. **`deposit_address_copied` carries `chain_id` ONLY**, for the network the user PICKED rather
 *    than the wallet's current chain. **The address is excluded by DERIVATION**: it never enters
 *    the params object and is deliberately not handed to `sanitizeParams` to be scrubbed. A value
 *    that is never present cannot be missed by a scrubber, logged by a future debug line, or
 *    reintroduced by someone adding a field here.
 * POO-1904 [R1]/[R3], the Paybis furniture this rail was still wearing. POO-1807 switched which
 * rail charges the card and the screen AROUND the checkout did not move with it: a Paybis
 * payment-method picker in both hosts, Paybis minimums, and "Secured by Paybis" printed above the
 * button that opens a Privy-brokered Stripe or MoonPay charge. The comment at `privyRail`'s own
 * declaration already asserted "behind `privyRail` the method step does not exist at all", which
 * shipped for the STEP and not for either method surface. [R3] is a compliance defect rather than a
 * cosmetic one (`docs/COMPLIANCE_REGISTER.md` `CR-CORE-043`): it named a counterparty that is
 * definitely not involved on the screen that takes the card, in all 12 locales. The replacement is
 * PROVIDER-NEUTRAL and never rail-aware, because Privy auto-routes between four providers and our
 * captured outcome does not record which one served.
 *
 * @implements-rules-version v17 (POO-1904 rules v1: no Paybis method surface, no Paybis floor and no
 *   vendor named on the Privy rail) · v16 (POO-1813 rules v1: the purchase funnel's settled row and
 *   the two-value `deposit_method` on this rail) · v15 (POO-1807 rules v1: the Privy rail host, its
 *   baseline gate, its coverage refusal and its two released-screen exits) · v14 (POO-1794 rules v1) · v13 (POO-1786 rules v1) · v3 (POO-1137 / POO-1129 rules v3) · v4 (POO-727/728/729 rules v1) · v5 (POO-1174 rules v2) · v6 (POO-1573 rules v2) · v7 (POO-1513 rules v1) · v8 (POO-1609 rules v2) · v9 (POO-1614 rules v1) · v10 (POO-1617 rules v1) · v11 (POO-1642 rules v1) · v12 (POO-1624 rules v1)
 *
 * ## The payment method is real now (POO-1513, rules v1)
 *
 * Reported live: *"I'm in Europe and I was prompted to pay with card in USD no matter what payment
 * method I chose in the deposit tab."* The choice was **structurally discarded**. It came from a
 * hardcoded `pix | card | applePay | bank` union that defaulted to Pix for every buyer on earth, it
 * never reached {@link StandaloneOnRampRail} (which was handed only `receiveUsd` and re-derived a card
 * with `pickDefaultPaymentMethod`), and its only consumers were a label and a LOCAL fee model.
 *
 * That fee model is the reason this is a money-correctness defect rather than an annoyance: it priced
 * `bank: 0` against `card: 0.0278`, so a bank-transfer buyer was shown a 0% processing fee and then
 * charged on a card at ~2.78%. We printed one number and billed another.
 *
 * Four things replace it, and none of them is new plumbing (POO-1578 built that and this consumes it):
 *
 *   1. **The list is live.** {@link useBuyRouteQuote} publishes every method
 *      `getOnRampPaymentMethodsAction` resolved for the buyer's OWN currency (POO-1512), each with its
 *      real `displayName` and its own minimum in its own `minCurrencyCode`.
 *   2. **The default comes from that list** via `pickDefaultPaymentMethod`, as a FALLBACK and never an
 *      override (POO-1578 S4). There is no `useState("pix")` constant any more.
 *   3. **The choice reaches the purchase**, as `paymentMethod` on the rail, which passes it to
 *      `mintOnRampRequest` and therefore to the quote and to `createOnRampRequestAction`.
 *   4. **The review prints the QUOTE's charge**, in the currency Paybis says it bills, through
 *      `formatFiat`. `SERVICE_RATE` / `SERVICE_MIN_USD` / `PROCESSING_RATES` and the literal `$` they
 *      were rendered with are deleted: a static copy of a vendor's published rates, in a currency the
 *      buyer may not be billed in, was a second and wrong source for a number the vendor already sends.
 *      When the quote carries no figure the row says so rather than inventing one.
 *
 *      POO-1614 finished this same sweep: an `Exchange rate` row directly below it still rendered
 *      the literal `1 USDC ≈ $1.00`, unformatted and unsourced, on every buyer's card regardless of
 *      the currency `formatFiat` had just printed one line up. Deleted outright rather than
 *      computed, since nothing in this flow fetches a live rate to compute it from.
 *
 * ### The pair is the one that gets minted, or there is no figure (POO-1513 X1/X2, with POO-1573)
 *
 * All four of those rest on ONE assumption that was left implicit and is not always true: that the
 * pair being quoted is the pair being purchased. A buyer holding under `PAYBIS_GAS_FLOOR_ETH` on Base
 * is sized ETH-FIRST ([R1] standalone), and since POO-1573 that leg is quoted received-fixed against
 * `gasFloorEth + fundingUsd / ethUsd` on the ETH pair's own fee schedule. Quoting `USDC-BASE` at the
 * entered amount for everyone therefore printed "you pay X" for a pair the buyer is not billed on,
 * structurally BELOW the charge by `gasFloorEth * ethUsd` (~$2.50 on a $100 deposit at $2,500/ETH).
 * Same class as the fee model above, same order of magnitude, one line further down the screen.
 *
 *   - The pair now comes from {@link buildStandaloneOnRampPlan}, the sizer the rail itself runs, so
 *     the screen and the mint cannot disagree about it. The METHOD LIST follows it, because
 *     `resolveWidgetPrefill` resolves the mint's list for the order's own `currencyCode`: a list
 *     resolved for another pair offers methods the mint may not find, and one it cannot find falls
 *     back to a card, which is POO-1578 [R3]'s invisible substitution re-created one layer up.
 *   - On the gas-first pair the CHARGE is suppressed rather than approximated. Its target is solved
 *     at mint time against a live ETH price this client does not hold, so the review falls to the
 *     "shown at checkout" caption it already uses when the provider returns no figure. Withholding a
 *     figure is never worse than asserting a wrong one, which is also why the degraded balance read
 *     (`balances: []`, indistinguishable from an empty wallet) suppresses rather than prints.
 *   - With no charge on that pair, the blocked-row check (below) falls to its OWN tier 2, comparing
 *     the ENTERED amount to the floor instead: this is exactly the buyer POO-1609's tier 2 exists
 *     for, not an exception to it.
 *
 * ### A method whose minimum exceeds the order renders BLOCKED (POO-1609, second and standing
 * ### reversal of POO-1576 Q2, murilo 2026-08-14)
 *
 * "the charge is never raised... the payment method must stay BLOCKED with a message explaining it."
 * Shown with its minimum-turned-floor message rather than hidden, in its normal position, never
 * reordered; its radio cannot become the selection, and it carries `aria-disabled="true"` rather than
 * `disabled` so it stays reachable and announced. The order itself never moves, automatically or on
 * consent: `/deposit` prints only what the buyer typed, always.
 *
 * The comparison ({@link isMethodBelowFloor}, PP-CORE-LIB-101) is two-tiered and defined ONCE for
 * every host that renders a row: tier 1 compares a row's own quoted charge to its own floor directly
 * (exact, no currency guard needed, since POO-1599 both figures share the flow's resolved currency by
 * construction); tier 2, for a row the quote never priced (the gas-first buyer above), compares the
 * ENTERED amount to the floor instead, guarded to the SAME currency only, because this app has no FX
 * source at all (POO-333) and a method wrongly blocked removes an option the buyer could have used.
 *
 * When EVERY method is blocked, `Continue` has nothing to act on: it is disabled and
 * `method.allBlocked` names the LOWEST floor in the list, so the screen states its own exit rather
 * than leaving a dead end to happen.
 *
 * ### The selection's lifetime (POO-1576 Q4)
 *
 * It survives an amount change, and is cleared ONLY when the resolved currency changed, because the
 * available list can legitimately differ under it (a EUR buyer's SEPA row is not in a USD set).
 *
 * The on-ramp as a single responsive wizard (one /deposit page, client state machine) rather than
 * separate routes, so the entered amount/method never get lost between steps.
 *
 * ## The fiat confirm (POO-1137, epic POO-1129 phase 6)
 *
 * `confirmFiat` runs the STANDALONE on-ramp rail in real mode behind the `fiatOnRamp` flag: it hands
 * off to {@link StandaloneOnRampRail}, which sizes the order with `sizeOnRampOrder({ standalone: true })`
 * ([R1] standalone gas trigger, never the classifier), mints the purchase resuming any in-flight id
 * ([R7]), opens the embedded Paybis widget, settles from the observed balance delta ([R4]/[R11]), and
 * per [R3] STOPS after the swap to USDC on Base (never a bridge, never an invest, even under a deep
 * link that carried a strategy). `deposit_completed` + `requestBalanceRefresh` fire on the CONFIRMED
 * settlement, `deposit_failed` on a terminal failure. In MOCK MODE the confirm keeps its pre-epic
 * mocked-success behaviour so the launched surface is unchanged (premise 10): the widget frame is
 * gated off there and could never settle a real delta anyway. Real mode with `fiatOnRamp` dark no
 * longer shares that path (POO-1794): it refuses at the `onramp-disabled` step instead of printing a
 * receipt for a purchase no provider was ever asked to make.
 *
 * Two things about that hand-off are load-bearing and easy to undo by accident:
 *
 *   1. **The rail stays mounted through `onramp-error`.** A purchase that already SETTLED can still
 *      fail on its conversion leg (a rejected signature, a failed chain switch, a failed quote), and
 *      the only correct answer there is `flow.retry()`, which resumes the failed step. Unmounting the
 *      rail and re-entering from review would mint a SECOND Paybis purchase and strand the first
 *      purchase's ETH, because the fresh balance snapshot now clears the gas floor. The rail hands us
 *      a `settled` discriminator and the retry handle; only a PRE-settlement failure goes back to
 *      review. See `StandaloneOnRampRail`'s header and `ProvisioningPanel.tsx:1087`.
 *   2. **The receipt reports the SETTLED delta, not the estimate.** [R4] makes the observed delta the
 *      authority and the user can change the amount inside the Paybis widget, so the QUOTE's charge
 *      is a pre-purchase figure that a confirmed receipt must not quote back at them. It still drives
 *      the review step and the mock-mode success, the only remaining path where no delta exists.
 *   3. **The mint may need an ANSWER, and only this screen can ask for one (POO-1642).** Both of the
 *      above are about a purchase we watched settle. A purchase we never saw settle reaches the same
 *      double charge from the other end: `mintOnRampRequest` resumes a journaled in-flight id ([R7]),
 *      but a PAID-and-unlanded intent and an EXPIRED-and-unpaid one are not decidable by the client,
 *      because `paidAt` records only what we OBSERVED. POO-1384 built `confirmResume` for exactly
 *      that and this surface never passed one, so the hook took its documented fall-through:
 *      reopening the widget onto the vendor's completed screen, or minting a SECOND purchase beside
 *      funds still landing. `confirmResumePurchase` below is the question; the rail carries it into
 *      the mint. Every exit settles it, including the teardown, which REJECTS.
 *
 * Fiat path (Paybis): amount → payment-method dialog → review (the ONLY step that shows the charge) →
 * success. Crypto path (Carlos): receive (address + QR, USDC-only, chosen network). POO-604: there is
 * NO on-chain watcher / deposit webhook in production (and none planned for now), so the standalone
 * crypto path is TERMINAL at receive — it shows the address and never claims a "detected" state we
 * cannot observe. The manual "I've sent the funds" confirm (→ waiting, and → success in MOCK MODE
 * only since POO-1624) is shown ONLY under the "Deposit & invest" context, where it is the trigger to
 * RESUME the invest flow without a webhook (real resume wiring: POO-605). Every deposit is
 * RECEIVED-fixed (POO-729): the entered amount is the
 * USDC you receive and the Paybis fee is added ON TOP of "You pay". The amount is bounded to
 * $10 to $200,000 (POO-727), and the crypto network picker opens with Arbitrum pre-selected (POO-728) so
 * Continue is enabled on open. The output is USDC (~1:1 minus fees); the custom keypad
 * drives entry on mobile while desktop types. Supports the "Deposit & invest" top-up context (pre-fill
 * + banner + route back to the strategy on success), hardened per POO-494: the banner degrades to a
 * name-less variant when the strategy lookup misses, the review blocks confirm below the shortfall,
 * and the crypto path honors the top-up context too. POO-520: a manager-console origin returns the
 * resume to /manager?manage=<id>&invest=<amount> (the manage view re-arms the invest modal there);
 * investor-originated flows keep the strategy-detail return.
 *
 * The fiat success receipt links out to the explorer (POO-1617), under `success.backHome`. It links
 * the buyer's own WALLET ADDRESS, never a transaction: POO-1129 reconciles the purchase from the
 * observed balance delta rather than from a transaction this app submitted, so no hash ever exists
 * to link. The copy says "wallet" rather than promising a transaction view the link cannot open.
 *
 * ## The crypto wait stopped promising what it cannot do (POO-1624, rules v1)
 *
 * The paragraph above was true of the STANDALONE path and false of the other one. Under the invest
 * context the "I've sent the funds" confirm ran a 2500ms `setTimeout` commented "mock for on-chain
 * watching" and then printed `const CRYPTO_RECEIVED = 100` as the USDC that had arrived, and
 * **neither was gated on `isMockMode`**. So the screen this file's own header says never claims a
 * detected state we cannot observe was claiming exactly that, in production, on a money surface: a
 * receipt for a deposit nobody measured, settling on time rather than on money, under copy reading
 * "We'll detect it automatically. No need to do anything." Refreshing or navigating away lost the
 * wait entirely, which is the second half of the same sentence being false.
 *
 * Three changes, and all three are subtractions:
 *
 *   1. **The timer is mock-only**, so in real mode the wait never resolves itself and the receipt
 *      (`PP-DEP-SCR-006`) is unreachable. No `deposit_crypto_completed` fires either: premise 11 puts
 *      a `completed` on SETTLEMENT, and a timer has never been one.
 *   2. **The figure moved to `src/mocks/`** (`MOCK_CRYPTO_DEPOSIT_USDC`, `PP-CORE-MCK-008`), so the
 *      mock boundary is a directory rather than a comment three lines under the fiat minimum.
 *   3. **The copy states only what the implementation delivers**, in all 12 locales: we cannot
 *      confirm a transfer sent from somewhere else, and the balance updates on its own when it lands.
 *      The spinner went with the promise, because a spinner asserts that something is being watched.
 *
 * What did NOT change is the resume: the invest return moved onto the wait itself, so losing a
 * fabricated receipt does not also lose the way back to the strategy (POO-604 / POO-605).
 *
 * The absence is now measured rather than papered over. Reaching that wait in real mode reports
 * `tx_amount_blocked{block_reason:"transfer_unobserved"}`, this screen's second blocked intent: the
 * buyer asked to be told their deposit landed and the product answered that it cannot. That count is
 * the denominator for the decision this issue deliberately does NOT make, which is whether to extend
 * POO-1129's balance-delta reconcile to the crypto path (POO-1129 / POO-604 own it).
 *
 * PP-INTEGRATION-POINT: the fiat confirm hands off to Paybis hosted checkout. The crypto path still
 * has no chain-watching seam (removed with POO-604) and the invest-context "I've sent the funds"
 * confirm is a user-driven resume trigger; since POO-1624 it resolves nothing in real mode. The
 * assumed contract for the observation that would resolve it is recorded at the crypto-waiting
 * effect below (real balance-check wiring: POO-605 / POO-1129).
 */
"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  Copy,
  Loader2,
  Lock,
  Share2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { Button } from "@/components/ui/Button";
// POO-1807 [R8] / review F6: the HOUSE price-move buffer (5%), imported rather than restated.
// Rejection 2 forbids a second rate under any name and rejection 13 pins this one until POO-1812.
import { SEED_BUFFER_RATE } from "@/features/strategies/components/provisioning/fundingSelection";
import {
  type BuyRouteQuoteState,
  pickDefaultPaymentMethod,
  useBuyRouteQuote,
} from "@/features/strategies/hooks/useBuyRouteQuote";
// POO-1642: the question the mint asks when it finds an in-flight purchase it cannot verify.
import type { ConfirmResumePurchase } from "@/features/strategies/hooks/useProvisioningRail";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { Link } from "@/i18n/navigation";
import { toAnalyticsErrorCode } from "@/lib/analytics/errorCode";
import { onRampErrorCode, useFundingBuyFunnel } from "@/lib/analytics/fundingBuyFunnel";
import { useTxFlowAbandonment } from "@/lib/analytics/txFlowKit";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import { useAuth } from "@/lib/auth/useAuth";
import { requestBalanceRefresh } from "@/lib/balances/balanceRefresh";
import { useTokenBalances } from "@/lib/balances/useTokenBalances";
import { apiNetworkForChain, getExplorerAddressUrl } from "@/lib/chains/config";
import { browserTraceId } from "@/lib/observability/sentry/clientContext";
import type { CoverageResult } from "@/lib/onramp/coverageProbe";
import { usdcDestination } from "@/lib/onramp/destinations";
import { PRIVY_FIAT_CURRENCIES, toPrivyFiat } from "@/lib/onramp/fiatCurrencies";
import { ON_RAMP_FLOOR_USD } from "@/lib/onramp/limits";
import { isMethodBelowFloor, lowestFloor } from "@/lib/onramp/methodFloor";
import { resolveOnRampEnvironment } from "@/lib/onramp/onRampProvider";
// POO-1573 [R5] (rules v2): the mint refused because ETH could not be priced. Nothing was signed and
// no widget opened, so this screen keeps the buyer on REVIEW with a reason instead of the failure
// screen that exists for a purchase that actually started.
import { ONRAMP_ETH_UNPRICED_CODE, type OnRampPaymentMethod } from "@/lib/onramp/schemas";
import { useOnRampCoverage } from "@/lib/onramp/useOnRampCoverage";
import { useOnRampCurrencies } from "@/lib/onramp/useOnRampCurrencies";
import { useOnRampProvider } from "@/lib/onramp/useOnRampProvider";
import { usePrivyOnRamp } from "@/lib/onramp/usePrivyOnRamp";
import { ONRAMP_CHAIN_ID } from "@/lib/provisioning/computeNeed";
import { isMockMode } from "@/lib/services";
import { readErc20Balance } from "@/lib/tokens/readErc20";
import { classifyTxError } from "@/lib/tx/diagnostics";
// POO-1642 [R8]: the shape a rejected question travels in, so the flow reads a code rather than a
// bare Error, exactly as every other terminal on this screen does.
import { TransactionError } from "@/lib/tx/sendTransaction";
import { formatFiat, formatTokenAmount, formatUsd } from "@/lib/utils/format";
import { applyKeypadKey, sanitizeNumericInput } from "@/lib/utils/numericInput";
import { getDepositAddress } from "@/lib/wallet/getDepositAddress";
// POO-1624: the mock receipt's figure, in `src/mocks/` so the boundary is a directory rather than a
// comment. Read only inside the `isMockMode` branch below; real mode never renders that receipt.
import { MOCK_CRYPTO_DEPOSIT_USDC } from "@/mocks/data/cryptoDeposit";
import { mockSupportedCurrencies } from "@/mocks/data/onRampCurrencies";
import { fetchMockOnRampPaymentMethods, mockOnRampCharge } from "@/mocks/data/onRampPaymentMethods";
import { AmountKeypad } from "./components/AmountKeypad";
import { CurrencySelect } from "./components/CurrencySelect";
// POO-1807: the Privy rail. Each of these is OURS, and each has its own suite; this screen is the
// host that decides which rail runs and what every outcome means on screen.
import {
  DepositPrivyCheckout,
  ONRAMP_DESTINATION_DECIMALS,
} from "./components/DepositPrivyCheckout";
import { NetworkPickerDialog } from "./components/NetworkPickerDialog";
import { PaymentMethodDialog } from "./components/PaymentMethodDialog";
import { type PaymentMethodCharge, PaymentMethodList } from "./components/PaymentMethodList";
import { QrBlock } from "./components/QrBlock";
import {
  type StandaloneOnRampFailure,
  StandaloneOnRampRail,
  type StandaloneOnRampSettlement,
} from "./components/StandaloneOnRampRail";
import {
  DEFAULT_DEPOSIT_NETWORK,
  DEPOSIT_CHAIN_IDS,
  type DepositNetwork,
} from "./lib/depositNetworks";
import { buildStandaloneOnRampPlan, readBaseNativeEth } from "./lib/standaloneOnRampPlan";

/**
 * How long the amount field settles before the coverage probe asks (POO-1805 review F11).
 *
 * The rail's OWN number, read from its shipped bundle rather than chosen: the fiat screen wraps its
 * quotes fetch in `((e,t=750)=>{...setTimeout(...,t)})` (`@privy-io/react-auth@3.40.0`,
 * `dist/esm/index-rkoxGjIC.mjs`, the `fetchQuotes`/`debounceMs` pair its sourcemap names). Matching
 * it means one keystroke costs the same one question here as it does inside the modal; the probe
 * hook itself deliberately dedupes rather than debounces, and says so in its own header, because
 * holding a keystroke belongs to whoever owns the input.
 */
const ONRAMP_COVERAGE_DEBOUNCE_MS = 750;

/** App minimum fiat deposit (USD), on the received/entered amount (POO-727). */
const MIN_DEPOSIT = 10;
/** App maximum fiat deposit (USD), on the received/entered amount (POO-727). Above this the ramp /
 * KYC path differs; the real min/max come from the Paybis quote once wired (this is the app-side cap). */
const MAX_DEPOSIT = 200_000;

/** Flow steps. */
type Step =
  | "amount"
  | "review"
  | "success"
  | "onramp"
  | "onramp-settling"
  | "onramp-error"
  // POO-1794: real mode with `fiatOnRamp` dark. A terminal refusal, never a receipt: the on-ramp is
  // not launched, so the confirm cannot complete. Distinct from `onramp-error` (a real flow that
  // failed, which keeps the rail mounted); this step mounts nothing.
  | "onramp-disabled"
  // POO-1807 [R7]: nobody will sell to this buyer, in this currency, at this amount. A refusal
  // BEFORE anything opens, and the market's answer rather than our own floor.
  | "onramp-uncovered"
  // POO-1801 review F10: the rail does not sell in the buyer's currency, or we could not resolve
  // one at all. Also a refusal BEFORE anything opens, kept apart from `onramp-uncovered` because
  // the two lead to different fixes (wait, versus we cannot charge you in this money at all) and
  // because folding them together would hide a currency-resolution outage inside a market answer.
  | "onramp-currency-unsupported"
  // POO-1807 [R9] / ADR-0006: the visible window closed with no claim and no delta. Honest, and
  // deliberately not a cancellation: we do not know that nothing was charged.
  | "onramp-unverified"
  | "crypto-receive"
  | "crypto-waiting"
  | "crypto-success";

/** Round to cents, drop trailing zeros, as a raw string. */
function toText(value: number): string {
  return String(Number(value.toFixed(2)));
}
/** Today, formatted for the success / settling receipt rows. */
function todayMedium(): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date());
}
/** Format a plain number with up to 2 decimals (no currency symbol). */
function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

/** A label/value breakdown row. */
function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">
        {label}
        {sub ? <span className="ml-1 text-muted-foreground/70 text-xs">({sub})</span> : null}
      </span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

/** The invest-top-up context passed from "Deposit & invest". */
export interface DepositInvestContext {
  /** Strategy id to return to after a successful top-up. */
  strategyId: string;
  /** Strategy display name for the banner; null when the lookup missed (POO-494 R1) — the banner
   * then falls back to name-less copy, never fabricated data. */
  strategyName: string | null;
  /** Shortfall pre-filled into the amount. */
  shortfall: number;
  /** The full amount the investor is committing — deep-links "Invest now" back to Invest's Confirm
   * step (?invest=) so they don't retype it on return (POO-281 R3). */
  investAmount?: number;
  /** Launch surface (POO-520): "manager" returns the resume to the console manage view
   * (/manager?manage=<id>&invest=<amount>); absent/"investor" keeps the strategy-detail return. */
  origin?: "investor" | "manager";
}

/** Public props for {@link DepositScreen}. */
export interface DepositScreenProps {
  /** Optional invest-top-up context (pre-fills the amount + shows a banner + reroutes on success). */
  investContext?: DepositInvestContext | null;
  /** Whether the crypto-deposit (receive USDC to address) path is offered. Hidden for external wallets. */
  cryptoDepositAvailable?: boolean;
  /** Start directly on the crypto-receive step (deep link from the wallet modal's Receive action). */
  initialCrypto?: boolean;
}

/** The deposit on-ramp wizard. */
export function DepositScreen({
  investContext,
  cryptoDepositAvailable = true,
  initialCrypto = false,
}: DepositScreenProps) {
  const t = useTranslations("deposit");
  const { track } = useAnalytics();
  useTrackView("deposit_started");
  /**
   * POO-1612 S2: whether the payment-method list mounts inline (`lg` and up) or stays behind the
   * dialog. JS-gated rather than CSS-only (unlike the rest of this screen's mobile/desktop split):
   * two identically-labelled Continue buttons, or two copies of the same radio group, would both be
   * present in the DOM under a CSS-only `lg:hidden` toggle (jsdom does not evaluate media queries),
   * which is indistinguishable from a real duplicate to anything querying by role or name. `null`
   * (unmeasured: SSR, first paint, and every test that does not mock this hook) resolves to the
   * mobile path, so the dialog stays "mounted and unchanged below lg" by construction.
   */
  const isDesktop = useIsDesktop();
  // The crypto-receive address is the user's CONNECTED wallet (same source as the top-right chip),
  // checksummed for display. Null when no wallet is connected (guarded in the receive step);
  // `walletLoading` covers the real-mode Privy/wagmi handshake so we don't flash the empty state.
  const { address, isLoading: walletLoading } = useAuth();
  const connectedAddress = address ? getDepositAddress(address) : null;
  // Deep link (wallet modal "Receive") opens straight on the crypto-receive step when available.
  const [step, setStep] = useState<Step>(
    initialCrypto && cryptoDepositAvailable ? "crypto-receive" : "amount",
  );
  /**
   * POO-1174 [R1] [R3]: deposit abandonment, as `tx_flow_abandoned{flow:"deposit"}`.
   *
   * No `deposit_abandoned` name: the taxonomy already chose the cross-flow event plus a
   * discriminator (`events.ts`), and `"deposit"` is already an `AnalyticsFlow`. `strategyId` is
   * optional on the context, so this surface fits the kit unchanged.
   *
   * Why it is in the integrity core rather than nice-to-have: week one reconciles
   * `deposit_completed` against Paybis's own dashboard, the only independent source this programme
   * ever gets. Without this event a missing completion is ambiguous between someone walking away
   * and a broken emitter. It is also what makes `started = completed + failed + abandoned` close.
   */
  const stepRef = useRef(step);
  stepRef.current = step;
  const abandonment = useTxFlowAbandonment({ flow: "deposit" }, () => {
    switch (stepRef.current) {
      case "amount":
        return "amount";
      case "review":
        return "review";
      // [R2]: `onramp` is this lane's new exit. Neither `pending` (an on-chain tx in flight) nor
      // `provision` (told to fund first) describes sitting inside the Paybis widget, and this is
      // the exit the Paybis reconciliation has to be able to see.
      case "onramp":
        return "onramp";
      // The purchase settled at the processor and we are watching for the balance delta. That IS
      // an in-flight wait, so it is the one deposit state `pending` describes honestly.
      case "onramp-settling":
      case "crypto-waiting":
        return "pending";
      /**
       * POO-1807 review (F9): the Privy rail's three refusal/release screens are NOT terminal, and
       * mapping them to `default` (null) meant leaving one emitted no `tx_flow_abandoned` at all.
       *
       * `onramp-unverified` is the exact opposite of terminal: the passive window is still watching
       * and the buyer may have paid, which is why nothing here calls `conclude()`. The two refusals
       * are pre-purchase: nothing opened and nothing was charged, so a buyer who leaves has walked
       * away from a live deposit attempt exactly as one who leaves the amount step has. `pending`
       * rather than a new exit value, because `AnalyticsTxExit` is a closed cross-flow union
       * (`txFlowKit.ts`) and all three are the same thing at that altitude: a wait we did not
       * conclude.
       */
      case "onramp-unverified":
      case "onramp-uncovered":
      case "onramp-currency-unsupported":
        return "pending";
      // Looking at the receive address, deciding whether to send. The action point of a path with
      // no amount step, which is what `confirm` is for.
      case "crypto-receive":
        return "confirm";
      // Terminal. A flow that ended did not get abandoned, and the error case is already answered
      // by `deposit_failed` plus the conclude() calls below.
      default:
        return null;
    }
  });
  const [amountText, setAmountText] = useState(
    investContext && investContext.shortfall > 0 ? toText(investContext.shortfall) : "100",
  );
  /**
   * POO-1513 S4: the Paybis identifier the buyer CHOSE, or `undefined` while they have not.
   *
   * `undefined` is not "no method": it is "no preference", which is what lets
   * `pickDefaultPaymentMethod` stay the fallback POO-1578 S4 made it rather than the override it was.
   * The removed `useState<PaymentMethod>("pix")` was the opposite: a Brazil-only method asserted as
   * everyone's choice before they had seen a single option.
   */
  const [selectedMethod, setSelectedMethod] = useState<string | undefined>(undefined);
  const [methodOpen, setMethodOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [completedAt, setCompletedAt] = useState("");
  // POO-1137 [R4]: what the purchase ACTUALLY delivered, once the rail has observed it. Null on the
  // mock-mode success (since POO-1794 the only mocked receipt left) and on a resumed conversion,
  // where no delta was observed in this run and the pre-purchase estimate is the only figure we hold.
  const [settlement, setSettlement] = useState<StandaloneOnRampSettlement | null>(null);
  // POO-1137: the terminal failure the rail reported, kept so the error screen can tell a
  // pre-settlement failure (nothing moved, start over) from a post-settlement one (the card was
  // charged, resume) and can drive Try again through the rail's own `retry`.
  const [onRampFailure, setOnRampFailure] = useState<StandaloneOnRampFailure | null>(null);
  /**
   * POO-1642 [R2]: the in-flight purchase the mint is blocked on, with the resolver that unblocks
   * it. Null whenever nothing is being asked, which is almost always.
   *
   * State and not a ref, for the reason `ProvisioningPanel`'s twin gives: the question has to RENDER
   * for there to be an answer at all. Nothing has been signed and no widget is open at this point,
   * so both answers are safe.
   */
  const [resumePrompt, setResumePrompt] = useState<{
    startedAt: number;
    /** Paid changes the QUESTION, not just its wording. See [R3] against [R4]. */
    paid: boolean;
    decide: (choice: "resume" | "new") => void;
  } | null>(null);
  const resumePromptRef = useRef<HTMLDivElement>(null);

  // POO-1367 [R4]: memoized on the backend id alone. `browserTraceId()` reads the live propagation
  // context, so an unmemoized value could render differently from the one the user copied.
  const onRampReference = useMemo(
    () => onRampFailure?.error.correlationId ?? browserTraceId(),
    [onRampFailure?.error.correlationId],
  );
  /**
   * POO-1403 [R1]: the VENDOR's handle for the purchase, read from the journal that already holds it
   * for exactly this window ([R2], never re-minted: minting a second `requestId` is the double charge
   * `onRampJournal` exists to prevent).
   *
   * Ungated, unlike the provisioning panel's, because this screen IS the on-ramp: every failure it
   * shows is a fiat purchase's, including a post-settlement conversion failure whose code is a plain
   * wallet rejection. That case is the one where the vendor's record matters MOST, since the card was
   * charged and "was this person charged" is the whole question. Read only while a failure is on
   * screen, so an ordinary deposit never touches the journal.
   */
  const paybisRequestId = useMemo(() => onRampFailure?.paybisRequestId, [onRampFailure]);
  // Crypto deposit: the picker opens with Arbitrum pre-selected (POO-728, DEFAULT_DEPOSIT_NETWORK) so
  // Continue is enabled on open; the user can still switch. The address is identical across networks;
  // the choice only drives which network the loss-of-funds warning names. The picker still opens on
  // entry (and on the wallet-modal "Receive" deep link) so the send-network stays explicit.
  const [network, setNetwork] = useState<DepositNetwork>(DEFAULT_DEPOSIT_NETWORK);
  const [networkOpen, setNetworkOpen] = useState(initialCrypto && cryptoDepositAvailable);
  /**
   * POO-1807 [R4]: which rail serves fiat, read through the hook so a Dev-menu override moves this
   * screen and `ProvisioningPanel` together. Mock mode is checked FIRST everywhere below and keeps
   * its fixture path untouched ([R3]).
   *
   * BOTH answers below come from this ONE read (POO-1800 F9, cross-lane with POO-1808): `realRail`
   * used to call `isFeatureEnabled("fiatOnRamp")` itself, which is env-pure, while `privyRail` read
   * the hook, which a Dev-menu override can move. Under an override the two disagreed, and the
   * screen then ran the Privy rail while every `realRail` gate beside it still answered for the
   * flag's env value. `resolveOnRampProvider` already composes both flags into the three states
   * (`none` / `paybis` / `privy`), so "is fiat offered at all" is exactly `rail !== "none"`.
   *
   * POO-1137: the real standalone rail runs only with real data. MOCK MODE keeps the pre-epic mocked
   * success (premise 10); real mode with `fiatOnRamp` dark refuses at the `onramp-disabled` step
   * instead of completing (POO-1794 [R1]).
   */
  const rail = useOnRampProvider();
  const realRail = !isMockMode && rail !== "none";
  const privyRail = !isMockMode && rail === "privy";
  const { openCheckout } = usePrivyOnRamp();
  const probeCoverage = useOnRampCoverage();

  /**
   * POO-1807 [R6]: the destination balance BEFORE the checkout opens.
   *
   * `undefined` while it is in flight, `null` when the read failed. Both keep the confirm shut,
   * because a purchase opened without a baseline has nothing to measure its delta against, and a
   * failed read must never be treated as a zero: a zero baseline would report the buyer's whole
   * balance as the delivery.
   *
   * PP-INTEGRATION-POINT: one `balanceOf` on Base through the shared client. The same binding is
   * handed to the watcher, so the pre-read and every poll are the same call on the same scope
   * ([R5] of POO-1804).
   */
  const [baseline, setBaseline] = useState<bigint | null | undefined>(undefined);
  /**
   * Memoised, and it is load-bearing rather than an optimisation: this object is a dependency of
   * both effects below, and a fresh identity on every render re-armed the coverage probe's debounce
   * forever, so it never answered and every purchase silently took the `unknown` branch.
   */
  const privyDestination = useMemo(() => usdcDestination(ONRAMP_CHAIN_ID), []);
  const readBalance = useCallback(
    async ({ asset, address }: { chain: string; asset: string; address: string }) =>
      readErc20Balance(asset as `0x${string}`, address as `0x${string}`, ONRAMP_CHAIN_ID),
    [],
  );

  /**
   * POO-1807 [R7]: the coverage answer, probed BEFORE the click so the click stays synchronous.
   *
   * The whole of {@link CoverageResult}'s `status`, `amount-too-low` included (POO-1805 rules v2).
   * That answer is NOT `uncovered`: it means the buyer typed below the RAIL's own display floor, and
   * the fix is a bigger number rather than a hidden rail. Our `MIN_DEPOSIT` already sits above it,
   * so it is unreachable from this screen today; it is carried rather than folded in so the day the
   * floor moves the screen does not start calling a small amount "nobody will sell to you".
   */
  const [coverage, setCoverage] = useState<CoverageResult["status"] | undefined>(undefined);
  /** POO-1807 [R9]: the observed delta, the only figure the Privy receipt may print (ADR-0004). */
  const [deliveredUsd, setDeliveredUsd] = useState<number | null>(null);
  /** The checkout promise the click opened, handed to the component that owns the window. */
  const [checkoutPending, setCheckoutPending] = useState<ReturnType<typeof openCheckout> | null>(
    null,
  );
  /**
   * POO-1813 [R4]: what this purchase asked for, what we actually prefilled, and the currency the
   * card is CHARGED in, kept so the settled row can report all three beside the delivered figure.
   *
   * A ref because nothing renders off it and the settlement lands long after the click that set it:
   * the buyer's resolved currency could move underneath a purchase that is already open, and the
   * row has to say what THIS charge was denominated in, not what the next one would be.
   *
   * `prefill` is `undefined` when we prefilled nothing (a non-USD buyer, [R8] above), never `0`.
   */
  const privyFiguresRef = useRef<{
    requested: number;
    prefill: number | undefined;
    fiatCurrency: string;
  }>({ requested: 0, prefill: undefined, fiatCurrency: "USD" });
  const buyFunnel = useFundingBuyFunnel();

  const amount = Number.parseFloat(amountText) || 0;
  /**
   * The wallet this purchase will be sized against, read the SAME way {@link StandaloneOnRampRail}
   * reads it ([R1]'s trigger is a `useTokenBalances` snapshot, never a raw holdings read).
   *
   * PP-INTEGRATION-POINT: the SIWE-gated balance read behind `useTokenBalances` (real mode) /
   * fixtures (mock mode). No new upstream call shape: it is the same read the rail makes moments
   * later, pulled forward because the review step has to know the pair BEFORE the rail mounts.
   */
  const { balances } = useTokenBalances();
  /**
   * The order this purchase will ACTUALLY be minted as, from the shipped sizer rather than a second
   * copy of its rule (POO-1513 X1/X2, cross-lane with POO-1573).
   *
   * ## Why the screen has to ask this at all
   *
   * A buyer holding under `PAYBIS_GAS_FLOOR_ETH` on Base is sized ETH-FIRST ([R1] standalone), and
   * since POO-1573 that leg is quoted received-fixed against `gasFloorEth + fundingUsd / ethUsd` on
   * the ETH pair's own fee schedule. This screen was quoting `USDC-BASE` at the entered amount for
   * EVERYONE, so it printed "you pay X" for a pair the buyer is not billed on, structurally BELOW the
   * charge by `gasFloorEth * ethUsd` (~$2.50 on a $100 deposit at $2,500/ETH). That is the same class,
   * and the same order of magnitude, as the 2.78% card-fee defect this issue was opened to kill.
   *
   * ## Why it calls the plan builder instead of comparing against the floor here
   *
   * `buildStandaloneOnRampPlan` IS what the rail calls, with these same two inputs, so the screen and
   * the sizer cannot disagree about the pair: there is no predicate here to drift. `needsSwapToUsdc`
   * is the sizer's own "we bought ETH for gas" answer (`order.currencyCode === "ETH-BASE"`), read
   * rather than re-derived.
   *
   * ## The degraded read biases to gas-first, and that is the safe direction HERE too
   *
   * `useTokenBalances` resolves `isLoading=false` with `balances=[]` when the first read fails, which
   * `readBaseNativeEth` cannot tell from an empty wallet, so it reads a zero and the plan goes
   * ETH-first. Upstream that bias is deliberate (`StandaloneOnRampRail`'s header: land transactable
   * rather than stranded). Downstream, here, it costs a FIGURE and never a purchase, and withholding a
   * figure is never worse than asserting a wrong one. The same holds while the read is still in
   * flight, which is why no loading flag is consulted: unknown and empty both suppress.
   */
  const { order: sizedOrder, needsSwapToUsdc: gasFirst } = useMemo(() => {
    const { eth, ethUsd } = readBaseNativeEth(balances);
    return buildStandaloneOnRampPlan({ receiveUsd: amount, baseNativeEth: eth, ethUsd });
  }, [balances, amount]);
  /**
   * POO-1513 S1/S3: the live method list AND the received-fixed charge, from the ONE hook POO-1578
   * built for both surfaces. Nothing here re-implements that threading.
   *
   * THE PAIR IS THE ORDER'S OWN (X2). `resolveWidgetPrefill` resolves the mint's method list with
   * `currencyCodeTo: order.currencyCode`, so a list resolved for a different pair offers methods the
   * mint may not find, and a method the mint cannot find silently falls back to a card: POO-1578 [R3]'s
   * invisible substitution, re-created one layer up. Passing the sized order's own code makes the
   * picker's list the mint's list by construction.
   *
   * THE CHARGE IS SUPPRESSED ON THE GAS-FIRST PAIR (X1). The received-fixed quote asks Paybis to
   * deliver `amount` OF `currencyCodeTo`; a dollar figure says that correctly for `USDC-BASE` and says
   * nothing at all for `ETH-BASE`, whose target only the mint can solve (POO-1573, against a live ETH
   * price this client does not hold). So we print no charge and the review step falls to its shipped
   * "shown at checkout" caption, which is the SAME answer this screen already gives when the provider
   * returns no figure. Nothing new is asserted, and nothing is invented.
   *
   * Gated on `realRail` because the list and the quote are real calls behind a real SIWE session:
   * in mock mode or with `fiatOnRamp` dark there is no list, which is the informational (never
   * blocking) state the dialog renders. Mock mode reads {@link mockQuote} instead, off the same
   * seam: see its own doc for why the harness needed one at all.
   *
   * PP-INTEGRATION-POINT: live Paybis payment methods + received-fixed quote, via
   * `getOnRampPaymentMethodsAction` / `getOnRampQuoteAction` (PP-CORE-LIB-063).
   */
  /**
   * POO-1630: the currency the BUYER picked, in either mode, or nothing while they have not picked.
   *
   * Deliberately one piece of state for both modes rather than the mock-only override POO-1613
   * shipped. The two modes differ in where the OPTIONS come from and in nothing else, so a single
   * `chosen` keeps the clearing rule ([R3] below), the re-list and the analytics on one path instead
   * of two that can drift.
   *
   * It is a PROPOSAL, never the answer: `useBuyRouteQuote` sends it to the methods call and the
   * screen reads back `buyQuote.currencyCodeFrom`, which is what the SERVER echoed. A refused
   * proposal therefore changes nothing on screen, rather than printing one currency beside another
   * currency's figures (the POO-1513 stale-figure class, wearing a denomination).
   */
  const [chosenCurrency, setChosenCurrency] = useState<string | undefined>(undefined);

  /**
   * POO-1807 review (F5): the PRICING hop is off on the Privy rail, and only the pricing hop.
   *
   * The Privy rail prices inside the provider's own modal, so a Paybis charge is an assertion about
   * a purchase that is not the one being made: it reached the review row, the receipt's Amount row
   * and the method label on a rail that mints none of them. `pricingEnabled: false` is the shipped
   * way to suspend exactly that hop (the gas-first pair already uses it), and every figure it feeds
   * is withheld beside it below.
   *
   * The METHODS hop stays on, and that is deliberate rather than an oversight: it is also the
   * BUYER-CURRENCY oracle. `currencyCodeFrom` is POO-1512's server-side resolution chain
   * (CloudFront geo, then profile, then USD) echoed back, and there is no other client-reachable
   * read of it today. The Privy rail refuses to open without one (the `onramp-currency-unsupported`
   * refusal below, POO-1801 review F10), so turning this hop off would refuse every purchase. When
   * POO-1809 deletes the method picker, the currency read is what has to survive it.
   */
  const liveQuote = useBuyRouteQuote({
    amountToUsd: amount,
    currencyCodeTo: sizedOrder.currencyCode,
    enabled: realRail,
    pricingEnabled: !gasFirst && !privyRail,
    ...(selectedMethod === undefined ? {} : { paymentMethod: selectedMethod }),
    ...(chosenCurrency === undefined ? {} : { currencyCodeFrom: chosenCurrency }),
  });

  /**
   * POO-1630/POO-1621: the fiat currencies this pair can actually be bought with.
   *
   * Real mode only, because the action is wallet-gated and server-side; mock mode keeps its own
   * fixture below. On the SAME gate as the list it re-fetches, so the control is ready when the
   * buyer arrives rather than a round trip later.
   *
   * Absent is a first-class answer, not a failure to handle: the hook degrades to no options, and
   * `CurrencySelect` then renders the display-only state POO-1613 already shipped. POO-494 [R1]:
   * a Select offering what it cannot switch to lies, so no readable set means no control at all.
   */
  const { currencies: supportedCurrencies } = useOnRampCurrencies({
    currencyCodeTo: sizedOrder.currencyCode,
    enabled: realRail,
  });
  /**
   * MOCK MODE's own list and charge (premise 2), and nothing else's.
   *
   * ## Why the harness needs this at all
   *
   * The hook above is gated on `realRail`, and there is no mock for
   * `getOnRampPaymentMethodsAction`. So in mock mode the dialog rendered the "Paybis did not return
   * any payment options" caption permanently, the review always printed "Shown at checkout", and the
   * receipt dropped its Amount row. The modal has no story either, so there was no configuration
   * anywhere in which the designed picker could be seen. Mock mode IS this repo's visual harness;
   * a surface it cannot show is a surface nobody can review.
   *
   * ## It cannot reach real mode
   *
   * `isMockMode` is a build-time constant, so the branch below is resolved at build time and the
   * fixture is never read in real mode. The real path is byte-for-byte what it was.
   *
   * ## The empty state stays reachable, deliberately
   *
   * The fixture resolves after a simulated round trip rather than synchronously, so the informational
   * caption is still what the dialog shows before the list lands, exactly as it is in production
   * while the real call is in flight. `hasAmount` mirrors the real hook's own bail so the list also
   * clears when there is nothing to price.
   */
  const hasAmount = amount > 0;
  const [mockResolved, setMockResolved] = useState<{
    methods: OnRampPaymentMethod[];
    currencyCodeFrom: string;
  } | null>(null);
  useEffect(() => {
    setMockResolved(null);
    if (!isMockMode || !hasAmount) return;
    let live = true;
    void fetchMockOnRampPaymentMethods().then((resolved) => {
      if (live) setMockResolved(resolved);
    });
    return () => {
      live = false;
    };
  }, [hasAmount]);
  /**
   * POO-1613: the buyer's mock-only currency pick (the browsing part of the control; a
   * server-validated override that actually changes what the buyer is billed is POO-1618, not
   * wired here). Relabels the fixture's currency CODE without inventing a second set of amounts
   * for 44 currencies: the numbers stay the mock's own, only the denomination the buyer sees
   * changes, which is enough to exercise R3's clearing rule below and the disclosure this issue is
   * actually about.
   */
  const mockCurrencyCode = chosenCurrency ?? mockResolved?.currencyCodeFrom;
  const mockQuote = useMemo<BuyRouteQuoteState>(() => {
    if (mockResolved === null || mockCurrencyCode === undefined) return {};
    const list = { methods: mockResolved.methods, currencyCodeFrom: mockCurrencyCode };
    const method =
      mockResolved.methods.find((entry) => entry.paymentMethod === selectedMethod) ??
      pickDefaultPaymentMethod(mockResolved.methods);
    // The gas-first pair is suppressed here for the same reason it is upstream (X1): its target is
    // solved at mint time against a live ETH price, so there is no honest figure to print.
    if (!method || gasFirst) return list;
    const charge = mockOnRampCharge(amount, method.paymentMethod);
    if (charge === undefined) return list;
    /**
     * POO-1612: every mock row's own charge, in the SAME `quote`-lookalike shape
     * `useBuyRouteQuote` exposes in real mode, so `PaymentMethodList`'s blocked-row comparison
     * behaves identically under both. Mock mode is this repo's visual harness (premise 2): if this
     * diverged, the picker's own blocking couldn't be seen by hand at all.
     */
    const paymentMethods = mockResolved.methods.flatMap((entry) => {
      const entryCharge = mockOnRampCharge(amount, entry.paymentMethod);
      if (entryCharge === undefined) return [];
      return [
        {
          id: entry.paymentMethod,
          name: entry.displayName,
          chargeUsd: entryCharge,
          chargeAmount: entryCharge.toFixed(2),
          chargeCurrencyCode: mockCurrencyCode,
          receiveAmount: amount.toFixed(6),
          receiveCurrencyCode: "USDC-BASE",
        },
      ];
    });
    return {
      ...list,
      chargeUsd: charge,
      chargeCurrency: mockCurrencyCode,
      methodLabel: method.displayName,
      methodMinUsd: method.minUsd,
      methodMinCurrency: method.minCurrencyCode,
      pricedFor: { amountToUsd: amount, paymentMethod: method.paymentMethod },
      quote: {
        quoteId: "mock",
        currencyCodeFrom: mockCurrencyCode,
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "destination",
        paymentMethods,
        paymentMethodErrors: [],
      },
    };
  }, [mockResolved, mockCurrencyCode, selectedMethod, amount, gasFirst]);
  const buyQuote = isMockMode ? mockQuote : liveQuote;
  const methods = buyQuote.methods;
  /**
   * POO-1609: every row's own charge, keyed by Paybis identifier, for the blocked-row tier-1
   * comparison ({@link isMethodBelowFloor}). Read off {@link buyQuote}'s full `quote` (POO-1612), not
   * the single narrowed `chargeUsd` below: blocking has to be right for every row, not only the one
   * that happens to be active. A non-positive charge is not a price (POO-1599's own quote can answer
   * a genuine zero only for a free method, which Paybis does not offer), so it is skipped exactly as
   * {@link isMethodBelowFloor} skips it on the caller's side.
   *
   * Declared HERE, above {@link activeMethod}, rather than beside the other quote-derived figures:
   * {@link blockedIds} needs it, and the whole point of that set is that it is applied BEFORE the
   * method the rail mints is chosen.
   */
  const chargesByMethod = useMemo(() => {
    const map: Record<string, PaymentMethodCharge> = {};
    for (const entry of buyQuote.quote?.paymentMethods ?? []) {
      if (entry.chargeUsd > 0) {
        map[entry.id] = { amount: entry.chargeUsd, currencyCode: entry.chargeCurrencyCode };
      }
    }
    return map;
  }, [buyQuote.quote]);
  /**
   * POO-1609 [S2]: the identifiers this order cannot reach, from the SAME comparison every row is
   * drawn with ({@link isMethodBelowFloor}, PP-CORE-LIB-101). One derivation, three consumers: the
   * rows, the all-blocked dead end, and {@link activeMethod}'s filter below.
   *
   * Derived rather than stored. #897 held this as `blockedMethods` state written by an effect, which
   * needed a `blockGuardRef` latch to fire its analytics once and then needed that latch cleared in
   * two more places; a currency round trip that cleared the list but not the latch left the earlier
   * refusal's key still matching and the refusal was SUPPRESSED, so a below-floor method stayed
   * selected and reached the rail. Computing the answer from (methods, charges, amount) removes the
   * stale-key failure class outright: there is no second lifetime to keep in step with the first.
   */
  const blockedIds = useMemo(() => {
    const refused = new Set<string>();
    for (const method of methods ?? []) {
      if (
        isMethodBelowFloor({
          method,
          charge: chargesByMethod[method.paymentMethod],
          enteredAmount: amount,
        })
      ) {
        refused.add(method.paymentMethod);
      }
    }
    return refused;
  }, [methods, chargesByMethod, amount]);
  /**
   * POO-1578 S4: the buyer's choice first, `pickDefaultPaymentMethod` as the FALLBACK.
   *
   * A selection the resolved list no longer offers falls back rather than dead-ending, for the same
   * reason `resolveWidgetPrefill` does: the list is per resolved currency (POO-1512), so a currency
   * change can legitimately retire the method they picked.
   *
   * POO-1609 [S2]: the fallback picks over the methods this order can actually reach. A refused
   * method must not become the `value` the picker shows or the `paymentMethod` the rail mints,
   * because that is the whole failure this issue closes: with the CTA never disabled on this screen,
   * a below-floor method left in place is a purchase that Paybis refuses on a screen that is not
   * ours. When EVERY method is refused there is nothing to pick over, so the shipped default stands
   * and Continue is disabled beside `method.allBlocked` ([P38]) rather than the screen minting a
   * method it has just told the buyer is unavailable.
   *
   * The filter is the half a click-time refusal cannot cover, and it is why `handleMethodSelect`
   * alone is not the rule. That handler only ever sees a CLICK, so two paths reach the rail without
   * one: a selection made while the order cleared the floor and then left below it by an amount edit,
   * and the auto-picked default, which nobody chose and which `pickDefaultPaymentMethod` resolves by
   * NAME over the whole list (a card first, floored or not). Both are pinned at the rail in
   * `DepositScreen.methods.test.tsx`, because a blocked row already renders unchecked either way and
   * a DOM assertion would pass while the mint still carried the refused identifier.
   */
  const activeMethod = useMemo(() => {
    if (!methods || methods.length === 0) return undefined;
    const reachable = methods.filter((entry) => !blockedIds.has(entry.paymentMethod));
    return (
      reachable.find((entry) => entry.paymentMethod === selectedMethod) ??
      pickDefaultPaymentMethod(reachable) ??
      pickDefaultPaymentMethod(methods)
    );
  }, [methods, selectedMethod, blockedIds]);
  const methodId = activeMethod?.paymentMethod;
  /**
   * POO-1807 review (F5): withheld on the Privy rail, everywhere it is READ ABOUT a purchase.
   *
   * `activeMethod` is a Paybis payment method, picked by `pickDefaultPaymentMethod` over the list
   * the methods hop returned. On the Privy rail the buyer never sees that list and the provider
   * behind the checkout chooses its own method, so printing "Paying with SEPA Transfer" on the
   * receipt, or riding `deposit_method: "sepa"` on `deposit_submitted` / `deposit_completed` /
   * `deposit_failed`, is a claim about how they paid that nobody made. Absent is the shipped answer
   * for "the provider returned no list" and it is the correct one here too.
   *
   * `methodId` itself is NOT gated: it is what the picker renders and what the Paybis mint reads,
   * and both are unreachable on this rail anyway.
   */
  const methodLabel = privyRail ? undefined : activeMethod?.displayName;
  /** The same withholding, for every funnel event that names a method. */
  const analyticsMethodId = privyRail ? undefined : methodId;
  const chargeUsd = buyQuote.chargeUsd;
  const chargeCurrency = buyQuote.chargeCurrency;
  /**
   * POO-1513 review (F1): the (amount, method) the charge above was priced for.
   *
   * Two things read it, and both because a charge is an assertion ABOUT a pair. The refusal below
   * says "this charge, for this method, misses this floor"; {@link chargeText} says "this charge is
   * what this method costs". A figure one commit behind the AMOUNT is corrected by the hook's own
   * clear-first rule on the very next commit, which is why only the refusal checks that leg.
   */
  const pricedFor = buyQuote.pricedFor;
  /**
   * POO-1513 S3: the charge Paybis quoted, in the currency Paybis says it bills, or nothing.
   *
   * `formatFiat` and never `formatUsd`: since POO-1512 [R7] the buyer is charged in their own
   * currency, and printing a EUR 208 charge as `$208.00` is the same class of defect as the deleted
   * fee model, one line further down the screen.
   *
   * ## Withheld when it answers for a method this screen is not naming (POO-1609)
   *
   * The charge is published for the method the QUOTE was priced against, which with no selection
   * live is `pickDefaultPaymentMethod` over the WHOLE list. `methodId` is the method the screen
   * NAMES and the rail mints, which since [S2] skips the refused ones. A refusal sets exactly that
   * state: it hands the selection back, so the quote re-opens unpinned and republishes the charge of
   * the method it just refused, while the review beside it names the fallback. The review then read
   * "Paying with SEPA Transfer" over a card's figure and offered Confirm under a number that
   * answered for neither the method named beside it nor the method about to be charged, which is the
   * deleted `PROCESSING_RATES` divergence with a new source, made persistent rather than transient.
   *
   * So the figure is withheld. Withholding one is never worse than asserting a wrong one, which is
   * the posture this screen already states for the gas-first pair and for a degraded balance read,
   * and what it falls back to is not new copy: `review.payAtCheckout` is what this screen already
   * shows whenever the quote carries no charge at all.
   */
  const chargeText =
    chargeUsd === undefined || (methodId !== undefined && pricedFor?.paymentMethod !== methodId)
      ? null
      : formatFiat(chargeUsd, chargeCurrency ?? "USD");
  const resolvedCurrency = buyQuote.currencyCodeFrom;
  /**
   * The rail's spelling of the buyer's currency, or NOTHING (POO-1801 review F10).
   *
   * It used to be `toPrivyFiat(resolvedCurrency) ?? "usd"`, read at four call sites. That `??` is
   * the POO-1512 defect wearing a new rail: a buyer whose currency the rail does not sell in, or
   * whose currency we could not resolve at all, was silently charged in DOLLARS on a screen that
   * had just told them the amount was approximate. `toPrivyFiat` never defaults on purpose ("the
   * caller decides what to do about a currency we cannot charge in", `fiatCurrencies.ts:100`) and
   * this is the caller deciding: absent is refused, loudly and before anything opens.
   */
  const privyFiat = toPrivyFiat(resolvedCurrency);
  const shortfall = investContext?.shortfall ?? 0;
  // POO-494 R4 guard: the review blocks confirm while the entered amount is below the shortfall the
  // investment needs (otherwise the user returns to Invest still short). Only meaningful under the
  // invest top-up context, where shortfall > 0.
  // POO-1374: compare at CENT precision, the precision the UI actually displays.
  //
  // `shortfall` can carry SUB-CENT precision (it is `Number.parseFloat` of a URL param,
  // `investContext.ts`), while the amount field is prefilled with `toText(shortfall)`, which ROUNDS
  // to 2dp. So a shortfall of 55.2049 prefills 55.2, and the raw comparison read `55.2 < 55.2049`
  // and DISABLED confirm, while both figures rendered as "$55.20" and the copy told the user they
  // needed exactly what they already had. Rounding both to cents makes the gate agree with the
  // screen. (Not float epsilon: `101.02 - 45.82` rounds the other way and never triggered this.)
  // Matches the shipped `round2` idiom (`buildPlan.ts:251`, `standaloneOnRampPlan.ts:106`).
  const belowNeed = shortfall > 0 && Math.round(amount * 100) < Math.round(shortfall * 100);
  // POO-494 R5: the crypto path honors the top-up context — the mock detection credits the
  // shortfall (rounded to cents) instead of the generic fixture amount.
  //
  // POO-1624: BOTH halves are mock-only now, and the receipt they feed is unreachable in real mode.
  // Neither is a measurement: the shortfall is what we ASKED the buyer for and the fixture is a
  // constant, so printing either as "received" states an amount nobody observed.
  const cryptoReceived = shortfall > 0 ? Number(shortfall.toFixed(2)) : MOCK_CRYPTO_DEPOSIT_USDC;
  /**
   * POO-1137 [R4]: the receipt quotes what the purchase DELIVERED, observed on-chain, whenever the
   * rail observed one. The quote's charge is a pre-purchase figure for an amount the user can still
   * change inside the Paybis widget, so it stays the review step's number and the fallback for the
   * mock-mode success, never a confirmed one.
   *
   * The settled figure is genuinely USD (it is summed from the on-chain delta), so it prints through
   * `formatUsd`; the estimate prints through `chargeText`, which carries the billed currency.
   *
   * POO-1513 review (F6): with NEITHER a settlement nor a quote charge there is no such figure at
   * all, so the row is omitted rather than filled with `formatUsd(amount)`. That fallback printed the
   * USDC the buyer RECEIVES under a label that says what they PAID, which is the deleted fee model's
   * mistake one screen later; the received row right beside it already states that number honestly.
   */
  //
  // POO-1807 review (F5): and on the Privy rail there is no such fallback at all. `chargeText` is a
  // PAYBIS quote for a purchase Privy priced itself, so printing it as "Amount" on the receipt
  // states a charge nobody made. The rail's own receipt is built from the observed delta below
  // (`receiptUsdc`), which is the only figure ADR-0004 lets this screen print.
  const receiptText = settlement ? formatUsd(settlement.settledUsd) : privyRail ? null : chargeText;
  // Received-fixed (POO-729): what you entered is what you receive, so the estimate IS the amount.
  const receiptUsdc = deliveredUsd ?? (settlement ? settlement.receivedUsdc : amount);
  /**
   * POO-1807 [R8]: the figure we actually pass as the checkout's prefill, floor and buffer included.
   *
   * The buffer is the HOUSE one, `SEED_BUFFER_RATE` (5%), imported rather than restated: rejection 2
   * forbids a new rate under any name, and rejection 13 pins that number until POO-1812. It read
   * `STANDALONE_SLIPPAGE_PCT` (2%) before the review, which is the SWAP leg's max slippage: a
   * different quantity with a different owner, sized for a Uniswap route rather than for a
   * provider's spread, and moving it would move the swap. What the prefill needs is the price-move
   * allowance the rest of the funding path already asks for, so it asks for the same one.
   *
   * Rounded to whole cents here as well as in the adapter: this figure is also what [R1]'s sentence
   * is written against, and a screen that says "about 105.00" while the modal opens on
   * "105.00000000000001" is the same defect one surface earlier.
   */
  const privyPrefillUsd =
    Math.round(Math.max(amount * (1 + SEED_BUFFER_RATE), ON_RAMP_FLOOR_USD) * 100) / 100;
  /**
   * POO-1807 [R2]: the delivery landed under the platform minimum to invest.
   *
   * The receipt is still printed, and still prints the real figure: the money IS in the wallet
   * (ADR-0004). What changes is one line of copy and the absence of the invest CTA, because the
   * operation boundary would refuse it anyway and offering it here would be a dead end. The refusal
   * proper is POO-1806/1808's, at that boundary.
   */
  const belowPlatformMinimum = deliveredUsd !== null && deliveredUsd < ON_RAMP_FLOOR_USD;
  /**
   * POO-1617: the receipt links the buyer's OWN wallet address on the explorer, never a transaction
   * hash. POO-1129 reconciles the on-ramp from the observed balance delta rather than from a
   * submitted transaction, so the flow never learns a hash to link. Base is this leg's only target
   * chain (`RAIL_OPTIONS.operation.targetChainId`), which is why this reads `ONRAMP_CHAIN_ID` rather
   * than `settlement`: `settlement` is null on a resumed conversion even though the deposit still
   * settled on Base, and the network here does not depend on it. `getExplorerAddressUrl` (shared with
   * `ExplorerTxLink`, PP-CORE-CMP-050) is the one chain-to-URL mapping; no second copy of it here.
   */
  const explorerWalletUrl = connectedAddress
    ? getExplorerAddressUrl(apiNetworkForChain(ONRAMP_CHAIN_ID), connectedAddress)
    : undefined;
  // On success, "Invest now" returns to where the flow ORIGINATED, with ?invest=<amount> when we
  // know the full committed amount, so Invest reopens at Confirm & sign instead of the amount step
  // (POO-281 R3). A manager-console origin returns to that strategy's manage view, where the
  // add-liquidity modal re-arms from the same param (POO-520 R1); the investor origin keeps the
  // strategy-detail return (POO-520 R2).
  const hasInvestAmount = Boolean(investContext?.investAmount && investContext.investAmount > 0);
  const investHref = investContext
    ? investContext.origin === "manager"
      ? hasInvestAmount
        ? `/manager?manage=${investContext.strategyId}&invest=${investContext.investAmount}`
        : `/manager?manage=${investContext.strategyId}`
      : hasInvestAmount
        ? `/strategies/${investContext.strategyId}?invest=${investContext.investAmount}`
        : `/strategies/${investContext.strategyId}`
    : "/strategies";
  // The top-up banner, shared by the fiat amount step and the crypto path (POO-494 R5). Name-less
  // fallback copy when the strategy lookup missed (POO-494 R1): never fabricate data in real mode.
  const investBanner =
    investContext && investContext.shortfall > 0 ? (
      <p className="rounded-lg bg-risk-2/10 px-3 py-2 text-center text-risk-2 text-sm">
        {investContext.strategyName
          ? t("investContext", {
              name: investContext.strategyName,
              amount: formatUsd(investContext.shortfall),
            })
          : t("investContextGeneric", { amount: formatUsd(investContext.shortfall) })}
      </p>
    ) : null;

  /**
   * POO-1576 Q4: the selection survives an amount change and is cleared ONLY when the resolved
   * currency changed.
   *
   * The list is fetched per resolved currency (POO-1512), so a currency change can legitimately retire
   * the method they picked: a EUR buyer's SEPA row simply is not in a USD set. Keeping a dead
   * identifier would silently fall back inside the rail, which is the invisible substitution POO-1578
   * [R3] exists to stop. `undefined` is skipped rather than treated as a change, because it is the
   * list reloading, not the currency moving.
   */
  const resolvedCurrencyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (resolvedCurrency === undefined) return;
    if (
      resolvedCurrencyRef.current !== undefined &&
      resolvedCurrencyRef.current !== resolvedCurrency
    ) {
      setSelectedMethod(undefined);
    }
    resolvedCurrencyRef.current = resolvedCurrency;
  }, [resolvedCurrency]);

  /**
   * POO-1609 (second and standing reversal, murilo 2026-08-14): "the charge is never raised... the
   * payment method must stay BLOCKED with a message explaining it." The order never moves, not
   * automatically and not on accept; a method whose own minimum exceeds it renders blocked instead,
   * in position, never hidden. The per-row comparison ({@link isMethodBelowFloor}, PP-CORE-LIB-101,
   * two tiers: the row's own charge when the quote priced it, else the entered amount) is the SAME
   * one {@link PaymentMethodList} runs for every row; it is read again here only to answer the
   * dead-end case a per-row check cannot see by itself.
   *
   * ## The dead end this rule creates, and its exit (P38)
   *
   * When EVERY method is below its floor, nothing is selectable and `Continue` has nothing to act on.
   * `Continue` is disabled below and `method.allBlocked` names the LOWEST floor in the list
   * ({@link lowestFloor}), so the screen states its own exit: the amount field's own `+$50` chip is
   * already on this step.
   *
   * ## Never on the Privy rail (POO-1904 [R1]), and gated HERE rather than at the render site
   *
   * This one derivation feeds three things, and the third is why the gate belongs on the VALUE: the
   * banner below, `Continue`'s `disabled`, and therefore whether the purchase can open at all. A
   * Paybis floor above the typed amount was withholding a PRIVY purchase that Privy would have
   * taken, which is a refusal by a vendor that does not serve this rail rather than a cosmetic leak.
   * Gating only the two renders would have left that refusal standing, and standing invisibly.
   *
   * It is reachable on this rail only for a USD-denominated floor: {@link isMethodBelowFloor}'s
   * tier 1 needs a row charge, which the suspended pricing hop never produces here, and its tier 2
   * compares only a floor already in USD (`sameFiat`, there is no FX source in this app). So the
   * buyer who reported `Minimum EUR 8.59` was reading the PICKER's own per-row minimum, which the
   * same rule removes below, while a dollar buyer under a Paybis floor was being refused outright.
   */
  const allBlocked =
    !privyRail && methods !== undefined && methods.length > 0 && blockedIds.size === methods.length;
  const lowestBlockedFloor = allBlocked ? lowestFloor(methods ?? []) : undefined;
  const allBlockedBanner =
    allBlocked && lowestBlockedFloor ? (
      <p className="rounded-lg bg-warning/10 px-3 py-2 text-center text-sm text-warning">
        {t("method.allBlocked", {
          amount: formatFiat(lowestBlockedFloor.minUsd, lowestBlockedFloor.minCurrencyCode),
        })}
      </p>
    ) : null;

  /**
   * Selecting a payment-method row (POO-1609). A BLOCKED row cannot become the selection: the
   * activation is refused instead, and reported as this screen's blocked intent (premise 11) on the
   * refusal itself, exactly once per activation. `PaymentMethodList` owns no state and fires no
   * analytics of its own (POO-1612), so this ONE handler is what both the dialog and the inline
   * section (POO-1612 S2) call.
   */
  function handleMethodSelect(paymentMethod: string) {
    // The SAME set `activeMethod` filters on and the rows are drawn from, so the click-time refusal
    // and the mint can never disagree about which methods this order can reach.
    if (blockedIds.has(paymentMethod)) {
      track("tx_amount_blocked", {
        flow: "deposit",
        block_reason: "below_minimum",
        deposit_method: paymentMethod,
      });
      return;
    }
    setSelectedMethod(paymentMethod);
    // POO-1513: the VALUE changes from the local `pix | card | applePay | bank` union to the
    // Paybis identifier. The event itself is unchanged; `docs/ANALYTICS_EVENTS.md` records the
    // discontinuity so the history is not read as one continuous series.
    track("deposit_method_selected", { deposit_method: paymentMethod });
  }

  const changeAmount = useCallback((next: string | ((prev: string) => string)) => {
    setAmountText(next);
  }, []);

  /**
   * What happens after "I've sent the funds", and the two different answers it has (POO-1624).
   *
   * ## Real mode: the wait states its own absence
   *
   * Nothing in this app watches a deposit address. There is no on-chain watcher and no deposit
   * webhook (POO-604), so the honest answer to "did it arrive?" is that we do not know, and the
   * screen says so and stops. It does not spin, it does not resolve, and it prints no figure,
   * because every figure it could print is one nobody measured.
   *
   * The refusal is reported once, as this screen's blocked intent (premise 11): the buyer pressed
   * a money CTA asking to be told their deposit landed and the product answered that it cannot
   * tell them. It is deliberately NOT `deposit_failed` (nothing failed, and the transfer is very
   * probably arriving) and deliberately NOT `deposit_crypto_completed`, which premise 11 puts on
   * SETTLEMENT and which a timer has never been.
   *
   * `conclude()` runs here too, because this IS the terminal state of the real-mode crypto flow. A
   * buyer who leaves after being told to come back later has not abandoned anything, and counting
   * them as drop-off would report churn on the one path that behaves exactly as designed.
   *
   * PP-INTEGRATION-POINT: the deposit observation this screen does not have. The assumed contract
   * is the one the fiat rail already runs on (POO-1129 [R4], `StandaloneOnRampRail`'s
   * `onSettled({ settledUsd, receivedUsdc })`): watch the connected address on the PICKED network
   * for an incoming USDC balance delta and settle from the OBSERVED figure, never an expected one.
   * Reusing that reconcile here is the obvious candidate and is a product decision rather than an
   * implementation detail (which network, for how long, and what a partial or late arrival means),
   * so it is left to POO-1129 / POO-604 rather than assumed here. Until it exists this screen
   * states the absence, and `transfer_unobserved` counts how much the absence costs.
   *
   * ## Mock mode: the fixture receipt, unchanged
   *
   * A 2500ms timer into `crypto-success`, which is the visual harness for `PP-DEP-SCR-006` and the
   * ONLY way that screen is reachable at all. `isMockMode` is a build-time constant, so the whole
   * branch is resolved at build time and the fixture cannot ship in a production bundle's path.
   */
  const unobservedReportedRef = useRef(false);
  useEffect(() => {
    if (step !== "crypto-waiting") {
      // Re-arm for a second press of "I've sent the funds": that is a fresh question, and the
      // taxonomy counts the ATTEMPT rather than the answer.
      unobservedReportedRef.current = false;
      return;
    }
    if (!isMockMode) {
      abandonment.conclude();
      // The copy on this screen promises "Your balance updates on its own once the money arrives",
      // and this is the whole of what stands behind that sentence, so it is deliberate rather than
      // incidental. TWO mechanisms, neither of them a watcher:
      //   1. this one-shot read, which catches a transfer the buyer had ALREADY sent before pressing
      //      "I've sent the funds" (a common order, and the only case this screen can settle at all);
      //   2. `useTokenBalances`' focus/visibility refetch (`src/lib/balances/useTokenBalances.ts`),
      //      which is what covers the ordinary case of leaving for another app and coming back.
      // It is one cached read and it is NOT a substitute for the real observation, which is still
      // unbuilt and still POO-1129 / POO-604's (see the integration-point note on the effect's own
      // doc comment above). Nothing here may ever advance the step or print a figure: that is
      // exactly the defect POO-1624 closed.
      //
      // The cross-reference is deliberately worded WITHOUT spelling the marker tag: the seam census
      // in docs/INTEGRATION_POINTS.md is a bare `git grep -o` for that tag over `src`, so a POINTER
      // written with it counts as a SEAM and puts the header one over the truth. Measured, not
      // theorised: an earlier draft of this very comment said "see the <tag> above" and took the
      // census from 429 to 430 against a header that still read 429.
      requestBalanceRefresh();
      // One report per arrival. The ref is the de-duplicator POO-1609's removed `blockGuardRef`
      // existed to be: this is an EFFECT, so a re-render or React's development double-invoke would
      // otherwise count one buyer twice.
      if (unobservedReportedRef.current) return;
      unobservedReportedRef.current = true;
      track("tx_amount_blocked", { flow: "deposit", block_reason: "transfer_unobserved" });
      return;
    }
    const timer = setTimeout(() => {
      setCompletedAt(new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date()));
      setStep("crypto-success");
      // POO-1128 [R5]: funds just landed in the wallet, so the header chip must not keep showing the
      // pre-deposit total. The hook also re-reads when the tab regains focus, which is what covers
      // the real off-app settlement this step currently mocks.
      requestBalanceRefresh();
      abandonment.conclude();
      track("deposit_crypto_completed", {
        token_symbol: "USDC",
        token_amount: cryptoReceived,
        usd_value_at_time: cryptoReceived,
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [
    step,
    track,
    cryptoReceived,
    // Stable (`useCallback` with `[]` in the kit), declared so the exhaustive-deps rule can see it.
    abandonment.conclude,
  ]);

  /** Open the crypto-transfer path from the amount step (fires deposit_crypto_started once). The
   * network picker opens with Arbitrum pre-selected (POO-728); the user can still switch. */
  function openCrypto() {
    /**
     * POO-1813 [R2]: the other half of the top-level choice, and only on the rail that has one.
     *
     * On the PAYBIS rail `deposit_method_selected` carries a payment-method identifier from the
     * method step, and adding a `"crypto"` row to that series would put two vocabularies in one
     * dimension of a live funnel. Behind `privyRail` the method step does not exist at all, so this
     * is the only selection the buyer makes and the only one we can report.
     */
    if (privyRail) track("deposit_method_selected", { deposit_method: "crypto" });
    track("deposit_crypto_started");
    setNetwork(DEFAULT_DEPOSIT_NETWORK);
    setNetworkOpen(true);
    setStep("crypto-receive");
  }

  function applyKey(key: string) {
    changeAmount((prev) => applyKeypadKey(prev, key, { maxDecimals: 2 }));
  }

  // The CONFIRMED settlement of a fiat deposit: the real rail's on-chain settle ([R4]/[R5]) and, in
  // MOCK MODE only, the mocked hosted-checkout success. Real mode with `fiatOnRamp` dark never
  // reaches here since POO-1794: it stops at the `onramp-disabled` refusal. POO-1128 [R5]: refresh
  // the balance and fire `deposit_completed` here, exactly once, so a purchase moves the header chip
  // and no in-app handler has to observe the asynchronous off-app settlement.
  //
  // POO-1137 [R4]: the VALUE reported is the observed settlement delta whenever the rail observed one.
  // POO-1513: with no settlement it is the RECEIVED amount, not a charge. The charge is now the
  // vendor's figure in the BUYER's currency, and adding euros into a `currency: "USD"` total would be
  // a false number; the received side is USD-denominated for every buyer.
  const completeFiat = useCallback(
    (settled: StandaloneOnRampSettlement | null) => {
      setSettlement(settled);
      setOnRampFailure(null);
      setCompletedAt(todayMedium());
      setStep("success");
      requestBalanceRefresh();
      const value = settled ? settled.settledUsd : amount;
      abandonment.conclude();
      track("deposit_completed", {
        // POO-1513: the Paybis identifier of the method actually being funded, omitted rather than
        // guessed when the provider returned no list at all.
        ...(analyticsMethodId === undefined ? {} : { deposit_method: analyticsMethodId }),
        value,
        currency: "USD",
        usd_value_at_time: value,
      });
    },
    [
      analyticsMethodId,
      amount,
      track,
      // Stable (`useCallback` with `[]` in the kit), declared so the exhaustive-deps rule can see it.
      abandonment.conclude,
    ],
  );

  /**
   * POO-1807 [R6]: read the baseline as soon as the amount step is live, never in the click.
   *
   * A failed read leaves `null`, which the CTA reads as "not ready" and says so. Retried on every
   * amount step entry rather than once per mount, so a buyer who fixes their connection and comes
   * back to the amount is not stuck behind a dead read.
   */
  useEffect(() => {
    if (!privyRail || step !== "amount" || !connectedAddress || !privyDestination) return;
    let live = true;
    setBaseline(undefined);
    readBalance({
      chain: privyDestination.chain,
      asset: privyDestination.asset,
      address: connectedAddress,
    })
      .then((value) => {
        if (live) setBaseline(value);
      })
      .catch(() => {
        // Honest: a failed read is not a zero balance. The CTA stays shut and the copy says why.
        if (live) setBaseline(null);
      });
    return () => {
      live = false;
    };
  }, [privyRail, step, connectedAddress, privyDestination, readBalance]);

  /**
   * POO-1807 [R7]: ask whether anyone will sell BEFORE the buyer clicks.
   *
   * It has to be here rather than in the click handler, and that is not a preference: the click has
   * to call `openCheckout` synchronously or the browser blocks the popup ([R3] of POO-1803), so an
   * awaited probe inside it would cost the buyer the checkout. Probed on the amount as it settles,
   * and its answer is what the click then reads.
   *
   * PP-INTEGRATION-POINT: the provider's quotes endpoint, through `PP-CORE-LIB-108`'s probe.
   */
  useEffect(() => {
    if (!privyRail || step !== "amount" || !privyDestination || !connectedAddress) return;
    if (amount < MIN_DEPOSIT || amount > MAX_DEPOSIT) return;
    // No currency, no question: the refusal below already answers this attempt, and probing a
    // currency we are about to refuse in would spend the rail's quota to learn nothing.
    const fiat = privyFiat;
    if (!fiat) return;
    let live = true;
    setCoverage(undefined);
    const timer = setTimeout(() => {
      probeCoverage({
        fiat,
        amount: String(amount),
        destination: { ...privyDestination, address: connectedAddress },
        // POO-1807 review (F3) / security S1: DERIVED, never a literal. `production` was hardcoded
        // here and at the checkout, so a dev or preview build probed (and would have charged)
        // against the live vendor environment. `resolveOnRampEnvironment` is the one answer both
        // hosts read (`PP-CORE-LIB-105`), so the probe and the purchase can never disagree.
        environment: resolveOnRampEnvironment(),
      })
        .then((result) => {
          if (live) setCoverage(result.status);
        })
        .catch(() => {
          // [R7]: `unknown` never blocks. A probe we could not run is our problem, not the buyer's.
          if (live) setCoverage("unknown");
        });
    }, ONRAMP_COVERAGE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [privyRail, step, amount, privyFiat, privyDestination, connectedAddress, probeCoverage]);

  // POO-1137 [R5]: the reconcile timed out with the purchase paid but not yet on-chain. Not a failure:
  // the money may still be landing (the rail already published a balance refresh), so show the settling
  // screen rather than a success or an error.
  const handleFiatSettling = useCallback(() => {
    setStep("onramp-settling");
  }, []);

  /**
   * POO-1642 [R8]: the pending question's REJECT half, so the one exit no button covers still
   * settles the promise the rail is awaiting.
   *
   * A ref rather than state because nothing renders off it, and because the teardown below has to
   * read the value that is live at unmount rather than one captured on the render that registered
   * the effect.
   */
  const pendingResumeRef = useRef<((reason: unknown) => void) | null>(null);
  useEffect(
    () => () => {
      /**
       * Rejecting, never resolving, and that choice is the whole rule.
       *
       * Resolving `"new"` here would mint the second purchase this issue exists to prevent, with
       * nobody left on screen to see it; resolving `"resume"` would reopen a vendor checkout onto an
       * unmounted screen. Leaving it pending is worse than both: `mintOnRampRequest` would await
       * forever, and with it the flow step, holding the whole run open on a question that can no
       * longer be answered.
       */
      pendingResumeRef.current?.(
        new TransactionError("The purchase was left before the question was answered", {
          code: "ONRAMP_ABANDONED",
        }),
      );
      pendingResumeRef.current = null;
    },
    [],
  );

  /**
   * POO-1642 [R2]/[R9]: hold the mint and ASK, when an in-flight purchase intent cannot be verified.
   *
   * The rail calls this from inside `mintOnRampRequest`, before anything is signed and before any
   * widget opens, so both answers are safe and neither has cost anything yet. What the two answers
   * MEAN differs by branch and is the rail hook's own code, not this screen's: see
   * {@link ConfirmResumePurchase}.
   *
   * The interception is this screen's blocked intent ([R9]). It fires here, on the question itself,
   * rather than on either answer: `Resume` and `Start a new purchase` are two answers to ONE blocked
   * attempt, and counting them separately would make the denominator (how often we interrupt a
   * buyer at all) unrecoverable.
   */
  const confirmResumePurchase = useCallback<ConfirmResumePurchase>(
    ({ startedAt, paid }) =>
      new Promise<"resume" | "new">((resolve, reject) => {
        pendingResumeRef.current = reject;
        track("tx_amount_blocked", {
          flow: "deposit",
          block_reason: paid ? "purchase_paid_unsettled" : "purchase_unverified",
          // The method being funded, when the provider gave us a list to name one from.
          ...(analyticsMethodId === undefined ? {} : { deposit_method: analyticsMethodId }),
        });
        setResumePrompt({
          startedAt,
          paid,
          decide: (choice) => {
            // Cleared BEFORE the resolve so the teardown above cannot also reject an answered
            // question, and so a second press on a button that has not re-rendered yet is inert.
            pendingResumeRef.current = null;
            setResumePrompt(null);
            resolve(choice);
          },
        });
      }),
    [track, analyticsMethodId],
  );

  // PP-A11Y [R7]: the question interrupts a purchase the buyer already confirmed, so focus goes to
  // it rather than being left on a screen that no longer holds the next action. The container is the
  // target (not the first button) so the whole question is announced before either answer is.
  useEffect(() => {
    if (resumePrompt) resumePromptRef.current?.focus();
  }, [resumePrompt]);

  // POO-1137: a terminal failure. TWO different events share this screen and must never share copy:
  // a PRE-settlement failure (declined / abandoned / SDK unavailable) moved no money, while a
  // POST-settlement one (the conversion leg's signature, chain switch or quote) happened after the
  // card was charged and the funds landed as ETH on Base. The failure's own code rides only the
  // analytics event, never the screen.
  const handleFiatFailed = useCallback(
    (failure: StandaloneOnRampFailure) => {
      setOnRampFailure(failure);
      /**
       * POO-1573 [R5] (rules v2): the purchase never STARTED, so it does not get the screen built for
       * one that did.
       *
       * The mint refuses an `ETH-BASE` order whose ETH target could not be priced, before the request
       * id is created and before the widget mounts. The failure screen would say "the purchase did not
       * go through" beside a Try again that walks back to this exact screen anyway, so the buyer is
       * simply kept here, on the review they were looking at, with the one fact they can act on: we
       * could not price ETH just now, try again. `charged`, the method and the amount are all still on
       * screen, so the retry is a single tap on Confirm rather than a re-entry.
       */
      setStep(
        failure.error.code === ONRAMP_ETH_UNPRICED_CODE && !failure.settled
          ? "review"
          : "onramp-error",
      );
      abandonment.conclude();
      track("deposit_failed", {
        ...(analyticsMethodId === undefined ? {} : { deposit_method: analyticsMethodId }),
        value: amount,
        /**
         * POO-1173 D1 [R2]: resolve the code, never forward it raw.
         *
         * The rail hands over the `TxError` as-is, so a declined conversion signature arrives as
         * the digits `"4001"` (`toTxError` stringifies the provider code). Forwarded verbatim it
         * failed `sanitizeParams`' shape guard and was DROPPED, so the failure event on the one
         * screen where money has already left the user's card reached GA4 with no `error_code` at
         * all. `toAnalyticsErrorCode` returns the stable code when there is one and the kind's name
         * otherwise, so this parameter is now unconditional: there is no blank branch left.
         */
        error_code: toAnalyticsErrorCode(failure.error, classifyTxError(failure.error)),
      });
    },
    [
      analyticsMethodId,
      amount,
      track,
      // Stable (`useCallback` with `[]` in the kit), declared so the exhaustive-deps rule can see it.
      abandonment.conclude,
    ],
  );

  /**
   * Try again, answered by WHERE the purchase got to.
   *
   * Post-settlement the money has already moved, so the only correct action is to resume the failed
   * step through the rail's live flow ([R7] and the wallet-sign family's "retry resumes" contract).
   * Going back to review would remount the rail, and a remounted rail reads a wallet that now clears
   * the gas floor: it would mint a second purchase and leave the first one's ETH unconverted.
   * Pre-settlement nothing moved, so review is exactly right and the mint resumes the journaled id.
   */
  function retryFiat() {
    /**
     * POO-1807 review (F8): on the Privy rail, Try again goes back to the AMOUNT step.
     *
     * `review` does not exist on this rail (the provider prices inside its own modal, so the step
     * has no data source and no confirm), and `onRampFailure` is only ever set by the Paybis rail,
     * so this handler used to drop a Privy buyer onto a dead screen with no way forward. Amount is
     * where their next attempt starts: the baseline and coverage effects re-arm there, which is
     * exactly what a retry needs.
     */
    if (privyRail) {
      setStep("amount");
      return;
    }
    if (onRampFailure?.settled) {
      setStep("onramp");
      onRampFailure.retry();
      return;
    }
    setOnRampFailure(null);
    setStep("review");
  }

  /**
   * POO-1807 [R1]/[R3]/[R7]/[R8]: the Privy rail's confirm, and the reason the amount step has been
   * doing work in the background.
   *
   * Everything this handler needs was resolved before it ran: the baseline ([R6]) and the coverage
   * answer ([R7]). That is not tidiness, it is the popup. `openCheckout` has to be reached inside
   * the click's own synchronous turn or the browser blocks the provider's window and the buyer sees
   * nothing at all, so this function awaits nothing before calling it.
   */
  function confirmFiatPrivy() {
    /**
     * POO-1813 [R2]: the only method choice this rail can honestly report.
     *
     * The provider owns the picker inside its own surface and never tells us which method was used,
     * so the Paybis-era value space (a `poolparty-*` identifier) has nothing behind it here. What
     * survives is the TOP-LEVEL choice the buyer really did make on this screen: buy with money
     * (`onramp`) or send crypto (`crypto`, on {@link openCrypto}). Emitted behind the rail check so
     * the Paybis series keeps its own identifiers until POO-1809 retires that rail.
     */
    track("deposit_method_selected", { deposit_method: "onramp" });
    track("deposit_submitted", {
      ...(analyticsMethodId === undefined ? {} : { deposit_method: analyticsMethodId }),
      value: amount,
    });

    // [R7]: the market said no. A refusal before anything opens, counted as its own blocked intent
    // and never as a failure, because nothing ran. `amount-too-low` is NOT this (POO-1805 rules v2):
    // it is the RAIL's display floor, below our own `MIN_DEPOSIT`, and it never reaches here.
    if (coverage === "uncovered") {
      track("tx_amount_blocked", { flow: "deposit", block_reason: "onramp_uncovered" });
      setStep("onramp-uncovered");
      return;
    }

    /**
     * POO-1801 review (F10): no currency we can charge in, no purchase.
     *
     * The refusal is the whole point. `?? "usd"` here would open a checkout denominated in dollars
     * for a buyer whose money is not dollars, which is POO-1512 [R5]'s defect with a new rail behind
     * it, and the adapter's own [R1] guard would not catch it because `usd` IS a valid code. Counted
     * as its own blocked intent so a currency-resolution outage shows up as a number rather than as
     * a support ticket about a surprising charge.
     */
    /**
     * [R6] belt and braces: the CTA is already disabled without a baseline, and this is what makes
     * that a compiler-checked fact rather than a UI convention. A missing baseline is NOT counted as
     * a blocked intent: the button the buyer pressed cannot be reached in that state, so an event
     * here would count a click nobody made.
     */
    if (baseline === undefined || baseline === null) return;

    const fiatCode = privyFiat;
    if (!fiatCode || !privyDestination || !connectedAddress) {
      track("tx_amount_blocked", {
        flow: "deposit",
        block_reason: "onramp_currency_unsupported",
      });
      setStep("onramp-currency-unsupported");
      return;
    }

    /**
     * [R8]: the prefill is USD-only in v1, and deliberately.
     *
     * `prefill.amount` is a USD figure produced by the standalone sizing (floor plus buffer). Passed
     * as a BRL or EUR `defaultAmount` it would be a wrong number on the buyer's card, and there is
     * no rate anywhere on this path to convert it with. The ADAPTER enforces that (POO-1803: it
     * sends `defaultAmount` only when `prefill.currency` matches `fiat.defaultAsset`), so a non-USD
     * buyer gets no prefill and the [R1] sentence tells them to enter what they want to pay instead.
     */
    const buffered = privyPrefillUsd;
    const assets =
      // [R2] of POO-1803: narrowed only when the probe actually answered. `unknown` keeps the full
      // list, because a probe we could not run must not shrink what the buyer may pay with.
      coverage === "covered" ? [fiatCode] : [...PRIVY_FIAT_CURRENCIES];

    // No `await` above this line.
    const pending = openCheckout({
      destination: privyDestination,
      address: connectedAddress,
      requested: { amount, currency: "USD" },
      prefill: { amount: buffered, currency: "USD" },
      fiat: { defaultAsset: fiatCode, assets },
      // (F3) / security S1: derived, exactly as the probe above derives it.
      environment: resolveOnRampEnvironment(),
      /**
       * POO-1802's record is wallet-scoped and keeps the zero mark, so the adapter mints it with the
       * baseline this screen already read ([R6]) rather than reading its own: a second read would be
       * a different instant, and an `await` before the popup ([R3] of POO-1803).
       *
       * A base-unit STRING, never a number: past ~9e15 base units a USDC balance is not float-safe.
       */
      baseline: { raw: baseline.toString(), decimals: ONRAMP_DESTINATION_DECIMALS },
    });
    /**
     * POO-1813 [R4]: the three things the settled row needs and the settlement handler cannot see.
     *
     * `prefill` is the buffered figure ONLY when it actually rides on the call: the adapter drops
     * `defaultAmount` when the prefill currency and the charge currency disagree, so for a non-USD
     * buyer we prefilled nothing and the row omits the field rather than reporting a zero we never
     * asked for.
     */
    privyFiguresRef.current = {
      requested: amount,
      prefill: fiatCode === "usd" ? buffered : undefined,
      fiatCurrency: fiatCode.toUpperCase(),
    };
    setCheckoutPending(pending);
    setDeliveredUsd(null);
    setStep("onramp");
  }

  /** [R9]: the observed delta landed. The receipt is built from it and from nothing else. */
  const handlePrivySettled = useCallback(
    (delivered: number, attemptId: string) => {
      setDeliveredUsd(delivered);
      setCompletedAt(todayMedium());
      setStep("success");
      requestBalanceRefresh();
      abandonment.conclude();
      /**
       * POO-1813 [R4]: the one honest money-in number, from the OBSERVED delta rather than the
       * promise resolving. Emitted through the shared module (`PP-CORE-LIB-111`) so this host and
       * the provisioning one produce the same four rows for the same purchase, joined on the
       * attempt id the checkout hands back.
       *
       * `fiat_currency` is what the card was CHARGED in, not the currency the figures are sized in:
       * `requested` and `prefill` are USD by construction on this screen, and reporting the charge
       * as USD for a buyer paying in reais is the POO-1512 defect wearing an analytics hat.
       */
      buyFunnel.settled(
        {
          rail: "privy",
          attemptId,
          fiatCurrency: privyFiguresRef.current.fiatCurrency,
        },
        {
          requestedUsd: privyFiguresRef.current.requested,
          ...(privyFiguresRef.current.prefill === undefined
            ? {}
            : { prefillUsd: privyFiguresRef.current.prefill }),
          deliveredUsd: delivered,
        },
      );
      track("deposit_completed", {
        ...(analyticsMethodId === undefined ? {} : { deposit_method: analyticsMethodId }),
        value: delivered,
        currency: "USD",
        usd_value_at_time: delivered,
      });
    },
    [analyticsMethodId, track, abandonment.conclude, buyFunnel],
  );

  /** [R9]: the checkout closed with money possibly moving. Never a failure, never a completion. */
  const handlePrivySettling = useCallback(() => {
    setStep("onramp-settling");
  }, []);

  /**
   * [R9]/[R10]: the visible window closed with no claim and no delta.
   *
   * Counted, because how often this happens is the evidence for whether 90 seconds is long enough.
   * NOT concluded: the passive window keeps observing for the rest of the same session and may
   * still settle the purchase, so concluding here would let one `deposit_started` produce two
   * settlement terms. It does not yet survive a reload; POO-1833 owns the cross-session resume.
   */
  const handlePrivyUnverified = useCallback(() => {
    track("tx_amount_blocked", {
      flow: "deposit",
      block_reason: "onramp_unverified",
      // POO-1813 [R1]: the window's own outcome, in the same vocabulary every other on-ramp failure
      // reports in. It asserts only that we never saw the money, never that nothing was charged,
      // which is why the row is a blocked intent and the code is not an `ONRAMP_*_FAILED`.
      error_code: "ONRAMP_UNVERIFIED",
    });
    setStep("onramp-unverified");
  }, [track]);

  /** [R9]: the ONLY path that may read like a failure. */
  const handlePrivyFailed = useCallback(
    (reason: string) => {
      abandonment.conclude();
      track("deposit_failed", {
        ...(analyticsMethodId === undefined ? {} : { deposit_method: analyticsMethodId }),
        value: amount,
        /**
         * POO-1813 [R1]: MAPPED, never the raw slug.
         *
         * `reason` is the classifier's own lowercase string (`popup_blocked`,
         * `destination_unavailable`), and `sanitizeParams` DROPS anything that fails
         * `isAnalyticsErrorCodeShape` (`^[A-Z]...`). Sent raw it reached GA4 as no `error_code` at
         * all, which is the exact blank dimension POO-1173 was opened to close.
         */
        error_code: onRampErrorCode(reason),
      });
      setStep("onramp-error");
    },
    [amount, analyticsMethodId, track, abandonment.conclude],
  );

  function confirmFiat() {
    track("deposit_submitted", {
      ...(analyticsMethodId === undefined ? {} : { deposit_method: analyticsMethodId }),
      value: amount,
    });
    if (isMockMode) {
      // PP-INTEGRATION-POINT: mock mode keeps the pre-epic mocked hosted-checkout handoff, a direct
      // success with no real purchase (premise 10, the launched surface is unchanged until the flag
      // flips). No widget ran, so there is no observed delta to report. This printed receipt is honest
      // here and ONLY here: the whole app is running on fixtures, so nobody was charged for it.
      completeFiat(null);
      return;
    }
    // POO-1794 [R1]/[R2]: real mode with `fiatOnRamp` dark. Past the mock guard, `!realRail` is
    // exactly "the flag is off", so the on-ramp is not launched: no provider is charged and no
    // settlement can be observed. Before this split the same branch printed a receipt and emitted a
    // `deposit_completed{value: amount}` here too, to a real production buyer, for a purchase that
    // never happened (the premise-11 violation this issue closes). Refuse instead: count the blocked
    // intent and CONCLUDE the abandonment so the funnel identity still closes with no phantom
    // walk-away, then show the terminal refusal rather than a receipt.
    if (!realRail) {
      abandonment.conclude();
      track("tx_amount_blocked", { flow: "deposit", block_reason: "onramp_disabled" });
      setStep("onramp-disabled");
      return;
    }
    // Real mode with the flag on: hand off to the standalone rail (widget + settlement +
    // swap-to-USDC). It owns the CONFIRMED settlement, which fires `deposit_completed` via
    // {@link completeFiat}; never here.
    setOnRampFailure(null);
    setStep("onramp");
  }

  function copyAddress() {
    if (!connectedAddress) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    /**
     * POO-1174 [R5] (rules v2): emit AFTER the write resolves. A copy the browser refused is not a
     * copy, and neither is one the browser could not attempt: `navigator.clipboard` is absent in
     * insecure contexts and some in-app browsers/WebViews, where the earlier
     * `Promise.resolve(...?.writeText(...))` shape resolved with `undefined` and counted a copy
     * that never happened. No Clipboard API means no write and no event; the optimistic UI above
     * is a separate concern from what we count and stays as it was.
     *
     * `chain_id` is the network the USER PICKED, not the wallet's current chain: this address is
     * being copied to receive funds on that specific network, and the two can differ. Resolved
     * from the deposit-local {@link DEPOSIT_CHAIN_IDS}, which covers Ethereum; the app-wide
     * `networkToChainId` knows only the three operating chains, so a mainnet pick used to emit no
     * `chain_id` at all. The record is total over the slug union, so the param is unconditional.
     *
     * The address is excluded BY DERIVATION. It never enters this object, in any shape, and is
     * deliberately not handed to `sanitizeParams` to be scrubbed: a value that is never present
     * cannot be missed by a scrubber, cannot be caught by a future log of the params, and cannot
     * reappear when someone adds a field here. `sanitizeParams` stays the backstop, not the
     * mechanism.
     */
    const write = navigator.clipboard?.writeText(connectedAddress);
    if (!write) return;
    void write
      .then(() => {
        track("deposit_address_copied", { chain_id: DEPOSIT_CHAIN_IDS[network.slug] });
      })
      .catch(() => {});
  }

  function shareAddress() {
    if (!connectedAddress) return;
    if (typeof navigator.share === "function") {
      navigator.share({ text: connectedAddress }).catch(() => {});
      return;
    }
    copyAddress();
  }

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-6 ${step === "amount" ? "max-w-md lg:max-w-[1100px]" : "max-w-md"}`}
    >
      {/* ── Amount ───────────────────────────────────────────────────────── */}
      {step === "amount" ? (
        <div className="lg:grid lg:grid-cols-[500px_320px] lg:items-start lg:justify-center lg:gap-6">
          <div className="flex flex-col gap-6 lg:rounded-xl lg:border lg:border-border lg:bg-surface lg:p-6">
            <div className="flex items-center justify-between gap-3">
              <h1 className="font-bold text-2xl text-foreground">{t("title")}</h1>
              {cryptoDepositAvailable ? (
                <button
                  type="button"
                  onClick={openCrypto}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 font-medium text-primary text-sm transition-colors hover:bg-primary/15 lg:hidden"
                >
                  {t("cryptoPill")}
                </button>
              ) : null}
            </div>

            {investBanner}

            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-muted-foreground text-sm">{t("addLabel")}</p>
              {/* Mobile: static display driven by the keypad */}
              <p className="flex items-center font-bold text-5xl text-foreground lg:hidden">
                <span>$</span>
                <span>{amountText || "0"}</span>
              </p>
              {/* Desktop: typed input */}
              <div className="hidden items-center justify-center font-bold text-5xl text-foreground lg:flex">
                <span>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={t("addLabel")}
                  value={amountText}
                  onChange={(event) =>
                    changeAmount(sanitizeNumericInput(event.target.value, { maxDecimals: 2 }))
                  }
                  className="w-48 bg-transparent text-center outline-none placeholder:text-muted-foreground"
                  placeholder="0"
                />
              </div>
              <p className="text-success text-sm">
                {t("receiveEstimate", { amount: formatNumber(amount) })}
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              {[50, 100, 250, 500].map((inc) => (
                <button
                  key={inc}
                  type="button"
                  onClick={() => {
                    changeAmount(toText(amount + inc));
                    /**
                     * POO-1172: the spec's `deposit_amount_select`, in the repo's vocabulary
                     * (POO-1169 [D], the Rosetta). Reports the PRESET the user pressed, not the
                     * resulting total: these chips are increments, so the total also encodes
                     * whatever they had typed before, and "which chip do people reach for" is the
                     * question the deposit keypad design is waiting on.
                     */
                    track("tx_amount_preset_used", {
                      flow: "deposit",
                      metric_name: "preset_usd",
                      metric_value: inc,
                    });
                  }}
                  className="rounded-full border border-border px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  +{formatUsd(inc)}
                </button>
              ))}
            </div>

            <AmountKeypad className="lg:hidden" onKey={applyKey} />

            {/*
              POO-1630: interactive in BOTH modes now, and the options are real in each.

              `currencyCode` stays what the SERVER echoed (`resolvedCurrency`), never `chosenCurrency`:
              the pick is a proposal, and a refused one must leave the screen exactly as it was rather
              than name a currency the figures beside it are not denominated in.

              The two modes differ only in the SOURCE of the set: mock reads its fixture, real reads
              POO-1621's live answer. Where the set is missing (a real-mode degrade), both `options`
              and `onSelect` are withheld together, because `CurrencySelect` treats either one alone as
              non-interactive and half a control is worse than none (POO-494 [R1]).

              PP-INTEGRATION-POINT: `getOnRampSupportedCurrenciesAction` via `useOnRampCurrencies`
              (PP-CORE-HOK-033); the proposal rides to `getOnRampPaymentMethodsAction` as
              `proposedCurrencyCodeFrom`; the ECHO is threaded to `StandaloneOnRampRail` and from there
              to `mintOnRampRequest`, so the checkout opens on the currency the review priced.
            */}
            {(() => {
              const options = isMockMode ? mockSupportedCurrencies : supportedCurrencies;
              return (
                <CurrencySelect
                  {...(resolvedCurrency === undefined ? {} : { currencyCode: resolvedCurrency })}
                  {...(options === undefined || options.length === 0
                    ? {}
                    : {
                        options,
                        onSelect: (code: string) => {
                          setChosenCurrency(code);
                          // Premise 11: the control ships with its event. POO-1618 declared this for
                          // provisioning's step and `/deposit` had no control to fire it until now,
                          // so the same decision on this screen was about to go unmeasured.
                          //
                          // Fires on the PICK, not on the echo, and deliberately not once per
                          // session: a buyer hunting for a currency that has Pix is a different
                          // signal from one who sets theirs once, and a proposal the server then
                          // refuses is still a decision the buyer made.
                          track("funding_method_currency_changed", {
                            flow: "deposit",
                            chain_id: ONRAMP_CHAIN_ID,
                            funding_method_currency: code,
                          });
                        },
                      })}
                />
              );
            })()}

            {allBlockedBanner}

            {/*
              POO-1612 S2: inline at `lg` and above, in the panel, between the amount block and
              Continue. `methodOpen` never becomes true here (the dialog stays a below-`lg` host,
              mounted and unchanged); `onSelect` is the SAME `handleMethodSelect` the dialog uses,
              hoisted rather than reimplemented, so a blocked activation reports once regardless of
              which surface it happened on. Rendered only when `isDesktop`, not merely `lg:flex`,
              so the dialog's own radios stay the only copy in the DOM below `lg` (see `isDesktop`'s
              own comment above for why this one case is JS- rather than CSS-gated).

              POO-1904 [R1]: and never on the PRIVY rail, in this host or the dialog below. This is
              a Paybis method list (its rows, its `displayName`s, its per-row `Minimum EUR 8.59`),
              and on the Privy rail the provider's own modal owns method selection, so a picker of
              ours offers a choice the buyer does not actually get to make and prints another
              vendor's minimums beside it. The comment at `privyRail`'s own declaration already
              asserted "behind `privyRail` the method step does not exist at all"; POO-1807 shipped
              that for the STEP and left both method surfaces standing, which is what this closes.
            */}
            {!privyRail && isDesktop ? (
              <div className="flex flex-col gap-2">
                <p className="font-medium text-foreground text-sm">{t("method.title")}</p>
                <PaymentMethodList
                  {...(methods === undefined ? {} : { methods })}
                  {...(methodId === undefined ? {} : { value: methodId })}
                  charges={chargesByMethod}
                  enteredAmount={amount}
                  loading={buyQuote.methodsLoading ?? false}
                  onSelect={handleMethodSelect}
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              {amount < MIN_DEPOSIT ? (
                <p className="text-center text-sm text-warning">
                  {t("minHint", { min: formatUsd(MIN_DEPOSIT) })}
                </p>
              ) : amount > MAX_DEPOSIT ? (
                <p className="text-center text-sm text-warning">
                  {t("maxHint", { max: formatUsd(MAX_DEPOSIT) })}
                </p>
              ) : null}
              {/*
                Below `lg` (and unmeasured) Continue OPENS the dialog (S4, unchanged); at `lg` and
                above the choice is already on screen, so Continue ADVANCES straight to review (S3)
                and `method.continue` (the dialog's own button) stays the only OTHER CTA, never a
                second one visible at once (P3). One button, not two: see `isDesktop`'s comment.
              */}
              <Button
                className="w-full"
                size="lg"
                disabled={
                  amount < MIN_DEPOSIT ||
                  amount > MAX_DEPOSIT ||
                  allBlocked ||
                  // POO-1807 [R6]: no baseline, no purchase. Absent (in flight) or null (the read
                  // failed) both keep it shut, and the message below says which.
                  (privyRail && (baseline === undefined || baseline === null))
                }
                onClick={
                  privyRail
                    ? confirmFiatPrivy
                    : () => (isDesktop ? setStep("review") : setMethodOpen(true))
                }
              >
                {t("continue")}
              </Button>
              {/* POO-1807 [R1]: our sentence, BEFORE the checkout shows a larger figure than the one
                  the buyer typed. Without it that figure reads as an error. [R8]: a non-USD buyer
                  gets no prefill at all, so the sentence tells them to enter the amount instead. */}
              {privyRail ? (
                <p className="text-center text-muted-foreground text-xs">
                  {privyFiat === "usd"
                    ? t("onramp.checkout.approx", { amount: formatNumber(amount) })
                    : t("onramp.checkout.approxNoPrefill", { amount: formatNumber(amount) })}
                </p>
              ) : null}
              {privyRail && baseline === null ? (
                <p className="text-center text-sm text-warning">
                  {t("onramp.checkout.baselineUnavailable")}
                </p>
              ) : null}
              {/*
                POO-1904 [R3]: PROVIDER-NEUTRAL on the Privy rail, never rail-aware. This is the
                step that takes the card, and it was naming a counterparty that is definitely not
                involved in the charge: Privy brokers to Stripe, MoonPay, Coinbase or Meld, and
                whichever it picks is what appears on the buyer's statement.

                The copy is SELECTED by rail and names a vendor in neither direction. Naming the
                real one is not implementable and would not be allowed if it were: the selection
                happens inside the provider's own modal after this screen is done, and our captured
                outcome records `category`, `reason`, `asset` and `environment` but not the
                provider, so "Secured by Stripe" on a MoonPay charge is the same merchant-of-record
                error pointed at a different vendor. Rejection 14 of the epic's handoff bans
                printing "Privy" here for exactly that reason, and settled the replacement as the
                house style already translated in `strategies.provisioning.onramp.*` ("secure
                checkout"), which this namespace was already using in `onramp.checkout.*`.

                `securedByPaybis` stays, and stays naming Paybis: it is honest on the rail Paybis
                serves, which POO-1819 keeps as the 72-hour rollback target after cutover.
                POO-1809 deletes it with that rail.

                POO-1927 mirrors this key as `strategies.provisioning.secureCheckout`, with
                the same wording in all 12 locales, so the two screens cannot disagree about who
                takes the money. See `docs/COMPLIANCE_REGISTER.md` `CR-CORE-043`.
              */}
              <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
                <Lock className="size-3.5" aria-hidden="true" />
                {privyRail ? t("secureCheckout") : t("securedByPaybis")}
              </p>
            </div>
          </div>
          <aside className="mt-2 hidden flex-col gap-4 lg:flex">
            {cryptoDepositAvailable ? (
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
                <p className="font-semibold text-foreground">{t("cryptoAside.title")}</p>
                <p className="mt-1 text-muted-foreground text-sm">{t("cryptoAside.body")}</p>
                <button
                  type="button"
                  onClick={openCrypto}
                  className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md border border-primary/50 font-semibold text-primary text-sm transition-colors hover:bg-primary/10"
                >
                  {t("cryptoPill")}
                </button>
              </div>
            ) : null}
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="font-semibold text-foreground">{t("howItWorks.title")}</p>
              <ol className="mt-3 flex flex-col gap-3">
                {[t("howItWorks.step1"), t("howItWorks.step2"), t("howItWorks.step3")].map(
                  (text, i) => (
                    <li key={text} className="flex gap-3 text-sm">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised font-semibold text-foreground text-xs">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{text}</span>
                    </li>
                  ),
                )}
              </ol>
            </div>
          </aside>
        </div>
      ) : null}

      {/* ── Review ───────────────────────────────────────────────────────── */}
      {step === "review" ? (
        <>
          <button
            type="button"
            onClick={() => setStep("amount")}
            className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {t("review.title")}
          </button>

          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-muted-foreground text-sm">{t("review.youReceive")}</p>
            <p className="mt-1 font-bold text-3xl text-foreground">
              {formatTokenAmount(amount, "USDC", 2)}
            </p>
            <div className="mt-4 flex flex-col gap-3 border-border border-t pt-4">
              {/* POO-1513 S3: the vendor's own charge, in the currency the vendor bills, or an
                  explicit "we do not have a figure" rather than one we computed. The deleted
                  `PROCESSING_RATES` row printed a 0% fee to a bank-transfer buyer whose card was
                  then charged ~2.78%: a fee line the app cannot substantiate is worse than none. */}
              <Row label={t("review.youPay")} value={chargeText ?? t("review.payAtCheckout")} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
            <span className="text-foreground text-sm">
              {methodLabel
                ? t("review.payingWith", { method: methodLabel })
                : t("review.choosePayment")}
            </span>
            <button
              type="button"
              onClick={() => setMethodOpen(true)}
              className="font-medium text-primary text-sm hover:underline"
            >
              {t("review.change")}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {/* POO-1573 [R5] (rules v2): the mint refused because ETH could not be priced. Stated
                here, above the button that retries it, because that is the only action available and
                the alternative (a card charge in dollars after this screen offered a bank transfer in
                euros) is the defect the whole issue exists to close. Same warning treatment as the
                shortfall line beside it: nothing was charged, so this is not an error state. */}
            {onRampFailure?.error.code === ONRAMP_ETH_UNPRICED_CODE ? (
              <p role="status" className="text-center text-sm text-warning">
                {t("review.ethUnpriced")}
              </p>
            ) : null}
            {belowNeed ? (
              <p className="text-center text-sm text-warning">
                {t("review.belowNeed", { amount: formatUsd(shortfall) })}
              </p>
            ) : null}
            <Button className="w-full" size="lg" onClick={confirmFiat} disabled={belowNeed}>
              {methodLabel
                ? t("review.confirm", { method: methodLabel })
                : t("review.confirmGeneric")}
            </Button>
            <p className="text-center text-muted-foreground text-xs">{t("review.poweredBy")}</p>
          </div>
        </>
      ) : null}

      {/* ── Fiat success ─────────────────────────────────────────────────── */}
      {step === "success" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">{t("success.title")}</h1>
            <p className="mt-1 text-muted-foreground text-sm">{t("success.subtitle")}</p>
          </div>
          <div className="w-full rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-col gap-3">
              {/* Omitted, never guessed, when nothing substantiates it: no observed settlement and
                  no quoted charge means this screen does not know what the buyer paid, and the
                  received row below already says what landed. */}
              {receiptText ? <Row label={t("success.amount")} value={receiptText} /> : null}
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{t("success.received")}</span>
                <span className="font-medium text-success">
                  {formatTokenAmount(receiptUsdc, "USDC", 2)}
                </span>
              </div>
              {/* Omitted rather than blank when the provider returned no list: naming a method the
                  buyer never saw would be a claim about how they paid. */}
              {methodLabel ? <Row label={t("success.method")} value={methodLabel} /> : null}
              <Row label={t("success.date")} value={completedAt} />
            </div>
          </div>
          {/* POO-1807 [R2]: the delivery landed under the platform minimum. The receipt above still
              prints the real figure, because the money IS in the wallet (ADR-0004); this line says
              why the next step is not offered, and the invest CTA is withheld rather than rendered
              into a refusal the operation boundary would raise anyway (POO-1806/1808). */}
          {belowPlatformMinimum ? (
            <p className="text-center text-muted-foreground text-sm">
              {t("onramp.checkout.belowMinimum", { amount: formatUsd(ON_RAMP_FLOOR_USD) })}
            </p>
          ) : null}
          <div className="flex w-full flex-col gap-2">
            {belowPlatformMinimum ? null : (
              <Link
                href={investHref}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
              >
                {t("success.investNow")}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            )}
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised"
            >
              {t("success.backHome")}
            </Link>
            {/* PR #868 convention (PP-CORE-CMP-050/071): the explorer affordance sits below the
                state button as its quiet secondary action, matching ExplorerTxLink's `ghost`
                geometry exactly (h-11, full width, no border/fill) — hand-rolled rather than that
                component because this links an ADDRESS, which it does not support (POO-1617). */}
            {explorerWalletUrl ? (
              <a
                href={explorerWalletUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
              >
                {t("success.viewWalletOnExplorer")}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── The in-flight purchase we cannot verify (POO-1642 [R3]/[R4]/[R7]) ──
          Asked, never assumed. `paidAt` records only what we OBSERVED, and money moves without us
          observing it: a bank transfer, where the buyer leaves for their banking app long before
          `completed`; a 3DS redirect, which unloads the page and its listener; a dismissal
          mid-checkout; a parser drift on a channel that has silently dropped events before.
          Resuming blind reopens an id Paybis may have expired, or worse lands the buyer on the
          vendor's completed screen with nothing to do; minting blind opens a SECOND purchase beside
          funds that may still be landing. Only the buyer knows which, so the buyer is asked.

          Two answers and no dismiss, deliberately ([R7]): the mint is awaiting this, so a third
          silent exit would be the silence the question exists to break. Teardown is the one path
          no button covers, and it REJECTS rather than resolving ([R8]).

          Rendered BEFORE the rail, not after: the rail's card is `min-h-[26rem]`, so a question
          placed under it lands below the fold on a phone. `.focus()` scrolls it into view in a real
          browser, but the buyer would still meet a spinner first and a blocking question second. */}
      {resumePrompt ? (
        <div
          ref={resumePromptRef}
          role="alertdialog"
          aria-labelledby="deposit-resume-title"
          aria-describedby="deposit-resume-body"
          tabIndex={-1}
          className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 focus-visible:outline-none"
        >
          <p id="deposit-resume-title" className="font-semibold text-sm text-warning">
            {t(resumePrompt.paid ? "onramp.resume.paidTitle" : "onramp.resume.title")}
          </p>
          <p id="deposit-resume-body" className="text-muted-foreground text-sm">
            {t(resumePrompt.paid ? "onramp.resume.paidBody" : "onramp.resume.body", {
              minutes: Math.max(1, Math.round((Date.now() - resumePrompt.startedAt) / 60_000)),
            })}
          </p>
          <div className="flex flex-col gap-2">
            <Button className="min-h-11 w-full" onClick={() => resumePrompt.decide("resume")}>
              {t(resumePrompt.paid ? "onramp.resume.keepWaiting" : "onramp.resume.resume")}
            </Button>
            <Button
              variant="ghost"
              className="min-h-11 w-full"
              onClick={() => resumePrompt.decide("new")}
            >
              {t("onramp.resume.startNew")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── On-ramp settling (paid, money still landing — POO-1037/POO-1136) ── */}
      {step === "onramp-settling" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Loader2 className="size-8 animate-spin" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">{t("onramp.settlingTitle")}</h1>
            <p className="mt-1 text-muted-foreground text-sm">{t("onramp.settlingBody")}</p>
          </div>
          <Link
            href="/"
            className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised"
          >
            {t("success.backHome")}
          </Link>
        </div>
      ) : null}

      {/* ── On-ramp (real rail: Paybis widget + swap-to-USDC) ──────────────
          Deliberately mounted through `onramp-error` too: the rail owns the running flow, and a
          post-settlement Try again has to RESUME its failed step. Unmounting it here is what made a
          settled purchase re-mintable. It renders nothing once the flow is terminal, so the error
          screen below is the only thing on the page. */}
      {/* POO-1807 [R4]/[R5]: the Privy rail's own body. It plugs into the same `onramp` step the
          Paybis rail does, and owns the observation window; this screen keeps the step machine and
          the funnel. The checkout was OPENED by the click handler, so what travels down is the
          promise: see the component's header for why it cannot be opened on mount.

          MOUNTED THROUGH `onramp-settling` (POO-1807 review F1), for exactly the reason the Paybis
          rail above is mounted through `onramp-error`: the observation window lives inside that
          component's effect. It was mounted for `step === "onramp"` alone, and its own
          `onSettling()` moves this screen to `onramp-settling`, so the first thing it reported
          unmounted it, the effect cleanup set `live = false`, and `onSettled` / `onUnverified` were
          unreachable. No Privy purchase could ever settle. It renders null once it has reported
          settling, so this screen's settling copy is the only thing on the page. */}
      {privyRail &&
      (step === "onramp" || step === "onramp-settling") &&
      checkoutPending &&
      baseline !== undefined &&
      baseline !== null &&
      privyDestination &&
      connectedAddress ? (
        <DepositPrivyCheckout
          pending={checkoutPending}
          baseline={baseline}
          address={connectedAddress}
          readBalance={readBalance}
          onSettled={handlePrivySettled}
          onSettling={handlePrivySettling}
          onUnverified={handlePrivyUnverified}
          onFailed={handlePrivyFailed}
        />
      ) : null}

      {/* POO-1807 [R7]: nobody will sell. Stated as the market's answer, with no failure wording:
          nothing ran and nothing was charged. */}
      {step === "onramp-uncovered" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
            <AlertTriangle className="size-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">
              {t("onramp.checkout.uncoveredTitle")}
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {t("onramp.checkout.uncoveredBody", {
                currency: (resolvedCurrency ?? "USD").toUpperCase(),
              })}
            </p>
          </div>
          <Button className="w-full" size="lg" onClick={() => setStep("amount")}>
            {t("onramp.tryAgain")}
          </Button>
        </div>
      ) : null}

      {/* POO-1801 review (F10): we cannot charge in this buyer's money. Same shape as the uncovered
          refusal (nothing opened, nothing was charged) and deliberately a different body: the buyer
          can act on "not in your currency" and cannot act on "not right now". */}
      {step === "onramp-currency-unsupported" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
            <AlertTriangle className="size-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">
              {t("onramp.checkout.uncoveredTitle")}
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {t("onramp.checkout.currencyUnsupportedBody")}
            </p>
          </div>
          <Button className="w-full" size="lg" onClick={() => setStep("amount")}>
            {t("onramp.tryAgain")}
          </Button>
        </div>
      ) : null}

      {/* POO-1807 [R9] / ADR-0006: the honest state. No cancellation wording appears here, because
          we do not know that nothing was charged; we know only that we never saw a delta. */}
      {step === "onramp-unverified" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
            <AlertTriangle className="size-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">
              {t("onramp.checkout.unverifiedTitle")}
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {t("onramp.checkout.unverifiedBody")}
            </p>
          </div>
        </div>
      ) : null}

      {/* POO-1807 review (F2): `!privyRail` gates BOTH steps, not just `onramp`.
          `(onramp && !privyRail) || onramp-error` mounted the PAYBIS rail on the Privy rail's own
          error screen, and this rail auto-runs on mount: it mints a Paybis purchase and can open the
          vendor's widget over a buyer whose Privy checkout just failed. The error step's copy is
          rendered below either way, so nothing on screen depended on the rail being here. */}
      {(step === "onramp" || step === "onramp-error") && !privyRail ? (
        // POO-1513 S2: `paymentMethod` is the boundary the selection used to die at. The rail passes
        // it to `mintOnRampRequest`, which is what puts it on the quote AND on
        // `createOnRampRequestAction` (POO-1578 S3).
        <StandaloneOnRampRail
          receiveUsd={amount}
          {...(methodId === undefined ? {} : { paymentMethod: methodId })}
          {...(resolvedCurrency === undefined ? {} : { currencyCodeFrom: resolvedCurrency })}
          // POO-1642 [R1]/[R2]: the question this screen can ask and the rail cannot. Without it the
          // mint decides in silence, and both of its silent answers are the production report: the
          // buyer stuck on the vendor's completed screen, or the card charged twice.
          confirmResume={confirmResumePurchase}
          onSettled={completeFiat}
          onSettling={handleFiatSettling}
          onFailed={handleFiatFailed}
        />
      ) : null}

      {/* ── On-ramp error ───────────────────────────────────────────────────
          Pre-settlement: nothing moved, and Try again returns to review (the mint then reuses the
          journaled id, [R7]). Post-settlement: the card WAS charged and the funds are resting as ETH
          on Base, so the copy says so and Try again resumes the failed conversion step instead. */}
      {step === "onramp-error" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
            <AlertTriangle className="size-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">
              {onRampFailure?.settled ? t("onramp.settledErrorTitle") : t("onramp.errorTitle")}
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {onRampFailure?.settled ? t("onramp.settledErrorBody") : t("onramp.errorBody")}
            </p>
          </div>
          {/* POO-1367: the support handle, on the one on-ramp screen where the user most needs it.
              A failed purchase is the case where they WILL contact support, and until now this
              screen gave them nothing to quote. Same resolution order and the same `select-all`
              affordance as `TransactionErrorActions` ([R1] there): the backend's correlation id,
              falling back to the browser trace id, and selectable text rather than a copy button
              alone, because the Clipboard API is absent in an insecure context. */}
          {onRampReference ? (
            <dl className="flex w-full items-center justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground text-xs">
                {t("onramp.referenceLabel")}
              </dt>
              <dd className="min-w-0 select-all break-all text-right font-mono text-muted-foreground text-xs">
                {onRampReference}
              </dd>
            </dl>
          ) : null}
          {/* POO-1403 [R1]: the row above is OUR id and Paybis has never heard of it. This is theirs,
              and it is the only identifier their support can act on, which for a failed purchase is
              the only thing that answers "was I charged". Named after the vendor so the user hands
              the right id to the right party, and omitted rather than blank when none was journaled
              (a user quotes an empty reference as faithfully as a real one). */}
          {paybisRequestId ? (
            <dl className="flex w-full items-center justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground text-xs">
                {t("onramp.paybisReferenceLabel")}
              </dt>
              <dd className="min-w-0 select-all break-all text-right font-mono text-muted-foreground text-xs">
                {paybisRequestId}
              </dd>
            </dl>
          ) : null}
          <div className="flex w-full flex-col gap-2">
            <Button className="w-full" size="lg" onClick={retryFiat}>
              {t("onramp.tryAgain")}
            </Button>
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised"
            >
              {t("success.backHome")}
            </Link>
          </div>
        </div>
      ) : null}

      {/* ── On-ramp disabled (real mode, `fiatOnRamp` dark) ─────────────────
          POO-1794 [R1]: the on-ramp is not launched, so the confirm cannot complete. A terminal
          refusal that mounts NO rail (unlike `onramp-error` above, which keeps the running flow
          mounted), reusing the "nothing moved" copy so no new string is introduced. Try again returns
          to review; while the flag stays dark the confirm refuses again, and each press is honestly
          counted as a fresh blocked intent (premise 11 counts the ATTEMPT). */}
      {step === "onramp-disabled" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
            <AlertTriangle className="size-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">{t("onramp.errorTitle")}</h1>
            <p className="mt-1 text-muted-foreground text-sm">{t("onramp.errorBody")}</p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Button className="w-full" size="lg" onClick={() => setStep("review")}>
              {t("onramp.tryAgain")}
            </Button>
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised"
            >
              {t("success.backHome")}
            </Link>
          </div>
        </div>
      ) : null}

      {/* ── Crypto receive ───────────────────────────────────────────────── */}
      {step === "crypto-receive" ? (
        <>
          <button
            type="button"
            onClick={() => setStep("amount")}
            className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {t("crypto.title")}
          </button>

          {investBanner}

          {connectedAddress ? (
            <>
              {/* Chosen network + a way to change it (POO-479 R3). */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
                <span className="flex min-w-0 items-center gap-2">
                  <NetworkLogo
                    network={network.slug}
                    name={network.name}
                    size={20}
                    className="size-5"
                  />
                  <span className="truncate font-medium text-foreground text-sm">
                    {network.name}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setNetworkOpen(true)}
                  className="shrink-0 font-medium text-primary text-sm hover:underline"
                >
                  {t("crypto.changeNetwork")}
                </button>
              </div>

              <div className="flex flex-col items-center gap-4">
                <p className="font-semibold text-foreground">{t("crypto.scanToDeposit")}</p>
                <div className="rounded-2xl bg-white p-3">
                  <QrBlock value={connectedAddress} className="size-44" />
                </div>
                <span className="rounded-full border border-border px-3 py-1 text-foreground text-xs">
                  {t("crypto.asset")}
                </span>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="text-muted-foreground text-xs">{t("crypto.addressLabel")}</p>
                <p className="mt-1 break-all font-mono text-foreground text-sm">
                  {connectedAddress}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={copyAddress}>
                    {copied ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                    {/* POO-1786 [R1]: the label is an element React owns. `Check` and `Copy` are
                        different types, so the swap inserts the new icon BEFORE its sibling, and a
                        bare text node that Chrome page translation rewrote is no longer where React
                        left it (the POO-1762 crash, see `Button.tsx`). A bare span is one flex item
                        where the anonymous one was, so the layout is unchanged. */}
                    <span>{copied ? t("crypto.copied") : t("crypto.copy")}</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1" onClick={shareAddress}>
                    <Share2 className="size-4" aria-hidden="true" />
                    {t("crypto.share")}
                  </Button>
                </div>
              </div>

              {/* Network-specific loss-of-funds warning (POO-479 R2). */}
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-warning text-sm">
                {t("crypto.networkWarning", { network: network.name })}
              </p>

              {/* POO-604: there is no on-chain watcher / deposit webhook in production and won't be for
                  now, so the "I've sent the funds" confirm is the ONLY trigger that advances the crypto
                  flow — and it is needed only to RESUME the Deposit & Invest flow (POO-605). On the
                  standalone path there is nothing to resume, so the receive step is terminal: just the
                  address. The deposit lands in the wallet and the balance reflects it on the next
                  refetch — we never claim a "detected" state we cannot actually observe. */}
              {investContext ? (
                <Button className="w-full" size="lg" onClick={() => setStep("crypto-waiting")}>
                  {t("crypto.sent")}
                </Button>
              ) : null}
            </>
          ) : walletLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <p className="rounded-lg bg-surface-raised px-3 py-6 text-center text-muted-foreground text-sm">
              {t("crypto.noWallet")}
            </p>
          )}
        </>
      ) : null}

      {/* ── Crypto waiting ───────────────────────────────────────────────────
          POO-1624: this screen used to spin under "We'll detect it automatically. No need to do
          anything." while a 2500ms timer ran. Nothing was being detected, and refreshing or
          navigating away lost the wait entirely, so both halves of that sentence were false.

          What renders now is the same screen with the promise removed. The SPINNER is mock-only for
          the same reason the copy changed: a spinner asserts that something is being watched, and
          in real mode nothing is. In mock mode it is honest, because the fixture really does resolve
          two and a half seconds later.

          The invest return is here rather than only on the (mock-only) receipt: the "I've sent the
          funds" confirm exists to RESUME the investment without a webhook (POO-604 / POO-605), so
          losing the fabricated receipt must not also lose the way back to the strategy. Invest
          re-reads the real balance and will send the buyer back here if it is still short, which is
          the honest answer this screen cannot give by itself. */}
      {step === "crypto-waiting" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          {isMockMode ? (
            <span className="flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Loader2 className="size-8 animate-spin" aria-hidden="true" />
            </span>
          ) : null}
          <div>
            <h1 className="font-bold text-foreground text-xl">{t("crypto.waitingTitle")}</h1>
            <p className="mt-1 text-muted-foreground text-sm">{t("crypto.waitingBody")}</p>
          </div>
          <span className="max-w-full truncate rounded-full border border-border px-3 py-1 font-mono text-muted-foreground text-xs">
            {connectedAddress}
          </span>
          <div className="flex w-full flex-col gap-2">
            {isMockMode ? null : (
              <Link
                href={investHref}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
              >
                {t("success.investNow")}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            )}
            <Button variant="ghost" size="md" onClick={() => setStep("crypto-receive")}>
              {t("crypto.viewAddress")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── Crypto success ───────────────────────────────────────────────── */}
      {step === "crypto-success" ? (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-bold text-foreground text-xl">{t("crypto.receivedTitle")}</h1>
            <p className="mt-1 font-medium text-success">
              {t("crypto.added", { amount: formatNumber(cryptoReceived) })}
            </p>
          </div>
          <div className="w-full rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{t("crypto.received")}</span>
                <span className="font-medium text-success">
                  {formatTokenAmount(cryptoReceived, "USDC", 2)}
                </span>
              </div>
              <Row label={t("crypto.source")} value={t("crypto.sourceValue")} />
              <Row label={t("crypto.date")} value={completedAt} />
            </div>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Link
              href={investHref}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            >
              {t("success.investNow")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised"
            >
              {t("success.backHome")}
            </Link>
          </div>
        </div>
      ) : null}

      {/*
        POO-1904 [R1]: the below-`lg` half of the same removal, and NOT MOUNTED rather than left
        closed. On the Privy rail `methodOpen` can never become true (Continue takes the
        `confirmFiatPrivy` branch instead of `setMethodOpen(true)`), so a closed dialog is invisible
        today and this looks like a no-op. It is not. Reachability is an argument about one call
        site, and the rule is that the picker does not EXIST on this rail: mounted-but-closed keeps
        a Paybis list, its charges and its floors threaded into a live surface, one `setMethodOpen`
        away from the screen, and keeps a dialog in the accessibility tree that has no business on
        this rail. Absent is a structural fact; closed is a convention.
      */}
      {privyRail ? null : (
        <PaymentMethodDialog
          open={methodOpen}
          onOpenChange={setMethodOpen}
          {...(methods === undefined ? {} : { methods })}
          {...(methodId === undefined ? {} : { value: methodId })}
          charges={chargesByMethod}
          enteredAmount={amount}
          loading={buyQuote.methodsLoading ?? false}
          onSelect={handleMethodSelect}
          onContinue={() => {
            setMethodOpen(false);
            setStep("review");
          }}
        />
      )}

      <NetworkPickerDialog
        open={networkOpen}
        onOpenChange={setNetworkOpen}
        value={network}
        onSelect={setNetwork}
        onContinue={() => setNetworkOpen(false)}
      />
    </div>
  );
}
