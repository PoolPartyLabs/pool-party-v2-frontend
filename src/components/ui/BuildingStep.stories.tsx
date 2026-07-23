/**
 * @id PP-CORE-CMP-052
 * @name BuildingStep — stories
 * @implements-rules-version v1
 * The shared "building the transaction" spinner used during a modal's `building` phase (POO-595).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BuildingStep } from "./BuildingStep";

const meta = {
  title: "UI/BuildingStep",
  component: BuildingStep,
  parameters: { layout: "centered" },
  args: { label: "Processing…" },
} satisfies Meta<typeof BuildingStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithBody: Story = {
  args: { label: "Processing…", body: "This usually takes a few seconds." },
};
