/**
 * @id PP-REW (POO-210)
 * @name Daily quack message
 * @implements-rules-version v1
 *
 * Builds the daily Say Quack check-in message the connected wallet signs. The
 * template and the UTC date must match the backend (recordDailyQuack) exactly,
 * otherwise the recovered address won't match and the check-in is rejected.
 */

/** The current date in UTC as `YYYY-MM-DD` (the backend dedup key). */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build the exact message signed for the daily check-in. */
export function buildDailyQuackMessage(wallet: string, date: string): string {
  return `Quack! 🦆\n\nPool Party daily check-in\n\nDate: ${date}\n\nWallet: ${wallet}`;
}
