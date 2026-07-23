/**
 * @id PP-CORE-CMP-047
 * @name TransactionModalHeader.stories
 * @implements-rules-version v1
 *
 * Storybook coverage for the shared transactional-modal header (POO-445 R1): settings-only,
 * back + settings, and title-only, each rendered inside a Dialog so the ⚙ gear sits next to the X.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Dialog, DialogContent } from "./Dialog";
import { TransactionModalHeader } from "./TransactionModalHeader";

const meta = {
  title: "UI/TransactionModalHeader",
  component: TransactionModalHeader,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <Dialog open>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <Story />
        </DialogContent>
      </Dialog>
    ),
  ],
} satisfies Meta<typeof TransactionModalHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** First step of a flow: title + settings gear (no back). */
export const SettingsOnly: Story = {
  args: {
    title: "Confirm & sign",
    onSettings: () => {},
    settingsLabel: "Transaction settings",
  },
};

/** A Review/Confirm step: back arrow + title + settings gear. */
export const BackAndSettings: Story = {
  args: {
    title: "Review",
    onBack: () => {},
    backLabel: "Back",
    onSettings: () => {},
    settingsLabel: "Transaction settings",
  },
};

/** A plain step with no settings (title only). */
export const TitleOnly: Story = {
  args: { title: "Withdraw" },
};
