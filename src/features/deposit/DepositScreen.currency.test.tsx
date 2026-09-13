/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow — the real supported-currency set (POO-1630)
 * @implements-rules-version v1 (POO-1630 rules v1)
 *
 * POO-1613 shipped the currency control display-only in real mode: `options` and `onSelect` were
 * passed ONLY behind `isMockMode`, so a real buyer read their resolved currency and could not change
 * it, and the interactive half was driven by a fixture. POO-1621 published the real set and POO-1618
 * gave `useBuyRouteQuote` a `currencyCodeFrom` PROPOSAL, so both halves now exist upstream and this
 * screen is the last one still reading the fixture. That is what this suite pins.
 *
 * Rules v1 are recorded on POO-1630 (R1-R7). The properties that matter here, and the failure
 * each prevents:
 *
 *   - **The options are the SERVER's.** A real-mode buyer must never be offered a fixture's currency
 *     list, because a currency Paybis cannot sell the pair in is an option that fails at checkout.
 *   - **What is DISPLAYED is the server's echo, never the buyer's request.** The proposal can be
 *     refused; printing the request beside figures denominated in the echo is the POO-1513 stale-figure
 *     class wearing a currency.
 *   - **No readable set means no control.** POO-494 [R1]: a Select offering what it cannot switch to
 *     lies. Absent options degrade to the display-only state POO-1613 already shipped.
 *   - **[R7] the ECHO reaches the MINT.** Pinned in `StandaloneOnRampRail.test.tsx`, because that is
 *     the boundary it died at: without it a buyer who moved to BRL for Pix was billed on a card in
 *     USD. Review found it; the divergence only became reachable when this issue added the control.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
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

const CARD = {
  paymentMethod: "poolparty-credit-card",
  displayName: "Credit Card",
  minUsd: 15,
  minCurrencyCode: "EUR",
  labels: ["instant"],
};

const methodsAction = vi.hoisted(() => vi.fn());
const currenciesAction = vi.hoisted(() => vi.fn());
const quoteAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: methodsAction,
  getOnRampSupportedCurrenciesAction: currenciesAction,
  getOnRampQuoteAction: quoteAction,
}));

vi.mock("@/lib/balances/balanceRefresh", () => ({ requestBalanceRefresh: vi.fn() }));

// Real mode mounts no `WagmiProvider`, and `useAuth` reaches `useAccount()` unconditionally, so the
// screen cannot render at all without this. Same stub as `DepositScreen.realOnRamp.test.tsx`.
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as `0x${string}`,
    isLoading: false,
  }),
}));

// Real mode mounts no WagmiProvider, so the pair read must not reach `useAccount()`. Funded, so the
// purchase is the ordinary USDC-direct one rather than the gas-first ETH leg (which quotes no charge).
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
  }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { DepositScreen } from "./DepositScreen";

/**
 * Render the amount step and wait for the LIVE list to land in it.
 *
 * Waiting on the list rather than on a timer matters: the currency control and the methods both
 * arrive from the same round trip, so asserting before it settles reads the pre-fetch state and
 * passes for the wrong reason.
 */
async function openAmountStep() {
  renderWithProviders(<DepositScreen investContext={null} />);
  await screen.findByText(/EUR/);
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  methodsAction.mockResolvedValue({ ok: true, methods: [CARD], currencyCodeFrom: "EUR" });
  currenciesAction.mockResolvedValue({ ok: true, currencies: ["BRL", "EUR", "GBP", "USD"] });
  quoteAction.mockResolvedValue({
    ok: true,
    quote: {
      quoteId: "q1",
      currencyCodeFrom: "EUR",
      paymentMethods: [
        {
          id: "poolparty-credit-card",
          chargeUsd: 262.4,
          chargeAmount: 240.1,
          chargeCurrencyCode: "EUR",
        },
      ],
      paymentMethodErrors: [],
    },
  });
});

describe("DepositScreen — supported currency set (POO-1630)", () => {
  it("[R1] offers the SERVER's currencies in real mode, not the mock fixture", async () => {
    await openAmountStep();

    // The fixture ships a set of its own; a real-mode buyer must never see it.
    const trigger = await screen.findByRole("button", { name: /EUR/ });
    fireEvent.click(trigger);

    const list = await screen.findByRole("listbox");
    const codes = within(list)
      .getAllByRole("option")
      .map((node) => node.textContent ?? "");
    expect(codes.some((text) => text.includes("GBP"))).toBe(true);
    expect(codes.some((text) => text.includes("BRL"))).toBe(true);
    expect(currenciesAction).toHaveBeenCalled();
  });

  it("[R2] re-lists the methods against the currency the buyer picks", async () => {
    await openAmountStep();

    fireEvent.click(await screen.findByRole("button", { name: /EUR/ }));
    const list = await screen.findByRole("listbox");
    fireEvent.click(within(list).getByRole("option", { name: /GBP/ }));
    await act(async () => {});

    // The PROPOSAL rides to the methods call: the set is a function of the currency, not a
    // relabelling of it (a BRL-only rail like Pix simply is not in the GBP list).
    //
    // Asserted on `proposedCurrencyCodeFrom`, which is the wire field's real name and carries the
    // whole point in it: what leaves here is a request, and `currencyCodeFrom` is reserved for the
    // answer that comes back.
    expect(methodsAction).toHaveBeenCalledWith(
      expect.objectContaining({ proposedCurrencyCodeFrom: "GBP" }),
    );
  });

  it("[R3] displays the currency the SERVER echoed, never the one the buyer asked for", async () => {
    await openAmountStep();

    // The server refuses the proposal and answers about EUR anyway.
    methodsAction.mockResolvedValue({ ok: true, methods: [CARD], currencyCodeFrom: "EUR" });
    fireEvent.click(await screen.findByRole("button", { name: /EUR/ }));
    const list = await screen.findByRole("listbox");
    fireEvent.click(within(list).getByRole("option", { name: /BRL/ }));
    await act(async () => {});

    // A refused proposal must not print one currency beside another's figures.
    expect(screen.getByRole("button", { name: /EUR/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^BRL/ })).not.toBeInTheDocument();
  });

  it("[R5] reports the change, because the pick is a money decision (premise 11)", async () => {
    window.dataLayer = [];
    await openAmountStep();

    fireEvent.click(await screen.findByRole("button", { name: /EUR/ }));
    const list = await screen.findByRole("listbox");
    fireEvent.click(within(list).getByRole("option", { name: /GBP/ }));
    await act(async () => {});

    // On the PICK, not the echo: a proposal the server refuses is still a decision the buyer made,
    // and one that gets refused a lot is exactly what this event exists to surface.
    const events = (window.dataLayer ?? []) as Array<Record<string, unknown>>;
    const changed = events.filter((e) => e.event === "funding_method_currency_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ funding_method_currency: "GBP" });
  });

  it("[R4] stays display-only when the set cannot be read (POO-494: no phantom options)", async () => {
    currenciesAction.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "no pair" });
    await openAmountStep();

    // The resolved currency is still NAMED, because that half never depended on the set.
    expect(await screen.findByText(/EUR/)).toBeInTheDocument();
    // But there is nothing to open, so no trigger exists at all.
    expect(screen.queryByRole("button", { name: /EUR/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
