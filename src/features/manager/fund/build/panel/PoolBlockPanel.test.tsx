/**
 * @id PP-MGR-CMP-069
 * @name PoolBlockPanel tests
 * @implements-rules-version v1 (POO-2189); POO-2204 rules v1
 * @analytics-events none (the panel shell emits)
 */

import { renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import manager from "@/i18n/messages/en/manager.json";
import { PANEL_POOL_FIXTURES } from "@/mocks/data/buildPanelFixtures";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../../tests/utils/renderWithProviders";
import { mapV2Pool } from "../../mandatePoolSource";
import { TEST_CATALOG } from "../blocks/blockTestKit";
import { hubPoolPlan, makeTestDraft } from "../plan/planTestKit";
import { PoolBlockPanel, PoolPanelProvider, poolBlockPanel } from "./PoolBlockPanel";
import type { PanelBodyContext } from "./panelBodies";
import { toLivePoolGrid, toPanelPoolView } from "./panelCatalogView";
import { PanelHarness } from "./panelTestKit";
import { presetRange } from "./poolRangeMath";

const { action, live } = vi.hoisted(() => ({ action: vi.fn(), live: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/api/v2/actions", () => ({ getCatalogPoolsAction: action }));
vi.mock("./usePanelPool", () => ({ usePanelPool: live }));
const firstFixture = PANEL_POOL_FIXTURES[0];
const secondFixture = PANEL_POOL_FIXTURES[1];
if (!firstFixture || !secondFixture) throw new Error("Pool fixtures required");
const raw = firstFixture.pool;
const second = secondFixture.pool;
const pool = toPanelPoolView(raw);
const defaultRange = presetRange(toLivePoolGrid(pool), 10);
if (!defaultRange) throw new Error("A priced pool fixture is required");
const config = { poolId: pool.poolId, ...defaultRange, slippagePct: 2 };
const draft = { ...makeTestDraft(), pools: [mapV2Pool(raw), mapV2Pool(second)] };
const context: PanelBodyContext = {
  blockId: "b",
  kind: "uniswapV4Pool",
  network: "arbitrum",
  networkName: "Arbitrum",
  draft,
  catalog: TEST_CATALOG,
  plan: hubPoolPlan(),
  onEditMandate: vi.fn(),
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={{ manager }}>
    {children}
  </NextIntlClientProvider>
);
const configuredWrapper = ({ children }: { children: ReactNode }) =>
  wrapper({
    children: (
      <PoolPanelProvider context={context} config={config}>
        {children}
      </PoolPanelProvider>
    ),
  });
beforeEach(() => {
  action.mockResolvedValue({ ok: true, data: { pools: [raw, second] } });
  live.mockReturnValue({ pool, status: "ready", applicable: true, error: null, retry: vi.fn() });
});
describe("PoolBlockPanel", () => {
  it("[R2] one Retry updates the displayed price and the Apply gate together", async () => {
    live.mockImplementation(function useLiveRead() {
      const [ready, setReady] = useState(false);
      return {
        pool,
        status: ready ? "ready" : "error",
        applicable: ready,
        error: ready ? null : { code: "FAILED", status: 503 },
        retry: () => setReady(true),
      };
    });
    renderWithProviders(
      <PanelHarness
        draft={draft}
        catalog={TEST_CATALOG}
        plan={{
          version: 1,
          hub: {
            chains: [
              {
                id: "c",
                sharePct: 40,
                steps: [{ id: "b", family: "position", kind: "uniswapV4Pool", config }],
              },
            ],
          },
          spokes: [],
        }}
        selectedId="b"
        bodies={{ uniswapV4Pool: poolBlockPanel }}
      />,
    );
    screen.getByRole("slider", { name: "Allocation" }).focus();
    await userEvent.setup().keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeEnabled();
  });

  it("[R1][R3] Use produces the complete aligned default and canonical bare PoolId", async () => {
    const { result } = renderHook(() => poolBlockPanel.usePick(context), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.rows[0]?.config).toEqual(config);
    expect(result.current.rows[0]?.config?.poolId).toMatch(/^0x[0-9a-f]{64}$/);
    const plan = {
      version: 1 as const,
      hub: {
        chains: [
          {
            id: "c",
            sharePct: 0,
            steps: [
              {
                id: "b",
                family: "position" as const,
                kind: "uniswapV4Pool" as const,
                config: null,
              },
            ],
          },
        ],
      },
      spokes: [],
    };
    renderWithProviders(
      <PanelHarness
        draft={draft}
        plan={plan}
        selectedId="b"
        bodies={{ uniswapV4Pool: poolBlockPanel }}
      >
        {(api) => <output data-testid="plan">{JSON.stringify(api.plan)}</output>}
      </PanelHarness>,
    );
    const firstUse = (await screen.findAllByRole("button", { name: /Use WETH \/ USDC/ }))[0];
    if (!firstUse) throw new Error("A usable pool row is required");
    await userEvent.setup().click(firstUse);
    expect(screen.getByText("All changes applied")).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("plan").textContent ?? "{}").hub.chains[0].sharePct).toBe(
      0,
    );
  });
  it("[R2] Apply rejects stale display data when the latest live read failed", () => {
    live.mockReturnValue({
      pool,
      status: "error",
      applicable: false,
      error: { code: "FAILED" },
      retry: vi.fn(),
    });
    const { result } = renderHook(() => poolBlockPanel.useApplyGate?.(context, config), {
      wrapper: configuredWrapper,
    });
    expect(result.current?.ok).toBe(false);
    expect(result.current?.reason).toMatch(/failed/i);
  });
  it("[R2] disables Use for missing or ineligible catalog rows", async () => {
    action.mockResolvedValue({ ok: true, data: { pools: [{ ...raw, liquidity: "0" }] } });
    const { result } = renderHook(() => poolBlockPanel.usePick(context), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.rows.every((row) => row.config === null && row.disabledReason)).toBe(
      true,
    );
  });
  it("[R7][R8] resets range on a pool change and keeps the shell allocation", async () => {
    const changed = vi.fn();
    renderWithProviders(
      <PoolPanelProvider context={context} config={config}>
        <PoolBlockPanel
          context={context}
          applied={config}
          config={config}
          onConfigChange={changed}
          allocation={<span>Allocation 60%</span>}
        />
      </PoolPanelProvider>,
    );
    await waitFor(() => expect(action).toHaveBeenCalled());
    await userEvent.setup().click(screen.getByRole("button", { name: "Pool" }));
    await userEvent.setup().click(await screen.findByRole("option", { name: /0.3%/ }));
    expect(changed.mock.lastCall?.[0]).toEqual({
      poolId: second.poolId,
      ...presetRange(toLivePoolGrid(toPanelPoolView(second)), 10),
      slippagePct: 2,
    });
    expect(screen.getByText("Allocation 60%")).toBeInTheDocument();
    expect(screen.queryByText(/TVL|APR/)).not.toBeInTheDocument();
  });
  it("shows loading and recoverable failed catalog reads", async () => {
    action.mockResolvedValueOnce({ ok: false, error: { code: "FAILED" } });
    const { result } = renderHook(() => poolBlockPanel.usePick(context), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("error"));
    result.current.onRetry?.();
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});

describe("deferred allocation draft (POO-2204)", () => {
  // @rule R1, R2, R5
  it("hides range at zero, keeps earlier ticks, and restores the positive live gate", async () => {
    live.mockReturnValue({
      pool: null,
      status: "error",
      applicable: false,
      error: null,
      retry: vi.fn(),
    });
    renderWithProviders(
      <PanelHarness
        draft={draft}
        plan={{
          version: 1,
          hub: {
            chains: [
              {
                id: "c",
                sharePct: 40,
                steps: [{ id: "b", family: "position", kind: "uniswapV4Pool", config }],
              },
            ],
          },
          spokes: [],
        }}
        selectedId="b"
        bodies={{ uniswapV4Pool: poolBlockPanel }}
      >
        {(api) => <output data-testid="saved">{JSON.stringify(api.plan)}</output>}
      </PanelHarness>,
    );
    const slider = screen.getByRole("slider", { name: "Allocation" });
    slider.focus();
    await userEvent.setup().keyboard("{Home}");
    expect(
      screen.queryByLabelText(manager.fundBuilder.canvas.panel.pool.loading),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeEnabled();
    expect(live.mock.lastCall?.[1]).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Apply changes" }));
    const saved = JSON.parse(screen.getByTestId("saved").textContent ?? "{}").hub.chains[0];
    expect(saved.sharePct).toBe(0);
    expect(saved.steps.find((step: { id: string }) => step.id === "b").config).toEqual(config);
    slider.focus();
    await userEvent.setup().keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
    expect(live.mock.lastCall?.[1]).toBe(config.poolId);
  });
});

describe("deferred reads (POO-2204)", () => {
  // @rule R1, R3
  it("mounts a configured zero pool without requesting range data", async () => {
    action.mockClear();
    renderWithProviders(
      <PoolPanelProvider context={context} config={config} sharePct={0}>
        <PoolBlockPanel
          context={context}
          applied={config}
          config={config}
          sharePct={0}
          onConfigChange={vi.fn()}
          allocation={<span>Allocation 0%</span>}
        />
      </PoolPanelProvider>,
    );
    expect(
      screen.queryByLabelText(manager.fundBuilder.canvas.panel.pool.loading),
    ).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    expect(live.mock.lastCall?.[1]).toBeNull();
  });
});
