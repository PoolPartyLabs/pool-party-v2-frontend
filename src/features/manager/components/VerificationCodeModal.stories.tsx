/**
 * @id PP-MGR-MOD-004
 * @name VerificationCodeModal.stories
 * @implements-rules-version v1
 * Storybook coverage for the manager account-verification code modal (POO-745 [R4]): the staff-review
 * instruction, the prominent one-time code and the copy-to-clipboard control.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { VerificationCodeModal } from "./VerificationCodeModal";

const meta = {
  title: "manager/VerificationCodeModal",
  component: VerificationCodeModal,
  args: {
    open: true,
    onOpenChange: () => {},
    code: "K7QF2M9X",
  },
} satisfies Meta<typeof VerificationCodeModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default — shown right after a successful request-verification (and re-shown while pending). */
export const Default: Story = {};
