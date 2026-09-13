/**
 * @id PP-DEP-SCR-001 (POO-1904), spec
 * @name Deposit flow, the Privy rail wears no other vendor
 * @implements-rules-version v1 (POO-1904 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * The screen AROUND the checkout, not the checkout. POO-1807 switched which rail charges the card
 * and left the Paybis furniture standing on the new one: a Paybis payment-method picker, Paybis
 * minimums, and "Secured by Paybis" printed on the step that takes the card while a Privy-brokered
 * Stripe, MoonPay, Coinbase or Meld charge is what actually happens.
 *
 * Two rules live here.
 *
 *   [R1] no Paybis method surface on the Privy rail, in EITHER host: the inline desktop panel
 *        (POO-1612 S2) and the below-`lg` dialog. Privy's own modal owns method selection, so a
 *        picker of ours is a choice the buyer does not get to make. The Paybis FLOOR is part of that
 *        surface: it currently disables Continue on a rail Paybis does not serve.
 *   [R3] no user-facing copy on this rail names a vendor. Settled on the issue as PROVIDER-NEUTRAL
 *        rather than rail-aware, because Privy auto-routes between four providers and our own
 *        outcome record does not capture which one served, so naming any of them repeats the
 *        merchant-of-record error that rejection 14 of the epic's handoff exists to stop.
 *
 * Both rails are exercised in every case that has two sides: the Paybis rail's own furniture is
 * honest while that rail exists (POO-1819 keeps it as the 72-hour rollback target), so a gate that
 * removed it from BOTH would pass [R1] and break the rail this one is a rollback to.
 *
 * Driven against the REAL `useBuyRouteQuote` with only the two server actions stubbed, the same
 * harness `DepositScreen.desktopMethods.test.tsx` uses, because `methods`, the blocked set and
 * `allBlocked` are all derived and a hand-stubbed hook would assert nothing about them.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";

vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isFeatureEnabled: () => true,
}));

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

vi.mock("@/lib/balances/balanceRefresh", () => ({ requestBalanceRefresh: vi.fn() }));

vi.mock("@/lib/balances/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: [
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
    ],
    totalUsd: 2500,
    dayChangeUsd: 0,
    dayChangePct: 0,
    isLoading: false,
    isRefreshing: false,
    refresh: vi.fn(),
  }),
}));

/** The rail, the viewport, the probe, the adapter and the chain read: all OURS, all replaced. */
const rig = vi.hoisted(() => ({
  rail: "privy" as "privy" | "paybis" | "none",
  desktop: false,
  coverage: vi.fn(),
  openCheckout: vi.fn(),
  readBalance: vi.fn(),
}));

vi.mock("@/lib/onramp/useOnRampProvider", () => ({ useOnRampProvider: () => rig.rail }));
vi.mock("@/hooks/useIsDesktop", () => ({ useIsDesktop: () => rig.desktop }));
vi.mock("@/lib/onramp/useOnRampCoverage", () => ({ useOnRampCoverage: () => rig.coverage }));
vi.mock("@/lib/onramp/usePrivyOnRamp", () => ({
  usePrivyOnRamp: () => ({ openCheckout: rig.openCheckout }),
}));
vi.mock("@/lib/tokens/readErc20", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tokens/readErc20")>()),
  readErc20Balance: rig.readBalance,
}));

const actions = vi.hoisted(() => ({ getMethods: vi.fn(), getQuote: vi.fn() }));
vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: actions.getMethods,
  getOnRampQuoteAction: actions.getQuote,
}));

vi.mock("./components/DepositPrivyCheckout", () => ({
  ONRAMP_DESTINATION_DECIMALS: 6,
  DepositPrivyCheckout: () => <div data-testid="privy-checkout">checkout</div>,
}));

vi.mock("./components/StandaloneOnRampRail", () => ({
  StandaloneOnRampRail: () => <div data-testid="standalone-onramp-rail">paybis rail</div>,
}));

