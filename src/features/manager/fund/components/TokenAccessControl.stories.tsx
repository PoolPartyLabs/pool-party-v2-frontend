/**
 * @id PP-MGR-CMP-104
 * @name TokenAccessControl.stories
 * @implements-rules-version v1 (POO-2332)
 * @analytics-events none, a presentational control
 *
 * The Token access control (POO-2332 R1) in its two modes. `Selected` shows the info line (R4).
 * `All` hides it, because the Tokens step shows the info card in that mode. `Interactive` holds the
 * mode in local state, so the two options can be clicked and moved with the arrow keys.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import type { TokenMode } from "../mandateDraft";
import { TokenAccessControl } from "./TokenAccessControl";

const meta = {
  title: "Manager/Fund builder/TokenAccessControl",
  component: TokenAccessControl,
  parameters: { layout: "padded" },
  args: { mode: "selected", onChange: () => {} },
} satisfies Meta<typeof TokenAccessControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Selected tokens, with the info line beside the control. */
export const Selected: Story = { args: { mode: "selected" } };

/** All tokens. The info line is hidden. */
export const All: Story = { args: { mode: "all" } };

/** Click an option or use the arrow keys. The control reports each real change. */
export const Interactive: Story = {
  render: () => {
    const [mode, setMode] = useState<TokenMode>("selected");
    return <TokenAccessControl mode={mode} onChange={setMode} />;
  },
};
