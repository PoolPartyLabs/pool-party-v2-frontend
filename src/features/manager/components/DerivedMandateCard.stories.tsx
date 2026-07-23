/**
 * @id PP-MGR-SCR-002
 * Stories for DerivedMandateCard — the read-only "Calculated automatically" card in the strategy
 * builder's Build step. Default = risk + category only (the pre-POO-830 render / flag off). The
 * `WithTags` variants show the POO-830 R5 asset + objective preview (flag on): income, single-sided
 * DCA, and a crypto->crypto rotation (two objectives + two assets).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DerivedMandateCard } from "./DerivedMandateCard";

const meta: Meta<typeof DerivedMandateCard> = {
  title: "Manager/DerivedMandateCard",
  component: DerivedMandateCard,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof DerivedMandateCard>;

/** Flag OFF: risk + category only (exactly the pre-POO-830 card). */
export const RiskAndCategoryOnly: Story = {
  args: { derived: { riskLevel: 3, categoryKey: "blueChip" } },
};

/** Flag ON: a two-sided income strategy (range covers the current price). */
export const WithTagsIncome: Story = {
  args: {
    derived: { riskLevel: 2, categoryKey: "stable" },
    tags: { objectiveTags: ["income"], assetTags: ["stablecoins"], unverified: false },
  },
};

/** Flag ON: a single-sided dollar->crypto position (gradual buy / DCA). */
export const WithTagsGradualBuy: Story = {
  args: {
    derived: { riskLevel: 4, categoryKey: "blueChip" },
    tags: { objectiveTags: ["gradualBuy"], assetTags: ["ethereum"], unverified: false },
  },
};

/** Flag ON: a single-sided crypto->crypto rotation (two objectives + two assets). */
export const WithTagsRotation: Story = {
  args: {
    derived: { riskLevel: 5, categoryKey: "volatile" },
    tags: {
      objectiveTags: ["gradualBuy", "gradualSell"],
      assetTags: ["ethereum", "bitcoin"],
      unverified: false,
    },
  },
};
