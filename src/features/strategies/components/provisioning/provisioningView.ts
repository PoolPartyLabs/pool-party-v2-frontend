/**
 * @id PP-CORE-LIB-018 (POO-1596, POO-1927)
 * @name provisioningView
 * @implements-rules-version v7 (POO-1927 rules v1) · v6 (POO-1596 rules v1) · v5 (POO-1575 rules v2) · v4 (POO-1136 / POO-1129 rules v3) · v3 (POO-1087 rules v1) · v2 (POO-1041 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Pure mapper from a {@link ProvisioningPlan} to the wizard's Plan-state view model (PP-CORE-MOD-011,
 * POO-409). Each step becomes a numbered row (badge = 1-based display index, NOT `step.key`) with a
 * title `labelKey`, a caption key, an optional amount, and flags for the special rows: the op anchor
 * (renders the caller's `opLabel`) and the swap-gas row (renders the inline `GasAmountSelector`).
 *
 * No "You pay" total is produced (fees stay abstracted, decided 2026-06-30). No React, no i18n calls:
 * every row carries KEYS plus the values to interpolate into them, and the component resolves `t`
 * (POO-1041 [R5]).
 *
 * ## v2, POO-1041: the same rows describe what will REALLY run
 *
 * A mock plan is a list of display steps. A real plan is a route, and the two differ in ways the user
 * signs for:
 *
 * - **The rail expands a step into two.** Every ERC-20 leg needs its allowance granted first, so
 *   `buildPlanSteps` (POO-1036) emits an approval step the plan itself does not contain. Passing
 *   {@link PlanViewOptions.railSteps} folds those rows in, so the card lists what the wallet will
 *   actually be asked for instead of a shorter, prettier fiction. It also means `plan.steps[i]` and
 *   rail step `i` are different steps, which is why status and hashes here are matched by KEY and
 *   never by position ([R6]).
 * - **The route has real figures.** A bridge row carries the quote's own ETA ([R2]) and, once a real
 *   quote priced the leg, its USD amount. The mock-era rule that a bridge row shows no amount
 *   survives only where it is still true: a fixture plan has no leg, so there is no figure to show.
 * - **A broadcast leg is verifiable.** Once a hash exists the row carries it plus the API network of
 *   the chain it was broadcast on, which is all {@link ExplorerTxLink} needs. No hash, or a chain
 *   this app does not support, means NO link rather than an explorer home page ([R4]).
 *
 * Network names come from `src/lib/chains/config.ts` ([R3]). The local literal map this file used to
 * hold is gone: it was one of several copies in the repository, and the drift it invites is silent
 * (a chain added to the config renders with a hole where its name should be).
 *
 * ## v5, POO-1575: the buy row says what THIS buyer can pay with
 *
 * The `buy` caption was the literal string "Card or Pix" in all 12 locales, shown to every buyer in
 * every country. Half of it was a promise about a Brazilian rail most buyers are never offered, and
 * the copy could not have been right, because it was written before anything knew which currency
 * would resolve. The methods are DATA now (`useBuyRouteQuote().methods`, POO-1578), so the caption
 * takes them from {@link PlanViewOptions.buyPaymentMethods} and names at most two of them; with
 * none resolved it falls back to a caption that names no method rather than inventing one.
 *
 * ### rules v2 [R8]: a method list belongs to a CURRENCY, so the caption checks the currency
 *
 * The list is fetched per `currencyFrom` (POO-1512), so "the methods the buyer can use" is only
 * true of the fiat that list was resolved for. The fiat a given `buy` LEG is charged in is decided
 * separately, at mint time, by `resolveWidgetPrefill` (`useProvisioningRail`): a received-fixed
 * order lets the buyer's own currency resolve, a spend-fixed one is pinned to `order.fiatCurrency`,
 * which `sizeOnRampOrder` writes as the constant `"USD"`. When those two answers differ, naming the
 * buyer's own rails over a widget that will open in dollars is the very overpromise this issue
 * removes, one layer down, so {@link BuyPaymentMethods} makes the host state both and the row names
 * nothing unless they agree. The check is a comparison, never a second resolution ([R6]).
 *
 * ### v6, POO-1596: a method list belongs to a PAIR as well, and the fiat check cannot see that
 *
 * The list is fetched per (`currencyCodeTo`, `currencyFrom`), and the check above only ever read the
 * second half. That was safe by ACCIDENT: before POO-1573 a gas-first `ETH-BASE` leg was
 * unconditionally billed in USD, so listing the wrong pair surfaced as a mismatched fiat and the
 * currency comparison caught it. POO-1573 made that leg received-fixed too, so it adopts the buyer's
 * own currency, both fiat halves now agree for EVERY buyer, and the guard passes on a list resolved
 * for a pair this leg will never mint, with a different fee schedule and a different method set.
 *
 * So {@link BuyPaymentMethods.listedForPair} is the second half, compared against the step's own
 * `order.currencyCode` - the pair `sizeOnRampOrder` decided and the pair the mint lists for
 * (`useProvisioningRail`). Still a comparison, still no second resolution ([R6]).
 *
 * ## v7, POO-1927: the row credits the rail that serves, and names no vendor on Privy
 *
 * The row carried `poweredByPaybis: boolean`, which could only answer "Paybis, or nothing", so the
 * plan card printed "Powered by Paybis" on every fiat leg including ones Privy brokers through
 * Stripe or MoonPay. It carries {@link PlanRow.attributionKey} now, decided from the rail by
 * {@link ATTRIBUTION_KEY} beside `labelKey` and `captionKey`, which keeps the decision here where it
 * is testable without React and leaves the card resolving a key like it resolves every other.
 *
 * Two inputs, with a deliberate precedence. `ProvisioningStep.poweredBy` says WHETHER a row is
 * attributable at all, so nothing can stamp a vendor onto the op anchor or a bridge;
 * {@link PlanViewOptions.onRampRail}, the host's live reader, says WHICH. The host wins because the
 * rail that takes the money is the one the panel's execution branch reads, while the plan was built
 * by a server action blind to a Dev-menu override.
 */
