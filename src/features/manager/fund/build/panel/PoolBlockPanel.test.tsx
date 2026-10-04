/**
 * @id PP-MGR-CMP-069
 * @name PoolBlockPanel tests
 * @implements-rules-version v1 (POO-2189)
 * @analytics-events none (the panel shell emits)
 */

import { renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import manager from "@/i18n/messages/en/manager.json";
import { PANEL_POOL_FIXTURES } from "@/mocks/data/buildPanelFixtures";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../../tests/utils/renderWithProviders";
import { mapV2Pool } from "../../mandatePoolSource";
import { hubPoolPlan, makeTestDraft, TEST_CATALOG } from "../plan/planTestKit";
import { PoolBlockPanel, poolBlockPanel } from "./PoolBlockPanel";
import type { PanelBodyContext } from "./panelBodies";
import { toLivePoolGrid, toPanelPoolView } from "./panelCatalogView";
import { PanelHarness } from "./panelTestKit";
import { presetRange } from "./poolRangeMath";

const { action, live } = vi.hoisted(() => ({ action: vi.fn(), live: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/api/v2/actions", () => ({ getCatalogPoolsAction: action }));
vi.mock("./usePanelPool", () => ({ usePanelPool: live }));
const raw = PANEL_POOL_FIXTURES[0].pool;
const second = PANEL_POOL_FIXTURES[1].pool;
const pool = toPanelPoolView(raw);
const config = { poolId: pool.poolId, ...presetRange(toLivePoolGrid(pool), 10)!, slippagePct: 2 };
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
beforeEach(() => {
  action.mockResolvedValue({ ok: true, data: { pools: [raw, second] } });
  live.mockReturnValue({ pool, status: "ready", applicable: true, error: null, retry: vi.fn() });
});
describe("PoolBlockPanel", () => {
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
    await userEvent.setup().click(await screen.findByRole("button", { name: /Use WETH \/ USDC/ }));
    expect(screen.getByText("All changes applied")).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("plan").textContent!).hub.chains[0].sharePct).toBe(0);
  });
  it("[R2] Apply rejects stale display data when the latest live read failed", () => {
    live.mockReturnValue({
      pool,
      status: "error",
      applicable: false,
      error: { code: "FAILED" },
      retry: vi.fn(),
    });
    const { result } = renderHook(() => poolBlockPanel.useApplyGate!(context, config), { wrapper });
    expect(result.current.ok).toBe(false);
    expect(result.current.reason).toMatch(/failed/i);
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
      <PoolBlockPanel
        context={context}
        applied={config}
        config={config}
        onConfigChange={changed}
        allocation={<span>Allocation 60%</span>}
      />,
    );
    await waitFor(() => expect(action).toHaveBeenCalled());
    await userEvent.setup().click(screen.getByRole("combobox"));
    await userEvent.setup().click(await screen.findByRole("option", { name: /0.3%/ }));
    expect(changed.mock.lastCall?.[0]).toEqual({
      poolId: second.poolId,
      ...presetRange(toLivePoolGrid(toPanelPoolView(second)), 10)!,
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
