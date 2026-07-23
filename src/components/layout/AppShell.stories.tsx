/**
 * @id PP-CORE-LAY-001
 * @name AppShell.stories
 * @implements-rules-version v1
 * Storybook coverage for AppShell: the authenticated shell wrapping placeholder page content.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import { AppShell } from "./AppShell";

const meta = {
  title: "UI/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{}}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
} satisfies Meta<typeof AppShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="space-y-4">
        <h1 className="font-semibold text-xl">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Placeholder page content rendered inside the app shell content area.
        </p>
        <div className="rounded-lg border border-border bg-surface-raised p-6">
          <p className="text-sm">A surface-raised card stands in for real page widgets.</p>
        </div>
      </div>
    ),
  },
};
