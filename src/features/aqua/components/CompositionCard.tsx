import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { cn } from "@/lib/utils/cn";
import { COPY } from "../copy";

/** Same cycling palette the strategy detail composition bar uses, so the two read alike. */
const COMPOSITION_COLORS = [
  "bg-primary",
  "bg-info",
  "bg-success",
  "bg-brand-mango",
  "bg-brand-grape",
] as const;

/**
 * Where the money actually is, as a stacked bar plus a legend. Mirrors `detail.composition` on
 * the strategy detail screen, including collapsed-by-default (POO-903).
 *
 * The weights are LIVE balances, not the designed 90/10. A designed ratio printed next to
 * different real numbers is the kind of small dishonesty that costs a demo its credibility.
 */
export function CompositionCard({ slices }: { slices: Array<{ label: string; weight: number }> }) {
  if (slices.length === 0) return null;

  return (
    <CollapsibleCard title={COPY.composition.title} defaultOpen={false}>
      <div>
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          {slices.map((slice, index) => (
            <span
              key={slice.label}
              className={COMPOSITION_COLORS[index % COMPOSITION_COLORS.length]}
              style={{ width: `${slice.weight}%` }}
              aria-hidden="true"
            />
          ))}
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {slices.map((slice, index) => (
            <li key={slice.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-foreground">
                <span
                  className={cn(
                    "size-2.5 rounded-full",
                    COMPOSITION_COLORS[index % COMPOSITION_COLORS.length],
                  )}
                  aria-hidden="true"
                />
                {slice.label}
              </span>
              <span className="font-medium text-muted-foreground">{slice.weight.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-muted-foreground text-xs">{COPY.composition.live}</p>
      </div>
    </CollapsibleCard>
  );
}
