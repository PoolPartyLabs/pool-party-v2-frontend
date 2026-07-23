/**
 * @id PP-AUTH-SCR-003 (POO-201)
 * @name WalletReadyScreen.test
 * Behavior: renders the reassurance copy; Continue routes to Home.
 * POO-201: gated to new Google users only; redirects everyone else to /.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { WalletReadyScreen } from "./WalletReadyScreen";

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/welcome",
}));

// Controllable useAuth mock.
const mockAuth = vi.hoisted(() => ({
  mode: "privy" as const,
  isAuthenticated: true,
  address: "0xabc" as `0x${string}`,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
  error: null,
  loginResult: { isNewUser: true, loginMethod: "google" } as {
    isNewUser: boolean;
    loginMethod: string | null;
  } | null,
  isLoggingIn: false,
}));

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/lib/services", () => ({
  isMockMode: false,
}));

describe("WalletReadyScreen", () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
    window.dataLayer = [];
    // Default: new Google user (valid state for this screen).
    mockAuth.loginResult = { isNewUser: true, loginMethod: "google" };
    mockAuth.isAuthenticated = true;
  });

  // [AC-1] Reached only when loginWithGoogle returns isNewWallet===true
  it("renders the wallet-ready confirmation for a new Google user", () => {
    renderWithProviders(<WalletReadyScreen />);
    expect(screen.getByRole("heading", { name: "Your wallet is ready" })).toBeInTheDocument();
    expect(screen.getByText("Secured by Privy")).toBeInTheDocument();
  });

  it("tracks auth_wallet_ready_viewed on mount", () => {
    renderWithProviders(<WalletReadyScreen />);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "auth_wallet_ready_viewed" }),
    );
  });

  // [AC-3] CTA routes to /; screen does no SDK calls
  it("continues to Home", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WalletReadyScreen />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(push).toHaveBeenCalledWith("/");
  });

  // [AC-2] Not reached by external-wallet connect
  it("redirects to / when loginResult is a wallet user", () => {
    mockAuth.loginResult = { isNewUser: false, loginMethod: "wallet" };
    renderWithProviders(<WalletReadyScreen />);

    expect(replace).toHaveBeenCalledWith("/");
  });

  // [AC-4] Returning Google user skips it and lands on /
  it("redirects to / when loginResult is a returning Google user", () => {
    mockAuth.loginResult = { isNewUser: false, loginMethod: "google" };
    renderWithProviders(<WalletReadyScreen />);

    expect(replace).toHaveBeenCalledWith("/");
  });

  // [AC-4] Direct navigation / page refresh (loginResult is null)
  it("redirects to / when loginResult is null (direct navigation or refresh)", () => {
    mockAuth.loginResult = null;
    renderWithProviders(<WalletReadyScreen />);

    expect(replace).toHaveBeenCalledWith("/");
  });
});
