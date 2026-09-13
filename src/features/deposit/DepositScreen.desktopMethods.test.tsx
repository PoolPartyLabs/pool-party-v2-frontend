/**
 * @id PP-DEP-SCR-001 — tests
 * @name Deposit flow — the inline desktop payment-method panel (POO-1612)
 * @implements-rules-version v1 (POO-1612 rules v1)
 *
 * `lg` and above: the payment-method list mounts INLINE in the amount-step panel instead of behind
 * a dialog (S2), and Continue advances straight to review (S3) with no intermediate step. Below
 * `lg` is `DepositScreen.methods.test.tsx`'s territory; its 24+ cases run with `useIsDesktop`
 * unmocked (resolves `null` in jsdom) and are unaffected by anything in this file, which is the
 * proof the dialog path stayed "mounted and unchanged below lg".
 *
 * Driven against the REAL `useBuyRouteQuote` with only the two server actions stubbed, same harness
 * as `DepositScreen.methods.test.tsx`, plus `useIsDesktop` mocked true.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";

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
vi.mock("@/hooks/useIsDesktop", () => ({ useIsDesktop: () => true }));

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

/** A wallet that already has gas, same fixture as `DepositScreen.methods.test.tsx`. */
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

function methodsIn(currencyCodeFrom: string, methods: OnRampPaymentMethod[]) {
  return { ok: true as const, currencyCodeFrom, methods };
}

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

/** Answers a quote the way the endpoint does (POO-1599): every method on the pair, unpinned. */
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
  rail.paymentMethod = undefined;
  rail.receiveUsdSeen = [];
  actions.getMethods.mockReset();
  actions.getQuote.mockReset();
  actions.getMethods.mockResolvedValue(methodsIn("EUR", [CARD, SEPA]));
  actions.getQuote.mockImplementation(
    pricedLike(({ paymentMethod }) => (paymentMethod === SEPA.paymentMethod ? 101 : 103.4), "EUR"),
  );
});

describe("DepositScreen desktop inline payment method (POO-1612 S2/S3)", () => {
  it("shows the list inline on first paint, with no interaction, and never mounts the dialog open", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    expect(await screen.findByRole("radio", { name: /Credit Card/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /SEPA Transfer/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Continue advances straight to review, with no intermediate dialog step", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    await screen.findByRole("radio", { name: /Credit Card/ });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("You'll receive")).toBeInTheDocument();
  });

  it("selecting an inline row updates the selection and the Review that follows, with no intermediate step", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    await screen.findByRole("radio", { name: /Credit Card/ });
    fireEvent.click(screen.getByRole("radio", { name: /SEPA Transfer/ }));
    expect(screen.getByRole("radio", { name: /SEPA Transfer/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Paying with SEPA Transfer")).toBeInTheDocument();
  });

  // The wiring-survival proof POO-1612 asks for: the paymentMethod actually reaching the rail (and
  // therefore `mintOnRampRequest`) after a selection made on the INLINE list, not the dialog.
  it("hands the method chosen on the INLINE list to the rail that mints the purchase", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    await screen.findByRole("radio", { name: /Credit Card/ });
    fireEvent.click(screen.getByRole("radio", { name: /SEPA Transfer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm & pay/ }));

    expect(screen.getByTestId("standalone-onramp-rail")).toBeInTheDocument();
    expect(rail.paymentMethod).toBe("poolparty-sepa");
  });

  // POO-1612 Rows: every row carries its own charge now (POO-1599 unpinned the listing quote), so
  // the buyer compares the vendor's own figures side by side rather than a claim of ours about them.
  it("shows every row's own charge", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    expect(await screen.findByText("You pay €103.40")).toBeInTheDocument();
    expect(screen.getByText("You pay €101.00")).toBeInTheDocument();
  });

  /**
   * D1 (epic POO-1129, 16/08), murilo: *"use as labels do vendor so"* — use the vendor's labels
   * only. No superlative of OURS sits beside a money figure; the chip slot belongs to the vendor.
   *
   * Asserted as an absence, and deliberately not only on the string "Best price": what the rule
   * forbids is the CLAIM, so re-adding it under any wording ("Cheapest", "Best value") has to fail
   * too. POO-1639 also deleted the comparison itself (`selectBestPriceMethodIds`,
   * PP-CORE-LIB-100), which had been kept unwired for a cheapest-viable default nobody scheduled, so
   * this assertion is now the only thing standing between the claim and a re-implementation.
   */
  it("prints no superlative of ours beside a charge", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    await screen.findByText("You pay €103.40");
    for (const claim of [/best price/i, /cheapest/i, /best value/i, /lowest fee/i]) {
      expect(screen.queryByText(claim)).toBeNull();
    }
  });

  it("blocks a row inline exactly as the dialog would, using the same rule", async () => {
    actions.getMethods.mockResolvedValue(
      methodsIn("EUR", [CARD, { ...SEPA, minUsd: 200, minCurrencyCode: "EUR" }]),
    );
    renderWithProviders(<DepositScreen investContext={null} />);
    await screen.findByText("Paybis needs at least €200.00.");
    expect(screen.getByRole("radio", { name: /SEPA Transfer/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("disables Continue at lg too when every method is blocked, without a dialog to open", async () => {
    actions.getMethods.mockResolvedValue(
      methodsIn("EUR", [{ ...CARD, minUsd: 200, minCurrencyCode: "EUR" }]),
    );
    renderWithProviders(<DepositScreen investContext={null} />);
    await screen.findByText(
      "Increase your deposit to €200.00. No payment method accepts less right now.",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});
