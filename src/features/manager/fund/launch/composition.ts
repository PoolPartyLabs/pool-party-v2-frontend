/**
 * @id PP-MGR-LIB-030 (POO-2172)
 * @name launchComposition
 * @implements-rules-version v1
 * Range-derived v4 composition using decimal arithmetic and actual balances.
 */
import Decimal from "decimal.js";
import { formatUnits, parseUnits } from "viem";
import type { CatalogPool } from "@/lib/api/v2/schemas";

export function composition(pool: CatalogPool, lower: string, upper: string) {
  const price = new Decimal(pool.currentPrice.token1PerToken0);
  const minimum = new Decimal(lower);
  const maximum = new Decimal(upper);
  if (!price.isPositive() || !minimum.isPositive() || !maximum.gt(minimum))
    throw new Error("INVALID_RANGE");
  if (price.lte(minimum)) return { share0: new Decimal(1), share1: new Decimal(0) };
  if (price.gte(maximum)) return { share0: new Decimal(0), share1: new Decimal(1) };
  const current = price.sqrt();
  const value0 = maximum.sqrt().minus(current).mul(current).div(maximum.sqrt());
  const value1 = current.minus(minimum.sqrt());
  const total = value0.plus(value1);
  return { share0: value0.div(total), share1: value1.div(total) };
}
export function positionAmounts(
  pool: CatalogPool,
  balances: Record<string, bigint>,
  budgetRaw: bigint,
  base: string,
  lower: string,
  upper: string,
) {
  const split = composition(pool, lower, upper);
  const price = new Decimal(pool.currentPrice.token1PerToken0);
  const baseIndex = pool.tokens.findIndex(
    (token) => token.address.toLowerCase() === base.toLowerCase(),
  );
  if (baseIndex < 0) throw new Error("UNSUPPORTED_PAIR");
  const budget = new Decimal(formatUnits(budgetRaw, 6));
  const price0 = baseIndex === 0 ? new Decimal(1) : price;
  const price1 = baseIndex === 1 ? new Decimal(1) : new Decimal(1).div(price);
  const target0 = budget.mul(split.share0).div(price0);
  const target1 = budget.mul(split.share1).div(price1);
  const targets = [target0, target1];
  const available = pool.tokens.map(
    (token) =>
      new Decimal(formatUnits(balances[token.address.toLowerCase()] ?? BigInt(0), token.decimals)),
  );
  const factor = Decimal.min(
    1,
    ...targets.map((target, index) =>
      target.isZero() ? new Decimal(1) : available[index]!.div(target),
    ),
  );
  const amounts = targets.map((target, index) =>
    target.mul(factor).toFixed(pool.tokens[index]!.decimals, Decimal.ROUND_DOWN),
  );
  const swapShare = baseIndex === 0 ? split.share1 : split.share0;
  const requiredOther = baseIndex === 0 ? target1 : target0;
  const other = baseIndex === 0 ? 1 : 0;
  const deficitRatio = requiredOther.isZero()
    ? new Decimal(0)
    : Decimal.max(0, requiredOther.minus(available[other]!).div(requiredOther));
  const swapRaw = parseUnits(
    budget.mul(swapShare).mul(deficitRatio).toFixed(6, Decimal.ROUND_DOWN),
    6,
  );
  return {
    amount0: amounts[0]!,
    amount1: amounts[1]!,
    swapRaw,
    otherToken: pool.tokens[other]!.address,
  };
}
