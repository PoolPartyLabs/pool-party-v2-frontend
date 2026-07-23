/**
 * @id PP-MGR-LIB-010
 * @name managerStrategySort
 * @implements-rules-version v1
 *
 * Pure metric sort for the Manager Console "My strategies" list (POO-752 [R2]). Mirrors the investor
 * Explore sort shape (`sortValue`), including the missing-to-bottom convention: `fees30d === 0` is the
 * "not measured" sentinel (rendered as a dash on the card, POO-559/369), so it always sinks to the
 * BOTTOM regardless of direction. `aum` / `investors` zeros are genuine and sort normally; `apy` (the
 * Net APR) sorts signed (negatives allowed). Returns a NEW array (never mutates) and relies on the
 * engine's stable sort to preserve input order for equal keys.
 */
import type { ManagerStrategy } from "@/lib/schemas";

/** The metrics the "My strategies" list can sort by. */
export type ManagerStrategySortKey = "aum" | "investors" | "apy" | "fees30d";

/** Sort direction. */
export type SortDirection = "asc" | "desc";

/** A stable, non-mutating metric sort with fees-not-measured pinned to the bottom in both directions. */
export function sortManagerStrategies(
  strategies: ManagerStrategy[],
  key: ManagerStrategySortKey,
  dir: SortDirection,
): ManagerStrategy[] {
  const mult = dir === "asc" ? 1 : -1;
  return [...strategies].sort((a, b) => {
    if (key === "fees30d") {
      // 0 / absent = "not measured": always after any measured value, in BOTH directions.
      const aMissing = !a.fees30d;
      const bMissing = !b.fees30d;
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      if (aMissing) return 0;
      return (a.fees30d - b.fees30d) * mult;
    }
    return (a[key] - b[key]) * mult;
  });
}
