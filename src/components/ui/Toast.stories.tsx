/**
 * @id PP-CORE-CMP-016
 * @name Toast.stories
 * @implements-rules-version v1
 * Storybook coverage for the Toast primitive: trigger buttons for success, error, and info toasts
 * rendered alongside the themed Toaster.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Toaster, toast } from "./Toast";

const meta = {
  title: "UI/Toast",
  component: Toaster,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Toaster>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Shared button styling for the demo triggers (token utilities only). */
const triggerClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** All three variants: click a button to enqueue the matching toast on the mounted Toaster. */
export const Playground: Story = {
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className={triggerClass}
          onClick={() => toast.success("Deposit confirmed")}
        >
          Show success
        </button>
        <button
          type="button"
          className={triggerClass}
          onClick={() => toast.error("Transaction failed")}
        >
          Show error
        </button>
        <button
          type="button"
          className={triggerClass}
          onClick={() => toast.info("Rebalance scheduled")}
        >
          Show info
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Click a button to trigger a toast in the corner.
      </p>
      <Toaster />
    </div>
  ),
};
