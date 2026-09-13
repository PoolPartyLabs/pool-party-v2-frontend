/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow — the live payment-method picker (POO-1513, POO-1609)
 * @implements-rules-version v7 (POO-1609 rules v2) · v6 (POO-1513 rules v1)
 *
 * The defect this suite locks, reported live: *"I'm in Europe and I was prompted to pay with card in
 * USD no matter what payment method I chose in the deposit tab."* The choice was structurally
 * discarded, and the review screen priced it from a LOCAL fee model (`bank: 0` against
 * `card: 0.0278`), so the app printed one number and billed another.
 *
 * Since POO-1609 it also locks the SECOND money defect this picker shipped: choosing a method whose
 * provider floor the order missed RAISED the purchase, live in production. The charge is never
 * raised. The method is refused instead, and the order stays the buyer's.
 *
 * Driven against the REAL `useBuyRouteQuote` with only the two server actions stubbed, exactly as that
 * hook's own suite does: the guarantee under test is the wiring between the picker, the quote and the
 * mint, and stubbing the hook would assert nothing about it. Real mode + `fiatOnRamp` on, because that
 * is the only configuration where the live list exists at all.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../../../tests/utils/renderWithProviders";

vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isFeatureEnabled: () => true,
}));
/**
 * This suite is about the PAYBIS rail, so it pins the rail rather than the flags behind it.
 *
 * POO-1807 review N1: `realRail` used to read `isFeatureEnabled("fiatOnRamp")`, which the mock above
 * answers, and now comes from `useOnRampProvider()` so a Dev-menu override cannot move one gate
 * while the other answers for the env. That hook reads `useFeatureFlags`, not `isFeatureEnabled`,
 * and both on-ramp flags ship off, so without this line the screen resolves `none` and mounts no
 * rail at all. Naming the rail is also what these tests actually mean.
 */
vi.mock("@/lib/onramp/useOnRampProvider", () => ({ useOnRampProvider: () => "paybis" }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as `0x${string}`,
    isLoading: false,
  }),
}));

const actions = vi.hoisted(() => ({ getMethods: vi.fn(), getQuote: vi.fn() }));
vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: actions.getMethods,
  getOnRampQuoteAction: actions.getQuote,
}));

/** A wallet that already has gas: `readBaseNativeEth` reads 1 ETH on Base, well over the floor. */
const GAS_HAVING_WALLET = [
  {
    symbol: "ETH",
    name: "Ethereum",
    amount: 1,
    amountExact: "1",
    decimals: 18,
    usd: 2500,
    chainId: 8453,
    logoUrl: "",
    isNative: true,
    address: "0x0000000000000000000000000000000000000000",
  },
];

/**
 * A wallet that ALREADY HAS GAS, which is the configuration nearly every assertion in this suite is
 * about, held in a hoisted object exactly as `DepositScreen.gasFirst.test.tsx` holds its own.
 *
 * The screen reads the balance to know which pair the purchase will be minted on (POO-1513 X1): under
 * `PAYBIS_GAS_FLOOR_ETH` the order is `ETH-BASE` and there is deliberately no printed charge at all,
 * which would make every pricing assertion below vacuous. That path has its own suite,
 * `DepositScreen.gasFirst.test.tsx`, where it is asserted against the order the real rail mints.
 * Mocked rather than provider-mounted because this suite runs in real mode, where `useTokenBalances`
 * reads `useAccount()` and there is no `WagmiProvider` here.
 *
 * It is MUTABLE for one reason, and only one test uses it: emptying the wallet moves the pair, which
 * is the only thing on this screen that re-fetches the method list WITHOUT an amount edit. `beforeEach`
 * puts the gas back, so every other test reads the wallet its assertions assume.
 */
const wallet = vi.hoisted(() => ({ balances: [] as unknown[] }));
vi.mock("@/lib/balances/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: wallet.balances,
    totalUsd: 2500,
    dayChangeUsd: 0,
    dayChangePct: 0,
    isLoading: false,
    isRefreshing: false,
    refresh: vi.fn(),
  }),
}));

