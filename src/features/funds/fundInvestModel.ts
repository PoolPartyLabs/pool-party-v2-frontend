/** @id PP-STR-LIB-038 @name fundInvestModel @implements-rules-version v1 (POO-2248) @analytics-events none, pure deposit guards */
import { decodeFunctionData, erc20Abi, parseAbi } from "viem";
import type { FundBuild } from "@/lib/api/v2/fundSchemas";
export interface FundDepositPreview {
  sharesMinted: string;
  usdcCharged: string;
  flowFee: string;
  refundToCaller: string;
  sharePrice: string;
}
export const depositAbi = parseAbi([
  "function deposit(uint256 usdcAmount,uint256 minShares) returns(uint256 shares,uint256 usdcCharged)",
]);
export function validateDepositPreview(value: unknown, budget: string): FundDepositPreview {
  if (!value || typeof value !== "object") throw new Error("V2_INVALID_RESPONSE");
  const result = {} as FundDepositPreview;
  for (const key of [
    "sharesMinted",
    "usdcCharged",
    "flowFee",
    "refundToCaller",
    "sharePrice",
  ] as const) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw !== "string" || !/^\d{1,78}$/.test(raw)) throw new Error("V2_INVALID_RESPONSE");
    result[key] = raw;
  }
  if (
    BigInt(result.sharesMinted) <= 0n ||
    BigInt(result.sharesMinted) % 10n ** 18n !== 0n ||
    BigInt(result.sharePrice) <= 0n ||
    BigInt(result.usdcCharged) + BigInt(result.refundToCaller) !== BigInt(budget) ||
    BigInt(result.flowFee) > BigInt(result.usdcCharged)
  )
    throw new Error("V2_INVALID_RESPONSE");
  return result;
}
export function validateFundDepositBuild(
  build: FundBuild,
  core: string,
  wallet: string,
  token: string,
  budget: string,
  minShares: string,
) {
  const tx = build.transactions[0];
  if (
    build.transactions.length !== 1 ||
    !tx ||
    tx.chainId !== 42161 ||
    tx.from.toLowerCase() !== wallet.toLowerCase() ||
    tx.value !== "0"
  )
    throw new Error("V2_INVALID_RESPONSE");
  if (build.nextAction) {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data as `0x${string}` });
    if (
      tx.to.toLowerCase() !== token.toLowerCase() ||
      decoded.functionName !== "approve" ||
      decoded.args?.[0].toLowerCase() !== core.toLowerCase() ||
      decoded.args[1] !== BigInt(budget) ||
      build.preview != null
    )
      throw new Error("V2_INVALID_RESPONSE");
    return null;
  }
  const decoded = decodeFunctionData({ abi: depositAbi, data: tx.data as `0x${string}` });
  if (
    tx.to.toLowerCase() !== core.toLowerCase() ||
    decoded.functionName !== "deposit" ||
    decoded.args[0] !== BigInt(budget) ||
    decoded.args[1] !== BigInt(minShares)
  )
    throw new Error("V2_INVALID_RESPONSE");
  return validateDepositPreview(build.preview, budget);
}
