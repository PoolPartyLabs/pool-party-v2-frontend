/** @id PP-STR-CMP-041 @implements-rules-version v1 (POO-2262) */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fundViewSchema } from "@/lib/api/v2/fundSchemas";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../tests/utils/renderWithProviders";
import { FundDetailsPresenter } from "./FundDetail";
import { FundNetworks } from "./FundNetworks";
import fund6 from "./fixtures/fund6Detail.json";

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

const fund = fundViewSchema.parse(fund6.data);

describe("POO-2262 v6 Fund networks", () => {
  it("lists Arbitrum (hub), Robinhood and Solana with each spoke's report freshness", () => {
    const { container } = renderWithProviders(<FundNetworks fund={fund} />);
    const rows = [...container.querySelectorAll("[data-fund-network]")];
    expect(rows.map((row) => row.getAttribute("data-fund-network"))).toEqual([
      "42161",
      "4663",
      "1",
    ]);
    const [hub, robinhood, solana] = rows as HTMLElement[];
    if (!hub || !robinhood || !solana) throw new Error("three networks expected");
    expect(within(hub).getByText("Arbitrum")).toBeInTheDocument();
    expect(within(hub).getByText("Hub")).toBeInTheDocument();
    expect(hub.querySelector("[data-fund-report]")).toBeNull();
    expect(within(robinhood).getByText("Robinhood Chain")).toBeInTheDocument();
    expect(robinhood.querySelector("[data-fund-report]")).toHaveTextContent(
      "Report 25 min old · Refreshing",
    );
    expect(within(solana).getByText("Solana")).toBeInTheDocument();
    expect(solana.querySelector("[data-fund-report]")).toHaveTextContent(
      "Report 2 min old · Usable",
    );
  });
  it("links the Solana program, Fund PDA, vault and USDC account to Solscan", () => {
    renderWithProviders(<FundNetworks fund={fund} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://solscan.io/account/7PptZ653uyn5eoAFKqs4DXR1ijxH6sf49f2YAGMLTfCx",
      "https://solscan.io/account/4fhgX4FhW8Gvq5cnt7QJq9d4uTDhQdYc8ZMRULWkRWnu",
      "https://solscan.io/account/AXnN1ihCoy6bCwqcii6eDLT74abAwzDrn1AmgN57wNK6",
      "https://solscan.io/account/HEkWhruKWari9tepXfcKCTpS2YYfbYCWfoJtKmzqRw8b",
    ]);
    expect(
      screen.getByRole("link", {
        name: "USDC account HEkWhruKWari9tepXfcKCTpS2YYfbYCWfoJtKmzqRw8b",
      }),
    ).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("says so while the API has not derived the Solana accounts", () => {
    const chains = fund.chains.map((chain) =>
      chain.chainId === "1" ? { ...chain, solana: null } : chain,
    );
    renderWithProviders(<FundNetworks fund={{ ...fund, chains, spokes: undefined }} />);
    expect(screen.getByText("Solana accounts unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("shows the networks in the investor mandate of a v6 Fund only", async () => {
    const { container, unmount } = renderWithProviders(
      <FundDetailsPresenter fund={fund} personal={{ status: "disconnected" }} />,
    );
    await userEvent.setup().click(screen.getByText("Investment mandate"));
    expect(screen.getByText("Arbitrum · Robinhood · Solana")).toBeInTheDocument();
    expect(container.querySelector("[data-fund-networks]")).not.toBeNull();
    unmount();
    // EVM-only regression: the same mandate, no networks block, no report badges.
    const evm = renderWithProviders(
      <FundDetailsPresenter fund={mockFund} personal={{ status: "disconnected" }} />,
    );
    await userEvent.setup().click(screen.getByText("Investment mandate"));
    expect(screen.getByText("Arbitrum · Robinhood")).toBeInTheDocument();
    expect(evm.container.querySelector("[data-fund-networks]")).toBeNull();
    expect(evm.container.querySelector("[data-fund-report]")).toBeNull();
  });
});