/**
 * The rail is stubbed down to what it reports back: the method it was handed, and EVERY distinct
 * order size it was rendered with.
 *
 * The sequence matters and a last-value read would miss the defect: the real rail captures its plan
 * on the first render where balances resolve (`StandaloneOnRampRail.tsx`), which in production is
 * normally AFTER mount, so a `receiveUsd` that moves post-mount is a purchase sized at a figure the
 * buyer never confirmed.
 */
const rail = vi.hoisted(() => ({
  paymentMethod: undefined as string | undefined,
  receiveUsdSeen: [] as number[],
}));
vi.mock("./components/StandaloneOnRampRail", () => ({
  StandaloneOnRampRail: (props: { paymentMethod?: string; receiveUsd: number }) => {
    rail.paymentMethod = props.paymentMethod;
    if (rail.receiveUsdSeen.at(-1) !== props.receiveUsd) rail.receiveUsdSeen.push(props.receiveUsd);
    return <div data-testid="standalone-onramp-rail">rail</div>;
  },
}));

import { DepositScreen } from "./DepositScreen";

const CARD: OnRampPaymentMethod = {
  paymentMethod: "poolparty-credit-card",
  displayName: "Credit Card",
  minUsd: 10,
  minCurrencyCode: "EUR",
};
const SEPA: OnRampPaymentMethod = {
  paymentMethod: "poolparty-sepa",
  displayName: "SEPA Transfer",
  minUsd: 20,
  minCurrencyCode: "EUR",
};

/** A methods result for the buyer's own resolved currency (POO-1512). */
function methodsIn(currencyCodeFrom: string, methods: OnRampPaymentMethod[]) {
  return { ok: true as const, currencyCodeFrom, methods };
}

/**
 * A normalized quote pricing one entry per `[paymentMethod, charge]` pair.
 *
 * POO-1599: the quote is sent UNPINNED unless the buyer has actually chosen a method, and Paybis
 * answers an unpinned quote for EVERY method the pair offers. A stub that answers a listing quote
 * with a single entry (or, worse, with an entry whose `id` is the `undefined` it was handed) has
 * stopped modelling the endpoint, and the screen would then show no charge for a reason that exists
 * only in the stub.
 */
function quotePricing(prices: ReadonlyArray<readonly [string, number]>, currency: string) {
  return {
    ok: true as const,
    quote: {
      quoteId: "quote_1",
      currencyCodeFrom: currency,
      currencyCodeTo: "USDC-BASE",
      requestedAmountType: "destination",
      paymentMethods: prices.map(([paymentMethod, charge]) => ({
        id: paymentMethod,
        name: paymentMethod,
        chargeUsd: charge,
        chargeAmount: charge.toFixed(2),
        chargeCurrencyCode: currency,
        receiveAmount: "100",
        receiveCurrencyCode: "USDC-BASE",
      })),
    },
  };
}

/**
 * Answer a quote the way the endpoint does (POO-1599): the ONE method that was pinned, or every
 * method on the pair when the request carried no pin.
 */
function pricedLike(
  charge: (args: { amount: number; paymentMethod: string }) => number,
  currency: string,
) {
  return async ({ amount, paymentMethod }: { amount: number; paymentMethod?: string }) =>
    quotePricing(
      (paymentMethod === undefined
        ? [CARD.paymentMethod, SEPA.paymentMethod]
        : [paymentMethod]
      ).map((id) => [id, charge({ amount, paymentMethod: id })] as const),
      currency,
    );
}

beforeEach(() => {
  window.dataLayer = [];
  wallet.balances = GAS_HAVING_WALLET;
  rail.paymentMethod = undefined;
  rail.receiveUsdSeen = [];
  actions.getMethods.mockReset();
  actions.getQuote.mockReset();
  actions.getMethods.mockResolvedValue(methodsIn("EUR", [CARD, SEPA]));
  actions.getQuote.mockImplementation(
    pricedLike(({ paymentMethod }) => (paymentMethod === SEPA.paymentMethod ? 101 : 103.4), "EUR"),
  );
});

