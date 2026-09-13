/**
 * @id PP-CORE-CMP-064 — tests
 * @name FundingRoutePicker, tests
 * @implements-rules-version v11 (POO-1755 rules v1) · v10 (POO-1446 rules v3) · v9 (POO-1446 rules v2) · v4 (POO-1501 rules v1) · v3 (POO-1135, POO-1153, POO-1155 / POO-1129 rules v3) · v1 (POO-1086 rules v1)
 *
 * Screen 1, "Where from" (Figma `6547:569`, `6547:627`, `7326:766`, `7331:766`, `7331:811`). One tap
 * per option and no CTA: the question has exactly one answer per row, so a confirm button would only
 * add a step.
 *
 * The component ships ahead of its trigger. With the on-ramp off (POO-1082 D3) `resolveFundingRoutes`
 * returns a single route and the panel skips this step entirely, so nothing here renders in
 * production yet. That is the point of testing it now.
 */

import { describe, expect, it, vi } from "vitest";
import type { GasFeasibility } from "@/lib/provisioning";
import { PAYBIS_MIN_USD } from "@/lib/provisioning/computeNeed";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { FundingRoutePicker, type FundingRoutePickerProps } from "./FundingRoutePicker";
import { type FundingRoute, resolveFundingRoutes } from "./fundingRoutes";

/**
 * The worked scenario POO-1499 settled, and the one the stories render: a $200 operation with $5 of
 * gas on the tokens route, at the shipped 5% buffer. `tokens` targets `(200 + 5) × 1.05 = 215.25`
 * and `buy` targets `(200 × 1.05) + 2 = 212.00`, which is why buy still comes out cheaper.
 *
 * Tests and stories share these figures on purpose. They disagreed once and the disagreement was
 * invisible, because each file was internally consistent.
 */
const SCENARIO = {
  requiredUsd: 205,
  opRequiredUsd: 200,
  gasUsd: 5,
  bufferPct: 5,
} as const;

const TOKENS: FundingRoute = {
  kind: "tokens",
  availableUsd: 324.5,
  shortfallUsd: 0,
  sourceTargetUsd: 215.25,
};
const TOKENS_PLUS_BUY: FundingRoute = {
  kind: "tokens-plus-buy",
  availableUsd: 88.4,
  shortfallUsd: 121.6,
  sourceTargetUsd: 215.25,
};
const BUY: FundingRoute = {
  kind: "buy",
  availableUsd: 0,
  shortfallUsd: 205,
  sourceTargetUsd: 212,
};
/**
 * POO-1446 [R5](a): the buy route at the Paybis floor.
 *
 * `sourceTargetUsd()` ends `Math.max(PAYBIS_MIN_USD, target)`, and the value is cent-quantised on both
 * sides of the comparison (the floor is a constant, the other arm came out of `ceilToUsd`), so `<=` is
 * an exact test with no tolerance to tune. It is NOT a proof that the floor bound: `ceilToUsd` can
 * land on exactly $10.00 on its own, e.g. a $9.52 transaction with no reserve gives
 * `Math.round(9_520_000 * 1.05) = 9_996_000`, which ceils to `10.00` and survives `Math.max(10, 10)`.
 * The sentence holds either way, which is what matters here: a computed target of exactly $10.00 means
 * the need was strictly below $10.00, and $10.00 is still the smallest order we place. A gas-only
 * top-up on a chain that needs $0.05 lands here.
 */
const BUY_AT_FLOOR: FundingRoute = {
  kind: "buy",
  availableUsd: 0,
  shortfallUsd: 5.15,
  sourceTargetUsd: 10,
};
/**
 * POO-1446 [R12]/[R13]: the mixed route whose remaining gap falls UNDER the app's order floor.
 *
 * `shortfallUsd` here is `progress.remainingUsd`, the raw gap, and `sourceTargetUsd()` floors only
 * `routeKind === "buy"`. Left alone the row printed `+ buy $3.20` against a rail that will not sell
 * below $10.00.
 */
const TOKENS_PLUS_BUY_AT_FLOOR: FundingRoute = {
  kind: "tokens-plus-buy",
  availableUsd: 205,
  shortfallUsd: 3.2,
  sourceTargetUsd: 215.25,
};

const DEPOSIT: FundingRoute = { kind: "deposit", availableUsd: 0, shortfallUsd: 0 };

/** POO-1446 [R5](b), at {@link SCENARIO}'s 5% buffer. The gas reserve is deliberately unnamed. */
const DISCLOSURE_BUFFER =
  "This is a little more than the transaction needs: 5% in case prices move while your purchase settles, plus any network fees.";
/**
 * POO-1446 [R5a] v3, interpolating `PAYBIS_MIN_USD` through the app money formatter ([R8]).
 *
 * v2 read "Purchases start at $10.00, so this is the smallest amount you can buy". It named a PROVIDER
 * purchase floor, which the same row can contradict one line above (`Minimum EUR 30.00 with Trustly`,
 * denominated in the buyer's currency since POO-1512 and therefore not USD-comparable to this
 * constant), and "the smallest amount you can buy" is a superlative a method's own minimum can falsify.
 * v3 names OUR order floor instead, and drops the superlative. `formatUsd` stays right: this is the
 * crypto-side USD constant for the smallest order we place, not a fiat charge.
 */
const DISCLOSURE_MINIMUM =
  // Derived, not typed: the copy interpolates `{minimum}` from PAYBIS_MIN_USD, so hardcoding the
  // figure here made this assertion silently wrong the moment POO-1666 raised the floor.
  `We never place an order below $${PAYBIS_MIN_USD.toFixed(2)}, so this is what you will buy even when the transaction needs less.`;
