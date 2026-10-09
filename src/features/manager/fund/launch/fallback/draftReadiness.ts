/**
 * @id PP-MGR-LIB-048 (POO-2183)
 * @name draftReadiness
 * @implements-rules-version v1
 */
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft } from "../../mandateDraft";
import type { FundLaunchDraft } from "../contracts";
import { assertLaunchPlan } from "../journey";
import { hasLaunchTokenAllowance, reviewSchema, validateReview } from "../review";
import { fallbackLaunchPreview } from "./execution";

export function draftReadiness(
  draft: MandateDraft | FundLaunchDraft,
  catalog: MandateCatalog,
  balance: bigint | null,
) {
  const blockers: ("catalog" | "balance" | "review" | "execution")[] = [];
  const { plan, ...mandate } = draft;
  if (
    catalog.loading ||
    catalog.error ||
    !catalog.validateDraft?.(mandate) ||
    !hasLaunchTokenAllowance(draft) ||
    draft.networks.some(
      (network) => draft.tokens.filter((token) => token.network === network).length > 2,
    )
  )
    blockers.push("catalog");
  if (balance === null) blockers.push("balance");
  try {
    if (balance === null) reviewSchema.parse(draft.review);
    else validateReview(draft.review, balance);
  } catch {
    blockers.push("review");
  }
  const base = catalog.depositTokenFor("arbitrum");
  try {
    if (!plan || draft.planUnreadable) throw new Error("BUILD_EXECUTION_GAP");
    assertLaunchPlan(plan);
    // Runtime plan shape is validated above. The preview does not consume optional Review;
    // its missing/invalid fields remain independent blockers rather than execution failures.
    if (
      fallbackLaunchPreview(
        draft as FundLaunchDraft,
        {},
        base ? `arbitrum:${base.address.toLowerCase()}` : undefined,
      ).blockers.length
    )
      blockers.push("execution");
  } catch {
    blockers.push("execution");
  }
  return blockers;
}
