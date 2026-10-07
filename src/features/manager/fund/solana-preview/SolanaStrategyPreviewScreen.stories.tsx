/**
 * @id PP-MGR-SCR-009
 * @name SolanaStrategyPreviewScreen stories
 * @implements-rules-version v2 (POO-2281)
 * @analytics-events none, Storybook fixture; the screen owns its bounded events.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import type { PreviewBlock } from "./previewModel";
import { SolanaPreviewCanvas } from "./SolanaPreviewCanvas";
import { SolanaStrategyPreviewScreen } from "./SolanaStrategyPreviewScreen";

const meta = {
  title: "Manager/SolanaPreview/LocalStrategyDrawing",
  component: SolanaStrategyPreviewScreen,
  decorators: [
    withManagerMessages,
    (Story) => (
      <div className="min-w-0 bg-background p-4 text-foreground">
        <Story />
      </div>
    ),
  ],
  args: { onExit: () => {} },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SolanaStrategyPreviewScreen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EmptyDrawing: Story = {};
export const Mobile: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };

/** Percentages are drawing choices, not market/balance fixtures. Inspect each collector visually. */
function AllProtocolsCanvas() {
  const [selected, setSelected] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<PreviewBlock[]>([
    { id: "story-kamino", protocol: "kamino", allocationBps: 2500, pair: "SOL / USDC" },
    { id: "story-jupiter", protocol: "jupiter", allocationBps: 2500, pair: "SOL / USDC" },
    { id: "story-raydium", protocol: "raydium", allocationBps: 2500, pair: "SOL / USDC" },
    { id: "story-orca", protocol: "orca", allocationBps: 2500, pair: "SOL / USDC" },
  ]);
  return (
    <>
      <SolanaPreviewCanvas
        blocks={blocks}
        selectedId={selected}
        onSelect={setSelected}
        onRemove={setRemoveId}
      />
      <ConfirmDialog
        open={removeId !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveId(null);
        }}
        title="Remove drawing block?"
        body="This removes the block from this Storybook drawing."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={() => {
          setBlocks((items) => items.filter((item) => item.id !== removeId));
          if (selected === removeId) setSelected(null);
          setRemoveId(null);
        }}
      />
    </>
  );
}
export const AllProtocolPaths: Story = { render: () => <AllProtocolsCanvas /> };
