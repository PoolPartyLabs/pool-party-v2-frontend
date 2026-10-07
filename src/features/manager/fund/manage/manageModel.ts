/**
 * @id PP-MGR-LIB-051
 * @name manageModel
 * @implements-rules-version v2 (POO-2246; extends POO-2226, POO-2232)
 * @analytics-events none, normalized read data consumed by ManageScreen.
 *
 * One read model for cards and panels. Position identity is independent of pool and plan identity.
 */
import type { FundBalances, FundPosition, FundView } from "@/lib/api/v2/fundSchemas";

export type ManageRead<T> =
  | { status: "available"; value: T; source: string }
  | { status: "unavailable"; reason: string };
export interface ManageTokenAmount {
  chainId: number;
  address: string | null;
  symbol: string;
  decimals: number;
  raw: string;
  decimal: string;
}
export interface ManageToken {
  chainId: number;
  address: string | null;
  symbol: string;
  decimals: number;
  amount: ManageRead<ManageTokenAmount>;
  /** Independent authoritative USD valuation; POO-2230 has not supplied this cash read yet. */
  valueUsd?: ManageRead<string>;
}
/** The protocol mark is resolved from the adapter identity, never inferred from position shape. */
export function manageProtocolMark(adapterKind: string): string {
  if (adapterKind === "aave-v3") return "aaveSupply";
  if (adapterKind === "uniswap-v4") return "uniswapV4Pool";
  if (adapterKind === "uniswap-v3") return "uniswapV3Pool";
  return "unknown";
}

export interface ManagePosition {
  id: string;
  core: string;
  chainId: number;
  positionKey: string;
  blockId: string | null;
  poolId: string | null;
  kind: "supply" | "liquidity" | "unsupported";
  protocol: string;
  network: string;
  tokens: ManageToken[];
  valueUsd: ManageRead<string>;
  allocationPct: ManageRead<string>;
  rangeStatus: ManageRead<"in" | "out">;
  source: FundPosition;
}
export interface ManageChain {
  chainId: number;
  network: string;
  name: string;
  hub: boolean;
  positions: ManagePosition[];
  idle: ManageToken;
  idleSharePct: ManageRead<string>;
  cash: ManageToken[];
}
export interface ManageModel {
  core: string;
  name: string;
  hubChainId: number;
  positions: ManagePosition[];
  chains: ManageChain[];
  withdrawal: {
    requested: ManageRead<ManageTokenAmount>;
    reserved: ManageRead<ManageTokenAmount>;
    stillNeeded: ManageRead<ManageTokenAmount>;
    coveragePct: ManageRead<string>;
  };
  income: ManageToken;
  snapshot: { reportTimestamp: string | null; ageSeconds: number | null };
}

import Decimal from "decimal.js";
import { formatUnits } from "viem";
import { apiNetworkForChain, chainDisplayName, supportedChainMetas } from "@/lib/chains/config";

export function available<T>(value: T, source: string): ManageRead<T> {
  return { status: "available", value, source };
}
export function unavailable<T>(reason: string): ManageRead<T> {
  return { status: "unavailable", reason };
}
export function managePositionIdentity(core: string, chainId: number, positionKey: string): string {
  return `${core.toLowerCase()}:${chainId}:${positionKey.toLowerCase()}`;
}
function decimalRead(value: string | null | undefined, source: string): ManageRead<string> {
  return value != null && /^\d+(\.\d+)?$/.test(value)
    ? available(value, source)
    : unavailable("missing_value");
}
function tokenAmount(
  token: Omit<ManageToken, "amount">,
  raw: string | null | undefined,
  source: string,
): ManageRead<ManageTokenAmount> {
  if (
    raw == null ||
    !/^\d+$/.test(raw) ||
    !Number.isInteger(token.decimals) ||
    token.decimals < 0 ||
    token.decimals > 255
  )
    return unavailable("missing_quantity");
  return available({ ...token, raw, decimal: formatUnits(BigInt(raw), token.decimals) }, source);
}
function positionOf(core: string, source: FundPosition): ManagePosition {
  const chainId = Number(source.chainId);
  const kind =
    source.adapterKind === "aave-v3"
      ? "supply"
      : source.adapterKind === "uniswap-v4" || source.adapterKind === "uniswap-v3"
        ? "liquidity"
        : "unsupported";
  const tokens = source.tokens.map((meta, index): ManageToken => {
    const token = { chainId, address: meta.address, symbol: meta.symbol, decimals: meta.decimals };
    const amount =
      kind === "supply" && index === 0
        ? source.aave?.currentBalance
        : index === 0
          ? source.currentAmounts?.amount0
          : index === 1
            ? source.currentAmounts?.amount1
            : null;
    return { ...token, amount: tokenAmount(token, amount?.raw, "positionsSummary.currentAmounts") };
  });
  return {
    id: managePositionIdentity(core, chainId, source.positionKey),
    core,
    chainId,
    positionKey: source.positionKey,
    blockId: null,
    poolId: typeof source.poolKey === "string" ? source.poolKey : null,
    kind,
    protocol:
      source.adapterKind === "aave-v3"
        ? "Aave v3"
        : source.adapterKind === "uniswap-v4"
          ? "Uniswap v4"
          : source.adapterKind === "uniswap-v3"
            ? "Uniswap v3"
            : source.adapterKind,
    network: apiNetworkForChain(chainId) ?? String(chainId),
    tokens,
    valueUsd: decimalRead(
      source.currentValueUsd ?? source.valueUsd,
      "positionsSummary.currentValueUsd",
    ),
    allocationPct: decimalRead(source.shareOfNav, "positionsSummary.shareOfNav"),
    // Current position metadata only. Draft ticks and future-deposit policy never change this read.
    rangeStatus:
      kind === "liquidity" &&
      source.status === "open" &&
      typeof source.uniswap?.inRange === "boolean"
        ? available(source.uniswap.inRange ? "in" : "out", "positionsSummary.uniswap.inRange")
        : unavailable("missing_current_range_status"),
    source,
  };
}
function stableToken(fund: FundView, chainId: number): Omit<ManageToken, "amount"> {
  const meta = supportedChainMetas.find((m) => m.chain.id === chainId);
  const address =
    chainId === Number(fund.mandate.hubChainId)
      ? fund.mandate.usdc
      : fund.mandate.spokes.find((s) => Number(s.chainId) === chainId)?.spokeToken;
  const verified = address != null && meta?.usdc.address.toLowerCase() === address.toLowerCase();
  // PP-INTEGRATION-POINT: unknown mandate token identity needs served metadata, never a network-label guess.
  return {
    chainId,
    address: address ?? null,
    symbol: verified ? meta.usdc.symbol : "",
    decimals: verified ? meta.usdc.decimals : -1,
  };
}

