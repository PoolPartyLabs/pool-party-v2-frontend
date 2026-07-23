/**
 * @id PP-AUTH-SCR-001
 * @name SignInScreen.test
 * Behavior: renders the two methods; Google routes to Wallet ready (new wallet) or Home
 * (returning); Connect a wallet opens the connector picker.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { SignInScreen } from "./SignInScreen";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
const { loginWithGoogle } = vi.hoisted(() => ({
  loginWithGoogle: vi.fn(async () => ({
    userId: "u",
    method: "google" as const,
    address: "0x0",
    isNewWallet: true,
  })),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/sign-in",
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

vi.mock("@/lib/services", () => ({
  isMockMode: true,
  authService: { loginWithGoogle, connectWallet: vi.fn(), logout: vi.fn() },
}));

// useAuth imports these at module level; stub them so the import resolves.
vi.mock("@privy-io/react-auth", () => ({
  useLogin: () => ({ login: vi.fn() }),
  useLogout: () => ({ logout: vi.fn() }),
  usePrivy: () => ({ authenticated: false, ready: true }),
  useWallets: () => ({ wallets: [], ready: true }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
}));

describe("SignInScreen", () => {
  beforeEach(() => {
    push.mockClear();
    loginWithGoogle.mockClear();
    window.dataLayer = [];
  });

  it("renders both auth methods", () => {
    renderWithProviders(<SignInScreen />);
    expect(screen.getByRole("heading", { name: "Welcome to Pool Party" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect a wallet/i })).toBeInTheDocument();
  });

  it("signs in with Google and routes through Wallet ready", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInScreen />);

    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    expect(loginWithGoogle).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/welcome"));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "auth_signin_started" }),
    );
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "auth_signin_completed" }),
    );
  });

  it("sends a returning Google user (existing wallet) straight to Home", async () => {
    loginWithGoogle.mockResolvedValueOnce({
      userId: "u",
      method: "google" as const,
      address: "0x0",
      isNewWallet: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<SignInScreen />);

    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("opens the Terms and Privacy links in a new tab with a safe rel", () => {
    renderWithProviders(<SignInScreen />);
    for (const name of [/terms/i, /privacy/i]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("opens the connector picker for Connect a wallet", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInScreen />);

    await user.click(screen.getByRole("button", { name: /connect a wallet/i }));

    expect(push).toHaveBeenCalledWith("/connect");
  });

  it("surfaces an error when Google sign-in fails", async () => {
    loginWithGoogle.mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderWithProviders(<SignInScreen />);

    await user.click(screen.getByRole("button", { name: /continue with google/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(push).not.toHaveBeenCalled();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "auth_signin_failed" }),
    );
    errorSpy.mockRestore();
  });
});
