/** @id PP-CP-LIB-007 @name Cash+ safe error classification @implements-rules-version v1 */
import { BaseError, ContractFunctionRevertedError } from "viem";

const contractCodes: Record<string, string> = {
  InvalidAmount: "AMOUNT_INVALID",
  InsufficientShares: "INSUFFICIENT_USDC",
  CapacityExceeded: "CAPACITY_FULL",
  Paused: "DEPOSIT_PAUSED",
  PolicyChanged: "POLICY_CHANGED",
  DeadlineExpired: "QUOTE_EXPIRED",
  Slippage: "MIN_OUTPUT_NOT_MET",
  InsufficientCash: "LIQUIDITY_INSUFFICIENT",
  InsufficientLiquidity: "LIQUIDITY_INSUFFICIENT",
  InvalidOracle: "ORACLE_INVALID",
  StaleOracle: "ORACLE_INVALID",
  PegDeviation: "ORACLE_INVALID",
  FeedSkew: "ORACLE_INVALID",
  SequencerUnavailable: "SEQUENCER_UNAVAILABLE",
  Unauthorized: "WALLET_CHANGED",
};

export function cashPlusErrorCode(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((item) => item instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError)
      return contractCodes[reverted.data?.errorName ?? ""] ?? "TX_REVERTED";
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === 4001 || error.code === "ACTION_REJECTED")
  )
    return "USER_REJECTED";
  const message = error instanceof Error ? error.message : "";
  if (/^[A-Z][A-Z_]+$/.test(message)) return message;
  if (/user rejected|user denied/i.test(message)) return "USER_REJECTED";
  if (/insufficient funds/i.test(message)) return "INSUFFICIENT_GAS";
  return "READ_UNAVAILABLE";
}
