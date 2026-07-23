/**
 * @id PP-REW (POO-210)
 * @name mapDuckShootResult
 * @implements-rules-version v1
 *
 * Maps the P5 play response (POST /points/duck-shoot/play) to the FE
 * DuckShootResult. hitIndex is the board position whose multiplierPct equals the
 * server's outcome.value, so the animated duck matches the multiplier won ([R4]).
 */
import type { DuckShootResult } from "@/lib/services";
import type { DuckShootPlayResponse } from "./analyticsSchemas";
import { DUCK_SHOOT_TARGETS } from "./mapRubberRush";

/** Map a play response to the FE result, deriving hitIndex from the prize board. */
export function mapDuckShootResult(res: DuckShootPlayResponse): DuckShootResult {
  const matchedIndex = DUCK_SHOOT_TARGETS.findIndex(
    (target) => target.multiplierPct === res.outcome.value,
  );
  return {
    hitIndex: matchedIndex === -1 ? 0 : matchedIndex,
    multiplierPct: res.outcome.value,
    quacksWon: res.quacksAwarded,
    triesLeft: res.triesRemaining,
  };
}
