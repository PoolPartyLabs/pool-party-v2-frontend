/**
 * @id PP-MGR-LIB-048 (POO-2183)
 * @name draftReadiness
 * @implements-rules-version v1
 */
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft } from "../../mandateDraft";
import type { FundLaunchDraft } from "../contracts";
import { reviewSchema, validateReview } from "../review";
import { fallbackLaunchPreview } from "./execution";

export function draftReadiness(
  draft: MandateDraft,
  catalog: MandateCatalog,
  balance: bigint | null,
) {
  const blockers: ("catalog" | "balance" | "review" | "execution")[] = [];
  if (catalog.loading || catalog.error || !catalog.validateDraft?.(draft)) blockers.push("catalog");
  if (balance === null) blockers.push("balance");
  try {
    if (balance === null) reviewSchema.parse(draft.review);
    else validateReview(draft.review, balance);
  } catch {
    blockers.push("review");
  }
  const base = catalog.depositTokenFor("arbitrum");
  if (
    !draft.plan ||
    draft.planUnreadable ||
    fallbackLaunchPreview(
      draft as FundLaunchDraft,
      {},
      base ? `arbitrum:${base.address.toLowerCase()}` : undefined,
    ).blockers.length
  )
    blockers.push("execution");
  return blockers;
}
