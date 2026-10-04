/**
 * @id PP-MGR-CMP-072
 * @name SupplyBlockPanel stories
 * @implements-rules-version v1 (POO-2194)
 * @analytics-events none, stories use the panel harness without analytics
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { buildMandateCatalog } from "../../mandateCatalog";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import type { BuildPlan } from "../plan/buildPlan";
import { makeTestDraft, TEST_ASSET_KEYS } from "../plan/planTestKit";
import { PanelHarness } from "./panelTestKit";
import { supplyBlockBody } from "./SupplyBlockPanel";

type State = "pick" | "configured" | "pending" | "loading" | "failure" | "empty" | "unavailable";

function SupplyStory({ state = "pick" }: { state?: State }) {
  const draft = makeTestDraft();
  if (state === "empty") draft.aaveV3Reserves = [];
  const configured = ["configured", "pending", "unavailable"].includes(state);
  const plan: BuildPlan = {
    version: 1,
    hub: {
      chains: [
        {
          id: "chain",
          sharePct: configured ? 40 : 0,
          steps: [
            {
              id: "supply",
              family: "position",
              kind: "aaveSupply",
              config: configured
                ? {
                    assetKey:
                      state === "unavailable"
                        ? TEST_ASSET_KEYS.wethArbitrum
                        : TEST_ASSET_KEYS.usdcArbitrum,
                  }
                : null,
            },
          ],
        },
      ],
    },
    spokes: [],
  };
  return (
    <div className="w-[360px]">
      <PanelHarness
        draft={draft}
        plan={plan}
        selectedId="supply"
        catalog={{
          ...buildMandateCatalog(),
          loading: state === "loading",
          error: state === "failure",
          retry: () => {},
        }}
        bodies={{ aaveSupply: supplyBlockBody }}
        scenario={state === "pending" ? { share: 45 } : undefined}
      />
    </div>
  );
}

const meta = {
  title: "Manager/Fund Build/SupplyBlockPanel",
  component: SupplyStory,
  decorators: [withManagerMessages],
  parameters: { layout: "centered" },
  args: { state: "pick" },
} satisfies Meta<typeof SupplyStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PickAsset: Story = {};
export const Configured: Story = { args: { state: "configured" } };
export const PendingAllocation: Story = { args: { state: "pending" } };
export const Loading: Story = { args: { state: "loading" } };
export const FailedRead: Story = { args: { state: "failure" } };
export const EmptyMandate: Story = { args: { state: "empty" } };
export const UnavailableReserve: Story = { args: { state: "unavailable" } };