import {
  apiNetworkForChain,
  chainDisplayName,
  getUsdcAddress,
  nativeSymbol,
} from "@/lib/chains/config";
import type {
  OnRampAttribution,
  ProvisioningLeg,
  ProvisioningPlan,
  ProvisioningStep,
  ProvisioningStepStatus,
  ProvisioningStepType,
} from "@/lib/provisioning";
import { NATIVE_TOKEN_ADDRESS, sameEndpoint } from "@/lib/provisioning";
import type { PlanRailStep } from "../../lib/buildPlanSteps";

/** Caption i18n key per step type. */
/**
 * Caption i18n key per step type.
 *
 * POO-1087 [F4-R2]: every caption now says something about THIS step rather than about the route.
 * `swap-token` names the network it runs on, `bridge` names where the funds come FROM (the title
 * already says where they go), and `swap-gas` names what pays for it.
 */
// A TOTAL `Record`, not `Partial` (POO-1131): a missing key would compile clean and silently drop
// the row's caption. On the `buy` row that caption is what the vendor attribution hangs off
// (`ProvisioningPlanCard` gates it on `captionKey`), so a dropped `buy` would quietly remove a
// required provider attribution. Being total, `satisfies` the union forces every step type,
// including a future one, to declare a caption here at compile time.
const CAPTION_KEY: Record<ProvisioningStepType, string> = {
  // POO-1575: the NEUTRAL caption, which names no payment method. It used to read "Card or Pix" to
  // every buyer in every country; see {@link BUY_METHODS_CAPTION_KEY} for the resolved variant.
  buy: "provisioning.captions.buy",
  bridge: "provisioning.captions.bridge",
  "bridge-gas": "provisioning.captions.bridge",
  "swap-token": "provisioning.captions.onNetwork",
  "swap-gas": "provisioning.captions.swapGas",
  op: "provisioning.captions.op",
};

/**
 * The `buy` caption once the buyer's own payment methods are known (POO-1575 [R1]).
 *
 * A SECOND key rather than a dynamic entry in {@link CAPTION_KEY}: the map stays a total
 * `Record<ProvisioningStepType, string>`, both branches hand the row a caption key that is always a
 * string, and the vendor attribution that hangs off `captionKey` existing therefore cannot disappear
 * because a method list did or did not resolve ([R4]).
 */
const BUY_METHODS_CAPTION_KEY = "provisioning.captions.buyMethods";

/**
 * How many resolved methods a caption names ([R2]).
 *
 * Two, because the line is a compact sub-line beside the vendor attribution and a currency that
 * offers six rails would turn it into a list. Naming two of six is honest (both ARE offered and the
 * user picks inside the widget); naming a rail the buyer will never be offered, which is what the
 * hardcoded "Card or Pix" did in every locale, is not.
 */
const MAX_NAMED_PAYMENT_METHODS = 2;

/** The allowance row's title, reusing the wallet stepper's shipped copy rather than a second key. */
const APPROVE_LABEL_KEY = "sign.steps.approve";

/**
 * The methods a caption may name, normalized: trimmed, blanks dropped, deduplicated
 * case-insensitively, capped at {@link MAX_NAMED_PAYMENT_METHODS}, order preserved.
 *
 * The order is the caller's, so a host that knows which method it PRICED can lead with it
 * (`[methodLabel, ...methods.map((m) => m.displayName)]`, the duplicate being what the dedupe is
 * for). Deduplication is not defensive dressing: Paybis returns several processors under one
 * `displayName`, and "Credit Card or Credit Card" is a rendering nobody would ship on purpose.
 *
 * Module-private: {@link formatPaymentMethods} and {@link stepRow} are its only callers, and both
 * are covered end to end by tests that go through them. It was exported with nothing importing it
 * (POO-1575 review, finding 5), which is an API surface nobody asked for.
 */
function namedPaymentMethods(names: readonly string[] | undefined): string[] {
  if (names === undefined) return [];
  const seen = new Set<string>();
  const named: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name === "" || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    named.push(name);
    if (named.length === MAX_NAMED_PAYMENT_METHODS) break;
  }
  return named;
}

