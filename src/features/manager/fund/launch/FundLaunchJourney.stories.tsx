/**
 * @id PP-MGR-CMP-081 (POO-2212)
 * @name FundLaunchJourney.stories
 * @implements-rules-version v1
 * @analytics-events none, isolated presentation with no wallet or API calls
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { type FundLaunchJourneyState, FundLaunchJourneyView } from "./FundLaunchJourney";

const kinds = [
  "approve",
  "create",
  "discover",
  "spoke",
  "profile",
  "allocate",
  "open",
  "report",
  "bridge",
  "arrival",
  "swap",
  "open",
] as const;
const steps: FundLaunchJourneyState["steps"] = kinds.map((kind, index) => ({
  id: `${kind}-${index}`,
  kind,
  chain: index === 3 || index >= 9 ? 4663 : 42161,
  chainId: index === 3 || index >= 9 ? 4663 : 42161,
  dependencies: [],
  label: `manager.fundLaunch.${kind}`,
  status: index < 2 ? "confirmed" : "idle",
  txHash: null,
  explorerUrl: null,
  receiptStatus: null,
  error: null,
  waitReason: null,
  result: null,
}));
// PP-MOCK: presentation-only states. These callbacks never access a wallet, storage or network.
const launch: FundLaunchJourneyState = {
  steps,
  addresses: {},
  journey: { draft: { review: { name: "Arbitrum income fund", imageUrl: "" } } },
  journal: {},
  loadingError: false,
  ready: true,
  busy: false,
  error: null,
  outcome: "in-progress",
  sign: async () => {},
  resume: async () => {},
  retry: async () => {},
  cancel: () => {},
};
const meta = {
  title: "Manager/Fund builder/Launch journey",
  component: FundLaunchJourneyView,
  decorators: [withManagerMessages],
  args: { launch },
} satisfies Meta<typeof FundLaunchJourneyView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ReadyWithLongHistory: Story = {};
export const Signing: Story = {
  args: {
    launch: {
      ...launch,
      busy: true,
      steps: steps.map((step, index) => (index === 2 ? { ...step, status: "signing" } : step)),
    },
  },
};
export const WaitingForReport: Story = {
  args: {
    launch: {
      ...launch,
      busy: true,
      steps: steps.map((step, index) => ({
        ...step,
        status: index < 7 ? "confirmed" : index === 7 ? "waiting" : "idle",
      })),
    },
  },
};
export const RecoverableFailure: Story = {
  args: {
    launch: {
      ...launch,
      outcome: "failed",
      error: { code: "BALANCE_CHANGED", messageKey: "fundLaunch.partialFailure" },
    },
  },
};
export const Completed: Story = {
  args: {
    launch: {
      ...launch,
      outcome: "completed",
      steps: steps.map((step) => ({ ...step, status: "confirmed" })),
    },
  },
};
