/**
 * @id PP-STR-CMP-027
 * @name StickyActionFooter — stories
 * @implements-rules-version v1 (POO-1525 rules v1)
 *
 * POO-1525 [M3.3]/[M3.5]: the pinned CTA footer, in the two states that matter — content short enough
 * that nothing is stuck (no shadow), and content tall enough that it is (shadow visible). Both stories
 * mount inside a real `overflow-y-auto` box, the same pattern `Dialog.tsx`/`Sheet.tsx` put around
 * every host `ProvisioningPanel` mounts inside, so the shadow genuinely tracks a real scroll position
 * rather than being hand-set — Storybook runs in a real browser, unlike the hook's own jsdom tests.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/Button";
import { StickyActionFooter } from "./StickyActionFooter";

const meta = {
  title: "Strategies/Provisioning/StickyActionFooter",
  component: StickyActionFooter,
  parameters: { layout: "centered" },
  // Both stories fully override the render, so `args.children` is never read; it exists only to
  // satisfy the type, since `children` has no default.
  args: { children: null },
} satisfies Meta<typeof StickyActionFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The same scroll box every host puts around `ProvisioningPanel` (`Dialog.tsx` / `Sheet.tsx`). */
function ScrollHost({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[420px] w-96 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-surface p-4">
      {children}
    </div>
  );
}

const CTA = (
  <StickyActionFooter>
    <Button className="w-full" size="lg">
      Confirm and start
    </Button>
    <Button variant="ghost" className="w-full">
      Cancel
    </Button>
  </StickyActionFooter>
);

/** Content that fits: the footer sits at rest, right after it, no shadow. */
export const Default: Story = {
  render: () => (
    <ScrollHost>
      <p className="text-foreground text-sm">A short body with nothing left to scroll.</p>
      {CTA}
    </ScrollHost>
  ),
};

/** Content taller than the box: the footer sticks, the shadow reads "there is more above". */
export const ScrolledContent: Story = {
  render: () => (
    <ScrollHost>
      {Array.from({ length: 10 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static story content, never reordered
        <p key={i} className="text-foreground text-sm">
          Row {i + 1} of a body tall enough that the footer has to stick.
        </p>
      ))}
      {CTA}
    </ScrollHost>
  ),
};
