/**
 * @id PP-CORE-CMP-071
 * @name ExecutionCarousel — stories
 * @implements-rules-version v1 (POO-1504 rules v1)
 *
 * The execution surface across the states a real run passes through (Figma `7` `6550:615`, `7c`
 * expanded `7342:766`, `7f` all done `7360:766`, `7i` taking longer `7381:832`).
 *
 * What a story cannot show is the two things that only exist in time: the [R31] ticker between steps
 * and the [R58] line after ten seconds on one. Both are covered by the test suite, and the ticker's
 * timing lives in `globals.css` so it is inspectable there.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ProvisioningStepStatus } from "@/lib/provisioning";
import { ExecutionCarousel } from "./ExecutionCarousel";
import type { PlanRow, PlanView } from "./provisioningView";

function row(over: Partial<PlanRow> & Pick<PlanRow, "key" | "type" | "index">): PlanRow {
  return {
    labelKey: "provisioning.steps.swapToken",
    isOp: false,
    isGas: false,
    isApproval: false,
    status: "idle",
    tokenSymbol: "WETH",
    ...over,
  } as PlanRow;
}

/** The worked example from the spec: convert, bridge, convert, then the operation. */
function view(
  statuses: [ProvisioningStepStatus, ProvisioningStepStatus, ProvisioningStepStatus],
): PlanView {
  return {
    titleKey: "provisioning.plan.title",
    rows: [
      row({ key: "swap-0", type: "swap-token", index: 1, status: statuses[0], tokenSymbol: "ETH" }),
      row({
        key: "bridge-0",
        type: "bridge",
        index: 2,
        status: statuses[1],
        labelKey: "provisioning.steps.bridge",
        networkName: "Arbitrum",
      }),
      row({
        key: "swap-1",
        type: "swap-token",
        index: 3,
        status: statuses[2],
        tokenSymbol: "USDT",
      }),
      row({
        key: "op",
        type: "op",
        index: 4,
        status: "idle",
        isOp: true,
        labelKey: "provisioning.steps.op",
      }),
    ],
  } as PlanView;
}

const meta = {
  title: "Strategies/Provisioning/ExecutionCarousel",
  component: ExecutionCarousel,
  parameters: { layout: "centered" },
  args: { view: view(["done", "active", "idle"]), opLabel: "Invest in Stable Yield" },
  decorators: [
    (Story) => (
      <div className="w-[26rem]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ExecutionCarousel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `7` running: one step in the window, the bridge in flight, the bar at `(1 + 0.5) / 3`. */
export const Running: Story = {};

/** The first step, where the half-step is the only thing keeping the bar off empty ([R23]). */
export const FirstStep: Story = { args: { view: view(["active", "idle", "idle"]) } };

/** `7f` all done: every leg settled, the bar full, and no half left over. */
export const AllDone: Story = { args: { view: view(["done", "done", "done"]) } };

/**
 * `8` step failed. The cause is on the row with the plan's own figures, which is why the headline is
 * free to answer the only question that matters: what happened to my money.
 */
export const StepFailed: Story = {
  args: {
    view: view(["done", "error", "idle"]),
    execution: { routeFailed: true, errorKind: "slippage", slippagePct: 2 },
  },
};

/** A signature step, with [R26]'s disclosure below the window rather than inside the row. */
export const WithSigningDisclosure: Story = {
  args: {
    view: view(["done", "active", "idle"]),
    disclosure: <p className="text-muted-foreground text-xs">What am I signing?</p>,
  },
};