/**
 * The `{methods}` value a caption interpolates, or `undefined` when nothing resolved ([R2], [R3]).
 *
 * Joined by `Intl.ListFormat` with the ACTIVE locale rather than a hardcoded " or ": the separator
 * is copy, and a Portuguese caption reading "Cartão or Pix" is the same defect in miniature. Pure
 * and locale-parameterised, so this module still resolves no translations of its own; the component
 * passes the locale in, exactly as it passes `t` over the keys.
 *
 * `undefined` is the signal for the neutral branch, so a caller never has to test for an empty
 * string: no method list, an empty one, or one that normalizes away all read the same.
 *
 * The join is GUARDED, following `languageLabel` in `src/lib/tx/diagnostics.ts`, the repository's
 * other modern-`Intl` call site. `Intl.ListFormat` landed in Safari 14.1 while this app's default
 * browserslist still includes Safari 12, so on such a client the constructor throws INSIDE render
 * and takes the provisioning card down in the middle of a money flow.
 */
export function formatPaymentMethods(
  names: readonly string[] | undefined,
  locale: string,
): string | undefined {
  const named = namedPaymentMethods(names);
  // Destructured once: the same check answers [R3]'s "nothing resolved" and leaves the catch below a
  // `string` to fall back to, with no second (unchecked) index read.
  const [first] = named;
  if (first === undefined) return undefined;
  try {
    return new Intl.ListFormat(locale, { type: "disjunction", style: "long" }).format(named);
  } catch {
    // Name ONE method, which [R2] already permits ("at most two"), rather than invent a separator
    // this module has no locale-correct value for. NOT `undefined`: the caption KEY was already
    // chosen from the row carrying names (`stepRow`), so the `{methods}` placeholder is there and
    // next-intl throws on a placeholder with no value. [R3]'s neutral branch is for nothing having
    // resolved, which is not this case: a method IS known, only the joining of two is unavailable.
    return first;
  }
}

/**
 * The buyer's payment methods AND the currency question that decides whether they may be named
 * (POO-1575 rules v2 [R8]).
 *
 * One object rather than a bare `string[]`, because the two are not separable facts. A method list
 * is fetched per `currencyFrom` (POO-1512), so it describes what can be paid with **in that fiat**,
 * and a caption that prints it over a leg charged in another fiat is a claim we did not check. The
 * shape makes that impossible to omit: a host cannot hand over names without also saying which
 * currency they were listed for and which currency the leg will be billed in.
 *
 * Neither field is derivable here. `order.fiatCurrency` on the step is NOT the answer: it is written
 * as the constant `"USD"` by `sizeOnRampOrder` and is load-bearing only on the spend-fixed leg, and
 * whether a leg ends up received-fixed is settled at mint time inside `resolveWidgetPrefill`. So the
 * host answers, and this module only compares ([R6]: no second resolution).
 */
export interface BuyPaymentMethods {
  /**
   * Display names, the PRICED method first (see {@link namedPaymentMethods} on why order matters and
   * why a repeat is expected rather than defended against).
   */
  names: readonly string[];
  /**
   * ISO-4217 fiat the list was resolved for: `useBuyRouteQuote().currencyCodeFrom`, which the methods
   * action echoes precisely so a caller never has to guess which currency's set it is holding.
   */
  listedForCurrency: string;
  /**
   * POO-1596: the Paybis PAIR the list was resolved for, i.e. the `currencyCodeTo` the host asked
   * `useBuyRouteQuote` about (`USDC-BASE` / `ETH-BASE`). Compared against the `buy` step's own
   * `order.currencyCode` below.
   *
   * The fiat check alone was safe by accident and no longer is. Before POO-1573 a gas-first
   * `ETH-BASE` leg was unconditionally billed in USD, so listing the wrong pair showed up as a
   * mismatched FIAT and {@link chargedCurrency} caught it. That leg now adopts the buyer's own
   * currency, so both fiat halves agree for every buyer while the list still describes a different
   * pair, with a different fee schedule and a different method set. A method absent from the pair
   * the mint actually lists for is silently substituted by `pickDefaultPaymentMethod` (a card),
   * which is POO-1578 [R3]'s substitution arriving by a route nobody chose.
   *
   * The host holds this: it is the value it passed the hook, sized by `sizeOnRampOrder`. The hook
   * does not echo it back, so it cannot be read off `BuyRouteQuoteState`.
   */
  listedForPair: string;
  /**
   * ISO-4217 fiat this `buy` leg will actually be CHARGED in, which is the rail's answer and not the
   * buyer's profile: `resolveWidgetPrefill` omits the override on a received-fixed order (the buyer's
   * own currency resolves, so this equals {@link listedForCurrency}) and pins `order.fiatCurrency`
   * otherwise.
   *
   * A host that cannot yet know (an `ETH-BASE` leg is received-fixed only if the mint-time ETH price
   * read succeeds, POO-1573) should pass the pinned fallback, so an unknowable case takes the neutral
   * caption instead of a guess.
   */
  chargedCurrency: string;
}

