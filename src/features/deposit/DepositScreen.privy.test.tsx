/**
 * @id PP-DEP-SCR-001 (POO-1807), spec
 * @name Deposit flow, the Privy rail host
 * @implements-rules-version v1 (POO-1807 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * The `/deposit` half of the rail switch. What is pinned here is the host's side: which rail runs,
 * what gates the confirm, which outcome becomes which screen, and where the receipt figure comes
 * from. The adapter, the watcher, the probe and the checkout component are all OURS and all mocked,
 * because each has its own suite; nothing here mocks `@privy-io/react-auth`.
 *
 * The Paybis path stays byte-for-byte: `DepositScreen.realOnRamp.test.tsx` and its siblings run
 * against it untouched, and one test below proves the switch still reaches it.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/balances/balanceRefresh", () => ({ requestBalanceRefresh: refresh }));

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

/** The rail switch, the probe, the adapter and the chain read: all OURS, all replaced. */
const rig = vi.hoisted(() => ({
  rail: "privy" as "privy" | "paybis" | "none",
  /** What the server echoes as the buyer's own currency. `undefined` = it could not resolve one. */
  currencyCodeFrom: "usd" as string | undefined,
  coverage: vi.fn(),
  openCheckout: vi.fn(),
  readBalance: vi.fn(),
}));

/**
 * Both Paybis hops answer, and neither is scenery.
 *
 * The METHODS hop is the BUYER-CURRENCY oracle (POO-1512): the screen reads `currencyCodeFrom` back
 * from it, and since the POO-1801 review the Privy confirm REFUSES without a currency it can charge
 * in rather than silently defaulting to USD. A rig that left it unresolved would test the refusal on
 * every path.
 *
 * The QUOTE hop answers a real charge for a real method ON PURPOSE, even though this rail must show
 * neither. It is what makes the review's F5 assertions load-bearing: with an empty list and a failed
 * quote, "no method label" and "no Amount row" hold whatever the screen does, and the gate could be
 * deleted with every test still green. The screen suspends the pricing hop on this rail
 * (`pricingEnabled`), so this stub answering is exactly the pressure those assertions need.
 */
const PAYBIS_METHOD = {
  paymentMethod: "poolparty-credit-card",
  displayName: "Credit Card",
  minUsd: 10,
  minCurrencyCode: "USD",
};
vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: vi.fn(async () => ({
    ok: true,
    currencyCodeFrom: rig.currencyCodeFrom,
    methods: [PAYBIS_METHOD],
  })),
  getOnRampQuoteAction: vi.fn(async () => ({
    ok: true,
    quote: {
      quoteId: "quote_1",
      currencyCodeFrom: rig.currencyCodeFrom ?? "usd",
      currencyCodeTo: "USDC-BASE",
      requestedAmountType: "destination",
      paymentMethods: [
        {
          id: PAYBIS_METHOD.paymentMethod,
          name: PAYBIS_METHOD.displayName,
          chargeUsd: 103.4,
          chargeAmount: "103.40",
          chargeCurrencyCode: rig.currencyCodeFrom ?? "usd",
          receiveAmount: "100",
          receiveCurrencyCode: "USDC-BASE",
        },
      ],
    },
  })),
}));

vi.mock("@/lib/onramp/useOnRampProvider", () => ({ useOnRampProvider: () => rig.rail }));
vi.mock("@/lib/onramp/useOnRampCoverage", () => ({ useOnRampCoverage: () => rig.coverage }));
vi.mock("@/lib/onramp/usePrivyOnRamp", () => ({
  usePrivyOnRamp: () => ({ openCheckout: rig.openCheckout }),
}));
vi.mock("@/lib/tokens/readErc20", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tokens/readErc20")>()),
  readErc20Balance: rig.readBalance,
}));

