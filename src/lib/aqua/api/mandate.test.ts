// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MANDATES } from "./compiler/mandates";
import { aquaMandate, BAND_SLEEVE_PCT, CARRY_PCT, compositionSlices } from "./mandate";

describe("mandate view", () => {
  it("derives the sleeve from the compiler mandate rather than restating it", () => {
    expect(BAND_SLEEVE_PCT).toBe(MANDATES.production.bandSleevePct);
    expect(CARRY_PCT).toBe(100 - MANDATES.production.bandSleevePct);
  });

  it("names the two venues this strategy actually touches", () => {
    const protocols = aquaMandate().protocols.map((p) => p.label);
    expect(protocols).toEqual(["Aave v3", "1inch Aqua"]);
  });

  it("splits the protocol caps as carry plus band, summing to 100", () => {
    const { protocols } = aquaMandate();
    expect(protocols.reduce((sum, p) => sum + p.maxPct, 0)).toBe(100);
  });

  it("caps WETH at the sleeve, since a filled band converts exactly that much", () => {
    const assets = aquaMandate().assets;
    expect(assets.find((a) => a.label === "WETH")?.maxPct).toBe(BAND_SLEEVE_PCT);
    expect(assets.find((a) => a.label === "USDC")?.maxPct).toBe(100);
  });

  it("runs on Arbitrum only", () => {
    expect(aquaMandate().networks).toEqual(["Arbitrum"]);
  });
});

describe("composition slices", () => {
  it("weights by LIVE balances, not the designed split", () => {
    const slices = compositionSlices({
      parkedUsdc: BigInt(9_500_000),
      hotBufferUsdc: BigInt(500_000),
      wethValuedUsdc: BigInt(0),
    });
    expect(slices).toEqual([
      { label: "Lent on Aave", weight: 95 },
      { label: "Cash on hand", weight: 5 },
    ]);
  });

  it("includes the ETH leg once a band has filled", () => {
    const slices = compositionSlices({
      parkedUsdc: BigInt(5_000_000),
      hotBufferUsdc: BigInt(0),
      wethValuedUsdc: BigInt(5_000_000),
    });
    expect(slices?.map((s) => s.label)).toEqual(["Lent on Aave", "ETH bought"]);
    expect(slices?.every((s) => s.weight === 50)).toBe(true);
  });

  it("returns null on an empty vault so the section hides instead of showing an empty bar", () => {
    expect(
      compositionSlices({
        parkedUsdc: BigInt(0),
        hotBufferUsdc: BigInt(0),
        wethValuedUsdc: BigInt(0),
      }),
    ).toBeNull();
  });

  it("does not floor a small slice to zero and drop it silently", () => {
    const slices = compositionSlices({
      parkedUsdc: BigInt(999_000),
      hotBufferUsdc: BigInt(1_000),
      wethValuedUsdc: BigInt(0),
    });
    expect(slices?.find((s) => s.label === "Cash on hand")?.weight).toBeCloseTo(0.1, 5);
  });
});