/**
 * ISO-4217 fiat codes and Paybis pair codes alike compare case- and padding-insensitively; nothing
 * else about them is normalized.
 *
 * A BLANK (or whitespace-only) code never matches, not even another blank one. `"" === ""` would
 * read two absent answers as agreeing and name the buyer's rails with no check performed at all,
 * which is precisely the unchecked claim [R8] exists to remove. An unknown code takes the NEUTRAL
 * caption instead ([R3]'s branch), because "we do not know what this leg is charged in" (or "what it
 * buys", POO-1596) and "these are the rails for it" cannot both be said.
 */
function sameCode(a: string, b: string): boolean {
  const left = a.trim().toUpperCase();
  return left !== "" && left === b.trim().toUpperCase();
}

/**
 * The names a `buy` row may print: the normalized list, or NOTHING when it does not describe THIS
 * leg ([R8]).
 *
 * Two independent tests, because the list is resolved per (pair, fiat) and either half being wrong
 * makes the same claim we did not check:
 *
 *   - the FIAT it was listed for must be the fiat the leg is charged in (POO-1575);
 *   - the PAIR it was listed for must be the pair the leg mints (POO-1596), i.e. the step's own
 *     `order.currencyCode`. A leg that does not say which pair it mints (a pre-POO-1573 plan, a
 *     fixture) is an ABSENT code, which {@link sameCode} reads as a mismatch on purpose.
 *
 * Dropping rather than falling back to some other list is the whole point. There is no correct
 * substitute set to show, because the set for this leg was never fetched, and the neutral caption
 * already says exactly that much and no more.
 */
function buyRowMethodNames(
  methods: BuyPaymentMethods | undefined,
  mintedPair: string | undefined,
): string[] {
  if (methods === undefined) return [];
  if (!sameCode(methods.listedForCurrency, methods.chargedCurrency)) return [];
  if (!sameCode(methods.listedForPair, mintedPair ?? "")) return [];
  return namedPaymentMethods(methods.names);
}

/** One row of the Plan card. */
export interface PlanRow {
  key: string;
  type: ProvisioningStepType;
  /** 1-based badge number shown to the user. */
  index: number;
  /** Title i18n key (the op row ignores this and renders the caller's `opLabel`). */
  labelKey: string;
  /** Caption i18n key, if any. */
  captionKey?: string;
  /** USD amount to show, or `undefined` to omit the amount slot. */
  amountUsd?: number;
  /**
   * i18n KEY for the vendor attribution appended to the caption, if this row has one (POO-1927
   * [R2]). Absent on every row but the fiat `buy` leg.
   *
   * It replaces a `poweredByPaybis: boolean`, which could only ever answer "Paybis, or nothing" and
   * so printed "Powered by Paybis" on a charge Privy brokers through Stripe or MoonPay. A key sits
   * beside {@link labelKey} and {@link captionKey}, resolved by the card the same way, and keeps the
   * rail-to-copy decision in this module where it is testable without React.
   */
  attributionKey?: string;
  /** The trailing op anchor — renders `opLabel` + the op amount. */
  isOp: boolean;
  /** The gas step — renders the inline `GasAmountSelector`. */
  isGas: boolean;
  /** A rail-only allowance row, which the plan itself does not contain ([R6]). */
  isApproval: boolean;
  /** Network name for the `{network}` interpolation, from the chain config ([R3]). */
  networkName?: string;
  /**
   * The network this step RUNS on, for the caption (POO-1087 [F4-R2]).
   *
   * Distinct from {@link networkName}, which is a bridge's DESTINATION and belongs to the title
   * ("Move to Arbitrum"). Collapsing the two would make a bridge caption read "From Arbitrum" about
   * a leg that leaves Base.
   */
  sourceNetworkName?: string;
  /**
   * The chain this step RUNS on as an API network slug, for the `{stable}` interpolation
   * (POO-1779 [R1]). The name half of the same fact is {@link sourceNetworkName}; a caption that
   * says where a dollar is spent has to be able to say WHICH dollar, and on Robinhood Chain that is
   * USDG. Absent → the caption degrades to "USDC", the literal it carried before.
   */
  sourceNetwork?: string;
  /** Token symbol for the `{token}` interpolation (`Convert WETH`, `Approve WETH`). */
  tokenSymbol?: string;
  /**
   * `buy` rows only: the payment methods this buyer can actually use ON THIS LEG, for the
   * `{methods}` interpolation (POO-1575 [R1]). Already normalized and currency-checked by
   * {@link buyRowMethodNames}.
   *
   * ABSENT means nothing resolved OR that what resolved describes a currency this leg will not be
   * charged in ([R8]). It never means "none offered": the row carries what is known, and a caption
   * that names nothing is the honest reading of not knowing ([R3]). Only a `buy` row carries it
   * ([R5]).
   */
  paymentMethodNames?: readonly string[];
  /** Execution status from the rail; `idle` until the rail says otherwise ([R1]). */
  status: ProvisioningStepStatus;
  /** The broadcast hash, once this step has one ([R2]). */
  txHash?: string;
  /** API network slug of the chain {@link txHash} was broadcast on; absent → no link ([R4]). */
  explorerNetwork?: string;
  /** Bridge rows only: how long the leg says it will take ([R2]). */
  eta?: BridgeEtaCopy;
  /**
   * Whether this leg's input is the PREVIOUS leg's output (POO-1142), i.e. it continues that route
   * rather than spending a fresh holding. Read by {@link settledSafe} so a settled bridge supersedes
   * only the swaps it actually carried, never a different source's at-rest swap. Derived from the
   * legs' endpoints (`sameEndpoint`); absent on a mock plan and on a legless step, where the
   * settled-safe default (a bridge continues, a swap/buy starts fresh) is the single-source shape a
   * mock plan can produce.
   */
  continuesPrevious?: boolean;
  /**
   * A `buy` step that delivers the chain's NATIVE coin for gas ([R1]'s gas-first purchase), not a
   * spendable token. Read by {@link settledSafe} to exclude it from the safe-at-rest total exactly as
   * `swap-gas` / `bridge-gas` are: gas is spent on the transaction, not held. Absent on every other row.
   */
  deliversGas?: boolean;
}

