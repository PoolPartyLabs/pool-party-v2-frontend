/**
 * @id PP-CORE-LIB-106 (POO-1801) - tests
 * @name CAIP-2 chain identifiers - tests
 * @implements-rules-version v1 (POO-1801 rules v1)
 * @analytics-events none, a pure identifier translation emits nothing.
 *
 * [R1] The registry check is the whole point. `eip155:<id>` is trivial to build with a template
 * string, and a helper that did only that would be a rename of `String(chainId)`: what earns this
 * module its place is that it REFUSES an id this app does not ship, so a typo or a chain someone
 * removed from `supportedChainMetas` cannot reach a vendor as a well-formed identifier.
 */
import { describe, expect, it } from "vitest";
import { fromCaip2, toCaip2 } from "./caip2";
import { supportedChainMetas } from "./config";

describe("toCaip2", () => {
  // @rule R1
  it("[R1] renders every supported chain as eip155:<id>", () => {
    // Driven from the registry rather than a literal list, so adding a chain extends this test by
    // itself and removing one cannot leave a stale expectation passing.
    expect(supportedChainMetas.length).toBeGreaterThan(0);
    for (const meta of supportedChainMetas) {
      expect(toCaip2(meta.chain.id)).toBe(`eip155:${meta.chain.id}`);
    }
  });

  // @rule R1
  it("[R1] refuses an id the registry does not carry", () => {
    // Ethereum mainnet is the sharpest case: a real, famous chain that this app does not ship. A
    // helper that answered `eip155:1` here would hand a vendor a destination no balance of ours
    // lives on.
    expect(toCaip2(1)).toBeUndefined();
    expect(toCaip2(56)).toBeUndefined();
    expect(toCaip2(0)).toBeUndefined();
    expect(toCaip2(-1)).toBeUndefined();
    expect(toCaip2(Number.NaN)).toBeUndefined();
  });
});

describe("fromCaip2", () => {
  // @rule R1
  it("[R1] is the inverse for every supported chain", () => {
    for (const meta of supportedChainMetas) {
      expect(fromCaip2(`eip155:${meta.chain.id}`)).toBe(meta.chain.id);
    }
  });

  // @rule R1
  it("[R1] applies the SAME registry check on the way back", () => {
    // A parser that trusted the string would let a vendor tell us which chain we are on.
    expect(fromCaip2("eip155:1")).toBeUndefined();
    expect(fromCaip2("eip155:56")).toBeUndefined();
  });

  // @rule R1
  it("[R1] refuses anything that is not an eip155 decimal id", () => {
    const base = supportedChainMetas[0]?.chain.id ?? 8453;
    expect(fromCaip2(`solana:${base}`)).toBeUndefined();
    expect(fromCaip2(String(base))).toBeUndefined();
    expect(fromCaip2("eip155:")).toBeUndefined();
    expect(fromCaip2("eip155:abc")).toBeUndefined();
    // Hex and padded forms are not CAIP-2 decimal references, and accepting them would make two
    // spellings of one chain, which is how a comparison silently starts failing.
    expect(fromCaip2("eip155:0x2105")).toBeUndefined();
    expect(fromCaip2(`eip155:0${base}`)).toBeUndefined();
    expect(fromCaip2(` eip155:${base}`)).toBeUndefined();
    expect(fromCaip2("")).toBeUndefined();
  });
});
