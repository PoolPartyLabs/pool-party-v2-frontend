/**
 * @id PP-MGR-CMP-093 (POO-2275)
 * @name ManageIdleOutputPanel stories
 * @implements-rules-version v1
 * @analytics-events none, explicit presentation fixtures only.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ManageIdleOutputPanel } from "./ManageIdleOutputPanel";
import type {
  IdleQueueAmounts,
  ManageIdleOutputOrigin,
  ManageIdleOutputRead,
} from "./manageIdleOutput";

// PP-MOCK: illustrative queue presentation. No API contract or deployed data is claimed.
const token = {
  chainId: 42161,
  address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  symbol: "USDC",
  decimals: 6,
};
const origin: ManageIdleOutputOrigin = { core: `0x${"a".repeat(40)}`, hubChainId: 42161, token };
function amounts(
  cohortId: string,
  requested: string,
  reserved: string,
  stillNeeded: string,
): IdleQueueAmounts {
  const quantity = (raw: string) => ({ raw, cohortId });
  return {
    cohortId,
    requested: quantity(requested),
    reserved: quantity(reserved),
    stillNeeded: quantity(stillNeeded),
  };
}
const read: ManageIdleOutputRead = {
  core: origin.core,
  hubChainId: 42161,
  status: "ready",
  snapshot: {
    token,
    asOf: "2026-10-07T09:00:00Z",
    timezone: "UTC",
    freshness: "fresh",
    complete: true,
    confirmedEmpty: false,
    summary: amounts("eligible", "25000000000", "10000000000", "15000000000"),
    buckets: [
      {
        id: "today",
        date: "2026-10-07",
        relation: "today",
        deadlines: ["2026-10-07T18:00:00Z"],
        requestStates: [],
        amounts: amounts("today", "12000000000", "10000000000", "2000000000"),
      },
      {
        id: "tomorrow",
        date: "2026-10-08",
        relation: "tomorrow",
        deadlines: [],
        requestStates: [],
        amounts: amounts("tomorrow", "8000000000", "0", "8000000000"),
      },
      {
        id: "after",
        date: "2026-10-09",
        relation: "dayAfterTomorrow",
        deadlines: [],
        requestStates: [],
        amounts: amounts("after", "5000000000", "0", "5000000000"),
      },
    ],
  },
};
const snapshot = read.snapshot;
if (!snapshot?.summary || !snapshot.buckets[0] || !snapshot.buckets[1])
  throw new Error("missing story fixture");
const first = snapshot.buckets[0],
  second = snapshot.buckets[1],
  summary = snapshot.summary;
const meta = {
  title: "Manager/Fund Manage/ManageIdleOutputPanel",
  component: ManageIdleOutputPanel,
  decorators: [
    withManagerMessages,
    (Story) => (
      <div className="w-[360px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { origin, read, onBack: () => {}, onRetry: () => {} },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ManageIdleOutputPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Loading: Story = { args: { read: { ...read, status: "loading" } } };
export const ReadError: Story = { args: { read: { ...read, status: "error" } } };
export const Unavailable: Story = {
  args: { read: { ...read, status: "unavailable", snapshot: null } },
};
export const UnknownFreshness: Story = {
  args: { read: { ...read, snapshot: { ...snapshot, freshness: "unknown" } } },
};
export const Stale: Story = {
  args: { read: { ...read, snapshot: { ...snapshot, freshness: "stale" } } },
};
export const ConfirmedEmpty: Story = {
  args: {
    read: { ...read, snapshot: { ...snapshot, confirmedEmpty: true, buckets: [], summary: null } },
  },
};
export const ConfirmedZero: Story = {
  args: {
    read: {
      ...read,
      snapshot: { ...snapshot, buckets: [], summary: amounts("eligible", "0", "0", "0") },
    },
  },
};
export const Partial: Story = {
  args: {
    read: {
      ...read,
      snapshot: {
        ...snapshot,
        complete: false,
        summary: { ...summary, reserved: null, stillNeeded: null },
      },
    },
  },
};
export const OverdueLaterAndMultipleDeadlines: Story = {
  args: {
    read: {
      ...read,
      snapshot: {
        ...snapshot,
        buckets: [
          {
            ...first,
            id: "overdue",
            relation: "overdue",
            date: "2026-10-06",
            deadlines: ["2026-10-06T12:00:00Z", "2026-10-06T18:00:00Z"],
            requestStates: ["partiallyPaid", "canceled", "inFlight"],
          },
          { ...second, id: "later", relation: "later", date: "2026-10-21" },
        ],
      },
    },
  },
};
export const LongExactAmounts: Story = {
  args: {
    read: {
      ...read,
      snapshot: {
        ...snapshot,
        summary: amounts("eligible", "900719925474099312345678", "1", "900719925474099312345677"),
      },
    },
  },
};
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-[240px] max-w-full">
        <Story />
      </div>
    ),
  ],
};
