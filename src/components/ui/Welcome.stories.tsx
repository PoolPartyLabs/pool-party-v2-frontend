import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";

/**
 * Smoke story validating the Storybook setup: nextjs-vite build, Tailwind via globals.css,
 * the NextIntl decorator, the forced dark canvas, and the a11y addon.
 *
 * PP-TODO: replace with real design-system primitive stories once STY-001/002 + CMP-010.. land.
 */
function Welcome() {
  const t = useTranslations("common");
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{t("appName")}</h1>
      <p className="text-sm opacity-80">{t("tagline")}</p>
      <button type="button" className="w-fit rounded-md bg-white px-4 py-2 text-black">
        {t("retry")}
      </button>
    </section>
  );
}

const meta = {
  title: "Welcome/Smoke",
  component: Welcome,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Welcome>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
