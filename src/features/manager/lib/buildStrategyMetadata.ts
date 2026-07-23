/**
 * @id PP-MGR-LIB-008 (POO-308)
 * @name buildStrategyMetadata
 * @implements-rules-version v1
 *
 * Maps the Review-step identity + derived mandate into the v2 metadata-POST body (POO-308 [R1]/[R7]),
 * shaped to the deployed pool-party-api DTO (POO-579): the performance cut becomes the top-level
 * `managerFee` in BASIS POINTS (`Math.round(performancePct * 100)`); entry / exit / management are
 * V1-locked to 0 server-side (never sent). `riskLevel` is the `RiskProfile` enum classified from the
 * pool's token pair. `logoUrl` is included ONLY when it is a real https URL — a local `data:` crop
 * preview is omitted so it can never 400 the create. category is carried through. Pure so it TDDs
 * without React.
 */

import type { ObjectiveTag, StrategyAccess } from "@/lib/schemas";
import type { RiskProfile } from "@/lib/strategies/riskProfile";
import type {
  StrategyCategory,
  StrategyMetadataInput,
} from "@/lib/strategies/v2/strategyMetadataSchema";

/** The Review-step values that feed the metadata POST. */
export interface StrategyMetadataParams {
  /** Strategy display name (may carry surrounding whitespace from the input). */
  name: string;
  /** Optional thesis (may be empty / whitespace). */
  description: string;
  /** Manager-uploaded logo (data / remote URL), or null. Only an https URL is sent to the API. */
  logoUrl: string | null;
  /** Auto-derived stable category enum (the mandate's `categoryKey`); localized at render, never persisted as copy. */
  category: StrategyCategory;
  /** Auto-derived OBJECTIVE tags (POO-830 R3/R4), computed at creation from the mint composition. */
  objective: ObjectiveTag[];
  /** Risk profile enum classified from the pool's token pair (`getRiskProfile`); the DTO reuses it. */
  riskProfile: RiskProfile;
  /** The editable performance fee (percent of generated LP fees) -> `managerFee` basis points. */
  performancePct: number;
  /** Access model (V1: `public`). */
  access: StrategyAccess;
}

/** Build the v2 metadata-create payload from the Review step's launch inputs. */
export function buildStrategyMetadata(params: StrategyMetadataParams): StrategyMetadataInput {
  const description = params.description.trim();
  const body: StrategyMetadataInput = {
    name: params.name.trim(),
    description: description.length > 0 ? description : null,
    category: params.category,
    // POO-830 R7: the derived objective rides the signed metadata POST. The backend DTO's whitelist
    // strips it until the column exists (harmless); it becomes the persisted, investor-served objective.
    objectiveTags: params.objective,
    riskLevel: params.riskProfile,
    // V1: only the performance cut is manager-set, top-level in basis points (0-10000). entry / exit /
    // management are locked to 0 server-side, so they are never sent.
    managerFee: Math.round(params.performancePct * 100),
    access: params.access,
  };
  // Only a real remote https logo is persistable; a local `data:` crop preview is omitted so a logo
  // never 400s the launch (the DTO validates https-only `@IsUrl`). Real persistence is sequenced apart.
  if (params.logoUrl?.startsWith("https://")) body.logoUrl = params.logoUrl;
  return body;
}
