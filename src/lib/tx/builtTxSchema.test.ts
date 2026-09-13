/**
 * @id PP-TX (POO-352)
 * @name builtTxSchema — validation
 * Behavior: the built-tx the client signs+broadcasts is shape-validated (0x address / 0x-hex data /
 * wei value) so a malformed or substituted build response is rejected before it reaches the wallet.
 */
import { describe, expect, it } from "vitest";
import { builtTxSchema } from "./builtTxSchema";

const VALID = {
  tx: {
    to: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    from: "0x1111111111111111111111111111111111111111",
    data: "0x095ea7b3000000000000000000000000",
    value: "0",
  },
  estimatedGasInUsd: 1.23,
};

describe("builtTxSchema", () => {
  it("accepts a well-formed built tx (checksummed address, 0x calldata, decimal wei value)", () => {
    expect(builtTxSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts an omitted value/from and an empty 0x data (plain transfer)", () => {
    const r = builtTxSchema.safeParse({ tx: { to: VALID.tx.to, data: "0x" } });
    expect(r.success).toBe(true);
  });

  it("accepts a 0x-hex value (alongside the decimal form)", () => {
    const r = builtTxSchema.safeParse({ tx: { ...VALID.tx, value: "0xde0b6b3a7640000" } });
    expect(r.success).toBe(true);
  });

  it("[POO-824 R4] accepts an optional numeric chainId and rejects a non-integer one", () => {
    const withChain = builtTxSchema.safeParse({ ...VALID, chainId: 8453 });
    expect(withChain.success).toBe(true);
    if (withChain.success) expect(withChain.data.chainId).toBe(8453);
    // Absent stays fine (the API does not return it yet, POO-825).
    expect(builtTxSchema.safeParse(VALID).success).toBe(true);
    expect(builtTxSchema.safeParse({ ...VALID, chainId: "8453" }).success).toBe(false);
    expect(builtTxSchema.safeParse({ ...VALID, chainId: 1.5 }).success).toBe(false);
  });

  it("rejects a `to` that is not a 0x address", () => {
    expect(builtTxSchema.safeParse({ tx: { to: "0xc", data: "0x" } }).success).toBe(false);
    expect(builtTxSchema.safeParse({ tx: { to: "not-an-address", data: "0x" } }).success).toBe(
      false,
    );
  });

  it("rejects non-0x-hex calldata", () => {
    expect(builtTxSchema.safeParse({ tx: { to: VALID.tx.to, data: "deadbeef" } }).success).toBe(
      false,
    );
    expect(builtTxSchema.safeParse({ tx: { to: VALID.tx.to, data: "0xZZ" } }).success).toBe(false);
  });

  it("rejects a non-numeric / non-hex value (e.g. an injected expression)", () => {
    expect(builtTxSchema.safeParse({ tx: { ...VALID.tx, value: "1e18" } }).success).toBe(false);
    expect(builtTxSchema.safeParse({ tx: { ...VALID.tx, value: "-1" } }).success).toBe(false);
  });

  // POO-827 (POO-811): the collect build's manager performance-fee estimate is an optional
  // top-level USD figure — parsed when present, tolerated when absent (absent = no line).
  describe("performanceFeeInUsd (POO-811)", () => {
    it("parses the optional performance-fee estimate on a collect build", () => {
      const r = builtTxSchema.safeParse({ ...VALID, performanceFeeInUsd: 1.2 });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.performanceFeeInUsd).toBe(1.2);
    });

    it("tolerates its absence (manager collect / no fee / non-collect builds)", () => {
      const r = builtTxSchema.safeParse(VALID);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.performanceFeeInUsd).toBeUndefined();
    });
  });

  // POO-1826: every build-tx response now advertises a gas LIMIT (`tx.gas`, the on-chain estimate
  // x 1.25). A Pool Party manager write is a 13-frame call graph, and EIP-150's 63/64 rule strands
  // ~7% of any limit, so a wallet broadcasting at its own bare estimate runs out of gas in the
  // deepest frame and fails with EMPTY revert data. The schema is the first place the limit has to
  // survive, and an older API that omits it must keep parsing.
  describe("tx.gas (POO-1826)", () => {
    // @rule R1
    it("accepts an optional decimal-string gas limit", () => {
      const r = builtTxSchema.safeParse({ ...VALID, tx: { ...VALID.tx, gas: "4150329" } });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.tx.gas).toBe("4150329");
    });

    // @rule R1
    it("accepts a 0x-hex gas limit (the same shape `value` takes)", () => {
      const r = builtTxSchema.safeParse({ ...VALID, tx: { ...VALID.tx, gas: "0x3f52b9" } });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.tx.gas).toBe("0x3f52b9");
    });

    // @rule R1
    it("keeps validating a response WITHOUT gas (the field is advisory, older builds omit it)", () => {
      const r = builtTxSchema.safeParse(VALID);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.tx.gas).toBeUndefined();
    });

    // @rule R1
    it("rejects a gas that is not an integer quantity (it is signed into the wallet request)", () => {
      expect(builtTxSchema.safeParse({ ...VALID, tx: { ...VALID.tx, gas: "4.1e6" } }).success).toBe(
        false,
      );
      expect(builtTxSchema.safeParse({ ...VALID, tx: { ...VALID.tx, gas: "-1" } }).success).toBe(
        false,
      );
      expect(builtTxSchema.safeParse({ ...VALID, tx: { ...VALID.tx, gas: 4150329 } }).success).toBe(
        false,
      );
    });

    // @rule R3
    it("leaves the DISPLAYED fee on its own field: the limit is a ceiling, not a charge", () => {
      const r = builtTxSchema.safeParse({ ...VALID, tx: { ...VALID.tx, gas: "4150329" } });
      expect(r.success).toBe(true);
      // The network-fee line keeps reading the API's unpadded estimate, untouched by the limit.
      if (r.success) expect(r.data.estimatedGasInUsd).toBe(VALID.estimatedGasInUsd);
    });
  });

  // POO-610: the build-tx response carries a `swapInfo` block (price impact + protocol fee + min
  // received). It is DISPLAY-ONLY, strictly numeric, and must never break the tx parse it rides on.
  describe("swapInfo (POO-610)", () => {
    const SWAP_INFO = {
      priceImpactPercentage: 0.42,
      protocolFee: 0.004,
      minAmountInStable: 987.65,
    };

    it("parses and surfaces the three numeric swapInfo fields when present", () => {
      const r = builtTxSchema.safeParse({ ...VALID, swapInfo: SWAP_INFO });
      expect(r.success).toBe(true);
      expect(r.success && r.data.swapInfo).toEqual(SWAP_INFO);
    });

    it("parses fine when swapInfo is absent (optional, no-swap / mock builds)", () => {
      const r = builtTxSchema.safeParse(VALID);
      expect(r.success).toBe(true);
      expect(r.success && r.data.swapInfo).toBeUndefined();
    });

    it("drops a malformed swapInfo to undefined WITHOUT rejecting the tx it rides on", () => {
      // A non-numeric field must not smuggle a displayable non-number, nor block a legitimate signing.
      const r = builtTxSchema.safeParse({
        ...VALID,
        swapInfo: { priceImpactPercentage: "50%", protocolFee: 0.004, minAmountInStable: 1 },
      });
      expect(r.success).toBe(true);
      expect(r.success && r.data.swapInfo).toBeUndefined();
    });

    it("strips unknown swapInfo keys but keeps the three known numbers", () => {
      const r = builtTxSchema.safeParse({
        ...VALID,
        swapInfo: { ...SWAP_INFO, feeTier: 3000, note: "<script>" },
      });
      expect(r.success).toBe(true);
      expect(r.success && r.data.swapInfo).toEqual(SWAP_INFO);
    });
  });
});
