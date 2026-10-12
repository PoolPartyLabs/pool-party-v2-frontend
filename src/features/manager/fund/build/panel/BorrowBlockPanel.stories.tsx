/**
 * @id PP-MGR-CMP-105
 * @name BorrowBlockPanel stories
 * @implements-rules-version v1 (POO-2334 rules v1)
 * @analytics-events none, stories use the panel harness without analytics
 *
 * The Borrow body in the panel shell, on the [Swap · auto, Supply WETH, Borrow] chain of the plan
 * test kit, with the mock market (PP-MGR-MCK-006): the pick list, a configured block, a warning
 * health factor, the Aave limit (destructive), and a Supply above with no asset yet.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import type { BuildPlan, PositionBlock } from "../plan/buildPlan";
import { makeTestDraft, supplyBorrowPlan, TEST_ASSET_KEYS } from "../plan/planTestKit";
import { borrowBlockBody } from "./BorrowBlockPanel";
import { PanelHarness } from "./panelTestKit";
import { supplyBlockBody } from "./SupplyBlockPanel";

type State = "pick" | "configured" | "warning" | "atLimit" | "noSupply";

const BORROW_PCT: Partial<Record<State, number>> = { configured: 40, warning: 70, atLimit: 80 };

function storyPlan(state: State): BuildPlan {
  const plan = supplyBorrowPlan();
  const chain = plan.hub.chains[0];
  if (!chain) return plan;
  const steps = chain.steps.map((step) => {
    if (step.family !== "position") return step;
    if (step.kind === "aaveSupply" && state === "noSupply")
      return { ...step, config: null } as PositionBlock;
    if (step.kind !== "aaveBorrow") return step;
    const pct = BORROW_PCT[state];
    return {
      ...step,
      config: pct === undefined ? null : { assetKey: TEST_ASSET_KEYS.usdcArbitrum, borrowPct: pct },
    } as PositionBlock;
  });
  return { ...plan, hub: { chains: [{ ...chain, steps }] } };
}

function BorrowStory({ state = "pick" }: { state?: State }) {
  return (
    <div className="w-[360px]">
      <PanelHarness
        draft={makeTestDraft()}
        plan={storyPlan(state)}
        selectedId="hub-aave-borrow"
        bodies={{ aaveSupply: supplyBlockBody, aaveBorrow: borrowBlockBody }}
      />
    </div>
  );
}

const meta = {
  title: "Manager/Fund Build/BorrowBlockPanel",
  component: BorrowStory,
  decorators: [withManagerMessages],
  parameters: { layout: "centered" },
  args: { state: "pick" },
} satisfies Meta<typeof BorrowStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PickAsset: Story = {};
export const Configured: Story = { args: { state: "configured" } };
export const WarningHealthFactor: Story = { args: { state: "warning" } };
export const AtAaveLimit: Story = { args: { state: "atLimit" } };
export const NoSupplyAbove: Story = { args: { state: "noSupply" } };
