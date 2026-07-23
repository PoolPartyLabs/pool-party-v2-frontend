/**
 * @id PP-CORE-CMP-038
 * @name Sheet.stories
 * @implements-rules-version v1
 * Stories for the Sheet primitive: a bottom sheet on mobile (grab handle + swipe-to-dismiss) and a
 * centered card from `sm` up. Resize the Storybook viewport to see the responsive switch.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./Sheet";

const meta = {
  title: "UI/Sheet",
  component: Sheet,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Sheet>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default sheet: bottom-anchored with a grab handle on mobile, centered card on desktop. */
export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Open sheet
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Not enough gas</SheetTitle>
          <SheetDescription>
            You need a little network gas to confirm this transaction. Top up below.
          </SheetDescription>
        </SheetHeader>
        <p className="text-foreground text-sm">Body content goes here.</p>
        <SheetFooter>
          <SheetClose className="rounded-md border border-border bg-secondary px-4 py-2 font-medium text-secondary-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Not now
          </SheetClose>
          <SheetClose className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Continue
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

/** Without the built-in X — dismissal is via an explicit action or swipe/Esc. */
export const WithoutCloseButton: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Open
      </SheetTrigger>
      <SheetContent showClose={false}>
        <SheetHeader>
          <SheetTitle>Action required</SheetTitle>
          <SheetDescription>Choose an option below to continue.</SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <SheetClose className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Got it
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};