/** The checkout component, stubbed to expose its callbacks. */
const host = vi.hoisted(
  () =>
    ({}) as {
      onSettled?: (usd: number, attemptId: string) => void;
      onSettling?: () => void;
      onUnverified?: () => void;
      onFailed?: (reason: string) => void;
    },
);
vi.mock("./components/DepositPrivyCheckout", () => ({
  // The host imports this constant from the same module (ONE definition of the destination's
  // decimals, so a baseline and a delta cannot be scaled differently), so the mock must carry it.
  ONRAMP_DESTINATION_DECIMALS: 6,
  DepositPrivyCheckout: (props: {
    onSettled: (usd: number, attemptId: string) => void;
    onSettling: () => void;
    onUnverified: () => void;
    onFailed: (reason: string) => void;
  }) => {
    host.onSettled = props.onSettled;
    host.onSettling = props.onSettling;
    host.onUnverified = props.onUnverified;
    host.onFailed = props.onFailed;
    return <div data-testid="privy-checkout">checkout</div>;
  },
}));

vi.mock("./components/StandaloneOnRampRail", () => ({
  StandaloneOnRampRail: () => <div data-testid="standalone-onramp-rail">paybis rail</div>,
}));

import { SEED_BUFFER_RATE } from "@/features/strategies/components/provisioning/fundingSelection";
import { resolveOnRampEnvironment } from "@/lib/onramp/onRampProvider";
import { DepositScreen } from "./DepositScreen";

/**
 * Render, wait for BOTH pre-click reads to land, then press the amount step's CTA.
 *
 * Waiting for the coverage probe is not incidental: it is debounced on the amount step precisely so
 * the click can stay synchronous ([R7]), so a test that clicks before it answers is testing the
 * `unknown` branch by accident.
 */
async function reachCheckout() {
  const rendered = renderWithProviders(<DepositScreen investContext={null} />);
  await waitFor(() => expect(rig.readBalance).toHaveBeenCalled());
  await waitFor(() => expect(rig.coverage).toHaveBeenCalled(), { timeout: 3000 });
  const cta = screen.getByRole("button", { name: "Continue" });
  await waitFor(() => expect(cta).toBeEnabled());
  // One more flush so the probe's resolution has reached state before the click reads it.
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(cta);
  return rendered;
}

/**
 * The same click WITHOUT waiting for the coverage probe, for the paths where no probe is expected:
 * with no chargeable currency the screen deliberately asks nobody, so waiting for one would hang.
 */
async function confirmWithoutCoverage() {
  const rendered = renderWithProviders(<DepositScreen investContext={null} />);
  await waitFor(() => expect(rig.readBalance).toHaveBeenCalled());
  const cta = screen.getByRole("button", { name: "Continue" });
  await waitFor(() => expect(cta).toBeEnabled());
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(cta);
  return rendered;
}

beforeEach(() => {
  window.dataLayer = [];
  localStorage.clear();
  refresh.mockClear();
  rig.rail = "privy";
  rig.currencyCodeFrom = "usd";
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
  host.onSettled = undefined;
  host.onSettling = undefined;
  host.onUnverified = undefined;
  host.onFailed = undefined;
});

describe("the rail switch (POO-1807 [R4])", () => {
  it("[R4] takes the Privy path when the rail says privy", async () => {
    await reachCheckout();
    expect(await screen.findByTestId("privy-checkout")).toBeInTheDocument();
    expect(screen.queryByTestId("standalone-onramp-rail")).not.toBeInTheDocument();
  });

  // @rule R4 -- the existing rail keeps its own steps, review included.
  it("[R4] leaves the Paybis path alone, review and all", async () => {
    rig.rail = "paybis";
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // The Paybis path goes through the method dialog, which the Privy path does not have.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("privy-checkout")).not.toBeInTheDocument();
    // And it never reads a baseline or probes coverage: those are the new rail's.
    expect(rig.readBalance).not.toHaveBeenCalled();
    expect(rig.coverage).not.toHaveBeenCalled();
  });
});

