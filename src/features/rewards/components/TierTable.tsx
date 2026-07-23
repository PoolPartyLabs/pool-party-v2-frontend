/**
 * @id PP-REW-CMP-013
 * @name TierTable
 * @implements-rules-version v1
 *
 * ManagerIncentiveProgram bonus-fee tier ladder: a compact table of Tier / Min TVL / Bonus fees rows with the
 * investor's current tier softly highlighted. Presentational; rows arrive pre-formatted from the
 * screen. Renders borderless so it sits inside the surrounding card.
 */
import { cn } from "@/lib/utils/cn";

/** A single, pre-formatted tier row. */
export interface TierTableRow {
  /** Display name, e.g. "Tier 1". */
  name: string;
  /** Formatted minimum TVL, e.g. "$1M". */
  minTvl: string;
  /** Formatted bonus-fee share, e.g. "40%". */
  bonusFees: string;
  /** Whether this is the investor's current tier (highlighted). */
  active: boolean;
}

/** Public props for {@link TierTable}. */
export interface TierTableProps {
  /** The tier rows, top tier first. */
  rows: readonly TierTableRow[];
  /** Column header labels. */
  headers: { tier: string; minTvl: string; bonusFees: string };
  /** Extra classes on the table. */
  className?: string;
}

/** The ManagerIncentiveProgram tier ladder. */
export function TierTable({ rows, headers, className }: TierTableProps) {
  return (
    <table className={cn("w-full text-sm", className)}>
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th scope="col" className="px-3 py-2.5 text-left font-medium">
            {headers.tier}
          </th>
          <th scope="col" className="px-3 py-2.5 text-right font-medium">
            {headers.minTvl}
          </th>
          <th scope="col" className="px-3 py-2.5 text-right font-medium">
            {headers.bonusFees}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.name}
            className={cn("border-border border-t", row.active && "bg-primary/10")}
          >
            <td
              className={cn(
                "px-3 py-2.5 font-medium",
                row.active ? "text-primary" : "text-foreground",
              )}
            >
              {row.name}
            </td>
            <td className="px-3 py-2.5 text-right text-muted-foreground">{row.minTvl}</td>
            <td
              className={cn(
                "px-3 py-2.5 text-right font-semibold",
                row.active ? "text-primary" : "text-foreground",
              )}
            >
              {row.bonusFees}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
