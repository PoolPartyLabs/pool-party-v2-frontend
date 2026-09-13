/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow — the printed charge belongs to the pair that gets minted (POO-1513 / POO-1573)
 * @implements-rules-version v6 (POO-1513 rules v1)
 *
 * The cross-lane defect this suite exists for, and why every other `/deposit` suite is blind to it:
 * `DepositScreen.methods.test.tsx` mocks `./components/StandaloneOnRampRail` wholesale, so NOTHING in
 * this feature ever compared the figure the review screen PRINTS against the order the rail actually
 * MINTS. Here the rail is real: only its own dependencies (`useProvisioningRail`, the widget frame,
 * the balance read) are stubbed, exactly as `StandaloneOnRampRail.test.tsx` stubs them, so the pair the
 * purchase is minted on is an observed fact of the test rather than an assumption.
 *
 * ## The defect
 *
 * A buyer holding under `PAYBIS_GAS_FLOOR_ETH` on Base is sized ETH-FIRST ([R1] standalone: the order
 * is `ETH-BASE`, and since POO-1573 it is quoted received-fixed against `gasFloorEth + fundingUsd /
 * ethUsd`). The screen was quoting `USDC-BASE` received-fixed at the entered amount for EVERY buyer, so
 * it printed "you pay X" for a pair the buyer will not be billed on, structurally BELOW the real charge
 * by `gasFloorEth * ethUsd` (~$2.50 on a $100 deposit at $2,500/ETH — the same order of magnitude as
 * the 2.78% card-fee defect POO-1513 was opened to kill). The method list had the same seam: it was
 * resolved for `USDC-BASE` while `resolveWidgetPrefill` resolves the mint's list for the ORDER's pair.
 *
 * ## What is asserted
 *
 * Both halves of the pair, together, because either alone can pass for the wrong reason: what the
 * screen printed, AND what `mintOnRampRequest` was handed. A gas-first wallet prints no charge (the
 * shipped "Shown at checkout" caption) and spends no quote POST at all; a gas-having wallet prints the
 * quote's charge exactly as before. The degraded balance read biases to gas-first, which is the SAFE
 * direction here: suppressing a figure is never worse than asserting a wrong one.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTE_DEBOUNCE_MS } from "@/features/strategies/hooks/useBuyRouteQuote";
import type { TokenBalance } from "@/lib/balances/types";
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import type { ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";
import {
  act,
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

const WALLET = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const BASE_CHAIN_ID = 8453;

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: WALLET as `0x${string}`, isLoading: false }),
}));

const actions = vi.hoisted(() => ({ getMethods: vi.fn(), getQuote: vi.fn() }));
vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: actions.getMethods,
  getOnRampQuoteAction: actions.getQuote,
}));

/** The wallet the screen AND the rail both read. One source, set per test. */
const wallet = vi.hoisted(() => ({ balances: [] as unknown[] }));
vi.mock("@/lib/balances/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: wallet.balances,
    totalUsd: 0,
    dayChangeUsd: 0,
    dayChangePct: 0,
    isLoading: false,
    isRefreshing: false,
    refresh: vi.fn(),
  }),
}));

/**
 * The rail's own dependencies, stubbed the way `StandaloneOnRampRail.test.tsx` stubs them, so the REAL
 * rail runs: its plan sizing (`buildStandaloneOnRampPlan` -> `sizeOnRampOrder`) is what decides the
 * pair, and the mint is where that pair becomes observable.
 */
const rail = vi.hoisted(() => ({
  mint: vi.fn(async (_order: unknown, _options?: unknown) => ({
    requestId: "req-1",
    wallet: "0xabc",
  })),
  swap: vi.fn(async () => ({ txHash: "0xswap" })),
}));
vi.mock("@/features/strategies/hooks/useProvisioningRail", () => ({
  useProvisioningRail: () => ({
    buildSteps: (
      plan: ProvisioningPlan,
      reporters: { runOnRampBuy: (request: unknown) => Promise<void> },
    ) =>
      plan.steps
        .filter((step: ProvisioningStep) => step.type !== "op")
        .map((step: ProvisioningStep) => ({
          key: step.key,
          run: async () => {
            if (step.type === "buy") {
              await reporters.runOnRampBuy({
                order: step.order,
                expectedToken: step.toToken === "ETH" ? "ETH-BASE" : "USDC-BASE",
              });
              return {};
            }
            return rail.swap();
          },
        })),
    mintOnRampRequest: rail.mint,
    openJournal: vi.fn(),
    adoptJournal: vi.fn(),
    closeJournal: vi.fn(),
  }),
}));

