/**
 * @id PP-MGR-CMP-091
 * @name ManageBlockHeader stories
 * @implements-rules-version v2 (POO-2272)
 * @analytics-events none, fixture stories.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import deManager from "@/i18n/messages/de/manager.json";
import { mockFund } from "@/mocks/data/v2Funds";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ManageBlockHeader } from "./ManageBlockHeader";
import { normalizeManageModel } from "./manageModel";

const model = normalizeManageModel(mockFund);
const liquidity = model.positions.find((position) => position.kind === "liquidity");
const supply = model.positions.find((position) => position.kind === "supply");
if (!liquidity || !supply) throw new Error("Manage position fixtures missing");

const meta = {
  title: "Manager/Fund Manage/ManageBlockHeader",
  component: ManageBlockHeader,
  decorators: [withManagerMessages],
  args: { position: liquidity },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ManageBlockHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Liquidity: Story = {};
export const Supply: Story = { args: { position: supply } };
export const CollectPair: Story = { args: { subtitle: "USDG / WETH" } };
export const NarrowGerman: Story = {
  args: { position: { ...liquidity, protocol: "Uniswap V4" } },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={{ manager: deManager }}>
        <div className="w-[240px] rounded-2xl border border-border bg-surface p-4">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};
