/**
 * @id PP-CORE-CMP-063 (POO-904)
 * @name MobileLocaleSheet.stories
 * @implements-rules-version v1
 * Storybook coverage for the mobile locale picker: the icon trigger at different active locales.
 * Open the sheet from the trigger; the current locale row carries the check mark. Best viewed in
 * a mobile viewport (the Sheet primitive bottom-anchors below `sm`).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import enShell from "@/i18n/messages/en/shell.json";
import { MobileLocaleSheet } from "./MobileLocaleSheet";

const meta = {
  title: "UI/MobileLocaleSheet",
  component: MobileLocaleSheet,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{ shell: enShell }}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
} satisfies Meta<typeof MobileLocaleSheet>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Portuguese: Story = {
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="pt-BR" messages={{ shell: enShell }}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
};

export const Japanese: Story = {
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="ja" messages={{ shell: enShell }}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
};
