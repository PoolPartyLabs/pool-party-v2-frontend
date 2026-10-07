/**
 * @id PP-MGR-SCR-004
 * @implements-rules-version v2 (POO-2274)
 * @analytics-events none, authorized inspector integration regressions.
 */
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supportedChainMetas } from "@/lib/chains/config";
import { PANEL_POOL_FIXTURES } from "@/mocks/data/buildPanelFixtures";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { toPanelPoolView } from "../build/panel/panelCatalogView";
import { ManageEntry } from "./ManageEntry";

const mocks = vi.hoisted(() => ({ load: vi.fn(), metadata: vi.fn(), pool: vi.fn() }));
vi.mock("@/lib/api/v2/manageActions", () => ({
  loadManageFundAction: mocks.load,
  reviewManageMoveRangeAction: vi.fn(),
}));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mockFund.manager }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({ useSiweSession: () => ({ isSignedIn: true }) }));
vi.mock("./useManagePosition", () => ({
  MANAGE_READ_TIMEOUT_MS: 30_000,
  useManagePosition: mocks.metadata,
}));
vi.mock("../build/panel/usePanelPool", () => ({ usePanelPool: mocks.pool }));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/lib/analytics/useTrackView", () => ({ useTrackView: vi.fn() }));

const meta = supportedChainMetas.find((chain) => chain.chain.id === 42161);
const fixture = PANEL_POOL_FIXTURES[0];
if (!meta || !fixture) throw new Error("Missing canonical test metadata");
const fund = { ...mockFund, mandate: { ...mockFund.mandate, usdc: meta.usdc.address } };
const pool = toPanelPoolView(fixture.pool);
const position = mockFund.positionsSummary?.positions.find(
  (item) => item.adapterKind === "uniswap-v4",
);
if (!position) throw new Error("Missing LP test origin");

beforeEach(() => {
  window.dataLayer = [];
  mocks.load
    .mockReset()
    .mockResolvedValue({ ok: true, data: { wallet: fund.manager, fund, balances: [] } });
  mocks.metadata.mockReturnValue({
    status: "ready",
    position: {
      positionKey: position.positionKey,
      poolId: pool.poolId,
      status: "open",
      uniswap: {
        tickLower: Math.floor((pool.currentTick - 1000) / pool.tickSpacing) * pool.tickSpacing,
        tickUpper: Math.ceil((pool.currentTick + 1000) / pool.tickSpacing) * pool.tickSpacing,
        liquidity: "100000",
      },
    },
    retry: vi.fn(),
  });
  mocks.pool.mockReturnValue({ pool, status: "ready", applicable: true, retry: vi.fn() });
});
const selector = (id: string) => {
  const value = document.querySelector<HTMLElement>(`[data-manage-list-node="${id}"]`);
  if (!value) throw new Error(`Missing node ${id}`);
  return value;
};
const panel = () => {
  const value = document.querySelector<HTMLElement>("[data-active-manage-panel]");
  if (!value) throw new Error("Missing inline host");
  return within(value);
};
const openLp = async () => {
  await screen.findByText("Balanced Income");
  const lp = document.querySelectorAll<HTMLElement>("[data-manage-list-position]")[1];
  if (!lp) throw new Error("Missing LP selector");
  await userEvent.click(lp);
  return lp;
};
describe("authorized all-node inspector integration", () => {
  it("[R3,R6] focuses the visible Collect heading and restores the LP anchor on Escape", async () => {
    renderWithProviders(<ManageEntry core={fund.coreVault} />);
    const lp = await openLp();
    const collect = document.querySelector<HTMLElement>('[data-manage-list-node^="collect:"]');
    if (!collect) throw new Error("Missing Collect selector");
    collect.focus();
    await userEvent.keyboard("{Enter}");
    expect(panel().getByRole("heading", { name: "Manage block" })).toHaveFocus();
    expect(document.activeElement?.closest("[hidden]")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(lp).toHaveFocus();
    expect(lp).toHaveAttribute("aria-pressed", "true");
  });
  it("[R1,R3] retains block/network identity and available Idle quantities without guessing cash", async () => {
    renderWithProviders(<ManageEntry core={fund.coreVault} />);
    await screen.findByText("Balanced Income");
    await userEvent.click(selector("cash:4663"));
    expect(panel().getByRole("heading", { name: "Operating cash" })).toBeVisible();
    expect(panel().getByText("Robinhood Chain")).toBeVisible();
    expect(panel().getByText("ETH")).toBeVisible();
    expect(panel().queryByText("0 ETH")).not.toBeInTheDocument();
    await userEvent.click(selector("idle:42161"));
    expect(panel().getByRole("heading", { name: "Idle input" })).toBeVisible();
    expect(panel().getByText("190000 USDC")).toBeInTheDocument();
    expect(panel().getByText("Arbitrum")).toBeVisible();
  });
  it("[R4,R6] queue Retry leaves the screen and edited LP mounted and Back recovers the draft", async () => {
    renderWithProviders(<ManageEntry core={fund.coreVault} />);
    const lp = await openLp();
    await userEvent.click(panel().getByRole("button", { name: "±5%" }));
    await userEvent.click(selector("withdrawal"));
    await userEvent.click(panel().getByRole("button", { name: "Try again" }));
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(panel().getByRole("heading", { name: "Withdrawal deadlines" })).toBeVisible();
    await userEvent.click(panel().getByRole("button", { name: "Back to blocks" }));
    expect(panel().getByRole("button", { name: "±5%" })).toHaveAttribute("aria-pressed", "true");
    expect(lp).toHaveFocus();
    expect((window.dataLayer ?? []).filter((entry) => entry.event === "tx_flow_abandoned")).toEqual(
      [],
    );
  });
});
