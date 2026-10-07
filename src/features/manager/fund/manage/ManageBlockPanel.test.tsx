/** @id PP-MGR-CMP-086 @implements-rules-version v2 (POO-2246; extends POO-2227), v2 (POO-2274), v1 (POO-2284) */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_POOL_FIXTURES } from "@/mocks/data/buildPanelFixtures";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  act,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { toLivePoolGrid, toPanelPoolView } from "../build/panel/panelCatalogView";
import { fullPoolRange } from "../build/panel/poolRangeMath";
import { normalizeManageModel } from "./manageModel";

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), pool: vi.fn(), review: vi.fn() }));
vi.mock("./useManagePosition", () => ({
  MANAGE_READ_TIMEOUT_MS: 30_000,
  useManagePosition: mocks.metadata,
}));
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
  window.dataLayer = [];
  mocks.review.mockClear();
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
  // @rule POO-2274 R4: unvisited origins stay idle; activated origins keep their read lifetime.
  it("activates an origin only on its first visible visit", () => {
    const metadata = mocks.metadata();
    const live = mocks.pool();
    mocks.metadata.mockReturnValue({ ...metadata, status: "loading", position: null });
    mocks.pool.mockReturnValue({ ...live, status: "idle", pool: null, applicable: false });
    const view = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={liquidity} active={false} />,
    );
    expect(mocks.metadata.mock.calls.at(-1)?.[3]).toBe(false);
    expect(mocks.pool.mock.calls.at(-1)?.[1]).toBeNull();
    mocks.metadata.mockReturnValue(metadata);
    mocks.pool.mockReturnValue(live);
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    expect(mocks.metadata.mock.calls.at(-1)?.[3]).toBe(true);
    expect(mocks.pool.mock.calls.at(-1)?.[1]).toBe(pool.poolId);
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active={false} />);
    expect(mocks.metadata.mock.calls.at(-1)?.[3]).toBe(true);
    expect(mocks.pool.mock.calls.at(-1)?.[1]).toBe(pool.poolId);
  });
  // @rule POO-2274 R5: draft and review never transfer across a material core boundary.
  it("keeps a new core idle and discards the previous core review and draft", async () => {
    const view = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={liquidity} active />,
    );
    await userEvent.click(screen.getByRole("button", { name: "±5%" }));
    await userEvent.click(screen.getByRole("button", { name: "Move range" }));
    await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
    await screen.findByRole("button", { name: "Confirm & move range" });
    const nextFund = { ...mockFund, coreVault: `0x${"a".repeat(40)}` };
    const metadata = mocks.metadata();
    const live = mocks.pool();
    mocks.metadata.mockReturnValue({ ...metadata, status: "loading", position: null });
    mocks.pool.mockReturnValue({ ...live, status: "idle", pool: null, applicable: false });
    view.rerender(<ManageBlockPanel fund={nextFund} position={liquidity} active={false} />);
    expect(mocks.metadata.mock.calls.at(-1)?.[0]).toBe(nextFund.coreVault);
    expect(mocks.metadata.mock.calls.at(-1)?.[3]).toBe(false);
    expect(screen.queryByRole("button", { name: "Confirm & move range" })).not.toBeInTheDocument();
    mocks.metadata.mockReturnValue(metadata);
    mocks.pool.mockReturnValue(live);
    view.rerender(<ManageBlockPanel fund={nextFund} position={liquidity} active />);
    expect(screen.getByRole("button", { name: "±5%" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Move range" })).not.toBeInTheDocument();
    expect(mocks.review).toHaveBeenCalledTimes(1);
  });
  // @rule POO-2274 R5: missing protocol metadata invalidates review without dropping a retained draft.
  it("retains a draft when a real read no longer contains LP metadata", async () => {
    const view = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={liquidity} active />,
    );
    await userEvent.click(screen.getByRole("button", { name: "±5%" }));
    await userEvent.click(screen.getByRole("button", { name: "Move range" }));
    await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
    await screen.findByRole("button", { name: "Confirm & move range" });
    const metadata = mocks.metadata();
    mocks.metadata.mockReturnValue({
      ...metadata,
      position: { ...metadata.position, uniswap: null },
    });
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active={false} />);
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    expect(screen.queryByRole("button", { name: "Confirm & move range" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "±5%" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Review move range" })).toBeDisabled();
  });
  // @rule POO-2274 R5/R8: late preparation cannot revalidate a changed pool snapshot.
  it("ignores a pending preparation after an actual hidden price change in the same tick", async () => {
    const reply = await mocks.review();
    mocks.review.mockClear();
    let resolve: (value: unknown) => void = () => {};
    mocks.review.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={liquidity} active />,
    );
    await userEvent.click(screen.getByRole("button", { name: "±5%" }));
    await userEvent.click(screen.getByRole("button", { name: "Move range" }));
    await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
    mocks.pool.mockReturnValue({ ...mocks.pool(), pool: { ...pool, price: pool.price * 1.00001 } });
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active={false} />);
    await act(async () => resolve(reply));
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    expect(screen.queryByRole("button", { name: "Confirm & move range" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "±5%" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Review move range" })).toBeEnabled();
    expect(mocks.review).toHaveBeenCalledTimes(1);
  });
  // @rule POO-2274 R5: source snapshot/status changes invalidate review and keep the edit origin.
  it.each([
    "range",
    "liquidity",
    "closed",
    "fund-closed",
  ])("invalidates a review on a real hidden %s change and keeps its edited range", async (change) => {
    const view = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={liquidity} active />,
    );
    await userEvent.click(screen.getByRole("button", { name: "±5%" }));
    await userEvent.click(screen.getByRole("button", { name: "Move range" }));
    await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
    await screen.findByRole("button", { name: "Confirm & move range" });
    const metadata = mocks.metadata();
    mocks.metadata.mockReturnValue({
      ...metadata,
      position: {
        ...metadata.position,
        status: change === "closed" ? "closed" : "open",
        uniswap: {
          ...metadata.position.uniswap,
          liquidity: change === "liquidity" ? "0" : "100000",
          tickLower: change === "range" ? range.tickLower - pool.tickSpacing : range.tickLower,
        },
      },
    });
    const fund = change === "fund-closed" ? { ...mockFund, state: "Closed" as const } : mockFund;
    view.rerender(<ManageBlockPanel fund={fund} position={liquidity} active={false} />);
    view.rerender(<ManageBlockPanel fund={fund} position={liquidity} active />);
    expect(screen.queryByRole("button", { name: "Confirm & move range" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "±5%" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Review move range" })).toBeDisabled();
  });
  // @rule POO-2274 R4/R8: panel visibility is not intent abandonment or a new read identity.
  it("preserves the same draft and review across hide/show without false abandonment or renewal", async () => {
    const view = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={liquidity} active />,
    );
    await userEvent.click(screen.getByRole("button", { name: "±5%" }));
    await userEvent.click(screen.getByRole("button", { name: "Move range" }));
    await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
    expect(await screen.findByRole("button", { name: "Confirm & move range" })).toBeDisabled();
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active={false} />);
    expect(mocks.metadata.mock.calls.at(-1)?.[3]).toBe(true);
    expect(mocks.pool.mock.calls.at(-1)?.[1]).toBe(pool.poolId);
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeDisabled();
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(window.dataLayer?.filter((event) => event.event === "tx_flow_abandoned")).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Back to settings" }));
    expect(screen.getByRole("button", { name: "±5%" })).toHaveAttribute("aria-pressed", "true");
  });
  // @rule POO-2274 R4/R8: in-flight preparation keeps its immutable owner while hidden, no replay.
  it("accepts the same pending preparation after hide/show without retransmission", async () => {
    const reply = await mocks.review();
    mocks.review.mockClear();
    let resolve: (value: unknown) => void = () => {};
    mocks.review.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={liquidity} active />,
    );
    await userEvent.click(screen.getByRole("button", { name: "±5%" }));
    await userEvent.click(screen.getByRole("button", { name: "Move range" }));
    await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active={false} />);
    await act(async () => resolve(reply));
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    expect(await screen.findByRole("button", { name: "Confirm & move range" })).toBeDisabled();
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(window.dataLayer?.filter((event) => event.event === "tx_flow_abandoned")).toEqual([]);
  });
  // @rule POO-2274 R5: genuine hidden source failure invalidates a review but retains its draft.
  it("invalidates a review on a real hidden read failure while retaining the edited range", async () => {
    const view = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={liquidity} active />,
    );
    await userEvent.click(screen.getByRole("button", { name: "±5%" }));
    await userEvent.click(screen.getByRole("button", { name: "Move range" }));
    await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
    await screen.findByRole("button", { name: "Confirm & move range" });
    mocks.metadata.mockReturnValue({
      ...mocks.metadata(),
      status: "error",
      position: null,
      error: "V2_UNAVAILABLE",
    });
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active={false} />);
    view.rerender(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    expect(screen.queryByRole("button", { name: "Confirm & move range" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "±5%" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Review move range" })).toBeDisabled();
  });
  // @rule POO-2272 R5: the panel consumes one identity header, with no separate network row.
  it("keeps protocol, subtype and origin network in the selected block header", () => {
    const { container } = renderWithProviders(
      <ManageBlockPanel fund={mockFund} position={supply} active />,
    );
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    const content = within(header as HTMLElement);
    expect(content.getByText(supply.protocol)).toBeVisible();
    expect(content.getByText("Supply position")).toBeVisible();
    expect(content.getByText("Arbitrum")).toBeVisible();
    expect(screen.getAllByText("Arbitrum")).toHaveLength(1);
  });
  // @rule POO-2284 R5: restore Full from the authoritative ticks and the actual pool spacing.
  it("recognizes an existing Full position without enabling inward steppers (POO-2284)", async () => {
    const full = fullPoolRange(toLivePoolGrid(pool));
    const metadata = mocks.metadata();
    mocks.metadata.mockReturnValue({
      ...metadata,
      position: { ...metadata.position, uniswap: { ...full, liquidity: "100000" } },
    });
    renderWithProviders(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
    expect(screen.getByRole("button", { name: "Full" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Min price" })).toHaveValue("0");
    expect(screen.getByRole("textbox", { name: "Max price" })).toHaveValue("∞");
    for (const label of ["Min price", "Max price"]) {
      expect(screen.getByRole("textbox", { name: label })).toHaveAttribute("readonly");
      expect(screen.getByRole("button", { name: `Decrease ${label}` })).toBeDisabled();
      expect(screen.getByRole("button", { name: `Increase ${label}` })).toBeDisabled();
    }
    expect(document.querySelector("[data-range-marker]")).toHaveStyle({ left: "50%" });
    await userEvent.click(screen.getByRole("button", { name: "Full" }));
    expect(screen.queryByRole("button", { name: "Move range" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create new position" })).not.toBeInTheDocument();
  });
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

afterEach(() => vi.useRealTimers());
// @rule R7: Timeout keeps draft, offers explicit retry, and ignores a late response.
it("POO-2246 [R7,R9] times out preparation without losing the draft or accepting a late review", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  const reply = await mocks.review();
  mocks.review.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  renderWithProviders(<ManageBlockPanel fund={mockFund} position={liquidity} active />);
  await userEvent.click(screen.getByRole("button", { name: "±5%" }));
  await userEvent.click(screen.getByRole("button", { name: "Move range" }));
  vi.useFakeTimers();
  await act(async () => screen.getByRole("button", { name: "Review move range" }).click());
  await act(async () => {
    vi.advanceTimersByTime(30_000);
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Not available");
  expect(screen.getByRole("button", { name: "Review move range" })).toBeEnabled();
  await act(async () => resolveOld(reply));
  expect(screen.queryByRole("button", { name: "Confirm & move range" })).not.toBeInTheDocument();
  vi.useRealTimers();
  await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
  expect(await screen.findByRole("button", { name: "Confirm & move range" })).toBeDisabled();
});
