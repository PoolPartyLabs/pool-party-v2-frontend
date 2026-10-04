/**
 * @id PP-STR-LIB-033 (POO-2181)
 * @name fundListModel
 * @implements-rules-version v2
 * V2-only card projection; missing valuation is never zero.
 */
import { formatUnits } from "viem";
import type { z } from "zod";
import type { fundRowSchema, fundViewSchema } from "@/lib/api/v2/fundSchemas";
import { formatUsdPrecise } from "@/lib/utils/format";

export type FundListEntry = z.infer<typeof fundRowSchema> & Partial<z.infer<typeof fundViewSchema>>;

export function fundListModel(fund: FundListEntry) {
  const positions = fund.positionsSummary?.positions;
  const protocols = new Set(positions?.map((position) => position.adapterKind) ?? []);
  for (const chain of fund.chains) {
    if (chain.aaveV3Adapter) protocols.add("aave-v3");
    if (chain.uniswapV4Adapter) protocols.add("uniswap-v4");
  }
  return {
    protocolVersion: fund.protocolVersion,
    name: fund.profile?.name?.trim() || `PP-${fund.creationNumber}`,
    description: fund.profile?.description ?? "",
    image: fund.profile?.imageUrl || fund.profile?.image || null,
    manager: fund.manager,
    managerName: fund.profile?.managerDisplayName?.trim() || fund.manager,
    chains: fund.chains.map((chain) =>
      chain.chainId === "42161" ? "Arbitrum" : "Robinhood Chain",
    ),
    protocols: [...protocols],
    sharePrice:
      fund.sharePrice === undefined
        ? null
        : formatUsdPrecise(Number(formatUnits(BigInt(fund.sharePrice), 24))),
    shareAssets:
      fund.shareAssets === undefined
        ? null
        : formatUsdPrecise(Number(formatUnits(BigInt(fund.shareAssets), 6))),
    positions:
      positions?.map((position) => ({
        key: `${position.chainId}:${position.positionKey}`,
        tokens: position.tokens.map((token) => token.symbol).join(" / "),
        protocol: position.adapterKind,
        status: position.status,
      })) ?? null,
    limitsUsage: fund.limitsUsage ?? null,
  };
}
