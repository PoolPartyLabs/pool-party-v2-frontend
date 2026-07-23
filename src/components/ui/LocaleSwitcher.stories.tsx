/**
 * @id PP-CORE-CMP-021
 * @name LocaleSwitcher.stories
 * @implements-rules-version v1
 * Storybook coverage for the LocaleSwitcher across the supported locales and a disabled state.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import { LocaleSwitcher } from "./LocaleSwitcher";

const meta = {
  title: "UI/LocaleSwitcher",
  component: LocaleSwitcher,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{}}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
} satisfies Meta<typeof LocaleSwitcher>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Portuguese: Story = {
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="pt-BR" messages={{}}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
};

export const Spanish: Story = {
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="es" messages={{}}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
};

export const CustomLabel: Story = {
  args: { label: "Idioma" },
};

export const Disabled: Story = {
  args: { disabled: true },
};