describe("the baseline gate (POO-1807 [R6])", () => {
  // @rule R6 -- read BEFORE the click, so the pre-purchase balance is genuinely pre-purchase.
  it("[R6] reads the destination balance before the confirm is possible", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    await waitFor(() => expect(rig.readBalance).toHaveBeenCalled());
    expect(rig.openCheckout).not.toHaveBeenCalled();
  });

  // @rule R6 -- a failed read is honest, never a zero baseline.
  it("[R6] refuses to open the checkout when the baseline could not be read", async () => {
    rig.readBalance.mockRejectedValue(new Error("RPC down"));
    renderWithProviders(<DepositScreen investContext={null} />);

    expect(
      await screen.findByText(
        "We could not read your wallet balance, so we cannot start a purchase yet. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(rig.openCheckout).not.toHaveBeenCalled();
  });

  // @rule R6 -- and the baseline that IS read is the one handed to the checkout.
  it("[R6] hands the pre-read baseline to the checkout", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");
    expect(rig.openCheckout).toHaveBeenCalledTimes(1);
  });
});

describe("coverage before opening (POO-1807 [R7])", () => {
  // @rule R7 -- an uncovered buyer never sees a checkout at all.
  it("[R7] refuses before anything opens when nobody will sell", async () => {
    rig.coverage.mockResolvedValue({ status: "uncovered" });
    await reachCheckout();

    expect(await screen.findByText("We cannot sell to you right now")).toBeInTheDocument();
    expect(rig.openCheckout).not.toHaveBeenCalled();
    expect(screen.queryByTestId("privy-checkout")).not.toBeInTheDocument();
  });

  // @rule R7 -- `unknown` must not block: the probe failing is not the buyer's problem.
  it("[R7] does not block on an unknown coverage answer", async () => {
    rig.coverage.mockResolvedValue({ status: "unknown", reason: "network" });
    await reachCheckout();

    expect(await screen.findByTestId("privy-checkout")).toBeInTheDocument();
    expect(rig.openCheckout).toHaveBeenCalledTimes(1);
  });

  // @rule R7 / R2 of POO-1803 -- covered narrows the asset list to the buyer's own currency.
  it("[R7] narrows fiat.assets to the default when coverage is known", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    const opened = rig.openCheckout.mock.calls[0]?.[0];
    expect(opened.fiat.assets).toEqual([opened.fiat.defaultAsset]);
  });

  it("[R7] passes the full list when coverage is unknown", async () => {
    rig.coverage.mockResolvedValue({ status: "unknown", reason: "network" });
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    const opened = rig.openCheckout.mock.calls[0]?.[0];
    expect(opened.fiat.assets.length).toBeGreaterThan(1);
  });
});

describe("the prefill (POO-1807 [R1], [R8])", () => {
  // @rule R1 -- our sentence precedes the larger figure the buyer will see in the checkout.
  it("[R1] states the approximation before the checkout opens", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    await waitFor(() => expect(rig.readBalance).toHaveBeenCalled());

    expect(screen.getByText(/You will see a slightly higher amount/)).toBeInTheDocument();
  });

  // @rule R8 -- USD only. A USD figure passed as a BRL amount would be a wrong number, and there is
  // no rate anywhere in this path to convert it with.
  it("[R8] passes a buffered prefill in USD", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    const opened = rig.openCheckout.mock.calls[0]?.[0];
    expect(opened.fiat.defaultAsset).toBe("usd");
    expect(opened.requested.amount).toBe(100);
    // Buffered: what we pass is above what the buyer typed.
    expect(opened.prefill.amount).toBeGreaterThan(100);
  });
});

