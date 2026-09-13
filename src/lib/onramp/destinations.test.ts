/**
 * @id PP-CORE-LIB-106 (POO-1801, POO-1784, POO-1916) - tests
 * @name on-ramp destinations - tests
 * @implements-rules-version v3 (POO-1916 rules v1) · v2 (POO-1784 rules v1) · v1 (POO-1801 rules v1)
 * @analytics-events none, the module builds a destination object and emits nothing.
 *
 * [R2] The address must be READ, never retyped. So the assertions below compare against
 * `supportedChainMetas`' own value by IDENTITY OF SOURCE: a test that pasted
 * `0x833589fC...` would pass just as happily against a second literal in the module, which is
 * precisely the duplication this module exists to prevent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROBINHOOD_CHAIN_ID, supportedChainMetas } from "@/lib/chains/config";
import { onRampCanDeliverStable, usdcDestination } from "./destinations";

/** The registry entry for a chain, as the single source both the module and this test read. */
function metaFor(chainId: number) {
  const meta = supportedChainMetas.find((entry) => entry.chain.id === chainId);
  if (!meta) throw new Error(`unsupported chain in test setup: ${chainId}`);
  return meta;
}

const BASE = 8453;

describe("usdcDestination", () => {
  // @rule R2
  it("[R2] reads the asset address from the registry, never a second literal", () => {
    const meta = metaFor(BASE);
    expect(usdcDestination(BASE)).toEqual({
      chain: `eip155:${BASE}`,
      asset: meta.usdc.address,
    });
  });

  // @rule R2
  it("[R2] returns the registry's own Base address, by source and not by retyping", () => {
    // If someone adds a literal to the module, this still passes; what it pins is that the value
    // TRACKS the registry. The guard against a second literal is the next test.
    const fromRegistry = metaFor(BASE).usdc.address;
    expect(usdcDestination(BASE)?.asset).toBe(fromRegistry);
    // And the registry is genuinely the Base USDC contract, not an empty slot.
    expect(fromRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  // @rule R2
  it("[R2] holds no hardcoded address of its own", () => {
    // The rule is "never written twice", so it is asserted against the SOURCE, the same way
    // `csp.test.ts` and `registry.test.ts` pin decisions that a value check cannot see.
    const source = readFileSync(join(__dirname, "destinations.ts"), "utf8");
    expect(source).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });

  // @rule R2
  it("[R2] stays generic over the registry, so every chain whose stable IS USDC answers", () => {
    // Base-only is a CALLER decision for v1 (D8); the function itself is not narrowed to it, or the
    // second chain to ship fiat would need a new module rather than a new caller. What it IS
    // narrowed to is the asset: the registry's `usdc` slot is the STABLE slot, and only the chains
    // whose stable is genuinely USDC are destinations for a USDC purchase.
    const usdcChains = supportedChainMetas.filter((meta) => meta.usdc.symbol === "USDC");
    expect(usdcChains.length).toBeGreaterThan(0);
    for (const meta of usdcChains) {
      expect(usdcDestination(meta.chain.id)).toEqual({
        chain: `eip155:${meta.chain.id}`,
        asset: meta.usdc.address,
      });
    }
  });

  // @rule R2
  it("[R2] refuses a supported chain whose stable is not USDC", () => {
    // Robinhood Chain (4663) ships in `supportedChainMetas` with USDG in the `usdc` slot. Naming it
    // as a USDC destination would send a buyer's dollars to a token nobody asked for; the whole
    // registry is swept so a fourth chain with a different stable cannot slip through either.
    for (const meta of supportedChainMetas) {
      if (meta.usdc.symbol === "USDC") continue;
      expect(usdcDestination(meta.chain.id)).toBeUndefined();
    }
    expect(metaFor(ROBINHOOD_CHAIN_ID).usdc.symbol).not.toBe("USDC");
    expect(usdcDestination(ROBINHOOD_CHAIN_ID)).toBeUndefined();
  });

  // @rule R2
  it("[R2] refuses an unsupported chain rather than inventing a destination", () => {
    expect(usdcDestination(1)).toBeUndefined();
    expect(usdcDestination(Number.NaN)).toBeUndefined();
    expect(usdcDestination(ROBINHOOD_CHAIN_ID)).toBeUndefined();
  });
});

/**
 * POO-1784 [R1]: the predicate the ROUTE PICKER and the PLANNER share.
 *
 * POO-1916 [R1] takes the "same fact read twice" apart. It was composed from {@link usdcDestination}
 * on the premise that the leg carrying a purchase onwards is a SAME-TOKEN bridge, so the only stable
 * a card could ever land was the one the rail sells. Probed live on 2026-09-11 and again on
 * 2026-09-12, `USDC(8453) -> USDG(4663)` answers `200` with `routing: "BRIDGE"`: the bridge carries
 * stable-to-stable across chains, so where the RAMP delivers (Base USDC, fixed) and what the BRIDGE
 * lands on the target are two different questions and this one is no longer the other's shadow.
 *
 * What stays static here is only what the registry can answer: does this app know a stable address
 * on that chain at all. Whether the bridge will actually carry the pair is LIVE ([R3]), asked by
 * `buildPlan.buildOnRampSteps` against `/quote` and degraded there exactly as a `404` already is.
 */
describe("onRampCanDeliverStable", () => {
  // @rule R1
  it("[R1] answers yes for every chain the registry names a stable on", () => {
    expect(supportedChainMetas.length).toBeGreaterThan(0);
    for (const meta of supportedChainMetas) {
      expect(onRampCanDeliverStable(meta.chain.id)).toBe(true);
    }
  });

  // @rule R1
  it("[R1] answers YES for Robinhood Chain, because the bridge delivers USDG", () => {
    // The reversal. POO-1784 read this as `false` from "the bridge is same-token"; the live probe
    // says the bridge quotes `USDC(8453) -> USDG(4663)` at `200`, so a fiat purchase does reach a
    // Robinhood strategy in one bridge call and suppressing it withheld a route that works.
    expect(metaFor(ROBINHOOD_CHAIN_ID).usdc.symbol).not.toBe("USDC");
    expect(onRampCanDeliverStable(ROBINHOOD_CHAIN_ID)).toBe(true);
  });

  // @rule R1
  it("[R1] answers no for a chain this app does not ship", () => {
    // The pre-POO-1784 planner said TRUE here: `stableSymbol` degrades an unknown chain to "USDC",
    // so an id outside the registry compared equal to Base's and would have been offered a purchase
    // it has no address to deliver to. Reading the registry slot itself closes that by construction,
    // and keeps closing it now that the symbol comparison is gone.
    expect(onRampCanDeliverStable(1)).toBe(false);
    expect(onRampCanDeliverStable(Number.NaN)).toBe(false);
  });

  // @rule R1
  it("[R1] is NOT the boolean shadow of usdcDestination any more", () => {
    // Trap: the two functions answer DIFFERENT questions and POO-1784 fused them. `usdcDestination`
    // says where the RAMP delivers, and it still refuses a non-USDC chain because the rail sells
    // USDC and nothing else. This one says whether a purchase can REACH that chain's stable, which
    // the bridge decides. Robinhood Chain is exactly the case where they must part company, and a
    // test that asserted they never do is what made the old behaviour look correct.
    expect(usdcDestination(ROBINHOOD_CHAIN_ID)).toBeUndefined();
    expect(onRampCanDeliverStable(ROBINHOOD_CHAIN_ID)).toBe(true);
  });

  // @rule R3
  it("[R3] claims nothing about live routability, only about the registry", () => {
    // The failure mode this test exists for: swapping one hardcoded assumption ("the target stable
    // must be USDC") for another ("4663 is fine"). Nothing here may name a chain id, and the answer
    // must be derivable from the registry alone, so the live question stays where it can be asked.
    const source = readFileSync(join(__dirname, "destinations.ts"), "utf8");
    const predicate = source.slice(source.indexOf("export function onRampCanDeliverStable"));
    expect(predicate).not.toMatch(/\b4663\b/);
    expect(predicate).not.toMatch(/\bUSDG\b/);
    // The right-hand side is the registry slot the predicate CLAIMS to read, not a restatement of
    // the loop's own membership in the array it is iterating: `some(entry.chain.id === meta.chain.id)`
    // is true by construction here, so the loop asserted `true === true` and would have passed
    // against a predicate rewritten as `return true`. The negative side is the `[R1]` case above.
    for (const meta of supportedChainMetas) {
      expect(onRampCanDeliverStable(meta.chain.id)).toBe(metaFor(meta.chain.id).usdc !== undefined);
    }
  });
});
