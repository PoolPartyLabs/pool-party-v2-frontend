/**
 * @id PP-MGR-MOD-005
 * @name NameDraftDialog.stories
 * @implements-rules-version v1 (POO-2122 rules v1)
 * @analytics-events none, the dialog reports upward and the shell emits
 *
 * The states the handoff lists as "to build, not drawn": the default, the complete-mode primary,
 * a save that never resolves (the loading primary) and a save that failed on storage.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { MandateSaveResult } from "../useMandateDraft";
import { NameDraftDialog } from "./NameDraftDialog";

const meta = {
  title: "Manager/Fund builder/NameDraftDialog",
  component: NameDraftDialog,
  parameters: { layout: "centered" },
  args: {
    open: true,
    mode: "exit" as const,
    counts: { networks: 3, protocols: 4, tokens: 3 },
    position: { index: 3, count: 5 },
    // Annotated rather than inferred: `satisfies Meta` would otherwise narrow the arg to this one
    // story's return type, and every override below would stop type-checking against the PROP.
    onSave: async (): Promise<MandateSaveResult> => ({ ok: true }),
    onSaved: () => {},
    onBlocked: () => {},
    onClose: () => {},
  },
} satisfies Meta<typeof NameDraftDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first Save & exit. Type fewer than ten characters to see the helper turn destructive. */
export const Default: Story = {};

/** Reached from the last step's Next instead: the same question, a different answer. */
export const CompleteMode: Story = { args: { mode: "complete" } };

/**
 * A save that never resolves. Type a name of ten characters or more and press Save and exit: the
 * primary keeps its label and shows it is busy rather than swapping to a spinner.
 */
export const Saving: Story = {
  args: { onSave: () => new Promise(() => {}) },
};

/**
 * Storage refused the write. Type a valid name and press Save and exit: the dialog stays open with
 * the inline notice, and so does everything the manager chose.
 */
export const SaveFailed: Story = {
  args: { onSave: async (): Promise<MandateSaveResult> => ({ ok: false, error: "storage" }) },
};
