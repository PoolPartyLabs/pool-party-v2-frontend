/**
 * @id PP-MGR-CMP-047
 * @name BuildPanelSlot.stories
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, a story file of a presentational frame
 *
 * The Configure block frame of the Build step (POO-2152, handoff v1.2 [AN9], HU1): empty, and with
 * a body. The body here is the "Nothing selected" copy of the stub that slice S5 builds, rendered
 * from its keys so the frame is reviewed around real text; the stub itself is not this slice's.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";
import { BuildPanelSlot } from "./BuildPanelSlot";
import { withManagerMessages } from "./canvasStorySupport";

/** The copy of the stub's empty state, as a stand-in body. */
function NothingSelectedBody() {
  const t = useTranslations("manager");
  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold text-base text-foreground">
        {t("fundBuilder.canvas.panel.nothingTitle")}
      </p>
      <p className="text-muted-foreground text-sm">{t("fundBuilder.canvas.panel.nothingBody")}</p>
    </div>
  );
}

const meta = {
  title: "Manager/Fund builder/Build canvas/BuildPanelSlot",
  component: BuildPanelSlot,
  parameters: { layout: "padded" },
  decorators: [withManagerMessages],
} satisfies Meta<typeof BuildPanelSlot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The frame alone: overline, nothing else. It hugs its content. */
export const Empty: Story = {};

/** The frame with a body, as the Build step shows it when nothing is selected. */
export const WithContent: Story = {
  args: { children: <NothingSelectedBody /> },
};
