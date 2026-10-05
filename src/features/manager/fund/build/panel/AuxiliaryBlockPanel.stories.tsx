/**
 * @id PP-MGR-CMP-087
 * @name AuxiliaryBlockPanel stories
 * @implements-rules-version v1 (POO-2237)
 * @analytics-events none, isolated draft playground.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { makeDescribeContext } from "../blocks/blockTestKit";
import { useBlockSelection } from "../blocks/useBlockSelection";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { applyPanelConfig } from "../plan/auxiliaryConfig";
import { isPlanBlocked } from "../plan/buildPlan";
import { hubPoolPlan, makeTestContext, spokePoolPlan } from "../plan/planTestKit";
import { AuxiliaryBlockPanel } from "./AuxiliaryBlockPanel";
import { panelTarget, usePanelDraft } from "./usePanelDraft";

function Playground({ kind }: { kind: "swap" | "spoke" }) {
  const [plan, setPlan] = useState(() => {
    const value = kind === "spoke" ? spokePoolPlan() : hubPoolPlan();
    const swap = value.hub.chains[0]?.steps[0];
    if (swap?.family === "flow") swap.auto = false;
    return value;
  });
  const selection = useBlockSelection(kind === "spoke" ? "spoke:robinhood" : "hub-pool-swap");
  const target = panelTarget(plan, selection.selectedId);
  const panel = usePanelDraft({
    target,
    registerGuard: selection.registerGuard,
    onEvent: () => {},
    applyBlockConfig: (id, config, share) => {
      const result = applyPanelConfig(plan, makeTestContext(), id, config, share);
      if (isPlanBlocked(result)) return { ok: false, blocked: result.blocked };
      setPlan(result);
      return { ok: true };
    },
  });
  return target ? (
    <BuildPanelSlot>
      <AuxiliaryBlockPanel
        target={target}
        panel={panel}
        ctx={makeDescribeContext(plan)}
        onEditMandate={() => {}}
        onRemoveRequest={() => {}}
      />
    </BuildPanelSlot>
  ) : null;
}
const meta = {
  title: "Manager/Fund builder/Build panel/AuxiliaryBlockPanel",
  component: Playground,
  decorators: [withManagerMessages],
  parameters: { layout: "padded" },
  args: { kind: "swap" },
} satisfies Meta<typeof Playground>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ManualSwap: Story = {};
export const SpokeAllocation: Story = { args: { kind: "spoke" } };
