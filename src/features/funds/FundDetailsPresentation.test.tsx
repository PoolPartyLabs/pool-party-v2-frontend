/** @id PP-STR-SCR-006 @implements-rules-version v1 (POO-2223) */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { FundDetailsPresenter } from "./FundDetail";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/hooks/useContractFamily", () => ({ useContractFamily: () => ({ family: "v2" }) }));
vi.mock("@/features/manager/fund/manage/ManageEntry", () => ({ ManageEntry: () => null }));
vi.mock("@/features/strategies/components/InvestModal", () => ({ InvestModal: () => null }));
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

describe("V2 Details presentation", () => {
  // @rule R1
  it("synchronizes responsive Follow buttons and resets for a different manager", async () => {
    const { rerender } = renderWithProviders(
      <FundDetailsPresenter fund={mockFund} personal={{ status: "disconnected" }} />,
    );
    const user = userEvent.setup();
    const [desktopFollow, mobileFollow] = screen.getAllByRole("button", { name: "Follow" });
    if (!desktopFollow || !mobileFollow)
      throw new Error("Both responsive Follow buttons must exist");
    await user.click(desktopFollow);
    expect(screen.getAllByRole("button", { name: "Following", pressed: true })).toHaveLength(2);
    await user.click(mobileFollow);
    expect(screen.getAllByRole("button", { name: "Follow", pressed: false })).toHaveLength(2);
    await user.click(desktopFollow);
    rerender(
      <FundDetailsPresenter
        fund={{ ...mockFund, manager: `0x${"9".repeat(40)}` }}
        personal={{ status: "disconnected" }}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Follow", pressed: false })).toHaveLength(2);
    expect(screen.queryByText(/mock/i)).not.toBeInTheDocument();
  });
  // @rule R2
  it("shows a 65 percent coverage donut and 35 percent unknown allocation with position logos", async () => {
    const { container } = renderWithProviders(
      <FundDetailsPresenter fund={mockFund} personal={{ status: "disconnected" }} />,
    );
    await userEvent.setup().click(screen.getByText("Composition"));
    expect(
      screen.getByRole("img", { name: /65%.*Detailed.*35% not detailed/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("$250,000.00")).toBeInTheDocument();
    expect(screen.getByText("$400,000.00")).toBeInTheDocument();
    for (const src of [
      "/tokens/usdc.png",
      "/tokens/weth.png",
      "/tokens/aave.png",
      "/protocols/uniswap.svg",
      "/networks/arbitrum.png",
      "/networks/robinhood.png",
    ]) {
      expect(container.querySelector(`img[src="${src}"]`)).not.toBeNull();
    }
  });
  // @rule R3
  it("keeps positions visible without inventing a chart when a share is unknown", async () => {
    const fund = {
      ...mockFund,
      positionsSummary: {
        protocolVersion: "v2" as const,
        positions: (mockFund.positionsSummary?.positions ?? []).map((p) => ({
          ...p,
          shareOfNav: null,
        })),
      },
    };
    renderWithProviders(<FundDetailsPresenter fund={fund} personal={{ status: "disconnected" }} />);
    await userEvent.setup().click(screen.getByText("Composition"));
    expect(screen.queryByRole("img", { name: /Detailed/i })).not.toBeInTheDocument();
    expect(screen.getByText("$250,000.00")).toBeInTheDocument();
  });
  // @rule R4
  it("uses the Figma no-history state without a fabricated price line", () => {
    renderWithProviders(
      <FundDetailsPresenter fund={mockFund} personal={{ status: "disconnected" }} />,
    );
    expect(screen.getByText("No history yet")).toBeInTheDocument();
    expect(
      screen.getByText("The price history for this investment is not available yet."),
    ).toBeInTheDocument();
  });
});