/**
 * The Plan-state view model.
 *
 * POO-1503 (Rafael, 2026-08-11): `titleKey` is gone with the mock-mode plan screen, which was its
 * last renderer. The row model is what every remaining surface (step 2's `See details`, the running
 * card, the failure card) consumes.
 */
export interface PlanView {
  rows: PlanRow[];
}

/** What the rail knows that the plan does not. All of it optional: mock mode passes none of it. */
export interface PlanViewOptions {
  /**
   * The steps that will actually run, in execution order ({@link planRailSteps}). Folds the rail's
   * approval rows in; absent, the plan's own steps drive the rows exactly as before.
   */
  railSteps?: readonly PlanRailStep[];
  /** Per-step execution status, keyed by step key ([R1], [R6]). */
  statusByKey?: Readonly<Record<string, ProvisioningStepStatus | undefined>>;
  /** Per-step broadcast hash, keyed by step key ([R2], [R6]). */
  txHashByKey?: Readonly<Record<string, string | undefined>>;
  /**
   * POO-1575 [R1]/[R8]: the payment methods Paybis actually offers for the currency this `buy` leg
   * will be charged in, as display names, so the row's caption names what this buyer can use.
   *
   * The host already holds them: `useBuyRouteQuote` (PP-CORE-HOK-026) lists the pair's methods and
   * since POO-1578 returns the FULL list plus the priced one's `methodLabel`. This option is that
   * list arriving, never a second resolution ([R6]): a mapper that fetched its own would be a
   * second answer to "what can this buyer pay with", free to disagree with the picker beside it.
   *
   * Absent, empty, listed for a currency this leg will not be charged in, or listed for a PAIR it
   * will not mint (POO-1596), all take the neutral caption ([R3]). Absent is the normal state in
   * mock mode, in the crypto-only cut, and before the list answers.
   *
   * PP-TODO(POO-1576): `ProvisioningPanel` still calls `buildPlanView` without this, so the caption
   * takes the neutral branch in production today. The wiring is deliberately left to the owner of
   * that file, which POO-1576 rewrites.
   *
   * Only the `names` / `listedForCurrency` half below is COMPILED, by `provisioningView.test.ts`
   * (`buyPaymentMethodsHandoff`), so that half cannot drift from the hook's actual types the way its
   * first version did. `chargedCurrency` is an ARGUMENT to that helper, so the line sourcing it is a
   * hand-maintained snippet that compiles nowhere: whoever edits one of the two texts edits both.
   *
   * ```tsx
   * buyPaymentMethods: buyRouteQuote.currencyCodeFrom === undefined
   *   ? undefined
   *   : {
   *       // `methodLabel` is `string | undefined`, so the type guard is load-bearing, not tidying.
   *       names: [buyRouteQuote.methodLabel, ...(buyRouteQuote.methods ?? []).map((m) => m.displayName)]
   *         .filter((name): name is string => name !== undefined),
   *       listedForCurrency: buyRouteQuote.currencyCodeFrom,
   *       // POO-1596: the pair the host ASKED the hook about (`buyPair`, sized by `sizeOnRampOrder`),
   *       // which the hook does not echo back. Never the `DEFAULT_CURRENCY_CODE_TO` literal.
   *       listedForPair: buyPair,
   *       // Sourced, not computed here. See below.
   *       chargedCurrency: chargedFiat,
   *     }
   * ```
   *
   * There is no `receivedFixed` (nor `order`) binding at the panel's render, so `chargedFiat` must be
   * SOURCED rather than derived: it is the fiat this leg will actually be billed in, and that is the
   * rail's answer, settled at MINT time inside `resolveWidgetPrefill` (`useProvisioningRail`), which
   * omits the currency override on a received-fixed order (letting `currencyCodeFrom` stand) and pins
   * `order.fiatCurrency` otherwise. A render cannot know it in advance: an `ETH-BASE` leg is
   * received-fixed only if the mint-time ETH price read succeeds (POO-1573). Until that settled value
   * is carried back to the render, pass the PINNED fallback, so an unknowable case takes the neutral
   * caption instead of a guess ([R8]).
   */
  buyPaymentMethods?: BuyPaymentMethods;
  /**
   * POO-1927 [R2]: the rail serving fiat RIGHT NOW, as the host's live reader sees it.
   *
   * Supplied, it decides which vendor the fiat buy row credits, overriding the rail the plan
   * recorded. The plan is built by a `"use server"` action, so its own read is env-pure and blind to
   * a Dev-menu override, while the panel branches the actual purchase on `useOnRampProvider`
   * (`ProvisioningPanel.tsx:909`). The attribution has to follow the reader that decides where the
   * money goes, or a tester flipping the flag reads the wrong vendor on a real charge.
   *
   * It never CREATES an attribution: `ProvisioningStep.poweredBy` is what marks a leg attributable,
   * so a plan with no fiat leg stays unattributed however this is set. Absent is the right state for
   * stories, fixtures and any host with no live reader, where the plan's own record stands.
   */
  onRampRail?: OnRampAttribution;
}