/** POO-1446 [R6]: the closing assurance both branches share. */
const DISCLOSURE_REMAINDER =
  "Anything you do not use stays in your wallet and can be used for other transactions.";

const noop = () => {};

/** The picker at {@link SCENARIO}, so each test states only what it changes. */
function renderPicker(
  props: Partial<FundingRoutePickerProps> & Pick<FundingRoutePickerProps, "routes">,
) {
  return renderWithProviders(
    <FundingRoutePicker {...SCENARIO} onSelect={noop} onCancel={noop} {...props} />,
  );
}

/** [R10] The info dot is the only affordance for the breakdown, so it is how a test opens it too. */
function breakdownTrigger() {
  return screen.getByRole("button", { name: "What makes up this amount" });
}

/**
 * POO-1446 [R2]: the buy row's OWN disclosure, which is a different affordance answering a different
 * question. Named distinctly from the heading's ("What makes up this amount"), so an exact-name query
 * can never reach the wrong one.
 */
function buyDisclosureTrigger() {
  return screen.getByRole("button", { name: "Why this amount" });
}

/**
 * The disclosure trigger belonging to ONE row, found through that row's own `<li>`.
 *
 * POO-1446 [R13] puts a second trigger on this screen (the mixed row's, when the floor binds), and
 * both carry the same accessible name because they are the same disclosure answering the same
 * question. An exact-name query is therefore ambiguous once both render, so a test that cares WHICH
 * row it is opening scopes through the row instead of counting matches.
 */
function rowDisclosureTrigger(rowName: RegExp): HTMLElement {
  const row = screen.getByRole("button", { name: rowName }).closest("li");
  expect(row).not.toBeNull();
  return within(row as HTMLElement).getByRole("button", { name: "Why this amount" });
}

/**
 * The surface the buy disclosure opened, anchored on the one line only it carries.
 *
 * Two tooltips live on this screen now and they hold SEPARATE state, so both can be open at once. A
 * bare `findByRole("tooltip")` is therefore ambiguous by construction, whatever a given test happens
 * to open today. Selected by content rather than by index, so it stays correct in either order.
 *
 * `role="tooltip"` is the visually-hidden mirror Radix renders for assistive tech, not the painted
 * surface, and it carries the same two lines. Asserting against the mirror is deliberate: it is what
 * a screen reader is actually handed.
 */
async function buyDisclosureTip(): Promise<HTMLElement> {
  const tips = await screen.findAllByRole("tooltip");
  const tip = tips.find((candidate) => candidate.textContent?.includes(DISCLOSURE_REMAINDER));
  expect(tip).toBeDefined();
  return tip as HTMLElement;
}

