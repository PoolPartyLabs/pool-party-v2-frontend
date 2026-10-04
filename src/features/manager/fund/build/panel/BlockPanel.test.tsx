/**
 * @id PP-MGR-CMP-061
 * @name BlockPanel tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, the panel reports through its draft and `onLimitHit`; these tests read
 *   those streams
 *
 * The configuration panel shell (handoff "Panel shell", Modes 1 to 4, P2, P5 to P8, P10), mounted
 * through `PanelHarness`: the real plan hook, selection and draft, the real `BlockPanel` in its
 * frame, with the FIXTURE bodies (the real Uniswap v4 and Supply bodies are their own slices).
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../../tests/utils/renderWithProviders";
import type { MandateDraft } from "../../mandateDraft";
import { fullRangeTicks } from "../plan/blockConfig";
import type { BuildPlan, PoolBlockConfig } from "../plan/buildPlan";
import {
  hubPoolPlan,
  makeTestDraft,
  supplyBorrowPlan,
  TEST_POOL_IDS,
  withCompletePools,
} from "../plan/planTestKit";
import { makeRealModeDraft, REAL_POOL_ID, realPoolRow } from "../plan/realPoolTestKit";
import type { PanelBodyDefinition } from "./panelBodies";
import {
  fixtureHeldPoolBody,
  fixtureLimitedSupplyBody,
  fixturePoolBody,
  fixtureSupplyBody,
} from "./panelFixtures";
import { PanelHarness } from "./panelTestKit";
import type { PanelDraftEvent } from "./usePanelDraft";

/** A hub chain with one empty block of a kind, at 0%. */
function emptyPlan(kind: "uniswapV4Pool" | "aaveSupply" | "aaveBorrow"): BuildPlan {
  return {
    version: 1,
    hub: {
      chains: [
        {
          id: "c",
          sharePct: 0,
          steps: [
            ...(kind === "uniswapV4Pool"
              ? [{ id: "s", family: "flow" as const, kind: "swap" as const, auto: true }]
              : []),
            { id: "b", family: "position", kind, config: null },
          ],
        },
      ],
    },
    spokes: [],
  };
}

function region(): HTMLElement {
  return screen.getByRole("region", { name: "Configure block" });
}

function mount(
  plan: BuildPlan,
  selectedId: string | null,
  extra: Partial<Parameters<typeof PanelHarness>[0]> = {},
  draft: MandateDraft = makeTestDraft(),
) {
  const events: PanelDraftEvent[] = [];
  const onEditMandate = vi.fn();
  const onLimitHit = vi.fn();
  renderWithProviders(
    <PanelHarness
      draft={draft}
      plan={plan}
      selectedId={selectedId}
      onEvent={(event) => events.push(event)}
      onEditMandate={onEditMandate}
      onLimitHit={onLimitHit}
      {...extra}
    />,
  );
  return { events, onEditMandate, onLimitHit };
}

describe("BlockPanel: Mode 1, nothing selected", () => {
  it("[Mode 1] says nothing is selected, with the canvas batch's body", () => {
    mount(hubPoolPlan(), null);
    expect(within(region()).getByText("Nothing selected")).toBeInTheDocument();
    expect(within(region()).getByText(/^Add a protocol or a network on the canvas/)).toBeVisible();
  });

  it.each([
    "Choose a protocol in the menu. The block is added on Arbitrum and opens here.",
    "Choose what comes after Supply WETH. A Borrow block uses that supply as its collateral.",
  ])("[Mode 1] while a menu is open, its sentence is the body: %s", (sentence) => {
    mount(hubPoolPlan(), null, { menuSentence: sentence });
    expect(within(region()).getByText(sentence)).toBeInTheDocument();
  });
});

describe("BlockPanel: the head (P2)", () => {
  it("[P2] protocol, block type and the read-only network chip with its tooltip", () => {
    // @rule P2
    mount(emptyPlan("uniswapV4Pool"), "b");
    expect(within(region()).getByText("Uniswap v4")).toBeInTheDocument();
    expect(within(region()).getByText("Liquidity position · no pool yet")).toBeInTheDocument();
    const chip = region().querySelector<HTMLElement>("[data-network-chip]");
    expect(chip).toHaveTextContent("Arbitrum");
    expect(chip).toHaveAccessibleDescription(
      "This block is on Arbitrum. A block takes the network of the place it sits in on the canvas.",
    );
    // Read only: the chip is not a control.
    expect(within(region()).queryByRole("button", { name: /Arbitrum/ })).toBeNull();
  });

  it("a kind with no body shows the head and Remove block only", () => {
    mount(supplyBorrowPlan(), "hub-aave-borrow");
    expect(within(region()).getByText("Borrow")).toBeInTheDocument();
    expect(within(region()).getByRole("button", { name: "Remove block" })).toBeInTheDocument();
    expect(within(region()).queryByRole("button", { name: "Apply changes" })).toBeNull();
  });
});

