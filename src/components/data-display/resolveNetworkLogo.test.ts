/**
 * @id PP-CORE-CMP-041
 * @name NetworkLogo resolver tests
 * @implements-rules-version v1 (POO-2347 rules v1)
 *
 * Pure tests of `resolveNetworkLogo`: the Solana logo for `solana` (R1), and the logos of the
 * other networks unchanged (R4).
 */
import { describe, expect, it } from "vitest";
import { resolveNetworkLogo } from "./NetworkLogo";

describe("resolveNetworkLogo", () => {
  // @rule R1
  it("returns the Solana preview asset for the network solana", () => {
    expect(resolveNetworkLogo("solana")).toBe("/protocols/solana-preview/solana.svg");
    expect(resolveNetworkLogo("Solana")).toBe("/protocols/solana-preview/solana.svg");
  });

  // @rule R4
  it("keeps the logos of the other networks", () => {
    expect(resolveNetworkLogo("ethereum")).toBe("/networks/ethereum.png");
    expect(resolveNetworkLogo("base")).toBe("/networks/base.png");
    expect(resolveNetworkLogo("arbitrum")).toBe("/networks/arbitrum.png");
    expect(resolveNetworkLogo("polygon")).toBe("/networks/polygon.png");
    expect(resolveNetworkLogo("robinhood")).toBe("/networks/robinhood.png");
    expect(resolveNetworkLogo("optimism")).toBeUndefined();
  });
});
