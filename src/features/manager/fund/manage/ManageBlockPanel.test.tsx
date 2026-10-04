/** @id PP-MGR-CMP-086 @implements-rules-version v1 (POO-2227) */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_POOL_FIXTURES } from "@/mocks/data/buildPanelFixtures";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";
import { toPanelPoolView } from "../build/panel/panelCatalogView";
import { normalizeManageModel } from "./manageModel";

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), pool: vi.fn(), review: vi.fn() }));
vi.mock("./useManagePosition", () => ({ useManagePosition: mocks.metadata }));
vi.mock("../build/panel/usePanelPool", () => ({ usePanelPool: mocks.pool }));
vi.mock("@/lib/api/v2/manageActions", () => ({ reviewManageMoveRangeAction: mocks.review }));

import { ManageBlockPanel } from "./ManageBlockPanel";
import { ManageCanvas } from "./ManageCanvas";

const fixture = PANEL_POOL_FIXTURES[0];
if (!fixture) throw new Error("Pool fixture missing");
const pool = toPanelPoolView(fixture.pool);
const model = normalizeManageModel(mockFund);
const liquidity = model.positions.find((p) => p.kind === "liquidity");
const supply = model.positions.find((p) => p.kind === "supply");
if (!liquidity || !supply) throw new Error("Manage fixture missing");
const range = {
  tickLower: Math.floor((pool.currentTick - 1000) / pool.tickSpacing) * pool.tickSpacing,
  tickUpper: Math.ceil((pool.currentTick + 1000) / pool.tickSpacing) * pool.tickSpacing,
};
beforeEach(() => {
  mocks.metadata.mockReturnValue({
    status: "ready",
    position: {
      positionKey: liquidity.positionKey,
      poolId: pool.poolId,
      status: "open",
      uniswap: { ...range, liquidity: "100000" },
    },
    retry: vi.fn(),
  });
  mocks.pool.mockReturnValue({
    pool,
    status: "ready",
    applicable: true,
    retry: vi.fn(),
    refreshedAt: Date.now(),
  });
  mocks.review.mockResolvedValue({
    ok: true,
    data: {
      status: "unavailable",
      canConfirm: false,
      missing: ["network-fee", "price-impact"],
      position: {
        positionKey: liquidity.positionKey,
        chainId: String(liquidity.chainId),
        uniswap: range,
      },
    },
  });
});
describe("Manage block inline", () => {
  it("[R3,R4,R6] binds the two timings to actions, preserves Back and keeps review inline", async () => {
    renderWithProviders(
      <>
        <ManageCanvas model={model} selectedId={liquidity.id} onSelect={vi.fn()} />
        <ManageBlockPanel fund={mockFund} position={liquidity} active />
      </>,
    );
    const graphBoxes = () =>
      [...document.querySelectorAll("[data-manage-node]")].map((node) =>
        node.getAttribute("style"),
      );
    const initialBoxes = graphBoxes();
    const expectCurrentPositionUnchanged = () => {
      // POO-2232 R1/R5: draft presets, Move/review and future policy do not move or recolor live cards.
      expect(graphBoxes()).toEqual(initialBoxes);
      expect(document.querySelector("[data-manage-range]")).toHaveTextContent("In range");
      expect(document.querySelector("[data-manage-range]")).toHaveClass("text-success");
    };
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: "Move range" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "±5%" }));
    expectCurrentPositionUnchanged();
    expect(screen.getByText("Apply now")).toBeInTheDocument();
    expect(screen.getByText("New deposits only")).toBeInTheDocument();
    expect(screen.queryByText("When to apply")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move range" }));
    expectCurrentPositionUnchanged();
    expect(screen.queryByRole("button", { name: "Create new position" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review move range" }));
    expect(await screen.findByRole("button", { name: "Confirm & move range" })).toBeDisabled();
    expectCurrentPositionUnchanged();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Back to settings" }));
    await user.click(screen.getByRole("button", { name: "Back to actions" }));
    await user.click(screen.getByRole("button", { name: "Create new position" }));
    expectCurrentPositionUnchanged();
    expect(screen.getByRole("button", { name: "Save for new deposits" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Review move range" })).not.toBeInTheDocument();
  });
  it("[R2] inversion alone offers no operation", async () => {
    renderWithProviders(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    await userEvent.setup().click(screen.getByRole("button", { name: / per / }));
    expect(screen.queryByRole("button", { name: "Move range" })).not.toBeInTheDocument();
  });
  it("[R5] Aave retains timing without a range or an executable save", () => {
    renderWithProviders(<ManageBlockPanel fund={mockFund} position={supply} active />);
    expect(screen.getByText("When to apply")).toBeInTheDocument();
    expect(screen.queryByText("Price range")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save for new deposits" })).toBeDisabled();
  });
  it("[R8] no metadata never falls back to the initial source ticks", () => {
    mocks.metadata.mockReturnValue({ status: "error", position: null, retry: vi.fn() });
    mocks.pool.mockReturnValue({ pool: null, status: "idle", applicable: false, retry: vi.fn() });
    renderWithProviders(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    expect(screen.queryByRole("button", { name: "±5%" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move range" })).not.toBeInTheDocument();
  });
  it("[R8] preserves edited settings with a visible Retry after a refresh fails", async () => {
    const view = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={liquidity} active />,
    );
    await userEvent.click(screen.getByRole("button", { name: "±5%" }));
    const previous = mocks.metadata();
    mocks.metadata.mockReturnValue({ ...previous, status: "error", error: "V2_UNAVAILABLE" });
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    expect(screen.getByRole("button", { name: "Move range" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "±5%" })).toBeDisabled();
  });
  it("[R8] does not review against an obsolete original range", async () => {
    const reply = await mocks.review();
    mocks.review.mockResolvedValue({
      ...reply,
      data: {
        ...reply.data,
        position: {
          ...reply.data.position,
          uniswap: { ...range, tickLower: range.tickLower - pool.tickSpacing },
        },
      },
    });
    renderWithProviders(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    await userEvent.click(screen.getByRole("button", { name: "±5%" }));
    await userEvent.click(screen.getByRole("button", { name: "Move range" }));
    await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Not available"));
    expect(screen.queryByRole("button", { name: "Confirm & move range" })).not.toBeInTheDocument();
  });
});
