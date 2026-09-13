/** @id PP-CP-LIB-002 @name Cash+ exact amounts @implements-rules-version v1 */
const MAX_UINT256 = (BigInt("1") << BigInt("256")) - BigInt("1");

export function parseCashPlusAmount(value: string, decimals = 6): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || value.length > 120) {
    throw new Error("AMOUNT_INVALID");
  }
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error("AMOUNT_INVALID");
  const [integer = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("AMOUNT_INVALID");
  const raw =
    BigInt(integer) * BigInt("10") ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= BigInt("0") || raw > MAX_UINT256) throw new Error("AMOUNT_INVALID");
  return raw;
}
export function canonicalCashPlusAmount(value: string, locale: string): string {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((part) => part.type === "group")?.value ?? ",";
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^(?:0|[1-9]\\d*|[1-9]\\d{0,2}(?:${escapePattern(group)}\\d{3})+)(?:${escapePattern(decimal)}\\d+)?$`,
  );
  if (value.length > 120 || !pattern.test(value)) throw new Error("AMOUNT_INVALID");
  return value.split(group).join("").replace(decimal, ".");
}
export function sharesForAssets(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  if (assets <= BigInt("0") || totalAssets <= BigInt("0") || totalShares <= BigInt("0"))
    throw new Error("AMOUNT_INVALID");
  return (assets * totalShares + totalAssets - BigInt("1")) / totalAssets;
}
export function minimumAfterSlippage(amount: bigint, bps = 10): bigint {
  if (amount < BigInt("0") || !Number.isInteger(bps) || bps < 0 || bps > 10000)
    throw new Error("AMOUNT_INVALID");
  return (amount * BigInt(10000 - bps)) / BigInt("10000");
}
