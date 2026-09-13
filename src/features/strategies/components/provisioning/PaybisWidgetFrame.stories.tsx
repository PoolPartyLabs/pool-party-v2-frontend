/**
 * @id PP-CORE-CMP-066 (POO-1134)
 * @name PaybisWidgetFrame — stories
 * @implements-rules-version v2 (POO-1129 rules v2)
 *
 * The lifecycle chrome of the embedded Paybis on-ramp across every state ([R5]). The live component
 * mounts a third-party SDK, so the stories drive the presentational {@link PaybisWidgetFrameView}
 * directly with a placeholder standing in for the widget iframe.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PaybisWidgetFrameView } from "./PaybisWidgetFrame";

/** Stand-in for the Paybis-injected iframe (absent in Storybook: no SDK). */
function WidgetPlaceholder() {
  return (
    <div className="flex min-h-[20rem] w-full items-center justify-center rounded-xl border border-border border-dashed text-muted-foreground text-sm">
      Paybis checkout
    </div>
  );
}

const meta = {
  title: "Strategies/Provisioning/PaybisWidgetFrame",
  component: PaybisWidgetFrameView,
  parameters: { layout: "centered" },
  args: { children: <WidgetPlaceholder /> },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PaybisWidgetFrameView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Waiting on the async SDK to attach. */
export const Connecting: Story = { args: { status: "idle" } };

/** The widget is up; the user completes the purchase inside it. */
export const Open: Story = { args: { status: "open" } };

/**
 * POO-1384: the close control, which is the whole point of `onExit` and had no story until now.
 * It is the user's only visible exit once the vendor iframe takes the full height of a phone, so it
 * is worth being able to LOOK at rather than only assert on.
 */
export const WithCloseControl: Story = { args: { status: "open", onExit: () => {} } };

/** `completed` fired; polling the wallet for the balance delta ([R4]). */
export const Reconciling: Story = { args: { status: "reconciling" } };

/** The observed delta landed. */
export const Settled: Story = { args: { status: "settled" } };

/** Ceiling elapsed with no delta: still settling, not a failure ([R5]). */
export const TimedOut: Story = { args: { status: "timed-out" } };

/** The purchase was declined. */
export const Rejected: Story = { args: { status: "rejected" } };

/** The user closed the checkout with no terminal event: resumable ([R5]). */
export const Closed: Story = { args: { status: "closed" } };

/** The SDK never loaded. */
export const Unavailable: Story = { args: { status: "unavailable" } };