vi.mock("@/features/strategies/components/provisioning/PaybisWidgetFrame", () => ({
  PaybisWidgetFrame: () => <div data-testid="paybis-widget">widget</div>,
  PaybisWidgetFrameView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

/** A Base-native ETH holding, the only balance row `readBaseNativeEth` looks at. */
function baseEth(amount: number, usd: number): TokenBalance {
  return {
    symbol: "ETH",
    name: "Ethereum",
    amount,
    amountExact: String(amount),
    decimals: 18,
    usd,
    chainId: BASE_CHAIN_ID,
    logoUrl: "",
    isNative: true,
    address: "0x0000000000000000000000000000000000000000",
  } as TokenBalance;
}

/** Under `PAYBIS_GAS_FLOOR_ETH` (0.001): [R1] sizes the purchase ETH-first. */
const GAS_FIRST_WALLET = [baseEth(0.0001, 0.25)];
/** Well over the floor: the purchase is a direct USDC-BASE buy, the pair the screen prices. */
const GAS_HAVING_WALLET = [baseEth(1, 2500)];

beforeEach(() => {
  window.dataLayer = [];
  localStorage.clear();
  rail.mint.mockClear();
  actions.getMethods.mockReset();
  actions.getQuote.mockReset();
  actions.getMethods.mockResolvedValue({
    ok: true as const,
    currencyCodeFrom: "EUR",
    methods: [CARD, SEPA],
  });
  // POO-1599: pinned, the quote answers for that one method; UNPINNED (the listing quote, which is
  // what this screen sends until the buyer chooses) it answers for every method on the pair.
  actions.getQuote.mockImplementation(async ({ paymentMethod }: { paymentMethod?: string }) => ({
    ok: true as const,
    quote: {
      quoteId: "quote_1",
      currencyCodeFrom: "EUR",
      currencyCodeTo: "USDC-BASE",
      requestedAmountType: "destination",
      paymentMethods: (paymentMethod === undefined
        ? [CARD.paymentMethod, SEPA.paymentMethod]
        : [paymentMethod]
      ).map((id) => ({
        id,
        name: id,
        chargeUsd: 103.4,
        chargeAmount: "103.40",
        chargeCurrencyCode: "EUR",
        receiveAmount: "100",
        receiveCurrencyCode: "USDC-BASE",
      })),
    },
  }));
});

/** Amount -> picker -> review, with the live list landed in the picker first. */
async function reachReview() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("radio", { name: /Credit Card/ });
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
}

/**
 * Give the quote pipeline its FULL chance before any "no charge" assertion.
 *
 * The methods call has to resolve, the quote effect has to re-run on that list, and the debounce
 * window has to elapse. Without this wait every negative below passes on timing alone: "Shown at
 * checkout" is on screen from the first render of the review step, so a `findByText` for it resolves
 * instantly and measures nothing at all (the first draft of this suite did exactly that and was green
 * against the defect).
 */
async function settleQuoteWindow() {
  await waitFor(() => expect(actions.getMethods).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, QUOTE_DEBOUNCE_MS * 2));
  });
}

/** The `currencyCode` of the order the rail actually minted (the fact the printed figure must match). */
async function mintedPair(): Promise<string> {
  fireEvent.click(screen.getByRole("button", { name: /Confirm & pay/ }));
  await waitFor(() => expect(rail.mint).toHaveBeenCalledTimes(1));
  return (rail.mint.mock.calls[0]?.[0] as { currencyCode: string }).currencyCode;
}