/** Map a provisioning plan to the wizard's Plan view. */
export function buildPlanView(plan: ProvisioningPlan, options: PlanViewOptions = {}): PlanView {
  // The rail's approval steps, indexed by the plan step each one precedes. Built once: a plan is
  // short, but a lookup per row keeps the walk below linear and the ordering obvious.
  const approvals = new Map<string, Extract<PlanRailStep, { kind: "approve" }>>();
  for (const railStep of options.railSteps ?? []) {
    if (railStep.kind === "approve") approvals.set(railStep.planStep.key, railStep);
  }

  const rows: PlanRow[] = [];
  // The output endpoint of the previous plan step's leg, so the next leg can be classified as
  // CONTINUING that route (consuming its output) or starting a new source (POO-1142). Advances only
  // on steps that carry a leg; a mock plan carries none, so every row's `continuesPrevious` is left
  // undefined and the settled-safe default applies.
  let previousLegOut: ProvisioningLeg["tokenOut"] | undefined;
  for (const step of plan.steps) {
    const approval = approvals.get(step.key);
    if (approval) rows.push(approvalRow(approval, rows.length + 1, options));
    const continuesPrevious = step.leg ? sameEndpoint(previousLegOut, step.leg.tokenIn) : undefined;
    rows.push(stepRow(step, rows.length + 1, options, continuesPrevious));
    // POO-1136: a `buy` carries an `order`, not a `leg`, so it must advance the endpoint chain with a
    // SYNTHETIC `tokenOut` for what it delivers (Paybis ETH / USDC on Base). Once POO-1136 re-plans the
    // downstream swap / bridge into legged steps from the settled delta, that leg's `tokenIn` is the
    // bought asset, so the swap / bridge after a buy CONTINUES it. Without this the legged bridge reads
    // `previousLegOut === undefined`, `sameEndpoint` is false, and `settledSafe` counts the buy AND the
    // bridge (the same $120 twice). A `buy` also RESETS the endpoint rather than leaving a stale one
    // from a leg before it, so a leg two steps back can never be read as the source a bridge continues.
    if (step.leg) {
      previousLegOut = step.leg.tokenOut;
    } else if (step.type === "buy") {
      previousLegOut = buyDeliveredEndpoint(step);
    }
  }

  return { rows };
}

/**
 * The endpoint a `buy` step delivers, as a synthetic leg output (POO-1136).
 *
 * A fiat purchase has no {@link ProvisioningLeg}, so the endpoint chain that {@link sameEndpoint}
 * walks needs the bought asset named here instead. Paybis sells ETH / USDC on Base ([R2]): native when
 * the delivered symbol is the chain's own coin, else the chain's USDC. Only `chainId` + `address` are
 * read by `sameEndpoint`; `symbol` / `decimals` ride along for completeness.
 *
 * `undefined` (an asset we cannot resolve) RESETS the endpoint, which is the safe reading: it is never
 * a stale value from a leg before the buy, so a downstream leg cannot be mis-marked as continuing one.
 */
function buyDeliveredEndpoint(step: ProvisioningStep): ProvisioningLeg["tokenOut"] | undefined {
  const chainId = step.toChainId;
  const symbol = step.toToken;
  if (chainId === undefined || symbol === undefined) return undefined;
  const isNative = symbol === nativeSymbol(apiNetworkForChain(chainId));
  const address = isNative
    ? NATIVE_TOKEN_ADDRESS
    : symbol === "USDC"
      ? getUsdcAddress(chainId)
      : undefined;
  if (address === undefined) return undefined;
  return { address, symbol, decimals: isNative ? 18 : 6, chainId };
}

