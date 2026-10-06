import { act } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { managerOverviewDemo } from "@/mocks/data/managerOverviewV2";
import { renderWithProviders, screen } from "../../../../../tests/utils/renderWithProviders";
import { ManagerOverviewV2 } from "./ManagerOverviewV2";

const bag = vi.hoisted(() => ({ load: vi.fn(), address: `0x${"11".repeat(20)}` }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: bag.address }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({ useSiweSession: () => ({ isSignedIn: true }) }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/features/funds/fundActions", () => ({ loadFundsAction: bag.load }));
vi.mock("./OverviewProfile", () => ({ OverviewProfile: () => <p>profile-only</p> }));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/features/manager/components/ConsoleShell", () => ({
  ConsoleShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
describe("Overview presenter POO-2245", () => {
  beforeEach(() => {
    localStorage.clear();
    bag.load.mockReset();
    window.dataLayer = [];
  });
  // @rule R5
  it("times out a stalled read, preserves setup and ignores its late response", async () => {
    vi.useFakeTimers();
    let finish: (value: unknown) => void = () => {};
    bag.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      renderWithProviders(<ManagerOverviewV2 />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(screen.getByText("We couldn't load your strategies")).toBeInTheDocument();
      expect(screen.getByText("Continue setup")).toBeInTheDocument();
      await act(async () => {
        finish({
          ok: true,
          data: { funds: managerOverviewDemo.funds, wallet: bag.address, holders: {} },
        });
      });
      expect(screen.queryByText("Balanced Income")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  // @rule R6
  it("shows concrete design data only on the explicit demo path", () => {
    renderWithProviders(<ManagerOverviewV2 demo={managerOverviewDemo} />);
    expect(screen.getByText("$125,000.00")).toBeInTheDocument();
    expect(screen.getByText("Balanced Income")).toBeInTheDocument();
    expect(screen.getByText("Global Markets")).toBeInTheDocument();
    expect(bag.load).not.toHaveBeenCalled();
  });
  // @rule R4
  it("keeps the workspace instead of first-use on empty discovery", async () => {
    bag.load.mockResolvedValue({ ok: true, data: { funds: [], wallet: bag.address, holders: {} } });
    renderWithProviders(<ManagerOverviewV2 />);
    expect(
      await screen.findByText(
        "No strategies available in this read. Complete history is not available.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No strategies yet")).not.toBeInTheDocument();
    expect(screen.queryByText("$125,000.00")).not.toBeInTheDocument();
  });
  // @rule R5, R10
  it("sanitizes read errors and retains setup with retry", async () => {
    bag.load.mockRejectedValue(new Error("secret upstream"));
    renderWithProviders(<ManagerOverviewV2 />);
    expect(await screen.findByText("We couldn't load your strategies")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("Continue setup")).toBeInTheDocument();
    expect(JSON.stringify(window.dataLayer)).not.toContain("secret upstream");
    expect(window.dataLayer).toContainEqual(expect.objectContaining({ event: "app_error_shown" }));
  });
});
