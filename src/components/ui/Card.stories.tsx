import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./Card";

const meta = {
  title: "UI/Card",
  component: Card,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A complete composed card using every part: header, title, description, content, and footer. */
export const Composed: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Conservative Pool</CardTitle>
        <CardDescription>Low-risk USDC yield strategy</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">8.2% APY</p>
        <p className="text-sm text-muted-foreground">Your balance: $12,500.00</p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <button
          type="button"
          className="rounded-md bg-secondary px-4 py-2 text-sm text-secondary-foreground"
        >
          Withdraw
        </button>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Deposit
        </button>
      </CardFooter>
    </Card>
  ),
};

/** Just the surface with arbitrary content, showing the bare container. */
export const ContentOnly: Story = {
  render: () => (
    <Card className="w-80">
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">A bare card surface with content only.</p>
      </CardContent>
    </Card>
  ),
};
