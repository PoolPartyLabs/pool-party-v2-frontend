/**
 * @id PP-MGR-CMP-029
 * Stories for AllocationCard — the manage-detail deployed-capital breakdown (Uniswap protocol badge +
 * per-token rows). POO-739 adds the protocol + per-token logos. The global preview decorator only
 * loads the `common` namespace, so these stories supply `manager` (and `common`) via a scoped provider.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/i18n/messages/en/common.json";
import enManager from "@/i18n/messages/en/manager.json";
import { AllocationCard } from "./AllocationCard";

const meta: Meta<typeof AllocationCard> = {
  title: "Manager/AllocationCard",
  component: AllocationCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{ common: enCommon, manager: enManager }}>
        <div className="max-w-md">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof AllocationCard>;

/** POO-739: the Uniswap protocol badge + per-token rows with logos, on Arbitrum. */
export const WithLogos: Story = {
  args: {
    allocation: {
      protocols: [{ label: "Uniswap v3", pct: 100 }],
      tokens: [
        { label: "ETH", pct: 62 },
        { label: "USDC", pct: 38 },
      ],
    },
    network: "arbitrum",
  },
};

/** Non-major tokens on Polygon: unresolved token logos fall back to the symbol-initial chip. */
export const NonMajorTokens: Story = {
  args: {
    allocation: {
      protocols: [{ label: "Uniswap v3", pct: 100 }],
      tokens: [
        { label: "WPOL", pct: 55 },
        { label: "USDC", pct: 45 },
      ],
    },
    network: "polygon",
  },
};
