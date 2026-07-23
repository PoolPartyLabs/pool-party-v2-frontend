/**
 * @id PP-CORE-CMP-025
 * @name WalletMenu.test
 * @implements-rules-version v1
 * Unit tests for the header wallet entry: the connect fallback when disconnected, and the
 * connected chip that opens the modal. Auth, balances, account and navigation are mocked.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { WalletMenu } from "./WalletMenu";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  signOut: vi.fn(async () => {}),
  auth: {
    isAuthenticated: false,
    address: undefined as string | undefined,
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

vi.mock("@/lib/services", () => ({ isMockMode: true }));
vi.mock("@/features/auth/siweActions", () => ({ signOutAction: mocks.signOut }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/account/useAccountService", () => ({
  useAccountService: () => ({
    getWalletKind: async () => "embedded" as const,
    getUsdcBalance: async () => 50,
  }),
}));
// Keep the real module (groupWalletBalances etc. are used by WalletModal) and override only the hook.
vi.mock("@/lib/balances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/balances")>()),
  useTokenBalances: () => ({
    balances: [
      {
        symbol: "USDC",
        name: "USD Coin",
        amount: 1200,
        decimals: 6,
        usd: 1200,
        chainId: 8453,
        logoUrl: "u",
      },
    ],
    totalUsd: 1284.5,
    dayChangeUsd: 58.4,
    dayChangePct: 0.047,
    isLoading: false,
    isRefreshing: false,
    refresh: vi.fn(),
  }),
}));

describe("WalletMenu", () => {
  it("shows the connect button when disconnected and routes to sign-in in mock mode", async () => {
    mocks.auth.isAuthenticated = false;
    mocks.auth.address = undefined;
    const user = userEvent.setup();
    renderWithProviders(<WalletMenu />);
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(mocks.push).toHaveBeenCalledWith("/sign-in");
  });

  it("shows the connected chip and opens the modal on click", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.auth.address = "0x1A2b3C4d5E6f7890a1B2c3D4e5F6789012345678";
    const user = userEvent.setup();
    renderWithProviders(<WalletMenu />);
    const chip = screen.getByRole("button", { name: "Open wallet" });
    expect(chip).toHaveTextContent("0x1A2b…5678");
    expect(chip).toHaveTextContent("$1,284.50");
    await user.click(chip);
    expect(screen.getByText("Wallet")).toBeInTheDocument();
  });

  // @rule POO-890 R1 - every logout entry point clears the SIWE session before navigation.
  it("[POO-890 R1] disconnect clears the SIWE session before the wallet logout", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.auth.address = "0x1A2b3C4d5E6f7890a1B2c3D4e5F6789012345678";
    mocks.signOut.mockClear();
    mocks.auth.logout.mockClear();
    const user = userEvent.setup();
    renderWithProviders(<WalletMenu />);
    await user.click(screen.getByRole("button", { name: "Open wallet" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(mocks.auth.logout).toHaveBeenCalledTimes(1));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    // The cookie clear lands before the Privy logout that triggers the redirect (R1).
    expect(Number(mocks.signOut.mock.invocationCallOrder[0])).toBeLessThan(
      Number(mocks.auth.logout.mock.invocationCallOrder[0]),
    );
  });

  it("navigates to deposit when Buy is used from the modal", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.auth.address = "0x1A2b3C4d5E6f7890a1B2c3D4e5F6789012345678";
    mocks.push.mockClear();
    const user = userEvent.setup();
    renderWithProviders(<WalletMenu />);
    await user.click(screen.getByRole("button", { name: "Open wallet" }));
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(mocks.push).toHaveBeenCalledWith("/deposit");
  });
});