/** The allowance the rail grants before a leg. It moves nothing, so it is priced at nothing. */
function approvalRow(
  railStep: Extract<PlanRailStep, { kind: "approve" }>,
  index: number,
  options: PlanViewOptions,
): PlanRow {
  const { leg } = railStep;
  return {
    key: railStep.key,
    // The plan step it belongs to, so a caller can still group the pair. The `isApproval` flag is
    // what decides behaviour: a `swap-gas` approval must NOT render the inline gas selector.
    type: railStep.planStep.type,
    index,
    labelKey: APPROVE_LABEL_KEY,
    captionKey: "provisioning.captions.approve",
    isOp: false,
    isGas: false,
    isApproval: true,
    tokenSymbol: leg.tokenIn.symbol,
    ...execution(railStep.key, leg.chainId, options),
  };
}

/**
 * The copy each rail is credited with (POO-1927 [R2]).
 *
 * The decision is PROVIDER-NEUTRAL and never rail-aware (issue comment, 2026-09-12, applying
 * rejection 14 of epic POO-1793's handoff): on the Privy rail no vendor is named, because Privy
 * auto-routes between Stripe, MoonPay, Coinbase and Meld and our captured outcome record does not
 * say which one served, so naming Stripe on a MoonPay charge would repeat the same
 * merchant-of-record error. `secureCheckout` is the house phrase already translated across the
 * `provisioning.onramp.*` block ("Open secure checkout", "Loading the secure checkout").
 *
 * The Paybis rail keeps its own honest copy while it exists: POO-1819 holds it as the 72-hour
 * rollback target after cutover, and POO-1809 is what finally removes it.
 *
 * `PaybisWidgetFrame.tsx` names Paybis directly and is CORRECT to ([R5]): that frame IS the Paybis
 * rail. Only rail-agnostic surfaces resolve their copy through this map.
 */
const ATTRIBUTION_KEY: Record<OnRampAttribution, string> = {
  paybis: "provisioning.poweredByPaybis",
  privy: "provisioning.secureCheckout",
};

/** One of the plan's own steps. */
function stepRow(
  step: ProvisioningStep,
  index: number,
  options: PlanViewOptions,
  continuesPrevious?: boolean,
): PlanRow {
  // Both bridge kinds. `bridge-gas` labels read "Send fees to {network}", and next-intl THROWS on
  // a placeholder with no value, so missing this made the feature's own row fail to render.
  const isBridge = step.type === "bridge" || step.type === "bridge-gas";
  const isBuy = step.type === "buy";
  const leg = step.leg;
  // Amount display follows Figma: shown only when meaningful — hidden on a step whose USD value is 0
  // (the op anchor for collect / withdraw / close), and on a bridge row that no real quote priced.
  // A real leg means a real figure, so [R2] shows it.
  const showAmount = step.amountUsd > 0 && (!isBridge || leg !== undefined);
  // [F4-R2] A funding swap's title names what it SPENDS (`fromToken`). A fiat `buy` is the exception:
  // its `fromToken` is the fiat "USD", so `Buy {token}` would read "Buy USD"; name what it DELIVERS.
  const displayToken = isBuy ? (step.toToken ?? step.fromToken) : (step.fromToken ?? step.toToken);
  // A `buy` that delivers the chain's native coin is a gas-first purchase ([R1]); settledSafe must
  // exclude it like a gas leg. Decided by the DELIVERED asset, never the step type.
  const deliversGas =
    isBuy &&
    step.toToken !== undefined &&
    step.toChainId !== undefined &&
    step.toToken === nativeSymbol(apiNetworkForChain(step.toChainId));
  // POO-1575 [R1]/[R5]/[R8]: what THIS buyer can pay with, on the only row that is paid with fiat.
  // Empty (nothing resolved, a list that normalizes away, or one listed for a currency this leg will
  // not be charged in / a PAIR it will not mint, POO-1596) keeps the neutral caption ([R3]); either
  // way `captionKey` below is a string, so the Paybis attribution gated on it survives both ([R4]).
  const paymentMethodNames = isBuy
    ? buyRowMethodNames(options.buyPaymentMethods, step.order?.currencyCode)
    : [];
  /**
   * POO-1927 [R2]: WHICH vendor this row credits, or nothing.
   *
   * `step.poweredBy` decides WHETHER there is an attribution at all: only the fiat buy leg carries
   * it, so this cannot stamp a vendor onto the op anchor or a bridge. The host's live rail then
   * decides WHICH, because the rail that actually takes the money is the one the panel's execution
   * branch reads (`ProvisioningPanel.tsx:1826`), while the plan was built by a server action whose
   * env-pure flag read cannot see a Dev-menu override. Without that precedence a tester flipping
   * `privyOnRamp` in the Dev menu reads the Paybis credit on a Privy charge, which is this issue.
   */
  const attribution = step.poweredBy ? (options.onRampRail ?? step.poweredBy) : undefined;
  return {
    key: step.key,
    type: step.type,
    index,
    labelKey: step.labelKey,
    captionKey: paymentMethodNames.length > 0 ? BUY_METHODS_CAPTION_KEY : CAPTION_KEY[step.type],
    ...(paymentMethodNames.length > 0 ? { paymentMethodNames } : {}),
    ...(showAmount ? { amountUsd: step.amountUsd } : {}),
    ...(attribution === undefined ? {} : { attributionKey: ATTRIBUTION_KEY[attribution] }),
    isOp: step.type === "op",
    isGas: step.type === "swap-gas",
    isApproval: false,
    // The DESTINATION for a bridge ("Move to Arbitrum"); `leg.chainId` would be its origin.
    ...(isBridge ? nameOf(chainDisplayName(step.toChainId)) : {}),
    // [F4-R2] Where the step runs, which is what its caption names.
    ...sourceNameOf(chainDisplayName(leg?.chainId ?? step.fromChainId)),
    // POO-1779 [R1]: the same chain as a slug, so the caption can name that chain's stable.
    ...sourceSlugOf(apiNetworkForChain(leg?.chainId ?? step.fromChainId ?? -1)),
    // [F4-R2] `Convert {token}` names what is SPENT. It used to name `toToken`, what the user ends
    // up holding, which is true of the whole route and says nothing about this step: every funding
    // swap on a route converts TO the same asset, so every row read alike. A `buy` is the documented
    // exception above, because its spent asset is fiat.
    ...(displayToken === undefined ? {} : { tokenSymbol: displayToken }),
    ...(isBridge ? { eta: bridgeEtaCopy(leg?.etaSeconds ?? step.etaSeconds) } : {}),
    ...(continuesPrevious === undefined ? {} : { continuesPrevious }),
    ...(deliversGas ? { deliversGas: true } : {}),
    // POO-1136: a fiat `buy` mines no on-chain transaction, so its row can never carry a verifiable
    // hash. Enforced HERE, on the row, rather than trusted of every producer: `data-tx-hash` is what
    // the e2e harness verifies receipts from, so one fabricated hash (mock mode's settle used to be
    // exactly that) turns into a harness verifying a transaction that does not exist.
    ...execution(step.key, leg?.chainId ?? step.chainId ?? step.fromChainId, options, isBuy),
  };
}

