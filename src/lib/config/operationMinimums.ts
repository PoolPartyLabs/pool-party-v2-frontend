/**
 * @id PP-CORE
 * @name Operation minimums (env-configurable)
 * @implements-rules-version v1
 *
 * USD minimums for investor/manager operations, read from NEXT_PUBLIC_* at build time so each
 * environment can lower them to test with smaller values (mirrors pool-party-interface). Defaults
 * are the production floors; e.g. `.env.dev` sets NEXT_PUBLIC_MIN_AMOUNT_FOR_ADD_LIQUIDITY=1.
 *
 * Env reads are LITERAL (not via a dynamic key) so Next.js inlines each value at build time, the
 * same way `managerContracts.ts` reads the manager addresses.
 *
 * PP-INTEGRATION-POINT: none — a build-time config knob, not a backend call.
 */

/**
 * Parse a USD-minimum env string into a number. Empty, unset, non-numeric, or negative values fall
 * back to `fallback` so a malformed override can never disable or invert a minimum.
 */
export function readUsdMinimum(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Minimum invest / add-liquidity amount in USD. Production floor is 10; an environment may lower it
 * (e.g. dev = 1) to test the flow with small amounts. Managers may still require more, never less.
 */
export const MIN_AMOUNT_FOR_ADD_LIQUIDITY = readUsdMinimum(
  process.env.NEXT_PUBLIC_MIN_AMOUNT_FOR_ADD_LIQUIDITY,
  10,
);

/**
 * Minimum total USD value to create a pool/strategy (the manager's seed deposit). Production floor is
 * 20; an environment may lower it (e.g. dev = 2) to test pool creation with small amounts.
 */
export const MIN_AMOUNT_FOR_CREATE_POOL = readUsdMinimum(
  process.env.NEXT_PUBLIC_MIN_AMOUNT_FOR_CREATE_POOL,
  20,
);

/**
 * Minimum collectable yield in USD (POO-802 R10, POO-799 decision #4: Collect only — Withdraw has
 * no equivalent floor). Production floor is 0.10; an environment may lower it to test tiny yields.
 * Below it the Collect CTA disables with a hint: gas would dwarf the payout.
 */
export const MIN_COLLECT_USD = readUsdMinimum(process.env.NEXT_PUBLIC_MIN_COLLECT_USD, 0.1);
