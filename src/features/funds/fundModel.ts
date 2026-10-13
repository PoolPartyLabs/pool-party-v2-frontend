/**
 * @id PP-STR-LIB-024 (POO-2175)
 * @name fundModel
 * @implements-rules-version v2; v6 networks and report gate (POO-2262, API contract §3.8, §3.9)
 * Exact fund amounts, rollout previews and accepted-report freshness.
 */
import type { FundView } from "@/lib/api/v2/fundSchemas";
import {
  type FundSpoke,
  SOLANA_FUND_CHAIN_ID,
  type SolanaChainDeployment,
} from "@/lib/api/v2/schemas";
import { apiNetworkForChain, chainDisplayName } from "@/lib/chains/config";

export function estimateDeposit(amount: string, sharePrice: string, feeBps = 25) {
  const budget = BigInt(amount);
  const price = BigInt(sharePrice);
  if (
    budget <= BigInt(0) ||
    price <= BigInt(0) ||
    !Number.isInteger(feeBps) ||
    feeBps < 0 ||
    feeBps > 10_000
  )
    throw new Error("V2_INVALID_AMOUNT");
  const flowFee = (budget * BigInt(feeBps)) / BigInt(10_000);
  const scale = BigInt("1000000000000000000");
  const wholeShares = ((budget - flowFee) * scale) / price;
  const principal = (wholeShares * price) / scale;
  return {
    sharesMinted: (wholeShares * scale).toString(),
    flowFee: flowFee.toString(),
    usdcCharged: (principal + flowFee).toString(),
    refundToCaller: (budget - principal - flowFee).toString(),
  };
}
export function rawAmount(value: string) {
  if (!/^\d{1,60}(\.\d{1,6})?$/.test(value)) throw new Error("V2_INVALID_AMOUNT");
  const [whole = "0", fraction = ""] = value.split(".");
  const raw = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  if (raw <= BigInt(0)) throw new Error("V2_INVALID_AMOUNT");
  return raw.toString();
}
export function reportFreshness(age: number | null, maximum: number, elapsed = 0) {
  return age !== null && age >= 0 && maximum > 0 && age + elapsed <= maximum;
}
/** Network slug and product name of a fund wire chain id. Solana is chain "1" in v6 fund reads. */
export function fundChainNetwork(chainId: string | number): { slug: string | null; name: string } {
  const id = String(chainId);
  if (id === SOLANA_FUND_CHAIN_ID) return { slug: "solana", name: "Solana" };
  return { slug: apiNetworkForChain(Number(id)) ?? null, name: chainDisplayName(Number(id)) ?? id };
}
/** A v6 Fund: one of its spokes is Solana (Hub Arbitrum + Robinhood + Solana). */
export function hasSolanaSpoke(fund: Pick<FundView, "chains" | "mandate">): boolean {
  return (
    fund.chains.some((chain) => chain.chainId === SOLANA_FUND_CHAIN_ID) ||
    fund.mandate.spokes.some((spoke) => spoke.chainId === SOLANA_FUND_CHAIN_ID)
  );
}
/**
 * The v6 deposit and payout gate (§3.9), or null for a Fund that keeps the single-report gate:
 * an EVM-only Fund, or an API that does not serve `reportsUsable`. `solanaUsable` is null when the
 * detail does not say, which a caller treats as "refresh it".
 */
export function v6ReportGate(
  fund: Pick<FundView, "chains" | "mandate" | "reportsUsable" | "spokes">,
): { usable: boolean; solanaUsable: boolean | null } | null {
  if (typeof fund.reportsUsable !== "boolean" || !hasSolanaSpoke(fund)) return null;
  const solana = fund.spokes?.find((spoke) => spoke.chainId === SOLANA_FUND_CHAIN_ID);
  return { usable: fund.reportsUsable, solanaUsable: solana?.reportFreshness?.usable ?? null };
}
export interface FundNetworkRow {
  chainId: string;
  slug: string | null;
  name: string;
  hub: boolean;
  status: "created" | "pending";
  /** The spoke's Hub-accepted report; null on the Hub, or when the detail has no freshness. */
  report: { usable: boolean; hasReport: boolean; ageMinutes: number | null } | null;
  /** Solana accounts (base58), only on the Solana row and only once the API derived them. */
  solana: Omit<NonNullable<SolanaChainDeployment["solana"]>, "protocolVersion"> | null;
}
function reportOf(spoke: FundSpoke | undefined): FundNetworkRow["report"] {
  const freshness = spoke?.reportFreshness;
  if (!freshness) return null;
  return {
    usable: freshness.usable,
    hasReport: freshness.hasReport,
    ageMinutes: freshness.ageSeconds === null ? null : Math.floor(freshness.ageSeconds / 60),
  };
}
/** The Fund's networks, Hub first, each spoke with its report freshness and Solana accounts. */
export function fundNetworkRows(
  fund: Pick<FundView, "chains" | "mandate" | "spokes">,
): FundNetworkRow[] {
  const hub = fund.mandate.hubChainId;
  return [...fund.chains]
    .sort((left, right) => Number(right.chainId === hub) - Number(left.chainId === hub))
    .map((chain) => {
      const spoke = fund.spokes?.find((entry) => entry.chainId === chain.chainId);
      const accounts =
        chain.chainId === SOLANA_FUND_CHAIN_ID
          ? (chain.solana ?? (spoke?.chainId === SOLANA_FUND_CHAIN_ID ? spoke.solana : null))
          : null;
      return {
        chainId: chain.chainId,
        ...fundChainNetwork(chain.chainId),
        hub: chain.chainId === hub,
        status: chain.status,
        report: chain.chainId === hub ? null : reportOf(spoke),
        solana: accounts
          ? {
              program: accounts.program,
              fund: accounts.fund,
              vault: accounts.vault,
              usdcAta: accounts.usdcAta,
            }
          : null,
      };
    });
}
export function fundErrorKey(code: string) {
  if (code === "TX_CONFIRMATION_UNKNOWN") return "confirmationTimeout";
  if (/PayoutBelowOneShare/.test(code)) return "payoutWholeShares";
  if (/BelowMinFirstDeposit|DepositBelowOneShare|SharesBelowMinimum/.test(code)) return "minimum";
  if (/FUND_LIMIT_EXCEEDED|SpokeCapExceeded/.test(code)) return "limit";
  if (code === "V2_DEFERRED") return "deferred";
  if (
    /StaleSpokeReport|ReportUnavailable|StalePrice|SOLANA_REPORT_REFRESHING|SPOKE_REPORT_STALE/.test(
      code,
    )
  )
    return "refreshing";
  if (/PayoutTermNotEnded|PayoutAwaitingSettlement|NoOpenPayoutRequest|HolderNotSettled/.test(code))
    return "notReady";
  if (/FundNotOpen|FundNotClosed|ManagerMustCloseFund/.test(code)) return "fundState";
  if (/ZeroAmount|V2_INVALID_AMOUNT/.test(code)) return "invalidAmount";
  if (/Insufficient|ERC20Insufficient/.test(code)) return "insufficient";
  if (/Unauthorized|NotManager|V2_SESSION|WRONG_ACCOUNT|WRONG_CHAIN/.test(code)) return "session";
  return "unavailable";
}
