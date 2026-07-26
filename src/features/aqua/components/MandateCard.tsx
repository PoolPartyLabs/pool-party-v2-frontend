import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import type { AquaMandateView } from "@/lib/aqua/api/mandate";
import { COPY } from "../copy";

/**
 * Investment mandate, rendered in the same three blocks the strategy detail prospectus uses:
 * assets, protocols, networks. Same primitive, same collapsed-by-default behaviour (POO-903),
 * so this reads as one more strategy in the catalog rather than a bespoke page.
 *
 * The protocols block is the one that answers "what does this actually touch": Aave v3 for the
 * carry leg and 1inch Aqua for the buy bands.
 */
export function MandateCard({ mandate }: { mandate: AquaMandateView }) {
  return (
    <CollapsibleCard title={COPY.mandate.title} defaultOpen={false}>
      <div>
        <Block label={COPY.mandate.assets}>
          <div className="flex flex-col divide-y divide-border">
            {mandate.assets.map((asset) => (
              <Row key={asset.label} label={asset.label} value={`${asset.maxPct}%`} />
            ))}
          </div>
        </Block>

        <Block label={COPY.mandate.protocols} className="mt-4">
          <div className="flex flex-col divide-y divide-border">
            {mandate.protocols.map((protocol) => (
              <Row key={protocol.label} label={protocol.label} value={`${protocol.maxPct}%`} />
            ))}
          </div>
        </Block>

        <Block label={COPY.mandate.networks} className="mt-4">
          <div className="flex flex-wrap gap-2">
            {mandate.networks.map((network) => (
              <span
                key={network}
                className="rounded-full border border-border px-3 py-1 text-foreground text-xs"
              >
                {network}
              </span>
            ))}
          </div>
        </Block>
      </div>
    </CollapsibleCard>
  );
}

function Block({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