/** `{ networkName }` when there is one, nothing when there is not (never `networkName: undefined`). */
function nameOf(networkName: string | undefined): { networkName?: string } {
  return networkName === undefined ? {} : { networkName };
}

/** The same, for the network a step runs on. */
function sourceNameOf(sourceNetworkName: string | undefined): { sourceNetworkName?: string } {
  return sourceNetworkName === undefined ? {} : { sourceNetworkName };
}

/** The slug half of {@link sourceNameOf}, for the caption's `{stable}` (POO-1779 [R1]). */
function sourceSlugOf(sourceNetwork: string | undefined): { sourceNetwork?: string } {
  return sourceNetwork === undefined ? {} : { sourceNetwork };
}

/**
 * The rail's view of a step: where it got to, and whether it can be verified on-chain yet.
 *
 * The explorer network is resolved ONLY alongside a hash. Without one there is nothing to link to,
 * so naming a network would be state the row cannot use, and the additivity of the v3 contract
 * fields (POO-1030 [R2]) would break for every mock plan that happens to carry a `chainId`.
 *
 * `hashless` (POO-1136) drops a supplied hash outright: the fiat `buy` row is terminal-good WITHOUT
 * one, so any hash reaching it is wrong by construction and must not be rendered or linked.
 */
function execution(
  key: string,
  chainId: number | undefined,
  options: PlanViewOptions,
  hashless = false,
): { status: ProvisioningStepStatus; txHash?: string; explorerNetwork?: string } {
  const status = options.statusByKey?.[key] ?? "idle";
  const txHash = hashless ? undefined : options.txHashByKey?.[key];
  if (!txHash) return { status };
  const explorerNetwork = chainId === undefined ? undefined : apiNetworkForChain(chainId);
  return {
    status,
    txHash,
    ...(explorerNetwork === undefined ? {} : { explorerNetwork }),
  };
}

/** A resolved copy key plus its interpolation values. No `t` call, per this module's contract. */
export interface BridgeEtaCopy {
  key: string;
  values?: Record<string, number>;
}

/**
 * How long the bridge leg says it will take (POO-1037 [R2]).
 *
 * The figure is the quote's own `estimatedFillTimeMs` (carried as {@link ProvisioningLeg.etaSeconds}),
 * never an invented constant: a step that looks stuck for three minutes with no ETA reads as a
 * failure and gets a tab closed mid-route. When the quote gave no estimate we say so rather than
 * guessing, because a promise of "about 30 seconds" that we cannot keep is worse than no number.
 */
export function bridgeEtaCopy(etaSeconds: number | undefined): BridgeEtaCopy {
  if (etaSeconds === undefined || !Number.isFinite(etaSeconds) || etaSeconds <= 0) {
    return { key: "provisioning.bridge.etaUnknown" };
  }
  // Under 90s reads naturally in seconds; above it, "about 2 minutes" beats "about 118 seconds".
  if (etaSeconds < 90) {
    return {
      key: "provisioning.bridge.etaSeconds",
      values: { seconds: Math.max(1, Math.round(etaSeconds)) },
    };
  }
  return {
    key: "provisioning.bridge.etaMinutes",
    values: { minutes: Math.max(1, Math.round(etaSeconds / 60)) },
  };
}