/** PP-INTEGRATION-POINT: consumes authorized V2 fund/manager reads; unresolved unit semantics stay unavailable. */
export function normalizeManageModel(fund: FundView, balances: FundBalances[] = []): ManageModel {
  const hubChainId = Number(fund.mandate.hubChainId);
  const positions = (fund.positionsSummary?.positions ?? []).map((position) =>
    positionOf(fund.coreVault, position),
  );
  const chainIds = [
    ...new Set([
      hubChainId,
      ...fund.chains.map((chain) => Number(chain.chainId)),
      ...positions.map((position) => position.chainId),
    ]),
  ];
  const chains = chainIds.map((chainId): ManageChain => {
    const meta = supportedChainMetas.find((m) => m.chain.id === chainId);
    const stable = stableToken(fund, chainId);
    const hub = chainId === hubChainId;
    const balance = balances.find((item) => Number(item.chainId) === chainId);
    const stableBalance = stable.address
      ? balance?.tokens.find((token) => token.token.toLowerCase() === stable.address?.toLowerCase())
      : undefined;
    const idleAmount = hub
      ? tokenAmount(stable, fund.freeIdle, "fund.freeIdle")
      : unavailable<ManageTokenAmount>(
          stableBalance ? "spoke_idle_semantics_unconfirmed" : "missing_spoke_idle",
        );
    const idleSharePct =
      hub && idleAmount.status === "available" && BigInt(fund.shareAssets) > BigInt(0)
        ? available(
            new Decimal(fund.freeIdle).div(fund.shareAssets).mul(100).toString(),
            "fund.freeIdle/fund.shareAssets",
          )
        : unavailable<string>("missing_denominator");
    const native = {
      chainId,
      address: null,
      symbol: meta?.chain.nativeCurrency.symbol ?? "",
      decimals: meta?.chain.nativeCurrency.decimals ?? -1,
    };
    return {
      chainId,
      network: apiNetworkForChain(chainId) ?? String(chainId),
      name: chainDisplayName(chainId) ?? String(chainId),
      hub,
      positions: positions.filter((position) => position.chainId === chainId),
      idle: { ...stable, amount: idleAmount },
      idleSharePct,
      // Scalar operatingCash does not identify native operating resources. Stable stays in idle/holdings.
      cash: [{ ...native, amount: unavailable("missing_native_cash") }],
    };
  });
  const hubStable = stableToken(fund, hubChainId);
  return {
    core: fund.coreVault,
    name: fund.profile?.name ?? `PP-${fund.creationNumber}`,
    hubChainId,
    positions,
    chains,
    withdrawal: {
      requested: unavailable("missing_withdrawal_queue"),
      reserved: tokenAmount(hubStable, fund.payoutReserve, "fund.payoutReserve"),
      stillNeeded: unavailable("missing_withdrawal_queue"),
      coveragePct: unavailable("missing_withdrawal_queue"),
    },
    // PP-INTEGRATION-POINT: hub USDC income balance with decimals/freshness is not exposed by current DTOs.
    income: { ...hubStable, amount: unavailable("missing_hub_income_balance") },
    snapshot: {
      reportTimestamp: fund.lastReport?.report.timestamp ?? null,
      ageSeconds: fund.lastReport?.ageSeconds ?? null,
    },
  };
}
