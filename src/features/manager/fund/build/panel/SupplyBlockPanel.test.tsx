/**
 * @id PP-MGR-CMP-072
 * @name SupplyBlockPanel tests
 * @implements-rules-version v1 (POO-2194)
 * @analytics-events none, tests observe the shared shell's events
 */
import { describe, expect, it, vi } from "vitest";
import { panelReserveFixtures } from "@/mocks/data/buildPanelFixtures";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog, type MandateCatalog } from "../../mandateCatalog";
import type { BuildPlan } from "../plan/buildPlan";
import { makeTestDraft, TEST_ASSET_KEYS } from "../plan/planTestKit";
import { PanelHarness } from "./panelTestKit";
import { supplyBlockBody } from "./SupplyBlockPanel";
import type { PanelDraftEvent } from "./usePanelDraft";

vi.mock("@/lib/services", () => ({ isMockMode: false }));

function plan(configured = false): BuildPlan {
  return {
    version: 1,
    hub: {
      chains: [
        {
          id: "c",
          sharePct: configured ? 40 : 0,
          steps: [
            {
              id: "b",
              family: "position",
              kind: "aaveSupply",
              config: configured ? { assetKey: TEST_ASSET_KEYS.usdcArbitrum } : null,
            },
          ],
        },
      ],
    },
    spokes: [],
  };
}
function catalog(extra: Partial<MandateCatalog> = {}): MandateCatalog {
  return {
    ...buildMandateCatalog(),
    reserves: panelReserveFixtures(),
    loading: false,
    error: false,
    ...extra,
  };
}
function mount(configured = false, suppliedCatalog = catalog(), draft = makeTestDraft()) {
  const events: PanelDraftEvent[] = [];
  const edit = vi.fn();
  const view = renderWithProviders(
    <PanelHarness
      draft={draft}
      plan={plan(configured)}
      catalog={suppliedCatalog}
      selectedId="b"
      bodies={{ aaveSupply: supplyBlockBody }}
      onEvent={(event) => events.push(event)}
      onEditMandate={edit}
    >
      {(api) => (
        <>
          <output data-testid="applied-plan">{JSON.stringify(api.plan)}</output>
          <button type="button" onClick={() => api.guardLeave(() => {})}>
            Leave test
          </button>
        </>
      )}
    </PanelHarness>,
  );
  return { ...view, events, edit };
}
const panel = () => within(screen.getByRole("region", { name: "Configure block" }));

