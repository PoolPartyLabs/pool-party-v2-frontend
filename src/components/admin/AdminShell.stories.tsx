/**
 * @id PP-ADM-CMP-010
 * @name AdminShell.stories
 * @implements-rules-version v1
 * Storybook coverage for AdminShell: the internal admin chrome wrapping placeholder page content.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import adminMessages from "@/i18n/messages/en/admin.json";
import { AdminShell } from "./AdminShell";

const meta = {
  title: "Admin/AdminShell",
  component: AdminShell,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{ admin: adminMessages }}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
} satisfies Meta<typeof AdminShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Master: Story = {
  args: {
    email: "murilo@pool-party.xyz",
    role: "master",
    children: (
      <div className="space-y-4">
        <h1 className="font-semibold text-xl">Overview</h1>
        <p className="text-muted-foreground text-sm">Operational snapshot of the platform.</p>
        <div className="rounded-lg border border-border bg-surface-raised p-6">
          <p className="text-sm">A surface-raised card stands in for the KPI tiles.</p>
        </div>
      </div>
    ),
  },
};

export const Operator: Story = {
  args: { ...Master.args, email: "ops@pool-party.xyz", role: "operator" },
};
