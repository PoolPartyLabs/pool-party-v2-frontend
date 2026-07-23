/**
 * @id PP-CORE-CMP-013
 * @name Dialog.stories
 * @implements-rules-version v1
 * Storybook stories for the Dialog primitive covering the default header/content/footer layout
 * and a variant without the built-in close button.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";

const meta = {
  title: "UI/Dialog",
  component: Dialog,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Default dialog with a header (title + description), body content, and a footer with Cancel and
 * Confirm actions. Opened via the trigger; closes on Esc, overlay click, or the X button.
 */
export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Withdraw funds
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm withdrawal</DialogTitle>
          <DialogDescription>
            You are about to withdraw 1,500 USDC to your linked wallet. This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-foreground">
          <p>Funds typically arrive within a few minutes.</p>
        </div>
        <DialogFooter>
          <DialogClose className="rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Cancel
          </DialogClose>
          <DialogClose className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Confirm
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/**
 * Destructive confirmation dialog. The same layout used for irreversible actions such as
 * removing a wallet, with a destructive Confirm button.
 */
export const Destructive: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Remove wallet
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this wallet?</DialogTitle>
          <DialogDescription>
            Removing a wallet disconnects it from your account. You can reconnect it later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose className="rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Cancel
          </DialogClose>
          <DialogClose className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Remove
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/**
 * Dialog without the built-in top-right close button. Use when the only way out should be an
 * explicit footer action.
 */
export const WithoutCloseButton: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Open
      </DialogTrigger>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>Action required</DialogTitle>
          <DialogDescription>
            Choose an option below to continue. There is no corner close button.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Got it
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