/** Open the picker from the amount step, once the live list has landed in it. */
async function openPicker() {
  return openPickerNamed(/Credit Card/);
}

/**
 * The same, waiting on a caller-named row: a suite whose fixtures are not the file-level CARD/SEPA
 * pair must wait for ITS OWN list to land, or it asserts against whatever rendered first.
 */
async function openPickerNamed(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("radio", { name });
  return dialog;
}

describe("DepositScreen payment methods (POO-1513 S1/S4)", () => {
  // S1: the dialog is built from `getOnRampPaymentMethodsAction`, resolved for the buyer's currency.
  it("offers the live list and never the hardcoded pix/card/applePay/bank union", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    expect(within(dialog).getByRole("radio", { name: /SEPA Transfer/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("radio", { name: /Pix/ })).toBeNull();
  });

  /**
   * S4: the default comes from the LIST via `pickDefaultPaymentMethod` (a fallback, POO-1578 S4), never
   * from the `useState<PaymentMethod>("pix")` constant. Pix is Brazil-only and was pre-selected for
   * every buyer in every country.
   */
  it("defaults from the list rather than from a constant", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    expect(within(dialog).getByRole("radio", { name: /Credit Card/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /SEPA Transfer/ })).not.toBeChecked();
  });

  // The buyer's choice OVERRIDES the fallback, which is the whole point of POO-1578 S4.
  it("lets the buyer's choice win over the card default", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    expect(within(dialog).getByRole("radio", { name: /SEPA Transfer/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Paying with SEPA Transfer")).toBeInTheDocument();
  });

  // Analytics: the event already existed and fired for a discarded choice. Its VALUE space moves from
  // the local union to the Paybis identifier (docs/ANALYTICS_EVENTS.md records the discontinuity).
  it("emits deposit_method_selected with the Paybis identifier", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "deposit_method_selected",
        deposit_method: "poolparty-sepa",
      }),
    );
  });
});

describe("DepositScreen review pricing (POO-1513 S3)", () => {
  /**
   * The money-correctness defect this issue opened on. `PROCESSING_RATES` was `bank: 0` against
   * `card: 0.0278`, so a bank-transfer buyer was shown a 0% fee and then billed a card at ~2.78%. The
   * review now prints the QUOTE's charge for the method actually chosen, in the currency actually
   * billed, and computes nothing of its own.
   */
  it("prints the quote's charge in the buyer's currency, not a local model in dollars", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("€103.40")).toBeInTheDocument();
    // The deleted local model's figure for a $100 received-fixed deposit, in dollars.
    expect(screen.queryByText("$102.00")).toBeNull();
    // And no locally derived fee row survives it.
    expect(screen.queryByText("Paybis fee")).toBeNull();
  });

  it("re-prices from the quote when the buyer changes method, never from a rate table", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("€101.00")).toBeInTheDocument();
  });

  // "It degrades, it never blocks": an unpriced quote costs the figure, never the flow.
  it("falls back to a neutral caption when the quote carries no charge", async () => {
    actions.getQuote.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "no pair" });
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Shown at checkout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm & pay/ })).not.toBeDisabled();
  });
});

