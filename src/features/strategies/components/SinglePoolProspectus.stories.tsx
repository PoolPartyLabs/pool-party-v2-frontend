/**
 * @id PP-STR-CMP-017
 * Stories for SinglePoolProspectus — the Composition + Investment-mandate cards derived from the pool
 * pair, shared by the manager + investor strategy detail. POO-739 adds token/protocol/network logos.
 * The global preview decorator only loads the `common` namespace, so these stories supply `strategies`
 * (and `common`) via a scoped provider.
 * POO-903: both cards start COLLAPSED (per-visit state) — expand them from their headers to inspect
 * the bodies in the workbench.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/i18n/messages/en/common.json";
import enStrategies from "@/i18n/messages/en/strategies.json";
import { SinglePoolProspectus } from "./SinglePoolProspectus";

const meta: Meta<typeof SinglePoolProspectus> = {
  title: "Strategies/SinglePoolProspectus",
  component: SinglePoolProspectus,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{ common: enCommon, strategies: enStrategies }}>
        <div className="flex max-w-md flex-col gap-4">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof SinglePoolProspectus>;

/** POO-739: pair-token + Uniswap + network logos, on Arbitrum. */
export const WithLogos: Story = {
  args: { tokens: { token0: "ETH", token1: "USDC" }, networkName: "Arbitrum", network: "arbitrum" },
};

/** POO-897 [R1]/[R8]: the per-token proportion: two token rows over a proportional two-tone bar. */
export const WithSplit: Story = {
  args: {
    tokens: { token0: "ETH", token1: "USDC" },
    networkName: "Arbitrum",
    network: "arbitrum",
    split: { pct0: 72.4, pct1: 27.6 },
  },
};

/** POO-897 [R3]: an out-of-range position renders 0/100 truthfully (same as manager Allocation). */
export const OutOfRangeSplit: Story = {
  args: {
    tokens: { token0: "ETH", token1: "USDC" },
    networkName: "Arbitrum",
    network: "arbitrum",
    split: { pct0: 0, pct1: 100 },
  },
};

/** A non-major pair on Polygon: unresolved token logos fall back to the symbol-initial chip. */
export const NonMajorPair: Story = {
  args: { tokens: { token0: "WPOL", token1: "USDC" }, networkName: "Polygon", network: "polygon" },
};

/** Unknown pair → the "not available" note in both cards (no fabricated data). */
export const NotAvailable: Story = {
  args: { tokens: null },
};
