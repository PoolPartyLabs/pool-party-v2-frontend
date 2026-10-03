/**
 * @id PP-MGR-CMP-063 (POO-2172)
 * @name FundReviewFormStories
 * @implements-rules-version v1
 * Review and checkpoint states without a connected wallet or broadcast.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { createJournal } from "./journal";
import type { LaunchStep } from "./plan";
import { FundReviewForm } from "./ReviewForm";

const steps: LaunchStep[] = [
  { id: "create", kind: "create", chain: 42161, dependencies: [] },
  { id: "report", kind: "report", chain: 42161, dependencies: ["create"] },
];
const review = {
  name: "Stable income strategy",
  description: "Aave supply with liquidity on Arbitrum and Robinhood Chain.",
  imageUrl: "",
  performanceFeeBps: 2000,
  managementFeeBps: 0,
  payoutFeeBps: 200,
  minimum: "100",
  seed: "100",
};
const meta = {
  title: "Manager/Fund/Review",
  component: FundReviewForm,
  args: {
    initial: review,
    balance: BigInt("1000000000"),
    steps,
    journal: null,
    busy: false,
    gap: false,
    onBack: () => {},
    onLaunch: async () => {},
    onUpload: async () => "https://cdn.example.test/logo.png",
  },
} satisfies Meta<typeof FundReviewForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const ExecutionGap: Story = { args: { gap: true } };
const journal = createJournal("story-draft", `0x${"12".repeat(20)}`, { review }, steps);
journal.checkpoints.create = {
  stepId: "create",
  chain: 42161,
  status: "confirmed",
  receiptStatus: "success",
  txHash: `0x${"ab".repeat(32)}`,
};
journal.checkpoints.report = { stepId: "report", chain: 42161, status: "waiting" };
export const WaitingForReport: Story = { args: { journal } };
