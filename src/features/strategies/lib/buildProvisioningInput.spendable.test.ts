/**
 * @id PP-STR-LIB-004 (POO-1149)
 * @name buildProvisioningInput — only routable tokens can fund an operation
 * @implements-rules-version v4 (POO-1149 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * REGRESSION, POO-1149, reported as POO-1552 from production on 2026-08-11.
 *
 * A $1 invest on a **Base** strategy sent the user to `/deposit` and its $10 fiat minimum while 3.05
 * USDC sat on Arbitrum. The wallet held 3.2263 VIRTUAL on Base, worth $1.78, and `computeNeed` was
 * handed the gate context's RAW per-chain token USD, so that $1.78 counted as money able to fund the
 * operation:
 *
 *   `unmetOnTargetUsd = 1 + 0 − 1.78 = −0.78`  → `needsBridge` false
 *   `spendableUsd     = 1.78 + 3.05 = 4.83`    → `needsUsdc`   false
 *   `targetNativeUsd  = 3.25 (Base ETH)`       → `needsGas`    false
 *                                              → `needed`      FALSE, gate stands aside
 *
 * The same invest on Arbitrum gated correctly, because there the raw figure was genuinely short. One
 * chain worked, the other silently did not, and nothing was logged: standing aside is the gate's
 * designed answer to "nothing is missing", so the wrong input produced a confident wrong answer.
 *
 * The fixture below is that wallet, to the cent. The first test fails on the pre-fix assembly.
 */
import { describe, expect, it } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { computeProvisioningNeed } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { realProvisioningInput } from "./buildProvisioningInput";

const ARBITRUM = 42161;
const BASE = 8453;

const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const VIRTUAL_BASE = "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b";

function source(
  over: Partial<FundingSource> & Pick<FundingSource, "chainId" | "usd">,
): FundingSource {
  return {
    address: USDC_ARBITRUM,
    symbol: "USDC",
    decimals: 6,
    amount: "3050000",
    reachableChainIds: [BASE],
    isNative: false,
    logoUrl: "",
    ...over,
  } as FundingSource;
}

/**
 * The reported wallet: 3.05 USDC on Arbitrum, 0.0023 ETH on Arbitrum, 0.0017 ETH on Base, 3.2263
 * VIRTUAL on Base. Total $13.71.
 *
 * `sources` carries the ROUTABLE holdings, which is what the inventory returns; VIRTUAL is present
 * here on purpose, because the point is not that VIRTUAL is unroutable in general. `balancesByChain`
 * carries the RAW per-chain figures, VIRTUAL's $1.78 included, which is what the gate was reading.
 */
function reportedContext(targetChainId: number, over: Partial<ProvisioningGateContext> = {}) {
  return {
    targetChainId,
    sources: [source({ chainId: ARBITRUM, usd: 3.05 })],
    gasByChain: {},
    balancesByChain: {
      [ARBITRUM]: { nativeUsd: 4.38, tokenUsd: 3.05 },
      [BASE]: { nativeUsd: 3.25, tokenUsd: 1.78 },
    },
    gasEstimateUsd: 0.02,
    ...over,
  } as ProvisioningGateContext;
}

