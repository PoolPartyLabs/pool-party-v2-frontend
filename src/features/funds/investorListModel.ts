/**
 * @id PP-STR-LIB-034
 * @name investorListModel
 * @implements-rules-version v1 (POO-2215)
 * @analytics-events none, pure read-only display projection
 */
import { formatUnits } from "viem";
import type { FundHolder } from "@/lib/api/v2/fundSchemas";
import type { Position, Strategy } from "@/lib/schemas";
import type { FundListEntry } from "./fundListModel";

type IdentityFields = Pick<
  Strategy,
  | "id"
  | "name"
  | "manager"
  | "managerAddress"
  | "managerHandle"
  | "managerVerified"
  | "description"
  | "logoUrl"
  | "type"
  | "assetTags"
>;
export interface InvestorV2Strategy extends IdentityFields {
  protocolVersion: "v2";
  coreVault: string;
  lifecycleAvailable: boolean;
  riskLevel: null;
  minInvestment: number | null;
  tvlUsd: number | undefined;
  investors: null;
  estReturn: null;
  rateType: null;
}
export type InvestorStrategy = (Strategy & { protocolVersion?: "v1" }) | InvestorV2Strategy;
export type InvestorPosition =
  | (Position & { protocolVersion?: "v1" })
  | {
      protocolVersion: "v2";
      id: string;
      strategyId: string;
      status: Position["status"] | "unavailable";
      invested: null;
      currentValue: number;
      totalYield: null;
      isPoolManager: boolean;
    };
export function investorHref(
  strategy: Pick<InvestorStrategy, "id" | "protocolVersion">,
  from?: string,
  withdraw = false,
) {
  const path =
    strategy.protocolVersion === "v2" ? `/funds/${strategy.id}` : `/strategies/${strategy.id}`;
  const params = new URLSearchParams();
  if (withdraw) params.set("withdraw", "1");
  if (from) params.set("from", from);
  return params.size ? `${path}?${params}` : path;
}
const usd = (raw: string) => Number(formatUnits(BigInt(raw), 6));
export function projectInvestorFund(fund: FundListEntry): InvestorV2Strategy {
  return {
    protocolVersion: "v2",
    coreVault: fund.coreVault,
    lifecycleAvailable: fund.state !== undefined,
    id: fund.coreVault,
    name: fund.profile?.name?.trim() || `PP-${fund.creationNumber}`,
    manager: fund.profile?.managerDisplayName?.trim() || fund.manager,
    managerAddress: fund.manager,
    managerVerified: false,
    description: fund.profile?.description ?? "",
    logoUrl: fund.profile?.imageUrl || fund.profile?.image || undefined,
    riskLevel: null,
    minInvestment: fund.mandate ? usd(fund.mandate.minFirstDeposit) : null,
    tvlUsd: fund.shareAssets === undefined ? undefined : usd(fund.shareAssets),
    investors: null,
    estReturn: null,
    rateType: null,
  };
}
export function projectInvestorHolding(
  fund: FundListEntry,
  holder: FundHolder,
  wallet: string,
): InvestorPosition {
  return {
    protocolVersion: "v2",
    id: `v2:${fund.coreVault}`,
    strategyId: fund.coreVault,
    status:
      fund.state === undefined
        ? "unavailable"
        : fund.state === "Closed"
          ? "closed"
          : fund.state === "Closing"
            ? "paused"
            : "active",
    invested: null,
    currentValue: usd(holder.value),
    totalYield: null,
    isPoolManager: fund.manager.toLowerCase() === wallet.toLowerCase(),
  };
}
