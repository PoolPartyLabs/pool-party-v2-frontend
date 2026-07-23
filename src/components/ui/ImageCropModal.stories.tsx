/**
 * @id PP-CORE-MOD-007
 * @name ImageCropModal — stories
 * The shared crop dialog in its two real configurations: banner (16:9 + safe area) and avatar (1:1).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ImageCropModal } from "./ImageCropModal";

// A self-contained sample image (gold→grape gradient) so stories need no network.
const SAMPLE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%23f7ce02'/><stop offset='1' stop-color='%23c5139f'/></linearGradient></defs><rect width='800' height='450' fill='url(%23g)'/></svg>`,
  );

// A square variant (same gradient) for the round / below-cover logo case.
const SAMPLE_SQUARE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%23f7ce02'/><stop offset='1' stop-color='%23c5139f'/></linearGradient></defs><rect width='512' height='512' fill='url(%23g)'/></svg>`,
  );

const meta: Meta<typeof ImageCropModal> = {
  title: "UI/ImageCropModal",
  component: ImageCropModal,
};
export default meta;

type Story = StoryObj<typeof ImageCropModal>;

function Demo({
  aspect,
  title,
  safe,
  src = SAMPLE,
  round,
  minZoom,
}: {
  aspect: number;
  title: string;
  safe: boolean;
  src?: string;
  round?: boolean;
  minZoom?: number;
}) {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-4">
      <Button onClick={() => setOpen(true)}>Open crop</Button>
      {result ? (
        <img
          src={result}
          alt="Crop result"
          className={
            round
              ? "max-w-md rounded-full border border-border"
              : "max-w-md rounded-xl border border-border"
          }
        />
      ) : null}
      <ImageCropModal
        open={open}
        onOpenChange={setOpen}
        src={src}
        aspect={aspect}
        title={title}
        description="Drag to reposition. Keep key content inside the safe area."
        showSafeArea={safe}
        safeAreaLabel="Safe area"
        zoomLabel="Zoom"
        applyLabel="Apply"
        cancelLabel="Cancel"
        onApply={setResult}
        round={round}
        minZoom={minZoom}
      />
    </div>
  );
}

export const Banner: Story = {
  render: () => <Demo aspect={16 / 9} title="Adjust your banner" safe />,
};

export const Avatar: Story = {
  render: () => <Demo aspect={1} title="Adjust your photo" safe={false} />,
};

// Round frame (circular crop) with zoom-out below the cover fit (minZoom 0.5), so a square logo can
// sit smaller than the circle with transparent padding around it.
export const RoundBelowCover: Story = {
  render: () => (
    <Demo
      aspect={1}
      title="Adjust your logo"
      safe={false}
      src={SAMPLE_SQUARE}
      round
      minZoom={0.5}
    />
  ),
};
