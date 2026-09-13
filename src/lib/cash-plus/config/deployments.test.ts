/** @id PP-CP-LIB-004 @name Cash+ manifest rules @implements-rules-version v1 */
import { describe, expect, it } from "vitest";
import { parseCashPlusDeployment } from "./deployments";

import { manifestFixture } from "./testFixture";

describe("Cash+ manifest validation", () => {
  // @rule R9: deployment mode, chain and local RPC binding cannot be confused.
  it("accepts an explicit local fork", () =>
    expect(parseCashPlusDeployment(manifestFixture).chainId).toBe(31337));
  it.each([
    { chainId: 42161 },
    { rpcUrl: "https://arb1.arbitrum.io/rpc" },
    { rpcUrl: "http://secret:password@127.0.0.1:8549" },
    { rpcUrl: "http://127.0.0.1:8549?apiKey=secret" },
    { vault: `0x${"0".repeat(40)}` },
    { deploymentBlock: "0" },
    { codeHashes: [] },
  ])("rejects inconsistent or unsafe binding %j", (change) => {
    expect(() => parseCashPlusDeployment({ ...manifestFixture, ...change })).toThrow(
      "DEPLOYMENT_INVALID",
    );
  });
  it("does not accept a missing live manifest or fixture fallback", () => {
    expect(() => parseCashPlusDeployment(null)).toThrow("DEPLOYMENT_INVALID");
    expect(() => parseCashPlusDeployment({ ...manifestFixture, mode: "live" })).toThrow(
      "DEPLOYMENT_INVALID",
    );
  });
});