describe("DepositScreen method minimums (POO-1609, second and standing reversal)", () => {
  /**
   * "the charge is never raised... the payment method must stay BLOCKED with a message explaining
   * it" (murilo, 2026-08-14). A method whose minimum exceeds the order renders BLOCKED: shown, in
   * its normal position, `method.blocked` in place of `method.minimum`, unselectable.
   */
  it("shows a method whose minimum exceeds the order as BLOCKED, not raised", async () => {
    actions.getMethods.mockResolvedValue(
      methodsIn("EUR", [CARD, { ...SEPA, minUsd: 200, minCurrencyCode: "EUR" }]),
    );
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    // The default beforeEach prices SEPA at EUR 101, under its EUR 200 floor: tier 1 blocks it.
    await within(dialog).findByText("Paybis needs at least €200.00.");
    expect(within(dialog).queryByText("Minimum €200.00")).toBeNull();
    const radio = within(dialog).getByRole("radio", { name: /SEPA Transfer/ });
    expect(radio).toHaveAttribute("aria-disabled", "true");
    expect(radio).not.toBeDisabled();
  });

  // AC1: activating a blocked row never changes the amount field. Proven by dismissing the dialog
  // without ever reaching Continue, which is exactly how the deleted raise used to leave the amount
  // step silently changed underneath a buyer who backed out.
  it("never changes the amount when a blocked row is activated", async () => {
    actions.getMethods.mockResolvedValue(
      methodsIn("EUR", [CARD, { ...SEPA, minUsd: 200, minCurrencyCode: "EUR" }]),
    );
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    await within(dialog).findByText("Paybis needs at least €200.00.");
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    expect(within(dialog).getByRole("radio", { name: /SEPA Transfer/ })).not.toBeChecked();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("You're adding")).toHaveValue("100");
  });

  /**
   * The deleted raise excluded the auto-picked default on purpose (raising on a selection nobody
   * made would have moved the field with nothing on screen to explain it). Blocking moves nothing,
   * so that carve-out does not carry over: it applies uniformly, including to the row
   * `pickDefaultPaymentMethod` would otherwise have chosen. P38: with the only method blocked,
   * nothing is selectable, so `Continue` is disabled and `method.allBlocked` names the floor.
   */
  it("blocks the auto-picked default too, and disables Continue when it is the only method", async () => {
    actions.getMethods.mockResolvedValue(
      methodsIn("EUR", [{ ...CARD, minUsd: 200, minCurrencyCode: "EUR" }]),
    );
    renderWithProviders(<DepositScreen investContext={null} />);
    // Continue is disabled the moment every method is blocked, so the dialog is never reachable:
    // asserted on the amount step alone, both figures come from the methods list.
    await screen.findByText(
      "Increase your deposit to €200.00. No payment method accepts less right now.",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  // The counterpart: an order that clears every floor is nobody's blocked intent.
  it("counts nothing when the order already clears the method's minimum", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("€101.00")).toBeInTheDocument();
    expect(window.dataLayer).not.toContainEqual(
      expect.objectContaining({ event: "tx_amount_blocked" }),
    );
  });

  /**
   * The refusal's AFTERMATH on the review step, where the buyer confirms.
   *
   * Handing the selection back re-opens the quote UNPINNED, and the hook then publishes the charge
   * for `pickDefaultPaymentMethod` over the WHOLE list, which is the very method it just refused,
   * while `activeMethod` picks over the REACHABLE list and names another. So the review printed one
   * method's name over another method's figure, not transiently but as the settled state a refusal
   * leaves behind, with Confirm under a number that answered for neither the method beside it nor
   * the method about to be charged. That is the deleted `PROCESSING_RATES` defect with a new source,
   * so the figure is withheld and the caption this screen already shows for an unpriced quote stands
   * in its place.
   */
  /**
   * #897's divergence, which this branch does NOT remove, plus the guard that contains it.
   *
   * The original test's premise was #897's mechanism: refusing a method handed the selection BACK,
   * re-opening the quote unpinned so it republished the refused method's charge while the review
   * named the fallback. That premise is false here (a refusal changes no state), the test replayed
   * onto this branch with no conflict, and it silently stopped measuring anything — it even lost its
   * `act` import on the way, which is how it was found.
   *
   * The divergence itself survives, by a different route. Once the buyer picks a method the quote is
   * PINNED to it, so every other row loses its own charge and falls to tier 2, where a floor in a
   * currency the entered amount is not denominated in cannot be compared at all
   * ({@link isMethodBelowFloor}'s deliberate no-FX rule, POO-333). A below-floor row is therefore
   * momentarily selectable, the click is accepted, and only the re-quote that follows reveals the
   * floor. Two things then have to hold, and both are asserted here: `activeMethod` filters the
   * refused method back out, so the RAIL never sees it; and the charge, which now answers for the
   * filtered method, is WITHHELD rather than printed under the name of the method that survived.
   *
   * PP-NOTE (POO-1609 residual): the momentary selectability is a UX wart, not a money defect — the
   * order never moves and the mint never sees the refused method. Closing it needs a per-row charge
   * that survives pinning, which is POO-1599's unpinned listing quote applied to the pinned case.
   */
  it("withholds the charge when the quote answers for a method the review is not naming", async () => {
    actions.getMethods.mockResolvedValue(
      methodsIn("EUR", [{ ...CARD, minUsd: 300, minCurrencyCode: "EUR" }, SEPA]),
    );
    // Priced apart, so a figure printed under the wrong name is visibly the wrong figure.
    actions.getQuote.mockImplementation(
      pricedLike(({ paymentMethod }) => (paymentMethod === CARD.paymentMethod ? 130 : 104), "EUR"),
    );
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();

    // The buyer compares the two rows. SEPA first, because the card is the row that starts checked.
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    await within(dialog).findByText("You pay €104.00");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Credit Card/ }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    // Wait out the re-quote the card's selection opened: it is the one that prices the card at 130
    // and reveals its EUR 300 floor, which is what filters the card back out. Settling on the NAME
    // rather than on the caption, because the caption appears the instant the stale charge is
    // cleared (that clear is deliberately not debounced) and would settle a commit too early.
    await screen.findByText("Paying with SEPA Transfer");

    // The refused card never becomes what the screen names or what the rail is pointed at.
    expect(
      screen.getByRole("button", { name: "Confirm & pay with SEPA Transfer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Shown at checkout")).toBeInTheDocument();
    // The refused card's charge, which is the one the quote published and the one SEPA does not cost.
    expect(screen.queryByText("€130.00")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Confirm & pay/ }));
    expect(rail.paymentMethod).toBe(SEPA.paymentMethod);
  });
});

