/**
 * @id PP-AQUA-FMT
 * @name Active Reserve display formatting
 * @implements-rules-version v3
 *
 * Raw integer token units in, human strings out. Everything crossing this boundary is a
 * STRING, never a JS number: a WETH amount is up to 1e18 and `Number` silently loses
 * precision well before that. Values are parsed to `bigint`, divided exactly, and only the
 * already-truncated fractional part is ever handed to a float-free string build.
 *
 * IDX-R6, the transaction-display rule: a token amount is always shown with its unit.
 */

/**
 * Exact decimal division of a raw integer amount. No floats anywhere in this function.
 *
 * `minFractionDigits` exists for money: a currency column where 190 renders as "$190" and
 * 190.5 as "$190.50" does not line up and reads as two different kinds of number. Token
 * amounts keep the default of 0 and trim, because "0.5100 ETH" is just noise.
 *
 * Fractions are TRUNCATED, never rounded, so a displayed balance can never exceed the real one.
 */
export function formatUnits(
  raw: string | bigint,
  decimals: number,
  maxFractionDigits = 6,
  minFractionDigits = 0,
): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").slice(0, maxFractionDigits);
  const trimmed = fraction.replace(/0+$/, "");
  const shown =
    trimmed.length >= minFractionDigits ? trimmed : fraction.slice(0, minFractionDigits);
  const wholeGrouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeGrouped}${shown ? `.${shown}` : ""}`;
}

/** Chainlink 8dp answer to a display price. Always two decimals. */
export function formatUsdPrice(e8: string | bigint): string {
  return `$${formatUnits(e8, 8, 2, 2)}`;
}

/** Always two decimals: money in a column must align. */
export function formatUsdc(raw: string | bigint): string {
  return `$${formatUnits(raw, 6, 2, 2)}`;
}

export function formatWeth(raw: string | bigint): string {
  return `${formatUnits(raw, 18, 4)} ETH`;
}

/**
 * Percentage share of a total, for the sleeve split. Returns null when the total is zero so
 * the view can hide the bar instead of rendering a meaningless 0% (FE-R7).
 */
export function shareOfTotal(part: string | bigint, total: string | bigint): number | null {
  const p = typeof part === "bigint" ? part : BigInt(part || "0");
  const t = typeof total === "bigint" ? total : BigInt(total || "0");
  if (t <= BigInt(0)) return null;
  // Scale before dividing so integer division does not floor everything to 0.
  return Number((p * BigInt(10_000)) / t) / 100;
}

/**
 * Human countdown to a unix-seconds deadline. `now` is injected so the value is testable and
 * so a server render and its test agree.
 */
export function formatCountdown(deadlineSeconds: string, now: Date): string {
  if (!deadlineSeconds) return "";
  const remaining = Number(BigInt(deadlineSeconds) - BigInt(Math.floor(now.getTime() / 1000)));
  if (remaining <= 0) return "expired";
  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Where the band sits relative to spot, as a signed percentage. */
export function percentFromSpot(edgeE8: string, spotE8: string): number | null {
  if (!edgeE8 || !spotE8) return null;
  const edge = BigInt(edgeE8);
  const spot = BigInt(spotE8);
  if (spot <= BigInt(0)) return null;
  return Number(((edge - spot) * BigInt(10_000)) / spot) / 100;
}

export function arbiscanTx(hash: string): string {
  return `https://arbiscan.io/tx/${hash}`;
}

export function arbiscanAddress(address: string): string {
  return `https://arbiscan.io/address/${address}`;
}

export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}...${hash.slice(-4)}` : hash;
}
