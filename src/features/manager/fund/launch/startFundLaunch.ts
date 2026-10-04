/**
 * @id PP-MGR-LIB-046 (POO-2177)
 * @name startFundLaunch
 * @implements-rules-version v1
 */
"use client";
import { createPublicClient, erc20Abi, type Hex, http } from "viem";
import { getSessionAction } from "@/features/auth/siweActions";
import { getCatalogReservesAction, getCatalogTokensAction } from "@/lib/api/v2/actions";
import { getChainById, getUsdcAddress } from "@/lib/chains";
import { isFeatureEnabled } from "@/lib/features";
import { isMockMode } from "@/lib/services";
import { buildRealCatalog, toV2MandateSelection } from "../v2Mandate";
import type { FundLaunchDraft } from "./contracts";
import { createJournal, journalKey, loadJournal, saveJournal } from "./journal";
import { getLaunchSteps, journeyPath, persistJourney } from "./journey";
import { withLaunchLock } from "./lock";
import { deriveLaunchSteps } from "./plan";
import { rawUsdc, validateReview } from "./review";

export async function startFundLaunch(draft: FundLaunchDraft): Promise<{ journeyId: string }> {
  if (isMockMode || !isFeatureEnabled("fundContracts")) throw new Error("V2_UNAVAILABLE");
  const manager = await getSessionAction();
  if (!manager) throw new Error("V2_UNAUTHORIZED");
  const journey = await withLaunchLock(journalKey(draft.id, manager), async () => {
    const existing = loadJournal(localStorage, draft.id, manager);
    if (!existing) {
      getLaunchSteps(draft);
      const chain = getChainById(42161);
      if (!chain) throw new Error("V2_UNAVAILABLE");
      const balance = await createPublicClient({ chain, transport: http() }).readContract({
        address: getUsdcAddress(42161) as Hex,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [manager as Hex],
      });
      const review = validateReview(draft.review, balance);
      const [hub, spoke, aave] = await Promise.all([
        getCatalogTokensAction(42161),
        getCatalogTokensAction(4663),
        getCatalogReservesAction(),
      ]);
      if (!hub.ok || !spoke.ok || !aave.ok) throw new Error("CATALOG_UNAVAILABLE");
      const selection = toV2MandateSelection(
        draft,
        buildRealCatalog([...hub.data.tokens, ...spoke.data.tokens], aave.data.reserves),
      );
      const journal = createJournal(
        draft.id,
        manager,
        {
          plan: draft.plan,
          review,
          request: {
            ...selection,
            manager,
            performanceFeeBps: review.performanceFeeBps,
            managementFeeBps: review.managementFeeBps,
            payoutFeeBps: review.payoutFeeBps,
            minFirstDeposit: rawUsdc(review.minimum).toString(),
            seedAmount: rawUsdc(review.seed).toString(),
          },
        },
        deriveLaunchSteps(
          draft.plan,
          draft.launchExecution ?? {},
          true,
          draft.networks.includes("robinhood"),
        ),
      );
      saveJournal(localStorage, journal);
    }
    return persistJourney(draft, manager);
  });
  const locale = document.documentElement.lang || "en";
  window.location.assign(journeyPath(journey.journeyId, locale));
  return { journeyId: journey.journeyId };
}