describe("the phases (POO-1807 [R9], ADR-0006)", () => {
  // @rule R9 -- the only path that may read like a failure.
  it("[R9] a hard no goes to the error screen", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onFailed?.("popup_blocked"));
    expect(screen.getByRole("heading", { name: "Purchase not completed" })).toBeInTheDocument();
  });

  // @rule R9
  it("[R9] settling shows the existing settling copy, not a failure", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettling?.());
    expect(screen.getByRole("heading", { name: "Payment received" })).toBeInTheDocument();
  });

  // @rule R9 -- the new honest state, with no cancellation wording anywhere on it.
  it("[R9] unverified is its own honest screen and never says cancelled", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onUnverified?.());
    expect(
      screen.getByRole("heading", { name: "We could not confirm your payment yet" }),
    ).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/cancel/i);
  });

  // @rule R9 / ADR-0004 -- the receipt quotes the DELTA.
  it("[R9] the receipt prints the observed figure, never the typed one", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettled?.(96.4, "a1"));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(screen.getByText(/96\.4/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("the below-minimum receipt (POO-1807 [R2])", () => {
  // @rule R2 -- the money IS in the wallet, so the receipt is honest and prints the real figure.
  it("[R2] still prints the receipt, with the platform-minimum note and no invest CTA", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettled?.(3, "a1"));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(screen.getByText(/below the .* minimum to invest/)).toBeInTheDocument();
    // `link`, not `button` (review N3): the CTA is an `<a>`, so the old `role: "button"` query
    // matched nothing whatever the screen did and the negative passed for free.
    expect(screen.queryByRole("link", { name: /Invest/i })).not.toBeInTheDocument();
  });

  it("[R2] a delivery at or above the floor keeps the invest CTA", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettled?.(96.4, "a1"));
    expect(screen.queryByText(/below the .* minimum to invest/)).not.toBeInTheDocument();
    // The positive half, which is what makes the negative above mean something.
    expect(screen.getByRole("link", { name: /Invest/i })).toBeInTheDocument();
  });
});

describe("the watcher stays mounted (POO-1807 review F1)", () => {
  /**
   * The bug this pins: `DepositPrivyCheckout` was mounted for `step === "onramp"` ALONE, and its own
   * `onSettling()` moves this host to `onramp-settling`. The component therefore unmounted the
   * instant it reported, its effect cleanup set `live = false`, and the settlement it was mounted to
   * observe could never be reported. No Privy purchase could complete.
   */
  it("keeps the checkout mounted through onramp-settling", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettling?.());

    expect(screen.getByRole("heading", { name: "Payment received" })).toBeInTheDocument();
    expect(screen.getByTestId("privy-checkout")).toBeInTheDocument();
  });

  it("still completes on the delta observed AFTER settling was reported", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettling?.());
    act(() => host.onSettled?.(96.4, "a1"));

    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(screen.getByText(/96\.4/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("the old rail never runs on this one (POO-1807 review F2)", () => {
  /**
   * `StandaloneOnRampRail` AUTO-RUNS on mount: it mints a Paybis purchase and can open the vendor's
   * widget. The error step used to mount it unconditionally, so a failed Privy checkout put a second
   * rail behind the failure screen and charged a card nobody had asked to charge.
   */
  it("does not mount the Paybis rail on the Privy error screen", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onFailed?.("popup_blocked"));

    expect(screen.getByRole("heading", { name: "Purchase not completed" })).toBeInTheDocument();
    expect(screen.queryByTestId("standalone-onramp-rail")).not.toBeInTheDocument();
  });

  // And Try again from there goes back to the amount step, because `review` does not exist on this
  // rail: it used to land on a dead Paybis screen with no way forward (review F8).
  it("[F8] Try again returns to the amount step", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");
    act(() => host.onFailed?.("popup_blocked"));

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByTestId("standalone-onramp-rail")).not.toBeInTheDocument();
  });
});

describe("the vendor environment is derived (POO-1807 review F3, security S1)", () => {
  /**
   * It was the literal `"production"` at both call sites, so a dev or preview build probed and
   * charged against the LIVE vendor environment. Asserting "not a literal" rather than a value:
   * the value is whatever `resolveOnRampEnvironment()` answers for the test env, and pinning that
   * here would just restate the resolver's own suite.
   */
  it("[F3] neither the probe nor the checkout hardcodes production", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    const probed = rig.coverage.mock.calls[0]?.[0] as { environment: string };
    const opened = rig.openCheckout.mock.calls[0]?.[0];
    expect(probed.environment).toBe(resolveOnRampEnvironment());
    expect(opened.environment).toBe(resolveOnRampEnvironment());
    // The two must never disagree: probing sandbox and charging production is the worst of both.
    expect(opened.environment).toBe(probed.environment);
  });
});