describe("realProvisioningInput — routable tokens only (POO-1149)", () => {
  /**
   * THE regression. A $1 invest on Base has to gate: the only thing on Base that could pay for it is
   * a token nothing offered to convert, and the USDC that can pay for it is on another chain, which is
   * precisely what the swap/bridge rail exists for.
   */
  it("[R1] gates a Base invest whose only on-chain token is not in the routable inventory", () => {
    const input = realProvisioningInput("invest", {
      context: reportedContext(BASE),
      amount: 1,
    });

    const need = computeProvisioningNeed(input);
    expect(need.needed).toBe(true);
    // And it gates for the right reason: the money exists, it is elsewhere. Not "go buy more".
    expect(need.needsBridge).toBe(true);
    expect(need.reason).toContain("network");
  });

  // The raw figure is what made the gate stand aside, so the assembled input must not carry it.
  it("[R1] reports no spendable token on a chain whose holdings are all unroutable", () => {
    const input = realProvisioningInput("invest", {
      context: reportedContext(BASE),
      amount: 1,
    });

    expect(input.balancesByChain?.[BASE]?.tokenUsd).toBe(0);
    // The Arbitrum USDC is still counted, from the routable inventory rather than the raw map.
    expect(input.balancesByChain?.[ARBITRUM]?.tokenUsd).toBe(3.05);
  });

  /**
   * Native stays RAW, and that is not an oversight.
   *
   * Gas is chain-local and paid in the chain's own coin, so whether anything would route it is beside
   * the point: what matters is whether it is there. Dropping it would make every operation on a
   * gas-funded chain report a gas shortfall it does not have.
   */
  it("[R1] keeps the native balance raw, so gas is judged on what the chain actually holds", () => {
    const input = realProvisioningInput("invest", {
      context: reportedContext(BASE),
      amount: 1,
    });

    expect(input.balancesByChain?.[BASE]?.nativeUsd).toBe(3.25);
    expect(computeProvisioningNeed(input).needsGas).toBe(false);
  });

  // The contrast case from the same report, which must keep working: on Arbitrum the wallet is short
  // in a way the raw figure already caught, and the gate fired. It still fires, for the same reason.
  it("[R1] still gates the Arbitrum invest that already worked", () => {
    const input = realProvisioningInput("invest", {
      context: reportedContext(ARBITRUM),
      amount: 4,
    });

    const need = computeProvisioningNeed(input);
    expect(need.needed).toBe(true);
    expect(need.needsUsdc).toBe(true);
  });

  /**
   * A chain that holds only its native coin must still appear, or its gas becomes unreportable.
   *
   * This is the case the naive fix loses: building the map from `sources` alone would drop any chain
   * with no routable token, and the operation's own chain is exactly the chain most likely to have
   * native and nothing else.
   */
  it("[R1] keeps a chain that holds native and no routable token", () => {
    const input = realProvisioningInput("invest", {
      context: reportedContext(BASE, {
        sources: [],
        balancesByChain: { [BASE]: { nativeUsd: 0.001, tokenUsd: 1.78 } },
      }),
      amount: 1,
    });

    expect(input.balancesByChain?.[BASE]).toEqual({ nativeUsd: 0.001, tokenUsd: 0 });
    // With no native worth the name, the gas half of the requirement is real too.
    expect(computeProvisioningNeed(input).needsGas).toBe(true);
  });

  // And a routable holding on a chain the raw map never mentioned must not vanish from the off-target
  // sum, which is the mirror of the case above.
  it("[R1] keeps a routable holding whose chain has no raw entry", () => {
    const input = realProvisioningInput("invest", {
      context: reportedContext(BASE, {
        sources: [source({ chainId: ARBITRUM, usd: 3.05 })],
        balancesByChain: { [BASE]: { nativeUsd: 3.25, tokenUsd: 1.78 } },
      }),
      amount: 1,
    });

    expect(input.balancesByChain?.[ARBITRUM]).toEqual({ nativeUsd: 0, tokenUsd: 3.05 });
    expect(computeProvisioningNeed(input).needsBridge).toBe(true);
  });

  // A native SOURCE is not counted as a spendable token: it would double against `nativeUsd`, and
  // under-counting is the direction that offers provisioning rather than suppressing it.
  it("[R1] does not count a native source as spendable token value", () => {
    const input = realProvisioningInput("invest", {
      context: reportedContext(BASE, {
        sources: [
          source({
            chainId: BASE,
            usd: 3.25,
            isNative: true,
            address: "0x0000000000000000000000000000000000000000",
            symbol: "ETH",
            decimals: 18,
          }),
        ],
      }),
      amount: 1,
    });

    expect(input.balancesByChain?.[BASE]?.tokenUsd).toBe(0);
    expect(computeProvisioningNeed(input).needed).toBe(true);
  });

  /**
   * The case POO-1149's own acceptance names, from Rafael's dev read on 2026-07-29: the SAME wallet,
   * thirteen days before it was reported from production.
   *
   * Arbitrum held $3.75 of priced token, of which only $2.83 was USDC (the rest PENDLE), so a $3.50
   * invest cleared the bar on paper and the gate never opened, while the rail could source $2.83.
   * Nominal coverage clearing while routable coverage does not is the whole failure class.
   */
  it("[R1] gates a $3.50 invest whose nominal coverage clears but whose routable coverage does not", () => {
    const input = realProvisioningInput("invest", {
      context: reportedContext(ARBITRUM, {
        // Only the USDC is routable; the PENDLE is priced and not offerable.
        sources: [source({ chainId: ARBITRUM, usd: 2.83, amount: "2830000" })],
        balancesByChain: {
          [ARBITRUM]: { nativeUsd: 4.38, tokenUsd: 3.75 },
          [BASE]: { nativeUsd: 3.25, tokenUsd: 1.81 },
        },
      }),
      amount: 3.5,
    });

    const need = computeProvisioningNeed(input);
    expect(need.needed).toBe(true);
    expect(need.needsUsdc).toBe(true);
    // And the shortfall is measured against what can be sourced, not against the priced bag.
    expect(need.usdcShortfallUsd).toBeCloseTo(3.5 - 2.83, 2);
  });

  // VIRTUAL is not unroutable by nature: the defect was reading RAW holdings, not this token. Once the
  // inventory does offer it, the same wallet stops gating, which is correct.
  it("[R1] counts the same holding once the inventory reports it as routable", () => {
    const input = realProvisioningInput("invest", {
      context: reportedContext(BASE, {
        sources: [
          source({
            chainId: BASE,
            usd: 1.78,
            address: VIRTUAL_BASE,
            symbol: "VIRTUAL",
            decimals: 18,
            reachableChainIds: [],
          }),
        ],
      }),
      amount: 1,
    });

    expect(input.balancesByChain?.[BASE]?.tokenUsd).toBe(1.78);
    expect(computeProvisioningNeed(input).needed).toBe(false);
  });
});
