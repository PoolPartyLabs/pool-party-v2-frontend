/**
 * @id PP-STR-CMP-021
 * Stories for CategoryFilter — the investor multi-select asset-category filter (POO-830 R6). The
 * component is controlled, so each story wraps it in a small stateful harness and shows the live
 * selection. Labels come from the `strategies` namespace, supplied via a scoped intl provider (the
 * global preview decorator only loads `common`).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import enCommon from "@/i18n/messages/en/common.json";
import enStrategies from "@/i18n/messages/en/strategies.json";
import type { AssetTag } from "@/lib/schemas";
import { CategoryFilter } from "./CategoryFilter";

const OPTIONS: { value: AssetTag; label: string }[] = [
  { value: "bitcoin", label: "Bitcoin" },
  { value: "ethereum", label: "Ethereum" },
  { value: "stablecoins", label: "Stablecoins" },
  { value: "altcoins", label: "Altcoins" },
  { value: "meme", label: "Meme coins" },
];

/** Controlled harness: owns the selection and echoes it below the control. */
function Harness({ initial = [] as AssetTag[] }) {
  const [selected, setSelected] = useState<AssetTag[]>(initial);
  return (
    <div className="flex flex-col gap-4">
      <CategoryFilter
        label="Browse by category"
        allLabel="All"
        selectedCountLabel={(count) => `${count} selected`}
        options={OPTIONS}
        selected={selected}
        onChange={setSelected}
      />
      <p className="text-muted-foreground text-sm">
        Selected: {selected.length === 0 ? "(none — no filter)" : selected.join(", ")}
      </p>
    </div>
  );
}

const meta: Meta<typeof CategoryFilter> = {
  title: "Strategies/CategoryFilter",
  component: CategoryFilter,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{ common: enCommon, strategies: enStrategies }}>
        <div className="max-w-sm">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof CategoryFilter>;

/** Empty selection — the neutral trigger, "no filter". */
export const Empty: Story = {
  render: () => <Harness />,
};

/** A pre-selected multi-pick — the trigger shows the active count badge. */
export const MultiSelected: Story = {
  render: () => <Harness initial={["bitcoin", "meme"]} />,
};
