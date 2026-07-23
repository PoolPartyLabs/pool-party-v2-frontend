/**
 * @id PP-PROF-SCR-004
 * @name Security & login — tests
 * Behavior: only Export key / Delete are actionable; the rest are "Coming soon"; account deletion
 * is gated behind withdrawing funds first.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../../../tests/utils/renderWithProviders";
import { SecurityScreen } from "./SecurityScreen";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/profile/security",
  useRouter: () => ({ push }),
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

// Export private key is gated on the wallet kind (POO-344). Default embedded → export visible
// (mock + the Google persona); an external wallet hides it.
const { getWalletKind } = vi.hoisted(() => ({
  getWalletKind: vi.fn(async (): Promise<"embedded" | "external"> => "embedded"),
}));
vi.mock("@/lib/account/useAccountService", () => ({
  useAccountService: () => ({ getWalletKind, getUsdcBalance: vi.fn() }),
}));

// Keep the export dialog on its mock branch so the screen test never loads the real Privy SDK. The
// full hold-to-reveal + real-export behavior is covered in ExportKeyDialog.test.tsx.
vi.mock("@/lib/account/useExportPrivateKey", () => ({
  useExportPrivateKey: () => ({ isMock: true, revealMockKey: () => `0xMOCK${"0".repeat(60)}` }),
}));

describe("SecurityScreen", () => {
  afterEach(() => {
    getWalletKind.mockResolvedValue("embedded");
  });

  it("hides Export private key for an external wallet (embedded shows it) — POO-344", async () => {
    getWalletKind.mockResolvedValue("external");
    renderWithProviders(<SecurityScreen />);
    // Once the wallet kind resolves to external, the export affordance must disappear.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Export private key" })).toBeNull();
    });
  });

  it("marks non-functional rows as coming soon and keeps export key actionable", () => {
    renderWithProviders(<SecurityScreen />);
    expect(
      screen.getByText("Never share your private key. Anyone with it controls your funds."),
    ).toBeInTheDocument();
    // v1: the seven non-functional rows are "Coming soon", not live controls.
    expect(screen.getAllByText("Coming soon").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("switch")).toBeNull();
    // Export private key stays one of the three functional rows.
    fireEvent.click(screen.getByRole("button", { name: "Export private key" }));
  });

  it("gates account deletion behind withdrawing funds first", () => {
    renderWithProviders(<SecurityScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Withdraw your funds first")).toBeInTheDocument();
    // The destructive delete confirm is not offered while funds remain.
    expect(within(dialog).queryByText("Delete account?")).toBeNull();
    // Acknowledging routes to the portfolio to withdraw first.
    fireEvent.click(within(dialog).getByRole("button", { name: "View portfolio" }));
    expect(push).toHaveBeenCalledWith("/portfolio");
  });

  it("opens the hold-to-reveal export gate from the export row", () => {
    renderWithProviders(<SecurityScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Export private key" }));
    const dialog = screen.getByRole("dialog");
    // The gate: a risk warning plus a deliberate hold-to-reveal control. No key is shown yet — the
    // reveal itself (mock) and the real Privy export are covered in ExportKeyDialog.test.tsx.
    expect(within(dialog).getByText("Reveal private key?")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Hold to reveal" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/0xMOCK/)).toBeNull();
  });
});
