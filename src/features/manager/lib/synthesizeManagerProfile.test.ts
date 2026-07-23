/**
 * @id PP-MGR-LIB-003
 * @name synthesizeManagerProfile.test
 * Behavior: an address-only manager profile has empty display fields and stats computed from its
 * strategies (POO-631 R1/R2).
 */
import { describe, expect, it } from "vitest";
import type { Strategy } from "@/lib/schemas";
import { synthesizeManagerProfile } from "./synthesizeManagerProfile";

/** A minimal real-shaped Strategy for the stat math (only the fields the helper reads matter). */
function strategy(overrides: Partial<Strategy>): Strategy {
  return {
    id: "s",
    name: "S",
    manager: "0x1234…5678",
    riskLevel: 3,
    minInvestment: 100,
    tvl: 0,
    investors: 0,
    estReturn: 0,
    rateType: "APR",
    status: "active",
    ...overrides,
  };
}

const ADDRESS = "0x77d2e9a1b3c5d7f9a0b1c2d3e4f5a6b7c8d9e0f1";

describe("synthesizeManagerProfile (POO-631)", () => {
  it("[R1] leaves the display fields empty and carries the address", () => {
    const profile = synthesizeManagerProfile(ADDRESS, [strategy({ tvl: 100 })]);
    expect(profile.address).toBe(ADDRESS);
    expect(profile.name).toBe("");
    expect(profile.bio).toBe("");
    expect(profile.handle).toBe("");
    expect(profile.sinceLabel).toBe("");
    expect(profile.managerVerification).toBe("none");
    expect(profile.socials).toEqual({});
  });

  it("[R2] sums AUM + investors, counts strategies, and TVL-weights the rate", () => {
    const profile = synthesizeManagerProfile(ADDRESS, [
      strategy({ tvl: 300_000, investors: 40, estReturn: 10 }),
      strategy({ tvl: 100_000, investors: 12, estReturn: 2 }),
    ]);
    expect(profile.stats.aum).toBe(400_000);
    expect(profile.stats.investors).toBe(52);
    expect(profile.stats.strategies).toBe(2);
    // (10*300k + 2*100k) / 400k = 8
    expect(profile.stats.avgApy).toBe(8);
  });

  it("[R2] falls back to a simple mean when total TVL is 0", () => {
    const profile = synthesizeManagerProfile(ADDRESS, [
      strategy({ tvl: 0, estReturn: 6 }),
      strategy({ tvl: 0, estReturn: 4 }),
    ]);
    expect(profile.stats.aum).toBe(0);
    expect(profile.stats.avgApy).toBe(5);
  });

  it("[R2] returns zeroed stats for an empty strategy list", () => {
    const profile = synthesizeManagerProfile(ADDRESS, []);
    expect(profile.stats).toEqual({ aum: 0, investors: 0, strategies: 0, avgApy: 0 });
  });
});
