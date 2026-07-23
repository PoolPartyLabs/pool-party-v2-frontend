/**
 * @id PP-BALANCES (POO-814)
 * @name groupWalletBalances
 * @implements-rules-version v1
 * Splits the connected wallet's holdings into the wallet-modal's two display groups: USDC first
 * (across every network), then all other tokens, each sorted by USD value descending, with dust
 * (< $1) hidden from both. Pure and presentation-only — the modal total is a Σ over ALL holdings
 * (incl. hidden dust), computed elsewhere, so this never drives the total.
 *
 * Business rules: POO-814 [R1, R2, R3, R7].
 */
import type { TokenBalance } from "./types";

/** Rows worth strictly less than this (USD) are hidden from the list (POO-814 [R3]). */
export const MIN_DISPLAY_USD = 1;

/** The wallet modal's two token groups, each filtered (>= $1) and sorted by USD desc. */
export interface WalletBalanceGroups {
  /** USDC holdings across every network (the top group). */
  usdc: TokenBalance[];
  /** Every non-USDC holding (below the divider). */
  others: TokenBalance[];
}

/** True when a holding is USDC on any network ([R7], case-insensitive). */
function isUsdc(balance: TokenBalance): boolean {
  return balance.symbol.toUpperCase() === "USDC";
}

/** Sort a copy by USD value, descending ([R2]). */
function byUsdDesc(balances: TokenBalance[]): TokenBalance[] {
  return [...balances].sort((a, b) => b.usd - a.usd);
}

/**
 * Group holdings for the wallet modal: USDC first, then the rest, each dust-filtered ([R3]) and
 * sorted by USD desc ([R2]). See {@link WalletBalanceGroups}.
 */
export function groupWalletBalances(balances: TokenBalance[]): WalletBalanceGroups {
  const shown = balances.filter((balance) => balance.usd >= MIN_DISPLAY_USD);
  return {
    usdc: byUsdDesc(shown.filter(isUsdc)),
    others: byUsdDesc(shown.filter((balance) => !isUsdc(balance))),
  };
}
