/**
 * @id PP-CORE-LIB-066 (POO-1134, POO-1136)
 * @name on-ramp balance-delta computation
 * @implements-rules-version v3 (POO-1129 rules v3) · v2 (POO-1129 rules v2)
 *
 * [R4] the observed balance delta is the authoritative amount, never the amount we requested or the
 * amount Paybis reported (the user can change both inside the widget). This module diffs two wallet
 * snapshots and returns every token whose balance GREW. Surplus stays in the wallet; a drop is never
 * reported as a purchase. Pure, so the exact-string arithmetic a downstream leg is sized from is
 * unit-tested without a widget.
 *
 * The exact path matters: {@link TokenBalance.amount} is a float (fine for display, wrong for sizing
 * a transaction — an 18-decimal balance loses its tail past ~17 significant digits and can round UP).
 * When both snapshots carry {@link TokenBalance.amountExact} the delta is computed in `Decimal` and
 * returned as an exact string, so POO-1135/1136 can size the swap/bridge from it without re-parsing a
 * display float. The degraded USDC-only read has no `amountExact`; the float delta still surfaces and
 * the exact figure is omitted rather than fabricated.
 */
import Decimal from "decimal.js";
import type { TokenBalance } from "@/lib/balances/types";
import { ONRAMP_CHAIN_ID } from "@/lib/provisioning/computeNeed";

/** A single token's positive balance change between two snapshots (a token that GREW). */
export interface TokenDelta {
  /** Chain the token lives on. */
  chainId: number;
  /** Token symbol, e.g. "USDC". */
  symbol: string;
  /** Token contract address (`0x000…000` for native), when the snapshot carried one. */
  address?: string;
  /** Token decimals (for base-unit conversion downstream). */
  decimals: number;
  /** The increase in human-readable units (float; display + detection). */
  amount: number;
  /** The increase in USD at read time. */
  usd: number;
  /**
   * The SAME increase as an exact decimal string, present only when BOTH snapshots carried
   * {@link TokenBalance.amountExact}. This is the base-unit-safe figure a downstream leg is sized
   * from ([R4]); a consumer that only displays the delta can keep reading {@link amount}.
   */
  amountExact?: string;
}

/** Chain + token identity: address when present (native is `0x0…0`), else the symbol. Lowercased. */
function tokenKey(balance: Pick<TokenBalance, "chainId" | "address" | "symbol">): string {
  return `${balance.chainId}:${(balance.address ?? balance.symbol).toLowerCase()}`;
}

/**
 * Every token whose balance increased from `before` to `after`. A token missing from `before` counts
 * from zero (the user bought a currency they held none of); a token missing from `after`, or one that
 * stayed flat or dropped, is excluded.
 */
export function computeTokenDeltas(before: TokenBalance[], after: TokenBalance[]): TokenDelta[] {
  const beforeByKey = new Map(before.map((balance) => [tokenKey(balance), balance]));
  const deltas: TokenDelta[] = [];

  for (const post of after) {
    const pre = beforeByKey.get(tokenKey(post));
    const amount = post.amount - (pre?.amount ?? 0);

    // Exact only when it can be exact: `after` has the string, and `before` either has it too or is
    // absent entirely (a new token diffs from an exact zero). A `before` row that lacks the string
    // cannot be subtracted exactly, so the delta falls back to the float and omits the exact figure.
    const exactComputable =
      post.amountExact !== undefined && (pre === undefined || pre.amountExact !== undefined);
    const amountExact = exactComputable
      ? new Decimal(post.amountExact as string).minus(pre?.amountExact ?? "0").toString()
      : undefined;

    // "Grew" is decided on the exact figure when available (no float noise), else on the float.
    const grew = amountExact !== undefined ? new Decimal(amountExact).gt(0) : amount > 0;
    if (!grew) continue;

    deltas.push({
      chainId: post.chainId,
      symbol: post.symbol,
      ...(post.address === undefined ? {} : { address: post.address }),
      decimals: post.decimals,
      amount,
      usd: post.usd - (pre?.usd ?? 0),
      ...(amountExact === undefined ? {} : { amountExact }),
    });
  }

  return deltas;
}

/** Whether any token grew: the settlement poll's stop condition ([R5]). */
export function hasPositiveDelta(deltas: TokenDelta[]): boolean {
  return deltas.length > 0;
}

