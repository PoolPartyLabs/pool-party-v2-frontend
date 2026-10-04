/**
 * @id PP-STR-LIB-035
 * @name investorListActions
 * @implements-rules-version v1 (POO-2215)
 * @analytics-events none, server-only reads; presenters own navigation/view events
 */
"use server";
import { readFund } from "@/lib/api/v2/funds";
import { isMockMode } from "@/lib/services";
import { loadFundsAction } from "./fundActions";
import type { FundListEntry } from "./fundListModel";

/** PP-INTEGRATION-POINT: discovered finalized scope; nextBlock is output, not a request cursor. */
export async function loadInvestorListAction(view: "explore" | "holder") {
  const result = await loadFundsAction(view);
  if (!result.ok) return result;
  if (view === "explore") {
    // Ownership read is independent: an unavailable session never hides public discovery.
    const personal = await loadFundsAction("holder");
    return personal.ok
      ? {
          ...result,
          data: { ...result.data, holders: personal.data.holders, wallet: personal.data.wallet },
        }
      : result;
  }
  if (isMockMode) return result;
  const funds: FundListEntry[] = [];
  for (let offset = 0; offset < result.data.funds.length; offset += 6) {
    funds.push(
      ...(await Promise.all(
        result.data.funds.slice(offset, offset + 6).map(async (identity) => {
          try {
            const detail = await readFund(identity.coreVault);
            return detail.coreVault.toLowerCase() === identity.coreVault.toLowerCase()
              ? { ...identity, ...detail, profile: detail.profile ?? identity.profile }
              : identity;
          } catch {
            return identity;
          }
        }),
      )),
    );
  }
  return { ...result, data: { ...result.data, funds } };
}