describe("FundingRoutePicker", () => {
  it("[F3-R1] states the total needed", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    expect(screen.getByText("You need $205.00")).toBeInTheDocument();
  });

  // @rule R10 — the composition used to sit permanently under the heading, where `+ $5.00` on a $200
  // operation reads as a fee. It now opens from the info dot and carries three lines, not one: the
  // split, why the top-up is bigger than this transaction needs, and what happens to the buffer.
  it("[R10] the breakdown opens from the info affordance, with all three lines", async () => {
    const user = userEvent.setup();
    renderPicker({ routes: [TOKENS, BUY] });

    expect(screen.queryByText(/for the transaction/)).not.toBeInTheDocument();

    await user.click(breakdownTrigger());

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("$200.00 for the transaction + $5.00 gas");
    expect(tip).toHaveTextContent("This gas top-up covers many transactions, not just this one.");
    expect(tip).toHaveTextContent("We convert 5% extra in case prices move while it runs.");
  });

  // @rule POO-840 R5 — Radix never opens a tooltip on a plain TAP unless the open state is
  // controlled, and D7 puts this same code on mobile, where a hover-only disclosure does not exist.
  // A click reaching the content is the whole difference between a disclosure and a decoration.
  it("[POO-840 R5] the breakdown opens on tap, not on hover alone", async () => {
    const user = userEvent.setup();
    renderPicker({ routes: [TOKENS, BUY] });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.click(breakdownTrigger());

    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  });

  // @rule POO-840 R2 — the 16px glyph needs a ~44px touch target, without changing its visual size
  // or moving the heading it sits in.
  it("[POO-840 R2] the info affordance carries an expanded touch target", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    const trigger = breakdownTrigger();
    expect(trigger).toHaveClass("relative");
    expect(trigger).toHaveClass("after:absolute");
    expect(trigger).toHaveClass("after:-inset-3.5");
  });

  it("[F3-R1] an operation that spends nothing says the gas is all that is missing", async () => {
    // Withdraw, collect, compound, move-range and close all pass `opRequiredUsdc = 0`. Telling those
    // users "$0.00 for the transaction" would be noise at best.
    const user = userEvent.setup();
    renderPicker({ routes: [TOKENS, BUY], requiredUsd: 10, opRequiredUsd: 0, gasUsd: 10 });

    await user.click(breakdownTrigger());

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("$10.00 to cover network fees");
    expect(tip).not.toHaveTextContent("for the transaction");
  });

  // @rule R9 (`1c`) — the target chain already holds gas, so there is nothing to break down. The
  // affordance goes with it: an empty disclosure is worse than no disclosure, and a dot that opens
  // a one-line tooltip restating the heading is a promise of detail the screen cannot keep.
  it("[R9] no gas needed renders neither the breakdown nor the affordance that opens it", () => {
    renderPicker({ routes: [TOKENS, BUY], requiredUsd: 200, opRequiredUsd: 200, gasUsd: 0 });

    expect(screen.getByText("You need $200.00")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "What makes up this amount" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/for the transaction/)).not.toBeInTheDocument();
  });

  // @rule R5 — verb plus amount, one line. The figure is IN the title rather than a step below it.
  it("[R5] renders one option per route, in the order it was given", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    const options = screen.getAllByRole("button", { name: /Use your \$215\.25|Buy \$212\.00/ });
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Use your $215.25");
    expect(options[1]).toHaveTextContent("Buy $212.00");
  });

  // @rule R5 — the title amount is what must LAND on this route (`sourceTargetUsd`), never the raw
  // wallet balance the old subtitle advertised. `$324.50 available` answered a different question.
  it("[R5] the tokens route is a single line: the old availability subtitle is gone", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    expect(screen.getByText("Use your $215.25")).toBeInTheDocument();
    expect(screen.queryByText("$324.50 available")).not.toBeInTheDocument();
  });

  it("[R5] the mixed route names both halves in the title, not in a subtitle", () => {
    renderPicker({ routes: [TOKENS_PLUS_BUY, BUY] });

    expect(screen.getByText("Use $88.40 + buy $121.60")).toBeInTheDocument();
    expect(screen.queryByText("$88.40 in tokens, buy $121.60")).not.toBeInTheDocument();
  });

  // @rule R5 — the ONE deliberate exception, decided with murilo 2026-08-10, pinned here so nobody
  // "finishes" R5 later by equalising the row heights. The buy subtitle is a disclosure, not a
  // caption: it carries what the provider will really charge, NAMED by the method it was priced for.
  // Deleting it turns `Buy $212.00` back into the unlabelled price POO-1153 / POO-1413 already fixed.
  it("[R5 exception] the buy row keeps its charge disclosure and the method's own minimum", () => {
    renderPicker({
      routes: [TOKENS, BUY],
      buyChargeUsd: 216.1,
      buyMethodName: "Trustly",
      buyMethodMinUsd: 30,
    });

    expect(screen.getByText("Buy $212.00")).toBeInTheDocument();
    expect(screen.getByText("$216.10 with Trustly")).toBeInTheDocument();
    expect(screen.getByText("Minimum $30.00 with Trustly")).toBeInTheDocument();
  });

  it("[F3-R1] each option says what it would draw on", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    // The row itself, asserted positively: without this the two negatives below would also hold
    // against an empty render, which is the one outcome this test must not accept.
    expect(screen.getByRole("button", { name: /Buy \$212\.00/ })).toBeInTheDocument();
    // [R10] Without a received-fixed quote the buy row shows the pending caption, which since
    // POO-1446 names the CHARGE rather than an "amount", never the FE shortfall.
    expect(screen.getByText("Final charge shown at checkout")).toBeInTheDocument();
    expect(screen.queryByText("$205.00 in the Paybis window")).not.toBeInTheDocument();
  });

  // @rule R10 — the buy route displays the received-fixed QUOTE charge (backend `amountFrom`), never
  // the FE-computed `route.shortfallUsd`. Here the shortfall is $205 but the quoted charge is $214.30
  // (Paybis fees), and it is the $214.30 the user is shown, LABELLED with the method it was priced for.
  it("[R10] shows the received-fixed quote charge, labelled with the method, not the FE shortfall", () => {
    renderPicker({ routes: [TOKENS, BUY], buyChargeUsd: 214.3, buyMethodName: "Credit Card" });

    expect(screen.getByText("$214.30 with Credit Card")).toBeInTheDocument();
    // The FE shortfall ($205) is never the buy charge.
    expect(screen.queryByText(/\$205\.00 with/)).not.toBeInTheDocument();
    expect(screen.queryByText("Final charge shown at checkout")).not.toBeInTheDocument();
  });

  // @rule POO-1153 — the method is NAMED beside the figure. The charge varies materially by method and
  // the user can change it inside the widget, so an unlabelled number overpromises (the old "Buy with
  // card" failure, which was wrong precisely because there are 21 methods, not one).
  it("[POO-1153] names the method beside the charge", () => {
    renderPicker({ routes: [TOKENS, BUY], buyChargeUsd: 182.4, buyMethodName: "Trustly" });

    expect(screen.getByText("$182.40 with Trustly")).toBeInTheDocument();
  });

  // @rule POO-1153 — a charge with no method name is never presented as a bare figure: without the
  // label the row falls back to the pending caption rather than overpromising an unlabelled number.
  // POO-1446 reworded that caption to name the CHARGE; it is still rendered, deliberately.
  it("[POO-1153] falls back to the pending caption when the method name is absent", () => {
    renderPicker({ routes: [TOKENS, BUY], buyChargeUsd: 214.3 });

    expect(screen.getByText("Final charge shown at checkout")).toBeInTheDocument();
    expect(screen.queryByText(/\$214\.30/)).not.toBeInTheDocument();
  });

  // @rule POO-1153 — the method's OWN minimum is surfaced (a method may require more than the app's $10
  // floor, and the user can change the method in the widget), so Paybis never rejects the order for an
  // amount the app quietly allowed.
  it("[POO-1153] surfaces the method's own minimum when provided", () => {
    renderPicker({
      routes: [TOKENS, BUY],
      buyChargeUsd: 214.3,
      buyMethodName: "Trustly",
      buyMethodMinUsd: 30,
    });

    expect(screen.getByText("Minimum $30.00 with Trustly")).toBeInTheDocument();
  });

  // @rule POO-1512 [R7]: the minimum is printed in ITS OWN currency. The methods list is fetched in
  // the buyer's resolved currency, so a EUR minimum pushed through formatUsd would claim dollars for
  // a figure Paybis enforces in euros.
  it("[POO-1512 R7] prints the method minimum in its own currency", () => {
    renderPicker({
      routes: [TOKENS, BUY],
      buyChargeUsd: 214.3,
      buyChargeCurrency: "EUR",
      buyMethodName: "Trustly",
      buyMethodMinUsd: 30,
      buyMethodMinCurrency: "EUR",
    });

    expect(screen.getByText("Minimum €30.00 with Trustly")).toBeInTheDocument();
  });

  // @rule POO-1153 — no minimum note when the host does not pass one (the method minimum is at or below
  // the app floor, so there is nothing extra to warn about).
  it("[POO-1153] shows no minimum note when none is provided", () => {
    renderPicker({ routes: [TOKENS, BUY], buyChargeUsd: 214.3, buyMethodName: "Credit Card" });

    expect(screen.queryByText(/Minimum/)).not.toBeInTheDocument();
  });

  // @rule POO-1446 [R1] v2 / [R4]. The state `CR-CORE-016` is BLOCKING on, pinned: no quote has
  // resolved (permanent in mock mode, where the host gates `useBuyRouteQuote` off, and reachable in
  // production on any quote failure), and the row must STILL account for its amount. POO-1626: this
  // used to add "every dev environment ... since the Paybis sandbox carries no `USDC-BASE` pair",
  // which POO-1605 made false. Asserted alongside the pending
  // caption, because the disclosure is additive: PR #866 deleted that caption and the deletion was
  // reversed on review, so a test that let it disappear here would re-open the same gap sideways.
  it("[R4] the buy row exposes its disclosure with no quote resolved, alongside the pending caption", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    expect(screen.getByText("Buy $212.00")).toBeInTheDocument();
    expect(screen.getByText("Final charge shown at checkout")).toBeInTheDocument();
    expect(buyDisclosureTrigger()).toBeInTheDocument();
  });

  // @rule POO-1446 [R2]. Radix never opens a tooltip on a plain TAP unless the open state is
  // controlled, and this screen is a mobile sheet first, where a hover-only disclosure does not
  // exist at all. A click reaching the content is the whole difference between a disclosure and a
  // decoration, which is the same reason POO-840 [R5] controls the heading's breakdown.
  it("[R2] the disclosure opens on tap and gives a reason plus what happens to the remainder", async () => {
    const user = userEvent.setup();
    renderPicker({ routes: [TOKENS, BUY] });

    expect(screen.queryByText(DISCLOSURE_BUFFER)).not.toBeInTheDocument();
    expect(screen.queryByText(DISCLOSURE_REMAINDER)).not.toBeInTheDocument();

    await user.click(buyDisclosureTrigger());

    const tip = await buyDisclosureTip();
    expect(tip).toHaveTextContent(DISCLOSURE_BUFFER);
    expect(tip).toHaveTextContent(DISCLOSURE_REMAINDER);
  });

  // @rule POO-1446 [R5](a). The floor is named ONLY when the floor is what set the figure.
  // `sourceTargetUsd()` ends `Math.max(PAYBIS_MIN_USD, target)`, so a printed $10.00 is the floor
  // and nothing else: a gas-only top-up that computes to $5.15 still has to buy $10.
  it("[R5a] names the purchase minimum when the floor is what set the figure", async () => {
    const user = userEvent.setup();
    renderPicker({ routes: [TOKENS, BUY_AT_FLOOR] });

    await user.click(buyDisclosureTrigger());

    const tip = await buyDisclosureTip();
    expect(tip).toHaveTextContent(DISCLOSURE_MINIMUM);
    expect(tip).not.toHaveTextContent(DISCLOSURE_BUFFER);
  });

  // @rule POO-1446 [R5](b). And never when it is not. On a ~$200 operation the gap is the buffer
  // plus whatever gas the route reserves, so naming a minimum here would be a false statement on a
  // money path: the exact failure class `CR-CORE-016` exists to close. The buffer percentage is
  // interpolated from `DEFAULT_SOURCE_BUFFER_RATE` via the host's `bufferPct` ([R8]), never baked
  // into a locale, which is why this asserts "5%" against SCENARIO's prop rather than a literal.
  it("[R5b] names the buffer, and never the minimum, when the buffer is what set the figure", async () => {
    const user = userEvent.setup();
    renderPicker({ routes: [TOKENS, BUY] });

    await user.click(buyDisclosureTrigger());

    const tip = await buyDisclosureTip();
    expect(tip).toHaveTextContent(DISCLOSURE_BUFFER);
    expect(tip).not.toHaveTextContent(DISCLOSURE_MINIMUM);
    expect(tip).not.toHaveTextContent("We never place an order below");
  });

  // @rule POO-1446 [R3]. A button inside a button is invalid HTML AND it makes the disclosure's tap
  // ambiguous with choosing the route. The trigger is a sibling inside the row's `<li>`, which is
  // also what keeps `Recommended` out of nothing and the row's accessible name free of the label.
  it("[R3] the trigger is a sibling of the route button, never nested inside it", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    const row = screen.getByRole("button", { name: /Buy \$212\.00/ });
    const trigger = buyDisclosureTrigger();

    expect(row).not.toContainElement(trigger);
    expect(row.closest("li")).toContainElement(trigger);
    expect(row).not.toHaveAccessibleName(/Why this amount/);
  });

  // @rule POO-1446 [R3]. The consequence that matters to the user: opening the explanation must
  // never commit them to the route it explains. Structural rather than a `stopPropagation`, so
  // there is nothing to forget to re-add.
  it("[R3] opening the disclosure does not select the buy route", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker({ routes: [TOKENS, BUY], onSelect });

    await user.click(buyDisclosureTrigger());

    expect(await buyDisclosureTip()).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  // @rule POO-1446 [R2]. The 16px glyph reaches a ~44pt target through the same `::after` hit area
  // the heading's dot uses, and the glyph itself is decorative, so the accessible name lives on the
  // trigger. `absolute` rather than the heading's `relative`: this one is positioned over the card,
  // and the hit area still needs a positioned ancestor.
  it("[R2] the trigger is named for a screen reader and carries an expanded touch target", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    const trigger = buyDisclosureTrigger();
    expect(trigger).toHaveClass("absolute");
    expect(trigger).toHaveClass("after:absolute");
    expect(trigger).toHaveClass("after:-inset-3.5");
    expect(trigger.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  // @rule POO-1446 [R3]. The trigger is absolutely positioned OVER the row's text column, so that
  // column has to reserve room for it or a long locale's caption wraps underneath the glyph. Only
  // the buy row pays that gutter: padding it on every row would push three rows' copy in for one
  // row's affordance.
  it("[R3] only the buy row reserves the gutter the trigger sits in", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    expect(screen.getByText("Buy $212.00").closest(".flex-1")).toHaveClass("pr-9");
    expect(screen.getByText("Use your $215.25").closest(".flex-1")).not.toHaveClass("pr-9");
  });

  // @rule POO-1446 [R7] v2. Three statements, deliberately distinct: the title says what must LAND,
  // the caption says what the provider will CHARGE, and this says why the first exceeds the need.
  // A disclosure that repeated either of the other two would add a line and close nothing.
  it("[R7] the disclosure restates neither the amount nor the charge", async () => {
    const user = userEvent.setup();
    renderPicker({
      routes: [TOKENS, BUY],
      buyChargeUsd: 216.1,
      buyMethodName: "Trustly",
    });

    await user.click(buyDisclosureTrigger());

    const text = (await buyDisclosureTip()).textContent ?? "";
    expect(text).not.toContain("$212.00");
    expect(text).not.toContain("$216.10");
    expect(text).not.toContain("Trustly");
  });

  // @rule POO-1446 [R1] v2, narrowed by [R13] v3. The affordance belongs to the row whose figure
  // needs explaining, and here that is the buy row alone: this mixed row's $121.60 gap clears the
  // $10 floor, so its printed leg IS the gap and there is nothing in excess to account for. The
  // tokens route converts a holding the wallet already has, and its title is the whole story.
  it("[R1] only the buy row carries the disclosure when the mixed row's gap clears the floor", () => {
    renderPicker({ routes: [TOKENS_PLUS_BUY, BUY] });

    expect(screen.getAllByRole("button", { name: "Why this amount" })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /Use \$88\.40 \+ buy \$121\.60/ }).closest("li"),
    ).not.toContainElement(buyDisclosureTrigger());
  });

  // @rule POO-1446 [R12]. `route.shortfallUsd` for `tokens-plus-buy` is the RAW remaining gap, and
  // `sourceTargetUsd()` floors at `PAYBIS_MIN_USD` for `routeKind === "buy"` only, so this row used
  // to print `+ buy $3.20` against a rail that will not sell below $10.00. It is question (a) of
  // `CR-CORE-016` verbatim: naming an amount the rail cannot sell. With a $3.20 gap the user really
  // does buy $10.00, so $10.00 is the figure.
  it("[R12] the mixed row prints the floored buy leg, not the raw gap, when the gap is below the floor", () => {
    renderPicker({ routes: [TOKENS_PLUS_BUY_AT_FLOOR, BUY] });

    expect(screen.getByText(`Use $205.00 + buy $${PAYBIS_MIN_USD.toFixed(2)}`)).toBeInTheDocument();
    expect(screen.queryByText(/\+ buy \$3\.20/)).not.toBeInTheDocument();
  });

  // @rule POO-1446 [R12]. And the floor is a floor, not a rewrite: above it the printed leg is the
  // gap exactly. A `Math.max` that leaked into the common case would overstate every mixed row.
  it("[R12] the mixed row prints the gap unchanged when it clears the floor", () => {
    renderPicker({ routes: [TOKENS_PLUS_BUY, BUY] });

    expect(screen.getByText("Use $88.40 + buy $121.60")).toBeInTheDocument();
  });

  // @rule POO-1446 [R13]. When the floor binds, the printed leg exceeds the gap, so the mixed row
  // owes the same explanation the buy row's floored branch gives: our own order floor, and where the
  // remainder ends up. Scoped through the row, because the buy row carries its own trigger under the
  // same accessible name.
  it("[R13] the mixed row discloses the minimum and the remainder when the floor binds", async () => {
    const user = userEvent.setup();
    renderPicker({ routes: [TOKENS_PLUS_BUY_AT_FLOOR, BUY] });

    await user.click(rowDisclosureTrigger(/Use \$205\.00/));

    const tip = await buyDisclosureTip();
    expect(tip).toHaveTextContent(DISCLOSURE_MINIMUM);
    expect(tip).toHaveTextContent(DISCLOSURE_REMAINDER);
  });

  // @rule POO-1446 [R13]. `disclosureBuffer` is unreachable from this row on purpose: the mixed
  // row's figure is the raw gap with no buffer applied, so "5% in case prices move" would be a false
  // sentence on a money path, which is the failure class rather than a near miss.
  it("[R13] the mixed row never explains its figure with the buffer", async () => {
    const user = userEvent.setup();
    renderPicker({ routes: [TOKENS_PLUS_BUY_AT_FLOOR, BUY] });

    await user.click(rowDisclosureTrigger(/Use \$205\.00/));

    expect(await buyDisclosureTip()).not.toHaveTextContent(DISCLOSURE_BUFFER);
  });

  // @rule POO-1446 [R13]. No trigger at all when the floor does not bind: the printed figure is
  // exactly the gap, and a disclosure with nothing to disclose is the empty-tooltip failure [R9]
  // already refuses for the heading's breakdown.
  it("[R13] the mixed row carries no trigger when the floor does not bind", () => {
    renderPicker({ routes: [TOKENS_PLUS_BUY, BUY] });

    const mixed = screen.getByRole("button", { name: /Use \$88\.40 \+ buy \$121\.60/ });
    expect(
      within(mixed.closest("li") as HTMLElement).queryByRole("button", {
        name: "Why this amount",
      }),
    ).not.toBeInTheDocument();
  });

  // @rule POO-1446 [R3]/[R13]. The trigger is absolutely positioned over the row's text column, so
  // whichever row carries one has to reserve the gutter it sits in, and a row that carries none must
  // not pay for it. Gated on the disclosure rather than on the route kind since v3.
  it("[R13] the gutter follows the disclosure: the floored mixed row reserves it, the unfloored one does not", () => {
    const { unmount } = renderPicker({ routes: [TOKENS_PLUS_BUY_AT_FLOOR, BUY] });
    expect(screen.getByText(/Use \$205\.00/).closest(".flex-1")).toHaveClass("pr-9");

    unmount();
    renderPicker({ routes: [TOKENS_PLUS_BUY, BUY] });
    expect(screen.getByText("Use $88.40 + buy $121.60").closest(".flex-1")).not.toHaveClass("pr-9");
  });

  // @rule POO-1446 [R13]. Two rows can carry a disclosure at once (`resolveFundingRoutes` emits
  // `tokens-plus-buy` and `buy` together), and they hold SEPARATE state: opening one must not open
  // the other. A single shared boolean, which is what shipped at v2 when only `buy` could carry one,
  // would fail exactly here.
  it("[R13] the two rows' disclosures open independently", async () => {
    const user = userEvent.setup();
    renderPicker({ routes: [TOKENS_PLUS_BUY_AT_FLOOR, BUY] });

    await user.click(rowDisclosureTrigger(/Use \$205\.00/));

    // The mixed row's tooltip is open (minimum branch); the buy row's would carry the BUFFER
    // sentence, and nothing on screen may show it yet.
    expect(await buyDisclosureTip()).toHaveTextContent(DISCLOSURE_MINIMUM);
    expect(screen.queryByText(DISCLOSURE_BUFFER)).not.toBeInTheDocument();
  });

  // @rule R6 — fewest steps wins. The wallet covers it, so spending what is already there beats
  // buying: one step against several.
  it("[R6] tokens carry Recommended when the wallet covers the amount", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    expect(screen.getByRole("button", { name: /Use your \$215\.25/ })).toHaveTextContent(
      "Recommended",
    );
    expect(screen.getByRole("button", { name: /Buy \$212\.00/ })).not.toHaveTextContent(
      "Recommended",
    );
  });

  // @rule R6 — the wallet does NOT cover it, so buying outright is one step and the mixed route is
  // convert plus buy plus move. The chip moves to `buy`, which is the counter-intuitive half of the
  // rule and the half a refactor is most likely to get backwards.
  it("[R6] buy carries Recommended when the wallet does not cover the amount", () => {
    renderPicker({ routes: [TOKENS_PLUS_BUY, BUY] });

    expect(screen.getByRole("button", { name: /Buy \$212\.00/ })).toHaveTextContent("Recommended");
    expect(
      screen.getByRole("button", { name: /Use \$88\.40 \+ buy \$121\.60/ }),
    ).not.toHaveTextContent("Recommended");
  });

  // @rule R6 (`1d`) — one card route and the deposit link. With nothing to compare against, a badge
  // on the only option invites the reader to look for a comparison that is not on screen.
  it("[R6] a single card route carries no chip", () => {
    renderPicker({ routes: [BUY, DEPOSIT] });

    expect(screen.getByText("Buy $212.00")).toBeInTheDocument();
    expect(screen.queryByText("Recommended")).not.toBeInTheDocument();
  });

  // @rule POO-1535 [M6.5] — below `sm` the chip is a notch on the recommended row's own top border,
  // not an inline badge beside the label: absolutely positioned, straddling the 1px stroke, filled
  // with the page's surface colour so the border reads as interrupted.
  it("[M6.5] the Recommended chip sits on the recommended row's top border", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    const chip = screen.getByText("Recommended");
    expect(chip).toHaveClass("absolute", "top-0", "right-4", "-translate-y-1/2", "bg-surface");
    // Lifted out of the FLOW by `position`, never out of the DOM: it stays inside the button, in
    // the label row, so the recommendation is still part of the accessible name a screen reader
    // hears. This is the whole reason a notch was allowed to replace the inline chip.
    const button = screen.getByRole("button", { name: /Use your \$215\.25/ });
    expect(button).toContainElement(chip);
    expect(button).toHaveAccessibleName(/Recommended/);
  });

  // @rule POO-1535 [M6.5] — the notch is a BELOW-`sm` treatment. The issue's own acceptance ends
  // "Above `sm` nothing changes", and above `sm` the row is wide enough for the chip that shipped
  // before this issue, so the same element goes back into the flow rather than a second one being
  // rendered (one element = one accessible name, at every viewport).
  it("[M6.5] the notch is below `sm` only: at `sm` and above the inline chip is restored", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    const chip = screen.getByText("Recommended");
    // Back in the flow, un-lifted, with main's tinted fill instead of the page surface.
    expect(chip).toHaveClass("sm:static", "sm:translate-y-0", "sm:bg-primary/10");
    // ...and every non-positional class is the pre-POO-1535 chip's, byte for byte, so "nothing
    // changes" above `sm` is a property of the markup and not of a screenshot.
    expect(chip).toHaveClass(
      "shrink-0",
      "rounded-full",
      "border",
      "border-primary/40",
      "px-2",
      "py-0.5",
      "font-medium",
      "text-primary",
      "text-xs",
    );
    // The row spacing the notch forced is gated the same way: 20px below `sm`, main's 8px above.
    const list = screen.getByRole("list", { name: "How to fund this" });
    expect(list).toHaveClass("gap-5", "sm:gap-2");
    expect(list).not.toHaveClass("gap-2");
  });

  // @rule POO-1535 [M6.5] — 20px of clearance between route rows, raised from 8, so a notched row's
  // chip never overlaps the row above it when recommended is not the first route (`1b`).
  it("[M6.5] route rows keep 20px clearance (gap-5) for the notch, not the old gap-2", () => {
    renderPicker({ routes: [TOKENS_PLUS_BUY, BUY] });

    const list = screen.getByRole("list", { name: "How to fund this" });
    expect(list).toHaveClass("gap-5");
    expect(list).not.toHaveClass("gap-2");
  });

  // @rule POO-1535 [M6.5] — the acceptance is ">=20px of clearance above any notched host", and
  // when recommended is the FIRST route (the common case) the thing above it is the HEADING, not
  // another row, so the `<ul>`'s own gap is not what governs. Measured at 375: the info dot's
  // `after:-inset-3.5` hit area reaches ~8px below the `h3`, and the notch reaches 11px above the
  // list, so the outer `gap-4` left the two overlapping by ~3px and the later-painted route button
  // took the tap. `en` missed horizontally by luck (dot ~x149-179, chip ~x227-327); a locale with a
  // longer heading pushes the dot right and stops missing. `gap-5` puts the dot 12px above the list
  // against the notch's 11px: no overlap, in any locale.
  it("[M6.5] a notched FIRST row clears the heading's info-dot hit area (gap-5, not gap-4)", () => {
    // `gasUsd > 0` is what renders the info dot at all ([R9]); SCENARIO ships $5.
    renderPicker({ routes: [TOKENS, BUY] });

    expect(breakdownTrigger()).toHaveClass("after:-inset-3.5");
    const outer = screen.getByRole("list", { name: "How to fund this" }).parentElement;
    expect(outer).toHaveClass("gap-5");
    expect(outer).not.toHaveClass("gap-4");
    // Above `sm` there is no notch to clear, so main's `gap-4` stands.
    expect(outer).toHaveClass("sm:gap-4");
  });

  it("[F3-R1] one tap chooses: there is no confirm button", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker({ routes: [TOKENS, BUY], onSelect });

    await user.click(screen.getByRole("button", { name: /Use your \$215\.25/ }));

    expect(onSelect).toHaveBeenCalledWith("tokens");
    expect(screen.queryByRole("button", { name: /^continue$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^confirm$/i })).not.toBeInTheDocument();
  });

  it("[F3-R1] the buy option reports its own kind", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker({ routes: [TOKENS, BUY], onSelect });

    await user.click(screen.getByRole("button", { name: /Buy \$212\.00/ }));

    expect(onSelect).toHaveBeenCalledWith("buy");
  });

  it("[POO-1155] offers the deposit-from-external-wallet peer and reports its kind", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker({ routes: [TOKENS, BUY, DEPOSIT], onSelect });

    const deposit = screen.getByRole("button", { name: /deposit from external wallet/i });
    expect(deposit).toBeInTheDocument();
    await user.click(deposit);

    expect(onSelect).toHaveBeenCalledWith("deposit");
  });

  // @rule R7 — depositing hands off to another surface entirely and settles its amount there, so it
  // is not one of the choices the cards present. As a card it competed with routes carrying figures;
  // as a ghost link below the list it stays reachable without competing. Asserting it is outside the
  // `<ul>` is the structural half: a screen reader is told "list, 2 items", and that count is a
  // promise about how many comparable ways out of this there are.
  it("[R7] deposit is a ghost link below the cards, not one of them", () => {
    renderPicker({ routes: [TOKENS, BUY, DEPOSIT] });

    const list = screen.getByRole("list");
    const deposit = screen.getByRole("button", { name: /deposit from external wallet/i });

    expect(list).not.toContainElement(deposit);
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("[R7] the deposit link carries no figure and no caption", () => {
    renderPicker({ routes: [BUY, DEPOSIT] });

    const deposit = screen.getByRole("button", { name: /deposit from external wallet/i });
    expect(deposit).toHaveTextContent("Deposit from external wallet");
    expect(deposit.textContent ?? "").not.toMatch(/\$/);
    expect(screen.queryByText("Send crypto from another wallet you hold")).not.toBeInTheDocument();
  });

  // @rule M5.2 (POO-1526) / POO-1571 — the explicit `min-h-11` box is gone: the row now shares the
  // route cards' own icon + padding structure (`py-3` around a `size-9` icon circle), which is what
  // already clears 44pt for every card on this screen without an explicit min-height. Asserted here
  // as "carries the same structure the cards rely on" rather than a jsdom pixel measurement, which
  // does not compute real layout.
  it("[M5.2] the deposit link's row structure clears 44pt the same way the cards do (padding + icon, not an explicit min-height)", () => {
    renderPicker({ routes: [BUY, DEPOSIT] });

    const deposit = screen.getByRole("button", { name: /deposit from external wallet/i });
    expect(deposit).toHaveClass("py-3");
    expect(deposit.querySelector(".size-9")).not.toBeNull();
  });

  // @rule POO-1571 — the row now shares the cards' padding (so its left edge lines up with them
  // instead of sitting flush against the screen edge) and carries the same trailing chevron, while
  // staying visually secondary (no visible border, no coloured background, muted text) so it does
  // not compete with the money-bearing cards above it (murilo, 2026-08-13). The border box is
  // present but TRANSPARENT: the cards spend 1px a side on a real stroke, so omitting the box
  // entirely would put this row's content 1px off theirs, which is the alignment this fix is for.
  it("[POO-1571] the deposit link is aligned with the cards (same px-4 padding, a transparent border box) and carries a chevron", () => {
    renderPicker({ routes: [BUY, DEPOSIT] });

    const deposit = screen.getByRole("button", { name: /deposit from external wallet/i });
    expect(deposit).toHaveClass("px-4", "w-full", "border", "border-transparent");
    // Ghost, still: it never takes the cards' visible stroke or their recommended tint. Asserted one
    // class at a time on purpose: `.not.toHaveClass(a, b)` passes as soon as ONE is missing, so a
    // combined negative would go green with the tint still applied.
    expect(deposit).not.toHaveClass("border-border");
    expect(deposit).not.toHaveClass("border-primary/35");
    expect(deposit).not.toHaveClass("bg-primary/[0.06]");
    expect(deposit.querySelector("svg.lucide-chevron-right")).not.toBeNull();
  });

  // @rule D1 (murilo, 2026-08-10) — the trigger is honest rather than a flag: a row cannot print an
  // amount it does not have, so an absent `sourceTargetUsd` IS "the quote has not resolved". The
  // modal still opens on tap, because "open only when ready" means a dead tap of unknown length.
  it("[D1] renders a skeleton of itself while any card route lacks its amount", () => {
    renderPicker({ routes: [{ ...TOKENS, sourceTargetUsd: undefined }, BUY] });

    expect(screen.getByTestId("funding-routes-loading")).toBeInTheDocument();
    expect(screen.queryByText(/You need/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  // @rule D1 — the deposit link has no amount to wait for and never will: it settles its figure on
  // the surface it hands off to. Counting it as unquoted would hold the whole screen behind a value
  // that is not coming.
  it("[D1] the deposit link does not hold the screen in loading", () => {
    renderPicker({ routes: [TOKENS, BUY, DEPOSIT] });

    expect(screen.queryByTestId("funding-routes-loading")).not.toBeInTheDocument();
    expect(screen.getByText("You need $205.00")).toBeInTheDocument();
  });

  it("[F3-R1] cancel backs out of the gate", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderPicker({ routes: [TOKENS, BUY], onCancel });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  // @rule M5.2 (POO-1526) — its own full-width row at the foot of the screen; the explicit 44pt is
  // a min-height, not a bigger font.
  it("[M5.2] cancel carries an explicit 44pt touch target", () => {
    renderPicker({ routes: [TOKENS, BUY] });

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("min-h-11");
  });

  it("[F3-R7] the option rows wrap long copy instead of overflowing", () => {
    renderPicker({ routes: [TOKENS_PLUS_BUY, BUY] });

    const option = screen.getByRole("button", { name: /Use \$88\.40 \+ buy \$121\.60/ });
    expect(option.querySelectorAll(".min-w-0").length).toBeGreaterThan(0);
    expect(option.querySelectorAll(".break-words").length).toBeGreaterThan(0);
  });

  it("renders nothing at all when there is no choice to make", () => {
    // [R2]: the panel is supposed to skip this step, but a component that renders a one-option
    // question if asked is one refactor away from shipping it.
    const { container } = renderPicker({ routes: [TOKENS] });

    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * POO-1755 [R3]: the D1 skeleton is unreachable for a state with no pending resolution.
 *
 * The production shape behind the report: wallet `0x3B58…D369`, a position op on an Arbitrum pool,
 * zero native anywhere, an empty routable inventory. POO-1033 [R2] deliberately classifies that
 * `multi` (the gas can only come from the on-ramp or another chain), so the picker mounts; every
 * card then lacked its figure by construction, because the five non-spending ops carry
 * `opRequiredUsdc: 0` and `targetFor` read the zero as "no target stated". The D1 skeleton sat on
 * screen forever with nothing in flight. The routes are built through the REAL resolver so this
 * cannot quietly regress into a fixture that keeps the test green.
 */
describe("a zero-cost operation reaches the choice, never the skeleton (POO-1755 [R3])", () => {
  const ARBITRUM = 42161;
  const blockedGas: GasFeasibility = {
    chainId: ARBITRUM,
    verdict: "BLOCKED",
    quotedGasUsd: 0.2,
    requiredGasUsd: 0.25,
    shortfallUsd: 0.25,
    surplusUsd: 0,
    reasonKey: "provisioning.gasVerdict.blocked",
  };

  it("renders the buy card for the reporting wallet's shape, not funding-routes-loading", () => {
    const routes = resolveFundingRoutes({
      sources: [],
      gasByChainId: { [ARBITRUM]: blockedGas },
      targetChainId: ARBITRUM,
      requiredUsd: 5,
      onRampEnabled: true,
      target: { transactionUsd: 0 },
    });

    renderPicker({ routes, requiredUsd: 5, opRequiredUsd: 0, gasUsd: 0.25 });

    expect(screen.queryByTestId("funding-routes-loading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Buy \$10\.00/ })).toBeInTheDocument();
  });
});
