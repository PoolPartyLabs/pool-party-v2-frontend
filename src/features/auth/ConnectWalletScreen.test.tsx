/**
 * @id PP-AUTH-SCR-004
 * @name ConnectWalletScreen.test
 * Behavior: lists the connectors; selecting one connects then routes to Home.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { ConnectWalletScreen } from "./ConnectWalletScreen";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
const { connectWallet } = vi.hoisted(() => ({
  connectWallet: vi.fn(async () => ({
    userId: "mock-metamask",
    method: "wallet" as const,
    address: "0x0",
    isNewWallet: false,
  })),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/connect",
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
  authService: { loginWithGoogle: vi.fn(), connectWallet, logout: vi.fn() },
}));

describe("ConnectWalletScreen", () => {
  beforeEach(() => {
    push.mockClear();
    connectWallet.mockClear();
    window.dataLayer = [];
  });

  it("lists the wallet connectors", () => {
    renderWithProviders(<ConnectWalletScreen />);
    expect(screen.getByRole("button", { name: /metamask/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /walletconnect/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /coinbase wallet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /phantom/i })).toBeInTheDocument();
  });

  it("connects the chosen wallet and routes to Home", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConnectWalletScreen />);

    await user.click(screen.getByRole("button", { name: /metamask/i }));

    expect(connectWallet).toHaveBeenCalledWith("metamask");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "wallet_connect_started" }),
    );
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "wallet_connect_completed" }),
    );
  });

  it("surfaces an error when the connection fails", async () => {
    connectWallet.mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderWithProviders(<ConnectWalletScreen />);

    await user.click(screen.getByRole("button", { name: /metamask/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(push).not.toHaveBeenCalled();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "wallet_connect_failed" }),
    );
    errorSpy.mockRestore();
  });
});