describe("BlockPanel: Modes 2 and 3, pick from the mandate", () => {
  it("[Mode 2, P1] lists the mandate's items of the block's network, then Remove block", () => {
    // @rule P1
    mount(emptyPlan("uniswapV4Pool"), "b");
    expect(within(region()).getByText("Pools in your mandate ·")).toBeInTheDocument();
    // The Arbitrum pool only: the Robinhood Chain pool of the mandate is another network.
    expect(within(region()).getAllByRole("button", { name: /^Use / })).toHaveLength(1);
    expect(within(region()).getByRole("button", { name: "Remove block" })).toBeInTheDocument();
  });

  it("[Mode 2] the link back goes to the Mandate step through the leave guard", async () => {
    // @rule P1
    const { onEditMandate } = mount(emptyPlan("aaveSupply"), "b");
    await userEvent.click(within(region()).getByRole("button", { name: "Edit mandate · Tokens" }));
    expect(onEditMandate).toHaveBeenCalledWith("tokens");
  });

  it("[Mode 3] a filter with no match shows the box", async () => {
    mount(emptyPlan("uniswapV4Pool"), "b");
    await userEvent.type(
      within(region()).getByRole("textbox", { name: "Filter by token or address" }),
      "PEPE",
    );
    expect(within(region()).getByText("No pool in your mandate has PEPE")).toBeInTheDocument();
  });

  it("[P7, DP1] Use opens Mode 4 with everything applied and nothing to apply", async () => {
    // @rule P7
    // @rule DP1
    const { events } = mount(emptyPlan("aaveSupply"), "b");
    await userEvent.click(within(region()).getByRole("button", { name: "Use USDC" }));
    expect(within(region()).getByText("All changes applied")).toBeInTheDocument();
    expect(within(region()).getByRole("button", { name: "Apply changes" })).toBeDisabled();
    expect(within(region()).getByRole("slider", { name: "Allocation" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(events).toEqual([{ type: "configured", kind: "aaveSupply", network: "arbitrum" }]);
  });
});

describe("BlockPanel: Mode 4, configured (P5, P6, P8)", () => {
  it("[P5] an edit shows Changes not applied and enables Apply changes", async () => {
    // @rule P5
    // @rule DP7
    mount(withCompletePools(hubPoolPlan()), "hub-pool-pool");
    const slider = within(region()).getByRole("slider", { name: "Allocation" });
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(within(region()).getByText("Changes not applied")).toBeInTheDocument();
    const apply = within(region()).getByRole("button", { name: "Apply changes" });
    expect(apply).toBeEnabled();
    await userEvent.click(apply);
    expect(within(region()).getByText("All changes applied")).toBeInTheDocument();
  });

  it("[P6] a refused way out turns the row into the notice, and Discard changes completes it", async () => {
    // @rule P6
    const proceed = vi.fn();
    renderWithProviders(
      <PanelHarness
        draft={makeTestDraft()}
        plan={withCompletePools(hubPoolPlan())}
        selectedId="hub-pool-pool"
      >
        {(api) => (
          <button type="button" onClick={() => api.guardLeave(proceed)}>
            leave
          </button>
        )}
      </PanelHarness>,
    );
    within(region()).getByRole("slider", { name: "Allocation" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.click(screen.getByRole("button", { name: "leave" }));
    const notice = within(region()).getByRole("alert");
    expect(notice).toHaveFocus();
    expect(proceed).not.toHaveBeenCalled();
    await userEvent.click(within(notice).getByRole("button", { name: "Discard changes" }));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(within(region()).getByText("All changes applied")).toBeInTheDocument();
  });

  it("[P8] the strategy's room stops the slider and names what the others take", async () => {
    // @rule P8
    const plan = withCompletePools(hubPoolPlan());
    plan.hub.chains.push({
      id: "other",
      sharePct: 35,
      steps: [{ id: "o", family: "position", kind: "aaveSupply", config: null }],
    });
    const { onLimitHit } = mount(plan, "hub-pool-pool");
    const slider = within(region()).getByRole("slider", { name: "Allocation" });
    expect(slider).toHaveAttribute("aria-valuemax", "65");
    slider.focus();
    await userEvent.keyboard("{End}");
    expect(
      within(region()).getByText(
        "Maximum reached. The other blocks under Idle input already take 35%.",
      ),
    ).toBeInTheDocument();
    expect(within(region()).queryByRole("button", { name: "Edit mandate · Limits" })).toBeNull();
    expect(onLimitHit).toHaveBeenCalledWith("uniswapV4Pool", "strategyRoom");
  });

  it("[P8] a network cap names the network and links to Limits", async () => {
    // @rule P8
    const spoke: BuildPlan = {
      version: 1,
      hub: { chains: [] },
      spokes: [
        {
          network: "robinhood",
          sharePct: 20,
          chains: [
            {
              id: "rh",
              sharePct: 20,
              steps: [{ id: "rh-supply", family: "position", kind: "aaveSupply", config: null }],
            },
          ],
        },
      ],
    };
    // Robinhood Chain is capped at 50% in the test mandate: Use, then push to the cap.
    const { onLimitHit, onEditMandate } = mount(spoke, "rh-supply");
    await userEvent.click(within(region()).getByRole("button", { name: "Use USDG" }));
    within(region()).getByRole("slider", { name: "Allocation" }).focus();
    await userEvent.keyboard("{End}");
    expect(
      within(region()).getByText("Maximum reached. Your mandate caps Robinhood Chain at 50%."),
    ).toBeInTheDocument();
    expect(onLimitHit).toHaveBeenCalledWith("aaveSupply", "networkCap");
    await userEvent.click(within(region()).getByRole("button", { name: "Apply changes" }));
    await userEvent.click(within(region()).getByRole("button", { name: "Edit mandate · Limits" }));
    expect(onEditMandate).toHaveBeenCalledWith("limits");
  });
});

/** A full-range pool config on a spacing of 10, for the pool `poolId`. */
function fullPool(poolId: string): PoolBlockConfig {
  const full = fullRangeTicks(10);
  if (!full) throw new Error("fixture");
  return { poolId, ...full, fullRange: true, displayInverted: false, slippagePct: 2 };
}

/** A pool body whose Use writes `useId`, and whose Fields can write `breakId`. */
function idBody(useId: string, breakId?: string): PanelBodyDefinition<PoolBlockConfig> {
  return {
    usePick(context) {
      const model = fixturePoolBody.usePick(context);
      return {
        ...model,
        rows: model.rows.slice(0, 1).map((row) => ({ ...row, config: fullPool(useId) })),
      };
    },
    Fields({ config, onConfigChange, allocation }) {
      return (
        <>
          {allocation}
          {breakId ? (
            <button type="button" onClick={() => onConfigChange({ ...config, poolId: breakId })}>
              break
            </button>
          ) : null}
        </>
      );
    },
  };
}

/** The applied plan, as the harness hands it out. */
function PlanProbe({ plan }: { plan: BuildPlan }) {
  return <output data-testid="plan">{JSON.stringify(plan)}</output>;
}

function appliedPlan(): BuildPlan {
  return JSON.parse(screen.getByTestId("plan").textContent ?? "{}") as BuildPlan;
}

describe("BlockPanel: what the review of PR #54 asked for (M1 to M4, L6)", () => {
  it("[M1, P13] a body's apply gate holds Apply changes and the status row says why", async () => {
    // @rule M1
    // @rule P13
    mount(withCompletePools(hubPoolPlan()), "hub-pool-pool", {
      bodies: { uniswapV4Pool: fixtureHeldPoolBody },
    });
    within(region()).getByRole("slider", { name: "Allocation" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(within(region()).getByText("Changes not applied")).toBeInTheDocument();
    expect(within(region()).getByRole("button", { name: "Apply changes" })).toBeDisabled();
    expect(within(region()).getByText("Waiting for the live pool price.")).toBeInTheDocument();
  });

  it("[M2] a pick row that cannot be used says why and cannot be used", () => {
    // @rule M2
    mount(emptyPlan("aaveSupply"), "b", { bodies: { aaveSupply: fixtureLimitedSupplyBody } });
    const rows = within(region()).getAllByRole("button", { name: /^Use / });
    expect(rows[0]).toBeEnabled();
    expect(rows[1]).toBeDisabled();
    expect(within(region()).getByText("Supply cap reached")).toBeInTheDocument();
  });

  it("[M3] Use lands a real row's id as its bare PoolId, whatever the body wrote", async () => {
    // @rule M3
    const row = realPoolRow();
    const draft = makeRealModeDraft();
    const plan: BuildPlan = {
      version: 1,
      hub: {
        chains: [
          {
            id: "c",
            sharePct: 0,
            steps: [{ id: "b", family: "position", kind: "uniswapV4Pool", config: null }],
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
        bodies={{ uniswapV4Pool: idBody(row.id) }}
      >
        {(api) => <PlanProbe plan={api.plan} />}
      </PanelHarness>,
    );
    await userEvent.click(
      within(region()).getAllByRole("button", { name: /^Use / })[0] as HTMLElement,
    );
    const stored = appliedPlan().hub.chains[0]?.steps.find((step) => step.family === "position");
    expect(stored).toMatchObject({ config: { poolId: REAL_POOL_ID } });
    expect(within(region()).getByText("All changes applied")).toBeInTheDocument();
  });

  it("[M3] an id in another case is not an edit", async () => {
    // @rule M3
    mount(withCompletePools(hubPoolPlan()), "hub-pool-pool", {
      bodies: {
        uniswapV4Pool: idBody(TEST_POOL_IDS.arbitrum, TEST_POOL_IDS.arbitrum.toUpperCase()),
      },
    });
    await userEvent.click(within(region()).getByRole("button", { name: "break" }));
    expect(within(region()).getByText("All changes applied")).toBeInTheDocument();
  });

  it("[M4] a refused Apply says why, and the next edit clears it", async () => {
    // @rule M4
    const { events } = mount(withCompletePools(hubPoolPlan()), "hub-pool-pool", {
      bodies: { uniswapV4Pool: idBody(TEST_POOL_IDS.arbitrum, "0xnot-in-the-mandate") },
    });
    await userEvent.click(within(region()).getByRole("button", { name: "break" }));
    await userEvent.click(within(region()).getByRole("button", { name: "Apply changes" }));
    expect(within(region()).getByRole("alert")).toHaveTextContent(
      "This pool or asset is no longer in your mandate on this network.",
    );
    expect(events).toEqual([{ type: "blocked", reason: "not_in_mandate" }]);
    within(region()).getByRole("slider", { name: "Allocation" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(within(region()).queryByRole("alert")).toBeNull();
  });

  it("[M4] a refused Use says why, under the list", async () => {
    // @rule M4
    mount(emptyPlan("uniswapV4Pool"), "b", {
      bodies: { uniswapV4Pool: idBody("0xnot-in-the-mandate") },
    });
    await userEvent.click(
      within(region()).getAllByRole("button", { name: /^Use / })[0] as HTMLElement,
    );
    expect(within(region()).getByRole("alert")).toHaveTextContent(
      "This pool or asset is no longer in your mandate on this network.",
    );
    expect(within(region()).getByText("Pools in your mandate ·")).toBeInTheDocument();
  });

  it("[L6] after Use focus goes to the first field, after Cancel back to Remove block", async () => {
    // @rule L6
    mount(emptyPlan("aaveSupply"), "b", { bodies: { aaveSupply: fixtureSupplyBody } });
    await userEvent.click(within(region()).getByRole("button", { name: "Use USDC" }));
    expect(within(region()).getByRole("button", { name: "Asset" })).toHaveFocus();
    await userEvent.click(within(region()).getByRole("button", { name: "Remove block" }));
    await userEvent.click(within(region()).getByRole("button", { name: "Cancel" }));
    expect(within(region()).getByRole("button", { name: "Remove block" })).toHaveFocus();
  });
});

describe("BlockPanel: Remove block (P10)", () => {
  it("[P10] Remove block turns into the confirm, under Apply changes", async () => {
    // @rule P10
    mount(withCompletePools(hubPoolPlan()), "hub-pool-pool");
    await userEvent.click(within(region()).getByRole("button", { name: "Remove block" }));
    expect(within(region()).getByText("Remove WETH / USDC?")).toBeInTheDocument();
    expect(
      within(region()).getByText(
        "Its 60% goes back to Idle input. Its Swap · auto step is removed with it.",
      ),
    ).toBeInTheDocument();
    expect(within(region()).getByRole("button", { name: "Apply changes" })).toBeInTheDocument();
    await userEvent.click(within(region()).getByRole("button", { name: "Remove block" }));
    expect(within(region()).getByText("Nothing selected")).toBeInTheDocument();
  });

  it("[P10] an empty block's confirm asks only 'Remove this block?'", async () => {
    // @rule P10
    mount(emptyPlan("aaveSupply"), "b");
    await userEvent.click(within(region()).getByRole("button", { name: "Remove block" }));
    expect(within(region()).getByText("Remove this block?")).toBeInTheDocument();
    await userEvent.click(within(region()).getByRole("button", { name: "Cancel" }));
    expect(within(region()).queryByText("Remove this block?")).toBeNull();
  });
});