describe("SupplyBlockPanel", () => {
  // @rule R1 @rule R3 @rule R4 @rule R7
  it("uses live mandate USDC with a canonical config at zero allocation, then shows its APY", async () => {
    const { events } = mount();
    expect(panel().getByText(/Assets in your mandate/)).toHaveTextContent(
      "Assets in your mandate · 2",
    );
    expect(panel().getByText("4.1%")).toBeVisible();
    const use = panel().getAllByRole("button", { name: /^Use / });
    expect(use[0]).toBeEnabled();
    expect(use[1]).toBeDisabled();
    await userEvent.click(panel().getByRole("button", { name: "Use USDC" }));
    const applied = JSON.parse(screen.getByTestId("applied-plan").textContent ?? "{}");
    expect(applied.hub.chains[0]).toMatchObject({
      sharePct: 0,
      steps: [{ config: { assetKey: TEST_ASSET_KEYS.usdcArbitrum } }],
    });
    expect(panel().getByRole("button", { name: "Asset" })).toHaveTextContent("USDC");
    expect(panel().getByText("4.1%")).toBeVisible();
    expect(events).toEqual([{ type: "configured", kind: "aaveSupply", network: "arbitrum" }]);
  });

  // @rule R1
  it("intersects reserves with the mandate and searches by token address", async () => {
    const draft = makeTestDraft();
    draft.aaveV3Reserves = [TEST_ASSET_KEYS.usdcArbitrum.slice("arbitrum:".length)];
    mount(false, catalog(), draft);
    expect(panel().getAllByRole("button", { name: /^Use / })).toHaveLength(1);
    await userEvent.type(
      panel().getByRole("textbox", { name: "Filter by token or address" }),
      "no-such-token",
    );
    expect(panel().queryByRole("button", { name: /^Use / })).toBeNull();
    expect(panel().getByText("No asset in your mandate matches no-such-token")).toBeVisible();
  });

  // @rule R1 @rule R2
  it("shows an empty intersection with a link to edit mandate tokens", async () => {
    const draft = makeTestDraft();
    draft.aaveV3Reserves = [];
    const { edit } = mount(false, catalog(), draft);
    expect(panel().getByText("No Aave asset in your mandate is on Arbitrum")).toBeVisible();
    await userEvent.click(panel().getByRole("button", { name: "Edit mandate · Tokens" }));
    expect(edit).toHaveBeenCalledWith("tokens");
  });

  // @rule R2
  it("shows loading without offering stale reserve rows", () => {
    mount(false, catalog({ loading: true }));
    expect(document.querySelector("[data-panel-pick-loading]")).toBeInTheDocument();
    expect(panel().queryByRole("button", { name: /^Use / })).toBeNull();
  });

  // @rule R2
  it("offers retry on a failed catalog instead of stale Use actions", async () => {
    const retry = vi.fn();
    mount(false, catalog({ error: true, retry }));
    expect(panel().getByRole("alert")).toBeVisible();
    await userEvent.click(panel().getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(panel().queryByRole("button", { name: /^Use / })).toBeNull();
  });

  // @rule R2 @rule R5
  it("blocks unsupported assets even if their catalog reserve is usable", () => {
    const reserves = panelReserveFixtures();
    const weth = reserves[1];
    if (!weth) throw new Error("WETH fixture is required");
    reserves[1] = { ...weth, supplyCap: "0", supplyCapReached: false, available: true };
    mount(false, catalog({ reserves }));
    expect(panel().getByText("Only USDC on Arbitrum is supported for Supply.")).toBeVisible();
    expect(panel().getAllByRole("button", { name: /^Use / })[1]).toBeDisabled();
  });

  // @rule R2 @rule R3
  it.each([
    { loading: true },
    { error: true },
    { reserves: [] },
  ])("blocks Apply after a reserve read becomes unavailable: %o", async (state) => {
    const retry = vi.fn();
    mount(true, catalog({ ...state, retry }));
    panel().getByRole("slider", { name: "Allocation" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(panel().getByRole("button", { name: "Apply changes" })).toBeDisabled();
    if (state.error) {
      await userEvent.click(panel().getByRole("button", { name: "Retry" }));
      expect(retry).toHaveBeenCalledTimes(1);
    }
  });

  // @rule R3 @rule R5
  it("keeps edits local until Apply and has no swap, slippage, Borrow or range controls", async () => {
    const { events } = mount(true);
    const before = screen.getByTestId("applied-plan").textContent;
    const slider = panel().getByRole("slider", { name: "Allocation" });
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByTestId("applied-plan")).toHaveTextContent(before ?? "");
    await userEvent.click(panel().getByRole("button", { name: "Apply changes" }));
    expect(screen.getByTestId("applied-plan").textContent).not.toBe(before);
    expect(events).toEqual([expect.objectContaining({ type: "applied", kind: "aaveSupply" })]);
    expect(panel().queryByText(/Max slippage|Price range|Borrow APY|Swap · auto/)).toBeNull();
  });

  // @rule R3
  it("discards a pending allocation on guarded exit", async () => {
    mount(true);
    const before = screen.getByTestId("applied-plan").textContent;
    panel().getByRole("slider", { name: "Allocation" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(screen.getByRole("button", { name: "Leave test" }));
    await userEvent.click(panel().getByRole("button", { name: "Discard changes" }));
    expect(screen.getByTestId("applied-plan").textContent).toBe(before);
  });
});
