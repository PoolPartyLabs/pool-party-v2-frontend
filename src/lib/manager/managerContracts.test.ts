/**
 * @id PP-MGR (POO-306)
 * @name Manager contracts tests
 * @implements-rules-version v1
 *
 * Returns null for unconfigured / invalid addresses (env unset in tests).
 */
import { describe, expect, it } from "vitest";
import { poolPartyManagerAddress } from "./managerContracts";

describe("poolPartyManagerAddress", () => {
  it("returns null when the env address is unset (dormant until configured)", () => {
    expect(poolPartyManagerAddress("arbitrum")).toBeNull();
    expect(poolPartyManagerAddress("base")).toBeNull();
  });

  it("returns null for an unsupported network", () => {
    expect(poolPartyManagerAddress("solana")).toBeNull();
  });
});