/**
 * The below-`lg` host, as a MOUNT PROBE rather than the real dialog.
 *
 * The real one is a Radix dialog mounted on every paint with `open={false}`, so it renders nothing
 * and a DOM query cannot tell "not rendered" from "rendered closed". That difference is the whole
 * assertion here: closed-but-mounted still threads the Paybis list and the Paybis charges into a
 * surface on this rail, and the only thing keeping it shut is that Continue takes the Privy branch
 * instead of `setMethodOpen(true)`. [R1] asks for the picker not to EXIST on this rail, which is a
 * statement about the component tree, so the probe is what makes it checkable.
 *
 * `PaymentMethodList` is deliberately NOT mocked: the inline panel's cases assert the real radios
 * and the real minimums, which is what the buyer actually reported seeing.
 */
const dialogProbe = vi.hoisted(() => ({ mounted: false }));
vi.mock("./components/PaymentMethodDialog", () => ({
  PaymentMethodDialog: () => {
    dialogProbe.mounted = true;
    return null;
  },
}));

import { DepositScreen } from "./DepositScreen";

/**
 * Two methods, priced in EUR, because the reported screenshot was a EUR buyer: the minimums the
 * buyer saw ("Minimum EUR 8.59") are the vendor's own, in the vendor's own currency, which is
 * exactly what makes them the wrong vendor's minimums on this rail.
 */
const CARD: OnRampPaymentMethod = {
  paymentMethod: "poolparty-credit-card",
  displayName: "Credit Card",
  minUsd: 10,
  minCurrencyCode: "EUR",
};
const SKRILL: OnRampPaymentMethod = {
  paymentMethod: "poolparty-skrill",
  displayName: "Skrill",
  minUsd: 20,
  minCurrencyCode: "EUR",
};

function methodsIn(currencyCodeFrom: string, methods: OnRampPaymentMethod[]) {
  return { ok: true as const, currencyCodeFrom, methods };
}

/** Every method priced, unpinned, the way the endpoint answers since POO-1599. */
function quoteFor(methods: OnRampPaymentMethod[], currency: string) {
  return {
    ok: true as const,
    quote: {
      quoteId: "quote_1",
      currencyCodeFrom: currency,
      currencyCodeTo: "USDC-BASE",
      requestedAmountType: "destination",
      paymentMethods: methods.map((method) => ({
        id: method.paymentMethod,
        name: method.displayName,
        chargeUsd: 103.4,
        chargeAmount: "103.40",
        chargeCurrencyCode: currency,
        receiveAmount: "100",
        receiveCurrencyCode: "USDC-BASE",
      })),
    },
  };
}

/**
 * Floors the Privy rail can actually hit, which is not the same fixture as the picker's.
 *
 * `isMethodBelowFloor` has two tiers: the row's own CHARGE when the quote priced it, else the
 * entered amount, and tier 2 only compares when the floor is denominated in USD (`sameFiat`, there
 * is no FX source in this app). This rail suspends the pricing hop, so tier 1 never applies here
 * and a EUR floor is silently incomparable: the EUR fixture below paints the picker but can never
 * reach `allBlocked`. A USD floor is what makes the refusal reachable on this rail, so it is the
 * fixture the two blocking cases use. Without this distinction both of them pass on `main`.
 */
const CARD_USD_FLOOR: OnRampPaymentMethod = {
  ...CARD,
  minUsd: 200,
  minCurrencyCode: "USD",
};
const SKRILL_USD_FLOOR: OnRampPaymentMethod = {
  ...SKRILL,
  minUsd: 300,
  minCurrencyCode: "USD",
};