/**
 * Retired with the raise itself, and why: F1 (stale-quote-ratio) and F2 (step-gate) both guarded
 * arithmetic that mutated `amountText` from a quote landing asynchronously; blocking computes a
 * boolean fresh on every render off the CURRENT `amount`/`methods`/`chargesByMethod`, so there is no
 * state left for a stale commit to corrupt. The currency-mismatch guard is retired for the same
 * reason tier 1 needs none (see `methodFloor.ts`'s header): since POO-1599 a listing quote's charge
 * and its method's floor are denominated in the currency the flow resolved, by construction, not by
 * a check this screen used to run.
 */
describe("DepositScreen blocked-row analytics (POO-1609 S4, premise 11)", () => {
  /** A EUR buyer, SEPA floored at EUR 300 against the default EUR 101 charge: blocked. */
  function sepaFlooredAt300() {
    actions.getMethods.mockResolvedValue(
      methodsIn("EUR", [CARD, { ...SEPA, minUsd: 300, minCurrencyCode: "EUR" }]),
    );
  }

  // The buyer asked to buy 100 with SEPA and the product refused that size: counted, with the
  // reason as a code and the method that carried the floor. No `value`: the order is USDC to
  // receive and the floor is fiat in the buyer's own currency, and mixing the two is the defect
  // this whole issue opened on.
  it("counts the refused activation as this screen's blocked intent, once", async () => {
    sepaFlooredAt300();
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    // Wait for the quote (debounced) so the row is actually rendered blocked before it is clicked;
    // clicking before it lands finds neither tier armed yet and this would prove nothing.
    await within(dialog).findByText("Paybis needs at least €300.00.");
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));

    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "tx_amount_blocked",
        flow: "deposit",
        block_reason: "below_minimum",
        deposit_method: "poolparty-sepa",
      }),
    );
    expect(
      (window.dataLayer as Record<string, unknown>[]).filter(
        (entry) => entry.event === "tx_amount_blocked",
      ),
    ).toHaveLength(1);
  });

  // Never the SELECTION event: a blocked activation is a refusal, not a pick.
  it("never emits deposit_method_selected for a blocked activation", async () => {
    sepaFlooredAt300();
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    await within(dialog).findByText("Paybis needs at least €300.00.");
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    expect(window.dataLayer).not.toContainEqual(
      expect.objectContaining({ event: "deposit_method_selected" }),
    );
  });
});