describe("DepositScreen prints a charge only for the pair it is minted on (POO-1513 X1)", () => {
  /**
   * The gas-first buyer, who is the ordinary `/deposit` buyer: someone reaching a fiat on-ramp holds
   * no crypto, so they are under the floor. The purchase is minted on `ETH-BASE` against an ETH target
   * only the mint can resolve, so this screen has no substantiable figure and must not invent one.
   */
  it("prints no charge when the purchase will be minted on the ETH pair", async () => {
    wallet.balances = GAS_FIRST_WALLET;
    renderWithProviders(<DepositScreen investContext={null} />);
    await reachReview();
    await settleQuoteWindow();

    expect(screen.getByText("Shown at checkout")).toBeInTheDocument();
    expect(screen.queryByText("€103.40")).toBeNull();
    // Not merely hidden: no quote was ever requested for a pair whose target we cannot express.
    expect(actions.getQuote).not.toHaveBeenCalled();
    // ...and the suppression is right BECAUSE this is what gets minted.
    expect(await mintedPair()).toBe("ETH-BASE");
  });

  /** The control. A wallet that already has gas is bought USDC-direct, the pair the quote prices. */
  it("prints the quote's charge when the purchase will be minted on the USDC pair", async () => {
    wallet.balances = GAS_HAVING_WALLET;
    renderWithProviders(<DepositScreen investContext={null} />);
    await reachReview();

    expect(await screen.findByText("€103.40")).toBeInTheDocument();
    expect(screen.queryByText("Shown at checkout")).toBeNull();
    expect(await mintedPair()).toBe("USDC-BASE");
  });

  /**
   * `useTokenBalances` resolves `isLoading=false` with `balances=[]` when the first read fails, which
   * is indistinguishable from an empty wallet and therefore reads as gas-first. That bias is deliberate
   * upstream (`StandaloneOnRampRail`'s header) and it is the safe direction here too: the screen
   * withholds a figure rather than asserting one it cannot substantiate.
   */
  it("withholds the figure on a degraded balance read", async () => {
    wallet.balances = [];
    renderWithProviders(<DepositScreen investContext={null} />);
    await reachReview();
    await settleQuoteWindow();

    expect(screen.getByText("Shown at checkout")).toBeInTheDocument();
    expect(actions.getQuote).not.toHaveBeenCalled();
    expect(await mintedPair()).toBe("ETH-BASE");
  });
});

describe("DepositScreen lists the methods of the pair it is minted on (POO-1513 X2)", () => {
  /**
   * `resolveWidgetPrefill` resolves the mint's list with `currencyCodeTo: order.currencyCode`. A picker
   * resolved for a DIFFERENT pair offers methods the mint may not find, and a method the mint cannot
   * find falls back to a card — the silent substitution POO-1578 [R3] exists to stop, re-created one
   * layer up.
   */
  it("resolves the list for the ETH pair when the purchase is gas-first", async () => {
    wallet.balances = GAS_FIRST_WALLET;
    renderWithProviders(<DepositScreen investContext={null} />);
    await reachReview();

    await waitFor(() =>
      expect(actions.getMethods).toHaveBeenCalledWith({ currencyCodeTo: "ETH-BASE" }),
    );
    expect(actions.getMethods).not.toHaveBeenCalledWith({ currencyCodeTo: "USDC-BASE" });
    // The list is still real and still reaches the mint: the choice is not degraded away.
    expect(screen.getByText("Paying with Credit Card")).toBeInTheDocument();
  });

  it("resolves the list for the USDC pair when the wallet already has gas", async () => {
    wallet.balances = GAS_HAVING_WALLET;
    renderWithProviders(<DepositScreen investContext={null} />);
    await reachReview();

    await waitFor(() =>
      expect(actions.getMethods).toHaveBeenCalledWith({ currencyCodeTo: "USDC-BASE" }),
    );
    expect(actions.getMethods).not.toHaveBeenCalledWith({ currencyCodeTo: "ETH-BASE" });
  });

  /** The buyer's own choice still reaches the mint on the gas-first pair, unpriced but not discarded. */
  it("threads the chosen method to the mint on the gas-first pair", async () => {
    wallet.balances = GAS_FIRST_WALLET;
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("radio", { name: /SEPA Transfer/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: /SEPA Transfer/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(await mintedPair()).toBe("ETH-BASE");
    // POO-1630: the review's currency rides with the method now. On the GAS-FIRST pair especially:
    // this is the leg where a European buyer was previously billed in dollars, because the mint
    // re-resolved a currency the screen had already settled.
    //
    // POO-1642: and the in-flight question rides with both. Asserted here rather than left out of an
    // exact `toEqual`, because this is the ONE suite that drives the real rail from the real screen:
    // it is the only place the whole thread (screen -> prop -> ref -> mint options) is exercised end
    // to end, so a regression that drops the question would show up here first.
    expect(rail.mint.mock.calls[0]?.[1]).toEqual({
      paymentMethod: "poolparty-sepa",
      currencyCodeFrom: "EUR",
      confirmResume: expect.any(Function),
    });
  });
});
