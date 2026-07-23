/**
 * @id PP-REW (POO-210)
 * @name Daily quack message tests
 * @implements-rules-version v1
 *
 * [R2] The signed message must match the backend template byte-for-byte, else
 * recoverMessageAddress fails and the check-in is rejected (INVALID_SIGNATURE).
 */
import { describe, expect, it } from "vitest";
import { buildDailyQuackMessage, todayUtc } from "./quackMessage";

describe("buildDailyQuackMessage", () => {
  it("matches the backend template exactly", () => {
    const message = buildDailyQuackMessage("0xABCdef", "2026-06-10");
    expect(message).toBe(
      "Quack! 🦆\n\nPool Party daily check-in\n\nDate: 2026-06-10\n\nWallet: 0xABCdef",
    );
  });

  it("embeds the wallet verbatim (casing preserved for recovery parity)", () => {
    expect(buildDailyQuackMessage("0xAbC", "2026-01-01")).toContain("Wallet: 0xAbC");
  });
});

describe("todayUtc", () => {
  it("returns the UTC date as YYYY-MM-DD", () => {
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("equals the UTC slice of the current ISO timestamp", () => {
    expect(todayUtc()).toBe(new Date().toISOString().slice(0, 10));
  });
});