/**
 * The Paybis currency code an on-ramp order buys, in chain+symbol terms. Paybis sells ONLY ETH and
 * USDC, both on Base, so this is the whole domain (v1's `getCurrencyCode`).
 *
 * POO-1136 (collapse): this is now the ONE exported union for "what the on-ramp bought". It used to
 * be declared twice, here as `OnRampExpectedToken` and in `sizeOnRampOrder.ts` as `OnRampCurrencyCode`,
 * with a note to reconcile them once the mint site held both an order and this hook. POO-1136 wires
 * that site, so the sizer now imports this type (type-only, so the pure delta domain still owns the
 * symbol and takes on no runtime dependency on the order sizer). `order.currencyCode` therefore
 * assigns straight into {@link selectPurchaseDeltas} with no mapping at the call site.
 */
export type OnRampCurrencyCode = "ETH-BASE" | "USDC-BASE";

/**
 * What each currency code resolves to on-chain. Paybis sells ONLY ETH and USDC on Base, so the chain
 * is {@link ONRAMP_CHAIN_ID} in both cases (imported, never a second `8453` literal).
 *
 * ## This table is why a DEV purchase never settles (POO-1626/POO-1627), and that is expected
 *
 * pool-party-api's POO-1605 substitutes our two production codes for their sandbox equivalents at the
 * VENDOR boundary, which is what made dev able to list methods, price a quote and open the widget at
 * all. It deliberately stops there ([R5] of `sandbox-currency-map.ts`: never on the settlement path),
 * so what we believe we RECEIVED stays in real codes. This table is that belief, and it is Base in
 * both rows, while a sandbox purchase delivers `USDC-SEPOLIA` / `ETH-SEPOLIA` on a testnet.
 *
 * So on dev the payment is taken and no Base delta ever arrives: the flow sits in its settling state
 * until `useOnRampSettlement` times out. Expected on dev, and NOT a settlement defect. POO-1627 owns
 * whether that timeout should say so out loud; do not "fix" it by teaching this table a testnet chain.
 */
const EXPECTED_TOKEN_SCOPE: Record<OnRampCurrencyCode, { chainId: number; symbol: string }> = {
  "ETH-BASE": { chainId: ONRAMP_CHAIN_ID, symbol: "ETH" },
  "USDC-BASE": { chainId: ONRAMP_CHAIN_ID, symbol: "USDC" },
};

/**
 * Whether a plain string is one of the two codes this module can scope a purchase to (POO-1136).
 *
 * `ProvisioningOrder.currencyCode` is typed `string` (it crosses the planner boundary as data), so the
 * rail cannot assert it into {@link OnRampCurrencyCode} and be right by construction. Without this,
 * an unexpected code makes the {@link EXPECTED_TOKEN_SCOPE} lookup `undefined` and destructuring it
 * throws a bare `TypeError` at SETTLEMENT time, i.e. after the user has paid. Checked against the
 * scope map itself with `Object.hasOwn`, so the domain is defined exactly once and an inherited
 * `Object.prototype` key (`"toString"`) can never pass.
 */
export function isOnRampCurrencyCode(value: string): value is OnRampCurrencyCode {
  return Object.hasOwn(EXPECTED_TOKEN_SCOPE, value);
}

/**
 * Narrow a delta set to the PURCHASE: growth on the on-ramp chain, in the token the order bought.
 *
 * [R4] "the balance delta is truth" means the delta of the purchase, not any delta that happens to
 * land inside the reconcile window. That window runs up to ten minutes ([R5]), which is ample room
 * for an unrelated inbound credit — a friend's transfer, another tab's swap, a bridge that finally
 * cleared — and an unscoped detector would settle the flow on it and hand the downstream legs
 * (POO-1135/1136) a `deltaByToken` that is not the money the user just bought.
 *
 * Scoping is possible precisely because the on-ramp's output is knowable in advance: Paybis only ever
 * sells ETH or USDC on Base, and `sizeOnRampOrder` (POO-1133) has already picked which. So the
 * expected token is an INPUT, never inferred from whatever showed up.
 *
 * A surplus in some other token still stays in the wallet; it is simply not evidence of this
 * purchase, so it neither settles the flow nor is reported as its delta.
 */
export function selectPurchaseDeltas(
  deltas: TokenDelta[],
  expectedToken: OnRampCurrencyCode,
): TokenDelta[] {
  const { chainId, symbol } = EXPECTED_TOKEN_SCOPE[expectedToken];
  return deltas.filter(
    (delta) => delta.chainId === chainId && delta.symbol.toUpperCase() === symbol,
  );
}