beforeEach(() => {
  window.dataLayer = [];
  localStorage.clear();
  dialogProbe.mounted = false;
  rig.rail = "privy";
  rig.desktop = false;
  rig.coverage.mockReset();
  rig.coverage.mockResolvedValue({ status: "covered", methods: [] });
  rig.openCheckout.mockReset();
  rig.openCheckout.mockResolvedValue({
    attemptId: "a1",
    moved: "confirmed",
    reason: "provider_confirmed",
  });
  rig.readBalance.mockReset();
  rig.readBalance.mockResolvedValue(BigInt(25_000_000));
  actions.getMethods.mockReset();
  actions.getQuote.mockReset();
  actions.getMethods.mockResolvedValue(methodsIn("EUR", [CARD, SKRILL]));
  actions.getQuote.mockResolvedValue(quoteFor([CARD, SKRILL], "EUR"));
});

/** Settle the amount step: the baseline read and, on the Privy rail, the debounced coverage probe. */
async function settleAmountStep({ probe = true }: { probe?: boolean } = {}) {
  const rendered = renderWithProviders(<DepositScreen investContext={null} />);
  if (rig.rail === "privy") {
    await waitFor(() => expect(rig.readBalance).toHaveBeenCalled());
    if (probe) await waitFor(() => expect(rig.coverage).toHaveBeenCalled(), { timeout: 3000 });
  }
  // The methods hop is what paints the picker on the rail that still has one, so every case waits
  // for it to ANSWER. A gate asserted before the list could arrive passes on both rails.
  await waitFor(() => expect(actions.getMethods).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

describe("no Paybis method surface on the Privy rail (POO-1904 [R1])", () => {
  // @rule R1 -- the desktop inline panel (POO-1612 S2).
  it("[R1] renders no inline payment-method panel at lg and above", async () => {
    rig.desktop = true;
    await settleAmountStep();

    expect(screen.queryByRole("radio", { name: /Credit Card/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /Skrill/ })).toBeNull();
    expect(screen.queryByText("Payment method")).toBeNull();
  });

  // @rule R1 -- and the below-`lg` dialog, which is MOUNTED on every paint rather than opened.
  it("[R1] never mounts the payment-method dialog below lg", async () => {
    rig.desktop = false;
    await settleAmountStep();

    expect(dialogProbe.mounted).toBe(false);
    expect(screen.queryByRole("radio", { name: /Credit Card/ })).toBeNull();
  });

  // @rule R1 -- and not at lg either, where the dialog is the surface that must stay absent.
  it("[R1] never mounts the payment-method dialog at lg and above", async () => {
    rig.desktop = true;
    await settleAmountStep();

    expect(dialogProbe.mounted).toBe(false);
  });

  /**
   * @rule R1 -- the minimums the buyer actually reported seeing.
   *
   * Two surfaces printed a Paybis floor, and the name of this case covers BOTH. `method.allBlocked`
   * interpolates `formatFiat(lowestFloor)`, which is where "Minimum EUR 8.59" came from: a floor read
   * off the Paybis method list, in the Paybis charge currency, printed on a rail Paybis does not
   * serve. `PaymentMethodList` also prints `method.minimum` ("Minimum {amount}") per ROW, from the
   * same floors, so asserting only the banner would leave the per-row line free to come back.
   *
   * `settleAmountStep` waits for the coverage probe and for the methods hop to ANSWER, so the
   * negative below cannot pass merely because the list had not painted yet. `deposit.minHint`
   * ("Minimum deposit is ...") shares the prefix and is the RAIL's own honest floor, which stays:
   * it paints only below `MIN_DEPOSIT`, and the amount here is above it.
   */
  it("[R1] prints no Paybis minimum when every Paybis method is below its floor", async () => {
    actions.getMethods.mockResolvedValue(methodsIn("USD", [CARD_USD_FLOOR, SKRILL_USD_FLOOR]));
    await settleAmountStep();

    expect(screen.queryByText(/No payment method accepts less/)).toBeNull();
    expect(screen.queryByText(/Increase your deposit/)).toBeNull();
    expect(screen.queryByText(/^Minimum /)).toBeNull();
  });

  /**
   * @rule R1 -- and the floor is not merely invisible, it no longer REFUSES.
   *
   * This is the behavioural half, and the one a DOM assertion cannot reach: `allBlocked` rode into
   * Continue's `disabled`, so a Paybis floor above the typed amount silently withheld a Privy
   * purchase that Privy would have taken. The rail's own floor (`MIN_DEPOSIT`) is what may refuse
   * here, and nothing else's.
   */
  it("[R1] lets the purchase open when a Paybis floor would have blocked it", async () => {
    actions.getMethods.mockResolvedValue(methodsIn("USD", [CARD_USD_FLOOR, SKRILL_USD_FLOOR]));
    await settleAmountStep();

    const cta = screen.getByRole("button", { name: "Continue" });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);
    await waitFor(() => expect(rig.openCheckout).toHaveBeenCalledTimes(1));
  });

  /**
   * @rule R1 -- the other side of every gate above.
   *
   * POO-1819 keeps the Paybis rail as the 72-hour rollback target after cutover, so its own picker,
   * its own minimums and its own refusal are all still load-bearing. A gate written as "never" would
   * pass the four cases above and delete the rail we roll back to.
   */
  it("[R1] leaves the Paybis rail's own picker, minimums and refusal alone", async () => {
    rig.rail = "paybis";
    rig.desktop = true;
    await settleAmountStep();

    expect(await screen.findByRole("radio", { name: /Credit Card/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Skrill/ })).toBeInTheDocument();
  });

  // @rule R1 -- the dialog is the Paybis rail's only method surface below `lg`, so it still mounts.
  it("[R1] still mounts the dialog on the Paybis rail below lg", async () => {
    rig.rail = "paybis";
    rig.desktop = false;
    await settleAmountStep();

    expect(dialogProbe.mounted).toBe(true);
  });

  it("[R1] leaves the Paybis rail's all-blocked refusal alone", async () => {
    rig.rail = "paybis";
    rig.desktop = true;
    actions.getMethods.mockResolvedValue(
      methodsIn("EUR", [
        { ...CARD, minUsd: 200 },
        { ...SKRILL, minUsd: 300 },
      ]),
    );
    await settleAmountStep();

    expect(await screen.findByText(/No payment method accepts less/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("no vendor is named on the Privy rail (POO-1904 [R3])", () => {
  /**
   * @rule R3 -- the compliance defect, on the step that takes the card.
   *
   * Asserted as an absence over the whole rendered step rather than against the one string that was
   * wrong, because the rule is about the CLAIM: re-introducing any vendor's name, in any copy, on
   * this rail has to fail. `privy` is in the list for the same reason the other four are, per
   * rejection 14 of the epic's handoff: they are not the merchant of record either.
   */
  it("[R3] names no payment vendor anywhere on the amount step", async () => {
    rig.desktop = true;
    await settleAmountStep();

    for (const vendor of [/paybis/i, /privy/i, /stripe/i, /moonpay/i, /coinbase/i, /meld/i]) {
      expect(screen.queryByText(vendor)).toBeNull();
    }
  });

  // @rule R3 -- and it still says something: a trust badge that vanished would be a silent removal.
  it("[R3] states the house-style neutral assurance instead", async () => {
    await settleAmountStep();

    expect(screen.getByText("Secure checkout")).toBeInTheDocument();
  });

  /**
   * @rule R3 -- the Paybis rail keeps the sentence that is true on it.
   *
   * "Secured by Paybis" is honest while Paybis is the counterparty, and POO-1819 keeps that rail
   * reachable. The fix is rail-selected copy, never a vendor named per rail.
   */
  it("[R3] keeps 'Secured by Paybis' on the rail Paybis actually serves", async () => {
    rig.rail = "paybis";
    await settleAmountStep();

    expect(screen.getByText("Secured by Paybis")).toBeInTheDocument();
    expect(screen.queryByText("Secure checkout")).toBeNull();
  });
});
