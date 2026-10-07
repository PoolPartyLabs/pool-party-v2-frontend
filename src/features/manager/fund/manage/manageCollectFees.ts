/**
 * @id PP-MGR-LIB-065 (POO-2276)
 * @name manageCollectFees
 * @implements-rules-version v1 (POO-2276)
 * @analytics-events none, pure read projection; the mounted host owns read/intent events.
 * Ordered position fees, independent from principal holdings and hub Income.
 */

import { formatUnits } from "viem";
import type { ManagePosition as ApiManagePosition } from "@/lib/api/v2/manageSchemas";
import { apiNetworkForChain } from "@/lib/chains/config";
import {
  type ManagePosition,
  type ManageRead,
  type ManageTokenAmount,
  managePositionIdentity,
} from "./manageModel";

/** The authorized detail fields required by this read-only presenter. */
export type ManageCollectDetail = Pick<
  ApiManagePosition,
  "chainId" | "positionKey" | "status" | "adapterKind" | "tokens" | "uniswap"
> & {
  uncollectedIncome: {
    amount0: ApiManagePosition["uncollectedIncome"]["amount0"] | null;
    amount1: ApiManagePosition["uncollectedIncome"]["amount1"];
  } | null;
};
/** Existing useManagePosition state plus freshness supplied by its authoritative host. */
export interface ManageCollectRead {
  identity: string;
  status: "loading" | "ready" | "error";
  position: ManageCollectDetail | null;
  error: string | null;
  freshness: "fresh" | "stale" | "unknown";
}
export interface ManageCollectFeeRow {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  amount: ManageRead<ManageTokenAmount>;
}
export interface ManageCollectFeesView {
  status: "loading" | "ready" | "zero" | "partial" | "error" | "unavailable";
  reason?: "identity" | "metadata" | "missing" | "stale" | "closed" | "unsupported";
  rows: ManageCollectFeeRow[];
}

/** Requires a matching authorized origin and fresh ordered fee quantities. */
export function projectManageCollectFees(
  origin: ManagePosition,
  read: ManageCollectRead,
): ManageCollectFeesView {
  const unavailable = (reason: ManageCollectFeesView["reason"]): ManageCollectFeesView => ({
    status: "unavailable",
    reason,
    rows: [],
  });
  const identity = managePositionIdentity(origin.core, origin.chainId, origin.positionKey);
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(origin.core) ||
    !/^0x[0-9a-fA-F]{64}$/.test(origin.positionKey) ||
    origin.id !== identity ||
    read.identity.toLowerCase() !== identity
  )
    return unavailable("identity");
  if (read.status === "loading" || read.status === "error")
    return { status: read.status, rows: [] };
  if (read.freshness === "stale") return unavailable("stale");
  // A completed read alone proves neither fresh nor stale fee quantities.
  if (read.freshness !== "fresh") return { status: "unavailable", rows: [] };
  const detail = read.position;
  if (!detail) return unavailable("missing");
  if (
    detail.chainId !== String(origin.chainId) ||
    detail.positionKey.toLowerCase() !== origin.positionKey.toLowerCase()
  )
    return unavailable("identity");
  if (origin.kind !== "liquidity") return unavailable("unsupported");
  if (apiNetworkForChain(origin.chainId) !== origin.network) return unavailable("metadata");
  if (origin.source.status !== "open" || detail.status !== "open") return unavailable("closed");
  if (
    detail.adapterKind !== origin.source.adapterKind ||
    !detail.uniswap ||
    detail.tokens.length !== 2 ||
    origin.tokens.length !== 2
  )
    return unavailable("metadata");
  const currencies = [detail.uniswap.poolKey.currency0, detail.uniswap.poolKey.currency1];
  const metadataValid = origin.tokens.every((token, index) => {
    const observed = detail.tokens[index];
    return (
      observed &&
      token.chainId === origin.chainId &&
      token.address !== null &&
      /^0x[0-9a-fA-F]{40}$/.test(token.address) &&
      token.address.toLowerCase() === observed.address.toLowerCase() &&
      token.address.toLowerCase() === currencies[index]?.toLowerCase() &&
      token.symbol === observed.symbol &&
      token.symbol.trim().length > 0 &&
      token.decimals === observed.decimals &&
      Number.isInteger(token.decimals) &&
      token.decimals >= 0 &&
      token.decimals <= 36
    );
  });
  if (!metadataValid || currencies[0]?.toLowerCase() === currencies[1]?.toLowerCase())
    return unavailable("metadata");
  const rows = detail.tokens.map((token, index): ManageCollectFeeRow => {
    const source =
      index === 0 ? detail.uncollectedIncome?.amount0 : detail.uncollectedIncome?.amount1;
    const metadata = {
      chainId: origin.chainId,
      address: token.address,
      symbol: token.symbol,
      decimals: token.decimals,
    };
    if (
      !source ||
      !/^\d{1,78}$/.test(source.raw) ||
      BigInt(source.raw) >= BigInt(2) ** BigInt(256) ||
      !/^\d{1,78}(?:\.\d{1,36})?$/.test(source.decimal)
    ) {
      return { ...metadata, amount: { status: "unavailable", reason: "missing_quantity" } };
    }
    const decimal = formatUnits(BigInt(source.raw), token.decimals);
    if (normalizeDecimal(source.decimal) !== normalizeDecimal(decimal))
      return { ...metadata, amount: { status: "unavailable", reason: "invalid_quantity" } };
    return {
      ...metadata,
      amount: {
        status: "available",
        source: "position.uncollectedIncome",
        value: { ...metadata, raw: source.raw, decimal },
      },
    };
  });
  const available = rows.filter((row) => row.amount.status === "available");
  if (!available.length) return { status: "unavailable", reason: "missing", rows };
  if (available.length !== rows.length) return { status: "partial", rows };
  const zero = rows.every(
    (row) => row.amount.status === "available" && BigInt(row.amount.value.raw) === BigInt(0),
  );
  return { status: zero ? "zero" : "ready", rows };
}

/** Numeric equality for validated decimal strings, without float conversion. */
function normalizeDecimal(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const whole = integer.replace(/^0+(?=\d)/, "");
  const tail = fraction.replace(/0+$/, "");
  return tail ? `${whole}.${tail}` : whole;
}
