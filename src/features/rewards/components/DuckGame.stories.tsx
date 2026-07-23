/**
 * @id PP-REW-MOD-001 (POO-210)
 * @name DuckGame — stories
 *
 * The carnival Duck Shoot mini-game. In Storybook isMockMode is on, so the play
 * resolves via the mock rewardsService (no wallet needed). Wrapped in a
 * rewards-scoped NextIntlClientProvider since the game uses the rewards namespace.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import enRewards from "@/i18n/messages/en/rewards.json";
import { DuckGame } from "./DuckGame";

const meta = {
  title: "Rewards/DuckGame",
  component: DuckGame,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{ rewards: enRewards }}>
        <div style={{ width: 480 }}>
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
} satisfies Meta<typeof DuckGame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The player has tries: the Start button + odds legend are shown. */
export const WithTries: Story = {
  args: { triesRemaining: 7, weeklyTriesLeft: 7 },
};

/** Out of tries: the game shows how many more can be earned this week. */
export const NoTries: Story = {
  args: { triesRemaining: 0, weeklyTriesLeft: 3 },
};
