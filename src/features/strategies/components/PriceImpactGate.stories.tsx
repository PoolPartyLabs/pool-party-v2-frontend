/**
 * @id PP-STR-CMP-022
 * @name PriceImpactGate — stories
 * @implements-rules-version v2
 *
 * POO-1011: the catastrophic price-impact gate. The Interactive story wires the real
 * usePriceImpactGate lifecycle against a mock CTA so the acknowledgment -> unblock flow is
 * exercisable; Incident renders the POO-1010 figure (92.41%) that used to hide behind "Show more";
 * BelowThreshold documents the null render under 10%.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/Button";
import { PriceImpactGate, usePriceImpactGate } from "./PriceImpactGate";

const meta = {
  title: "Strategies/PriceImpactGate",
  component: PriceImpactGate,
  parameters: { layout: "centered" },
} satisfies Meta<typeof PriceImpactGate>;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ pct }: { pct?: number }) {
  const gate = usePriceImpactGate(pct, true);
  return (
    <div className="w-96 space-y-3">
      <PriceImpactGate
        priceImpactPct={pct}
        acknowledged={gate.acknowledged}
        onAcknowledgedChange={gate.setAcknowledged}
      />
      <Button className="w-full" size="lg" disabled={gate.blocked}>
        Confirm investment
      </Button>
    </div>
  );
}

/** The POO-1010 incident figure: gated until the risk acknowledgment is checked. */
export const Incident: Story = {
  args: { priceImpactPct: 92.41, acknowledged: false, onAcknowledgedChange: () => {} },
  render: () => <Demo pct={92.41} />,
};

/** Just past the 10% threshold. */
export const AtThreshold: Story = {
  args: { priceImpactPct: 12.5, acknowledged: false, onAcknowledgedChange: () => {} },
  render: () => <Demo pct={12.5} />,
};

/** Below the threshold the gate renders nothing and the CTA stays enabled. */
export const BelowThreshold: Story = {
  args: { priceImpactPct: 4.5, acknowledged: false, onAcknowledgedChange: () => {} },
  render: () => <Demo pct={4.5} />,
};
