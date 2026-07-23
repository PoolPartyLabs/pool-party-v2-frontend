/**
 * @id PP-CORE-MOD-005
 * @name WalletModal.test
 * @implements-rules-version v1
 * Unit tests for the wallet modal: account + masked address, balances (amount + USD), action
 * routing, the Swap/Send coming-soon placeholder, all-network token list, copy, footer, empty state.
 */
import { describe, expect, it, vi } from "vitest";
import type { TokenBalance } from "@/lib/balances";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { WalletModal, type WalletModalProps } from "./WalletModal";

const balances: TokenBalance[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    amount: 1200,
    decimals: 6,
    usd: 1200,
    chainId: 8453,
    logoUrl: "u",
  },
  {
    symbol: "WETH",
    name: "Ethereum",
    amount: 0.018,
    decimals: 18,
    usd: 44.5,
    chainId: 42161,
    logoUrl: "w",
  },
];

function setup(overrides: Partial<WalletModalProps> = {}) {
  const props: WalletModalProps = {
    open: true,
    onOpenChange: vi.fn(),
    address: "0x1A2b3C4d5E6f7890a1B2c3D4e5F6789012345678",
    walletKind: "embedded",
    balances,
    totalUsd: 1284.5,
    dayChangeUsd: 58.4,
    dayChangePct: 0.047,
    isLoading: false,
    isRefreshing: false,
    onRefresh: vi.fn(),
    onBuy: vi.fn(),
    onReceive: vi.fn(),
    onManage: vi.fn(),
    onDisconnect: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<WalletModal {...props} />);
  return props;
}