describe("DepositScreen selection lifetime (POO-1576 Q4)", () => {
  it("keeps the selection across an amount change", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByLabelText("You're adding"), { target: { value: "250" } });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const reopened = screen.getByRole("dialog");
    await waitFor(() => {
      expect(within(reopened).getByRole("radio", { name: /SEPA Transfer/ })).toBeChecked();
    });
  });

  /**
   * Cleared ONLY when the resolved currency changed, because the available list can legitimately
   * differ under it: a EUR buyer's SEPA row simply does not exist in a USD set.
   */
  it("clears the selection when the resolved currency changes", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    /**
     * A profile write resolves the buyer to dollars. The new list deliberately still OFFERS the
     * method they picked: the rule is about the currency moving, not about the row disappearing, and
     * a test whose new list dropped the row would pass on the fallback alone and prove nothing.
     */
    actions.getMethods.mockResolvedValue(
      methodsIn("USD", [
        { ...CARD, minCurrencyCode: "USD" },
        { ...SEPA, minCurrencyCode: "USD" },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByLabelText("You're adding"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("You're adding"), { target: { value: "120" } });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const reopened = screen.getByRole("dialog");
    await waitFor(() => {
      expect(within(reopened).getByRole("radio", { name: /Credit Card/ })).toBeChecked();
    });
    expect(within(reopened).getByRole("radio", { name: /SEPA Transfer/ })).not.toBeChecked();
  });
});

describe("DepositScreen threads the choice to the purchase (POO-1513 S2)", () => {
  /**
   * The boundary the selection died at: `StandaloneOnRampRail` was handed only `receiveUsd`, so the
   * rail re-derived a method with `pickDefaultPaymentMethod` and always minted a card.
   */
  it("hands the chosen method to the rail", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm & pay/ }));

    expect(screen.getByTestId("standalone-onramp-rail")).toBeInTheDocument();
    expect(rail.paymentMethod).toBe("poolparty-sepa");
  });

  it("hands the list-derived default to the rail when the buyer did not choose", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm & pay/ }));
    expect(rail.paymentMethod).toBe("poolparty-credit-card");
  });

  it("carries the chosen method on the submit and completion events", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm & pay/ }));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_submitted", deposit_method: "poolparty-sepa" }),
    );
  });
});

/**
 * POO-1609 [S2], the rule this branch's rebase onto #897 could have deleted in silence.
 *
 * #897 shipped the block as an EFFECT: a `blockedMethods` state that `activeMethod` filtered before
 * choosing what the rail mints. This branch re-implements the same rule SYNCHRONOUSLY, refusing the
 * activation inside `handleMethodSelect`, and the two meet in a rebase where taking this branch's
 * side is correct. The part that does not survive that swap by itself is the FILTER: a click-time
 * refusal only ever sees a click, and the two ways a below-floor method reaches the rail without one
 * are exactly the two pinned here. Both are money defects with nothing on screen to warn the buyer,
 * and before this suite existed both were invisible to every test on either branch.
 *
 * Asserted at the RAIL, not at the radio. A blocked row already renders unchecked either way
 * (`PaymentMethodList` derives `selected` from the same comparison), so a DOM assertion passes while
 * the identifier the mint is built from is still the refused one. What is being protected is the
 * `paymentMethod` reaching `StandaloneOnRampRail` (→ `mintOnRampRequest`), which is the only figure
 * the buyer is actually charged against.
 */