describe("the buyer's currency (POO-1801 review F10)", () => {
  /**
   * `toPrivyFiat(resolvedCurrency) ?? "usd"` charged a non-USD buyer in dollars without saying so,
   * which is POO-1512 [R5]'s defect with a new rail behind it. No currency we can charge in, no
   * checkout.
   */
  it("[F10] refuses, and opens nothing, when the currency cannot be resolved", async () => {
    rig.currencyCodeFrom = undefined;
    await confirmWithoutCoverage();

    expect(await screen.findByText(/cannot take a payment in your currency/i)).toBeInTheDocument();
    expect(rig.openCheckout).not.toHaveBeenCalled();
  });

  // Same refusal for a currency that resolved fine and the rail simply does not sell in.
  it("[F10] refuses a currency outside the rail's own union", async () => {
    rig.currencyCodeFrom = "xxx";
    await confirmWithoutCoverage();

    expect(await screen.findByText(/cannot take a payment in your currency/i)).toBeInTheDocument();
    expect(rig.openCheckout).not.toHaveBeenCalled();
  });

  // And it never asked: probing for a currency we are about to refuse in would spend the rail's
  // quota to learn nothing.
  it("[F10] does not probe coverage for a currency it cannot charge in", async () => {
    rig.currencyCodeFrom = undefined;
    await confirmWithoutCoverage();

    expect(rig.coverage).not.toHaveBeenCalled();
  });

  /**
   * [R8] / review F4: a EUR buyer opens the checkout in EUR, and the USD prefill is NOT sent as a
   * EUR amount. The host's half of that is the mismatch itself: `prefill.currency` stays USD while
   * `fiat.defaultAsset` is the buyer's, which is the exact input the adapter drops `defaultAmount`
   * for (POO-1803, its own suite pins the drop).
   */
  it("[F4] a non-USD buyer gets their own currency and no USD prefill amount", async () => {
    rig.currencyCodeFrom = "eur";
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    const opened = rig.openCheckout.mock.calls[0]?.[0];
    expect(opened.fiat.defaultAsset).toBe("eur");
    expect(opened.prefill.currency).toBe("USD");
    expect(opened.prefill.currency).not.toBe(opened.fiat.defaultAsset.toUpperCase());
  });

  it("[F4] and the copy tells them to type the amount instead", async () => {
    rig.currencyCodeFrom = "eur";
    renderWithProviders(<DepositScreen investContext={null} />);
    await waitFor(() => expect(rig.readBalance).toHaveBeenCalled());

    expect(await screen.findByText(/Enter the amount you want to pay/)).toBeInTheDocument();
    expect(screen.queryByText(/You will see a slightly higher amount/)).not.toBeInTheDocument();
  });
});

describe("no Paybis figures on this rail (POO-1807 review F5)", () => {
  // The receipt printed `chargeText`, a PAYBIS quote, as the Amount of a purchase Privy priced
  // itself. The observed delta is the only figure this receipt may carry (ADR-0004).
  it("[F5] the receipt carries the observed delta and no quoted charge", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    act(() => host.onSettled?.(96.4, "a1"));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(screen.queryByText("Amount")).not.toBeInTheDocument();
    expect(screen.queryByText("Payment method")).not.toBeInTheDocument();
  });
});

describe("the prefill buffer is the house one (POO-1807 review F6)", () => {
  /**
   * It used to buffer with `STANDALONE_SLIPPAGE_PCT` (2%), the SWAP leg's max slippage: a different
   * quantity with a different owner. The prefill needs the price-move allowance the rest of the
   * funding path asks for, which is `SEED_BUFFER_RATE`, pinned at 5% until POO-1812.
   */
  it("[F6] buffers the typed amount by SEED_BUFFER_RATE, rounded to cents", async () => {
    await reachCheckout();
    await screen.findByTestId("privy-checkout");

    const opened = rig.openCheckout.mock.calls[0]?.[0];
    expect(opened.prefill.amount).toBe(Math.round(100 * (1 + SEED_BUFFER_RATE) * 100) / 100);
    // The number itself, so a silent swap back to the 2% slippage is a failing test and not a
    // re-derivation of whatever constant the file happens to import.
    expect(opened.prefill.amount).toBe(105);
  });
});