describe("WalletModal", () => {
  it("shows the account, masked address, kind and total balance", () => {
    setup();
    expect(screen.getByText("Wallet")).toBeInTheDocument();
    expect(screen.getByText("0x1A2b…5678")).toBeInTheDocument();
    expect(screen.getByText("Embedded")).toBeInTheDocument();
    expect(screen.getByText("$1,284.50")).toBeInTheDocument();
  });

  it("lists each token with its amount AND its USD value", () => {
    setup();
    expect(screen.getByText("1,200 USDC")).toBeInTheDocument();
    expect(screen.getByText("$1,200.00")).toBeInTheDocument();
    expect(screen.getByText("0.018 WETH")).toBeInTheDocument();
    expect(screen.getByText("$44.50")).toBeInTheDocument();
  });

  it("routes Buy and Receive to their handlers", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(props.onBuy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Receive" }));
    expect(props.onReceive).toHaveBeenCalledTimes(1);
  });

  // POO-285 R2: Swap is inert with a hover/focus tooltip — it must NOT open a sub-view.
  it("renders Swap disabled with a coming-soon tooltip", async () => {
    const user = userEvent.setup();
    setup();
    const swap = screen.getByRole("button", { name: /Swap/ });
    expect(swap).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Coming soon");
    await user.click(swap);
    // Still on the default wallet view (no "Got it" back button of the placeholder).
    expect(screen.queryByRole("button", { name: "Got it" })).not.toBeInTheDocument();
    expect(screen.getByText("TOTAL BALANCE")).toBeInTheDocument();
  });

  it("lists holdings across every network with no network switcher (POO-239)", () => {
    setup();
    // The chain-agnostic wallet shows all networks' holdings together...
    expect(screen.getByText("1,200 USDC")).toBeInTheDocument();
    expect(screen.getByText("0.018 WETH")).toBeInTheDocument();
    // ...and there is no per-network filter to switch between them.
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arbitrum" })).not.toBeInTheDocument();
  });

  it("copies the full address and confirms inline", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    // Define after userEvent.setup() so this mock wins over user-event's own clipboard stub.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(props.address);
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("disconnects and manages from the footer", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(props.onDisconnect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Manage wallet" }));
    expect(props.onManage).toHaveBeenCalledTimes(1);
  });

  // POO-480: a zero-balance wallet still shows the actions row AND the Manage/Disconnect footer; the
  // "No assets yet" note only replaces the token list (regression guard).
  it("keeps the actions row and the Manage/Disconnect footer at a zero balance", async () => {
    const user = userEvent.setup();
    const props = setup({ balances: [], totalUsd: 0 });
    // The empty note replaces the token list...
    expect(screen.getByText("No assets yet")).toBeInTheDocument();
    expect(screen.getByText("Add funds to get started")).toBeInTheDocument();
    // ...but the quick actions stay.
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Swap/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receive" })).toBeInTheDocument();
    // ...and so do Manage wallet (embedded) + Disconnect.
    expect(screen.getByRole("button", { name: "Manage wallet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    // Buy routes through the actions row, and the old empty-card "Buy crypto" CTA is gone.
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(props.onBuy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Buy crypto" })).toBeNull();
  });

  it("renders loading skeletons while balances load", () => {
    setup({ isLoading: true, balances: [] });
    expect(screen.getByText("Wallet")).toBeInTheDocument();
    expect(screen.queryByText("No assets yet")).not.toBeInTheDocument();
  });

  // POO-808 R1: a manual refresh control sits next to the total and calls onRefresh.
  it("shows a refresh control next to the total that calls onRefresh", async () => {
    const user = userEvent.setup();
    const props = setup();
    const refresh = screen.getByRole("button", { name: "Refresh balance" });
    expect(refresh).toBeInTheDocument();
    await user.click(refresh);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  // POO-808 R2: while refreshing the total stays visible (no skeleton) and the control is busy/disabled.
  it("keeps the total visible and marks the refresh control busy while refreshing", () => {
    setup({ isRefreshing: true });
    expect(screen.getByText("$1,284.50")).toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: "Refresh balance" });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
  });

  // The control is optional: callers that don't pass onRefresh render no button.
  it("renders no refresh control when onRefresh is not provided", () => {
    setup({ onRefresh: undefined });
    expect(screen.queryByRole("button", { name: "Refresh balance" })).toBeNull();
  });

  // POO-814 R1/R2/R3: USDC group first → soft divider → other tokens; rows < $1 hidden.
  it("shows USDC first, then a divider, then the other tokens, and hides sub-$1 dust", () => {
    const bal = (over: Partial<TokenBalance> & { symbol: string; usd: number }): TokenBalance => ({
      name: over.symbol,
      amount: over.usd,
      decimals: 18,
      chainId: 8453,
      logoUrl: "l",
      ...over,
    });
    setup({
      balances: [
        bal({ symbol: "WETH", usd: 50, chainId: 42161 }),
        bal({ symbol: "USDC", usd: 100, chainId: 8453, decimals: 6 }),
        bal({ symbol: "PEPE", usd: 0.4, chainId: 8453 }), // dust → hidden
        bal({ symbol: "DAI", usd: 30, chainId: 137 }),
      ],
      totalUsd: 180.4,
    });
    const usdc = screen.getByText("USDC");
    const divider = screen.getByTestId("wallet-group-divider");
    const weth = screen.getByText("WETH");
    // USDC (top group) precedes the divider; WETH (other group) follows it.
    expect(usdc.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(weth) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The < $1 dust row is hidden.
    expect(screen.queryByText("PEPE")).toBeNull();
  });

  // POO-814 R5: each row shows the token logo AND its network logo.
  it("renders the token logo and the network logo for a holding", () => {
    setup({
      balances: [
        {
          symbol: "USDC",
          name: "USD Coin",
          amount: 100,
          decimals: 6,
          usd: 100,
          chainId: 8453,
          logoUrl: "cdn",
        },
      ],
      totalUsd: 100,
    });
    // Committed token art (resolveTokenLogo) + the Base network logo (NetworkLogo).
    expect(document.querySelector('img[src="/tokens/usdc.png"]')).toBeInTheDocument();
    expect(document.querySelector('img[src="/networks/base.png"]')).toBeInTheDocument();
  });

  // No divider when there is nothing below it (a USDC-only wallet).
  it("shows no divider when there are no non-USDC holdings", () => {
    setup({
      balances: [
        {
          symbol: "USDC",
          name: "USD Coin",
          amount: 100,
          decimals: 6,
          usd: 100,
          chainId: 8453,
          logoUrl: "cdn",
        },
      ],
      totalUsd: 100,
    });
    expect(screen.queryByTestId("wallet-group-divider")).toBeNull();
  });

  it("labels an external wallet and hides Manage wallet", () => {
    // An external wallet is managed in the user's own wallet app, so the footer omits "Manage
    // wallet" — only social (embedded) wallets show it (murilo 2026-06-29).
    setup({ walletKind: "external" });
    expect(screen.getByText("External")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage wallet" })).toBeNull();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });
});
