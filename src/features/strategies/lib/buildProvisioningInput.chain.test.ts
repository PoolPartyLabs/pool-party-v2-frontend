/**
 * @id PP-STR-LIB-004 (POO-1549)
 * @name buildProvisioningInput — the demo runs on the operation's chain
 * @implements-rules-version v3 (POO-1549 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1549 rules v1):
 *   [R1] the mock gate input targets the OPERATION's chain, and keeps the fixture default when the
 *        network could not be resolved.
 *   [R2] each scenario keeps its story relative to that chain: the gas case starts ON target, the
 *        invest case starts OFF it.
 *   [R3] all three supported chains demo correctly.
 *
 * The reported defect: every invest presented as bridging to Arbitrum and the five non-spending
 * operations as needing gas on Base, whatever the strategy was actually on, because the resolved chain
 * was never handed to the builder. Two thirds of the network coverage had never been seen on a preview.
 */
import { describe, expect, it } from "vitest";
import { supportedChains } from "@/lib/chains/config";
import { computeProvisioningNeed } from "@/lib/provisioning";
import { mockProvisioningInput } from "./buildProvisioningInput";

const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

describe("mockProvisioningInput — the operation's chain (POO-1549)", () => {
  // @rule POO-1549 R1/R3 — the invest demo lands where the operation runs. This is the assertion the
  // defect fails on all three chains, including Arbitrum, where it passed by coincidence.
  it.each([BASE, POLYGON, ARBITRUM])("[R1] targets chain %i for an invest", (chainId) => {
    const input = mockProvisioningInput("invest", 100, chainId);

    expect(input.targetChainId).toBe(chainId);
  });

  it.each([
    BASE,
    POLYGON,
    ARBITRUM,
  ])("[R1] targets chain %i for an operation that spends no USDC", (chainId) => {
    const input = mockProvisioningInput("withdraw", undefined, chainId);

    expect(input.targetChainId).toBe(chainId);
  });

  /**
   * @rule POO-1549 R2 — the story survives the parameterisation, which is the half a naive fix breaks.
   *
   * `usdcBridgeGas` exists to demo "your money is on the wrong network". Had the source chain stayed
   * the baked `BASE`, a Base operation would have demoed a bridge from Base to Base: the fixture would
   * still be named for a bridge while the plan had none, and the one screen the scenario exists to show
   * would be unreachable on that chain.
   */
  it.each([BASE, POLYGON, ARBITRUM])("[R2] starts an invest OFF chain %i", (chainId) => {
    const input = mockProvisioningInput("invest", 100, chainId);

    expect(input.currentChainId).not.toBe(chainId);
    // And on a chain the app actually supports, never an invented one.
    expect(supportedChains.map((chain) => chain.id)).toContain(input.currentChainId);
  });

  /**
   * And the route really does need a bridge, EXCEPT on Base, which is not a gap in the fix.
   *
   * `usdcBridgeGas` holds no USDC anywhere (`usdcBalanceUsd: 0`), and the purchase always lands on
   * Base (`ONRAMP_CHAIN_ID`), so with Base as the target there is nothing to bridge: buy on Base, use
   * it on Base. `computeProvisioningNeed` says exactly that through `fundableFromAnotherChain`, and a
   * test that demanded a bridge there would be demanding a leg the route has no reason to run.
   */
  it.each([POLYGON, ARBITRUM])("[R2] needs a bridge to reach chain %i", (chainId) => {
    expect(computeProvisioningNeed(mockProvisioningInput("invest", 100, chainId)).needsBridge).toBe(
      true,
    );
  });

  it("[R2] needs no bridge on Base, where the purchase already lands", () => {
    const need = computeProvisioningNeed(mockProvisioningInput("invest", 100, BASE));

    expect(need.needsBridge).toBe(false);
    // Still a real gate, though: the money has to be bought and the chain has no gas.
    expect(need.needed).toBe(true);
    expect(need.reason).toContain("usdc");
  });

  // @rule POO-1549 R2 — the mirror image: `gasOnly` is "gas missing on the operation's OWN chain", so
  // the wallet has to be standing on it. A wallet elsewhere would demo a different problem.
  it.each([BASE, POLYGON, ARBITRUM])("[R2] starts a gas-only operation ON chain %i", (chainId) => {
    const input = mockProvisioningInput("collect", undefined, chainId);

    expect(input.currentChainId).toBe(chainId);
    const need = computeProvisioningNeed(input);
    expect(need.variant).toBe("gas-only");
    expect(need.targetChainId).toBe(chainId);
  });

  /**
   * @rule POO-1549 R1 — an unresolvable network slug keeps the fixture default.
   *
   * Real mode already treats an unknown network as non-triggering (`useProvisioningGate` refuses to
   * gate without a resolved chain), so inventing one here would make mock mode the only place a bad
   * slug produces a confident answer.
   */
  it("[R1] keeps the fixture default when no chain resolved", () => {
    const input = mockProvisioningInput("invest", 100, undefined);

    expect(input.targetChainId).toBe(ARBITRUM);
    expect(input.currentChainId).toBe(BASE);
  });

  // The amount is still the user's, which is what sizes the on-ramp realistically. Pinned here because
  // the parameterisation rebuilt the object and an override applied in the wrong order would drop it.
  it("carries the entered amount through the chain override", () => {
    expect(mockProvisioningInput("invest", 250, POLYGON).opRequiredUsdc).toBe(250);
    // A non-spending operation asks the wallet for no USDC whatever the amount ([R3] of POO-1042).
    expect(mockProvisioningInput("withdraw", 250, POLYGON).opRequiredUsdc).toBe(0);
  });
});
