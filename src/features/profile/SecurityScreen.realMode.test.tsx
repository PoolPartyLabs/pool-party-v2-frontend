/**
 * @id PP-PROF-SCR-004
 * @name Security & login — real-mode tests (POO-544 R2 no-flash)
 *
 * In real mode the export row must stay hidden on first paint until getWalletKind resolves, so an
 * external-wallet user never sees the export affordance flash before the async wallet kind lands.
 * Forces isMockMode=false (the mock-mode behavior is covered in SecurityScreen.test.tsx).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../../tests/utils/renderWithProviders";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/profile/security",
  useRouter: () => ({ push: vi.fn() }),
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

vi.mock("@/lib/services", () => ({ isMockMode: false }));

const { getWalletKind } = vi.hoisted(() => ({
  getWalletKind: vi.fn(async (): Promise<"embedded" | "external"> => "embedded"),
}));
vi.mock("@/lib/account/useAccountService", () => ({
  useAccountService: () => ({ getWalletKind, getUsdcBalance: vi.fn() }),
}));
// The export dialog is out of scope here; keep it on a real (but inert) exporter so no Privy SDK loads.
vi.mock("@/lib/account/useExportPrivateKey", () => ({
  useExportPrivateKey: () => ({ isMock: false, exportReal: vi.fn(), canExport: true }),
}));

const { SecurityScreen } = await import("./SecurityScreen");

describe("SecurityScreen (real mode) — R2 no-flash", () => {
  afterEach(() => {
    getWalletKind.mockReset();
    getWalletKind.mockResolvedValue("embedded");
  });

  it("hides the export row on first paint, then shows it once the wallet resolves to embedded", async () => {
    // Controlled promise so we can assert the loading (first-paint) state deterministically.
    let resolveKind!: (kind: "embedded" | "external") => void;
    getWalletKind.mockImplementationOnce(() => new Promise((resolve) => (resolveKind = resolve)));
    renderWithProviders(<SecurityScreen />);

    // First paint (walletKind === "loading"): the row must be absent — no external flash.
    expect(screen.queryByRole("button", { name: "Export private key" })).toBeNull();

    resolveKind("embedded");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export private key" })).toBeInTheDocument(),
    );
  });

  it("never shows the export row for an external wallet in real mode", async () => {
    getWalletKind.mockResolvedValue("external");
    renderWithProviders(<SecurityScreen />);
    // Absent on first paint (loading) and stays absent once it resolves to external.
    expect(screen.queryByRole("button", { name: "Export private key" })).toBeNull();
    await waitFor(() => expect(getWalletKind).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Export private key" })).toBeNull();
  });
});