describe("DepositScreen — a refused method never reaches the rail (POO-1609 [S2])", () => {
  /** A card floored above an ordinary order. Named "Credit Card", so it is what the default picks. */
  const HIGH_FLOOR_CARD: OnRampPaymentMethod = {
    paymentMethod: "poolparty-credit-card",
    displayName: "Credit Card",
    minUsd: 300,
    minCurrencyCode: "EUR",
  };
  /** A method the same order clears easily, so there is always somewhere honest to land. */
  const LOW_FLOOR_BANK: OnRampPaymentMethod = {
    paymentMethod: "poolparty-bank",
    displayName: "Bank transfer",
    minUsd: 10,
    minCurrencyCode: "EUR",
  };

  /** A quote whose charge tracks the entered amount, so an amount edit really moves the comparison. */
  function pricedByAmount(ids: readonly string[], currency: string) {
    return async ({ amount, paymentMethod }: { amount: number; paymentMethod?: string }) =>
      quotePricing(
        (paymentMethod === undefined ? ids : [paymentMethod]).map((id) => [id, amount] as const),
        currency,
      );
  }

  /**
   * The buyer picks a method the order CAN reach, then lowers the amount under its floor. The
   * click-time refusal never runs again, so without the filter the stale selection stays live and is
   * what the rail mints: a purchase on a method Paybis will refuse, on a screen that is not ours.
   */
  it("drops a selection the order stops reaching after an amount edit", async () => {
    actions.getMethods.mockResolvedValue(methodsIn("EUR", [LOW_FLOOR_BANK, HIGH_FLOOR_CARD]));
    actions.getQuote.mockImplementation(
      pricedByAmount([LOW_FLOOR_BANK.paymentMethod, HIGH_FLOOR_CARD.paymentMethod], "EUR"),
    );
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.change(screen.getByLabelText("You're adding"), { target: { value: "500" } });

    const dialog = await openPickerNamed(/Credit Card/);
    fireEvent.click(within(dialog).getByRole("radio", { name: /Credit Card/ }));
    expect(within(dialog).getByRole("radio", { name: /Credit Card/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    // Back to the amount step, and down under the EUR 300 floor the buyer had just cleared.
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByLabelText("You're adding"), { target: { value: "100" } });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const reopened = screen.getByRole("dialog");
    await within(reopened).findByText("Paybis needs at least €300.00.");
    fireEvent.click(within(reopened).getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm & pay/ }));

    expect(rail.paymentMethod).not.toBe(HIGH_FLOOR_CARD.paymentMethod);
    expect(rail.paymentMethod).toBe(LOW_FLOOR_BANK.paymentMethod);
  });

  /**
   * Nobody clicked anything. `pickDefaultPaymentMethod` prefers a CARD by name over the whole list,
   * so when that card is the row below its floor the rail is pointed at a refused method from first
   * render, while the picker draws that same row blocked. A click-time refusal cannot see this.
   */
  it("never lets the auto-picked default be a method the order cannot reach", async () => {
    actions.getMethods.mockResolvedValue(methodsIn("EUR", [HIGH_FLOOR_CARD, LOW_FLOOR_BANK]));
    actions.getQuote.mockImplementation(
      pricedByAmount([HIGH_FLOOR_CARD.paymentMethod, LOW_FLOOR_BANK.paymentMethod], "EUR"),
    );
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.change(screen.getByLabelText("You're adding"), { target: { value: "100" } });

    const dialog = await openPickerNamed(/Credit Card/);
    await within(dialog).findByText("Paybis needs at least €300.00.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm & pay/ }));

    expect(rail.paymentMethod).not.toBe(HIGH_FLOOR_CARD.paymentMethod);
    expect(rail.paymentMethod).toBe(LOW_FLOOR_BANK.paymentMethod);
  });

  /**
   * The other direction, so the filter cannot be "passed" by refusing everything: a method the order
   * DOES reach must still be mintable. Without this the two assertions above would also hold on a
   * screen that never mints anything at all.
   */
  it("still hands a reachable method to the rail", async () => {
    actions.getMethods.mockResolvedValue(methodsIn("EUR", [HIGH_FLOOR_CARD, LOW_FLOOR_BANK]));
    actions.getQuote.mockImplementation(
      pricedByAmount([HIGH_FLOOR_CARD.paymentMethod, LOW_FLOOR_BANK.paymentMethod], "EUR"),
    );
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.change(screen.getByLabelText("You're adding"), { target: { value: "500" } });

    const dialog = await openPickerNamed(/Credit Card/);
    fireEvent.click(within(dialog).getByRole("radio", { name: /Credit Card/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm & pay/ }));

    expect(rail.paymentMethod).toBe(HIGH_FLOOR_CARD.paymentMethod);
  });
});
