/**
 * @id PP-STR-LIB-024 (POO-2175)
 * @name fundModel
 * @implements-rules-version v2
 * Exact fund amounts, rollout previews and accepted-report freshness.
 */
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
export function fundErrorKey(code: string) {
  if (code === "TX_CONFIRMATION_UNKNOWN") return "confirmationTimeout";
  if (/BelowMinFirstDeposit|DepositBelowOneShare|SharesBelowMinimum|PayoutBelowOneShare/.test(code))
    return "minimum";
  if (/FUND_LIMIT_EXCEEDED|SpokeCapExceeded/.test(code)) return "limit";
  if (code === "V2_DEFERRED") return "deferred";
  if (/StaleSpokeReport|ReportUnavailable|StalePrice/.test(code)) return "refreshing";
  if (/PayoutTermNotEnded|PayoutAwaitingSettlement|NoOpenPayoutRequest|HolderNotSettled/.test(code))
    return "notReady";
  if (/FundNotOpen|FundNotClosed|ManagerMustCloseFund/.test(code)) return "fundState";
  if (/ZeroAmount|V2_INVALID_AMOUNT/.test(code)) return "invalidAmount";
  if (/Insufficient|ERC20Insufficient/.test(code)) return "insufficient";
  if (/Unauthorized|NotManager|V2_SESSION|WRONG_ACCOUNT|WRONG_CHAIN/.test(code)) return "session";
  return "unavailable";
}
