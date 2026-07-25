/**
 * @id PP-CORE-LIB-016 (POO-416, POO-1033)
 * @name computeProvisioningNeed tests
 * @implements-rules-version v2
 * @hackathon POO-1022 (Universal Funding)
 *
 * Pure requirement calculator: given wallet state (in USD) + op context, decide what is missing
 * (gas / usdc / network), by how much, and which UI branch to take (none / gas-only / multi).
 * Plus the gas-bounds clamp and the mock on-ramp sizing (slippage buffer + Paybis $10 floor).
 *
 * v2 (POO-1033, hackathon POO-1022) extends the branch matrix with the per-chain wallet model. The
 * first describe keeps the ORIGINAL scalar-shaped cases (the legacy input shape still has to compute
 * the same verdict); the second adds the `balancesByChain` cases, including the one this issue exists
 * for: a wallet with no gas on the position's chain and funds elsewhere is a BRIDGE, not a gas-only
 * top-up. Rules under test (POO-1033 rules v1):
 *   [R1] `balancesByChain` carries native + token USD per chain and replaces the scalar pair
 *   [R2] `needsBridge` no longer requires `opRequiredUsdc > 0`
 *   [R3] the none | gas-only | multi verdict (and the reason order) is unchanged
 *   [R4] gas sourceable on the target chain stays gas-only; only off-chain gas escalates to multi
 *   [R5] pure number-math: no I/O, no mutation of the caller's input
 */
import { describe, expect, it } from "vitest";
import {
  clampGasUsd,
  computeProvisioningNeed,
  GAS_CUSTOM_MAX_USD,
  GAS_CUSTOM_MIN_USD,
  ONRAMP_CHAIN_ID,
  PAYBIS_MIN_USD,
  sizeOnRampUsd,
  spendableTokenUsd,
} from "./computeNeed";
import type { ChainBalancesUsd, ProvisioningNeedInput } from "./types";

const BASE = 8453;
const ARBITRUM = 42161;
const POLYGON = 137;

/** A fully-satisfied baseline (lots of native + USDC on the target chain, op needs little). */
function input(overrides: Partial<ProvisioningNeedInput> = {}): ProvisioningNeedInput {
  return {
    nativeBalanceUsd: 50,
    usdcBalanceUsd: 1_000,
    currentChainId: BASE,
    targetChainId: BASE,
    opRequiredUsdc: 100,
    gasEstimateUsd: 0.5,
    ...overrides,
  };
}

/**
 * A per-chain input (POO-1033 R1). It deliberately passes NO `nativeBalanceUsd` / `usdcBalanceUsd`:
 * that is the compile-time half of R1 — the map has to be a complete description of the wallet, not
 * an extra field bolted onto a still-required scalar pair.
 */
function perChain(
  balancesByChain: Record<number, ChainBalancesUsd>,
  overrides: Partial<ProvisioningNeedInput> = {},
): ProvisioningNeedInput {
  return {
    currentChainId: BASE,
    targetChainId: BASE,
    opRequiredUsdc: 0,
    gasEstimateUsd: 0.5,
    balancesByChain,
    ...overrides,
  };
}

describe("computeProvisioningNeed", () => {
  it("returns variant 'none' when nothing is missing", () => {
    const need = computeProvisioningNeed(input());
    expect(need.needed).toBe(false);
    expect(need.variant).toBe("none");
    expect(need.reason).toEqual([]);
    expect(need.needsGas).toBe(false);
    expect(need.needsUsdc).toBe(false);
    expect(need.needsBridge).toBe(false);
  });

  it("is satisfied at the exact boundary (balance == requirement)", () => {
    const need = computeProvisioningNeed(
      input({
        nativeBalanceUsd: 0.5,
        usdcBalanceUsd: 100,
        gasEstimateUsd: 0.5,
        opRequiredUsdc: 100,
      }),
    );
    expect(need.variant).toBe("none");
  });

  it("flags gas-only when just native is short (same chain, op needs no extra USDC)", () => {
    const need = computeProvisioningNeed(
      input({ nativeBalanceUsd: 0, opRequiredUsdc: 0, gasEstimateUsd: 0.8 }),
    );
    expect(need.variant).toBe("gas-only");
    expect(need.needsGas).toBe(true);
    expect(need.gasShortfallUsd).toBeCloseTo(0.8);
    expect(need.reason).toEqual(["gas"]);
  });

  it("is still gas-only when gas is missing and the wallet has no USDC (buy-gas modal on-ramps)", () => {
    const need = computeProvisioningNeed(
      input({ nativeBalanceUsd: 0, usdcBalanceUsd: 0, opRequiredUsdc: 0, gasEstimateUsd: 0.5 }),
    );
    expect(need.variant).toBe("gas-only");
    expect(need.needsUsdc).toBe(false);
  });

  it("flags multi when the op needs more USDC than the wallet holds", () => {
    const need = computeProvisioningNeed(input({ usdcBalanceUsd: 40, opRequiredUsdc: 100 }));
    expect(need.variant).toBe("multi");
    expect(need.needsUsdc).toBe(true);
    expect(need.usdcShortfallUsd).toBeCloseTo(60);
    expect(need.reason).toContain("usdc");
  });

  it("flags a bridge when the op's USDC is on the wrong network", () => {
    const need = computeProvisioningNeed(
      input({
        currentChainId: BASE,
        targetChainId: ARBITRUM,
        usdcBalanceUsd: 1_000,
        opRequiredUsdc: 100,
      }),
    );
    expect(need.needsBridge).toBe(true);
    expect(need.variant).toBe("multi");
    expect(need.reason).toContain("network");
  });

  it("does not flag a bridge for a same-network op", () => {
    const need = computeProvisioningNeed(input({ currentChainId: BASE, targetChainId: BASE }));
    expect(need.needsBridge).toBe(false);
  });

  // POO-1033 [R2]/[R4] — THE case this issue exists for, in the legacy scalar shape. It used to
  // assert `needsBridge: false` / `gas-only`, because `needsBridge` required `opRequiredUsdc > 0`.
  // The op spends no USDC (withdraw / collect / move-range / close), the wallet has zero native on
  // the op's chain, and the only money that could buy that gas is on ANOTHER chain. That is a
  // bridge, and therefore the wizard: a gas-only plan here would run a swap on a chain whose funds
  // are not there and strand the user.
  it("bridges a no-USDC op whose gas can only come from another chain (POO-1033 R2)", () => {
    const need = computeProvisioningNeed(
      input({
        currentChainId: BASE,
        targetChainId: ARBITRUM,
        opRequiredUsdc: 0,
        nativeBalanceUsd: 0,
        gasEstimateUsd: 0.5,
      }),
    );
    expect(need.needsBridge).toBe(true);
    expect(need.variant).toBe("multi");
    expect(need.reason).toEqual(["gas", "network"]);
  });

  it("orders reasons gas → usdc → network", () => {
    const need = computeProvisioningNeed(
      input({
        nativeBalanceUsd: 0,
        usdcBalanceUsd: 0,
        opRequiredUsdc: 100,
        currentChainId: BASE,
        targetChainId: ARBITRUM,
        gasEstimateUsd: 0.5,
      }),
    );
    expect(need.variant).toBe("multi");
    expect(need.reason).toEqual(["gas", "usdc", "network"]);
  });

  it("lets a user-chosen gas amount raise the requirement (sizes the top-up)", () => {
    // 8 USD of native covers the 5 USD estimate, but the user chose a 10 USD top-up → short by 2.
    const need = computeProvisioningNeed(
      input({ nativeBalanceUsd: 8, opRequiredUsdc: 0, gasEstimateUsd: 5, gasChoiceUsd: 10 }),
    );
    expect(need.needsGas).toBe(true);
    expect(need.gasShortfallUsd).toBeCloseTo(2);
  });
});

describe("computeProvisioningNeed · per-chain balances (POO-1033)", () => {
  // [R1] The map is the whole wallet: no scalar field is passed by `perChain` at all.
  it("reads the wallet from balancesByChain alone", () => {
    const need = computeProvisioningNeed(
      perChain({ [BASE]: { nativeUsd: 20, tokenUsd: 500 } }, { opRequiredUsdc: 100 }),
    );
    expect(need.needed).toBe(false);
    expect(need.variant).toBe("none");
    expect(need.reason).toEqual([]);
  });

  // [R1] While both shapes are accepted, the per-chain map is the authority — otherwise a caller
  // that migrated would still be judged on the stale scalars it left behind.
  it("prefers balancesByChain over the legacy scalar pair when both are present", () => {
    const need = computeProvisioningNeed({
      ...input({ opRequiredUsdc: 0, gasEstimateUsd: 0.5 }),
      balancesByChain: { [BASE]: { nativeUsd: 0, tokenUsd: 0 } },
    });
    // The scalars claim $50 of native and $1,000 of USDC; the map says the wallet is empty.
    expect(need.needsGas).toBe(true);
    expect(need.gasShortfallUsd).toBeCloseTo(0.5);
  });

  // [R1] A chain the map does not mention holds nothing there. Silently reading it as "unknown, so
  // probably fine" is how a user gets sent into a swap on a chain with no gas.
  it("treats a chain absent from the map as empty", () => {
    const need = computeProvisioningNeed(
      perChain({ [POLYGON]: { nativeUsd: 40, tokenUsd: 900 } }, { targetChainId: ARBITRUM }),
    );
    expect(need.needsGas).toBe(true);
  });

  // [R2]/[R4] The headline case, in the per-chain shape: zero gas on the position's chain, funds on
  // another. `opRequiredUsdc` is 0 (a withdraw), which under the old rule made a bridge impossible.
  it("bridges a zero-gas position chain when the funds are on another chain", () => {
    const need = computeProvisioningNeed(
      perChain(
        {
          [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
          [BASE]: { nativeUsd: 12, tokenUsd: 1_200 },
        },
        { targetChainId: ARBITRUM, opRequiredUsdc: 0, gasEstimateUsd: 0.6 },
      ),
    );
    expect(need.needsGas).toBe(true);
    expect(need.needsBridge).toBe(true);
    expect(need.needsUsdc).toBe(false);
    expect(need.variant).toBe("multi");
    expect(need.reason).toEqual(["gas", "network"]);
  });

  // [R4] The same shortfall, with the tokens sitting ON the position's chain, stays gas-only: one
  // local swap buys the gas, no bridge, so the six op modals keep their simple branch.
  it("stays gas-only when the gas can be sourced on the target chain", () => {
    const need = computeProvisioningNeed(
      perChain(
        { [ARBITRUM]: { nativeUsd: 0, tokenUsd: 1_200 } },
        { targetChainId: ARBITRUM, gasEstimateUsd: 0.6 },
      ),
    );
    expect(need.needsGas).toBe(true);
    expect(need.needsBridge).toBe(false);
    expect(need.variant).toBe("gas-only");
    expect(need.reason).toEqual(["gas"]);
  });

  // [R2] Holding the op's USDC on the wrong chain is a MOVE problem, not a BUY problem: the wizard
  // bridges it and must not also ask the user to on-ramp money they already have.
  it("bridges the op's USDC without asking the user to buy more", () => {
    const need = computeProvisioningNeed(
      perChain(
        {
          [ARBITRUM]: { nativeUsd: 5, tokenUsd: 0 },
          [BASE]: { nativeUsd: 10, tokenUsd: 500 },
        },
        { targetChainId: ARBITRUM, opRequiredUsdc: 100 },
      ),
    );
    expect(need.needsUsdc).toBe(false);
    expect(need.usdcShortfallUsd).toBe(0);
    expect(need.needsGas).toBe(false);
    expect(need.needsBridge).toBe(true);
    expect(need.variant).toBe("multi");
    expect(need.reason).toEqual(["network"]);
  });

  // [R2] The bridgeable reserve is the whole wallet, not the single richest chain.
  it("sums the bridgeable reserve across every off-target chain", () => {
    const need = computeProvisioningNeed(
      perChain(
        {
          [ARBITRUM]: { nativeUsd: 5, tokenUsd: 0 },
          [BASE]: { nativeUsd: 10, tokenUsd: 60 },
          [POLYGON]: { nativeUsd: 3, tokenUsd: 60 },
        },
        { targetChainId: ARBITRUM, opRequiredUsdc: 100 },
      ),
    );
    expect(need.needsUsdc).toBe(false);
    expect(need.needsBridge).toBe(true);
  });

  // [R2] "Cannot be met on the target chain" is only half the rule: there must be somewhere for the
  // money to come FROM. An empty wallet on the on-ramp chain is a buy, not a bridge.
  it("does not bridge an empty wallet when the op runs on the on-ramp chain", () => {
    const need = computeProvisioningNeed(
      perChain(
        { [ONRAMP_CHAIN_ID]: { nativeUsd: 0, tokenUsd: 0 } },
        { targetChainId: ONRAMP_CHAIN_ID },
      ),
    );
    expect(need.needsBridge).toBe(false);
    expect(need.variant).toBe("gas-only");
  });

  // [R2] ...and the same empty wallet DOES bridge when the op is elsewhere, because the on-ramp
  // always lands USDC on Base (epic POO-411 global rule), which is then a chain away from the op.
  it("bridges an empty wallet when the op runs off the on-ramp chain", () => {
    const need = computeProvisioningNeed(
      perChain(
        { [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 } },
        { targetChainId: ARBITRUM, opRequiredUsdc: 100 },
      ),
    );
    expect(need.needsUsdc).toBe(true);
    expect(need.usdcShortfallUsd).toBeCloseTo(100);
    expect(need.needsBridge).toBe(true);
    expect(need.reason).toEqual(["gas", "usdc", "network"]);
    expect(need.variant).toBe("multi");
  });

  // [R2] Another chain's NATIVE coin is not counted as bridgeable: it is what pays that chain's own
  // gas, and sizing how much of it could be spared needs a live quote (POO-1032 / POO-1034), not
  // this pure function. Under-detecting a bridge falls back to the on-ramp; over-detecting one would
  // promise a route that cannot pay for itself.
  it("does not treat another chain's native coin as bridgeable funds", () => {
    const need = computeProvisioningNeed(
      perChain({
        [ONRAMP_CHAIN_ID]: { nativeUsd: 0, tokenUsd: 0 },
        [POLYGON]: { nativeUsd: 80, tokenUsd: 0 },
      }),
    );
    expect(need.needsBridge).toBe(false);
    expect(need.variant).toBe("gas-only");
  });

  // [R3] The routing vocabulary the six op modals branch on is unchanged; only the inputs that reach
  // each verdict got richer.
  it.each([
    ["none", { [BASE]: { nativeUsd: 20, tokenUsd: 500 } }, BASE, 100],
    ["gas-only", { [BASE]: { nativeUsd: 0, tokenUsd: 500 } }, BASE, 0],
    ["multi", { [BASE]: { nativeUsd: 20, tokenUsd: 500 } }, ARBITRUM, 100],
  ] as const)("routes to %s", (variant, balancesByChain, targetChainId, opRequiredUsdc) => {
    const need = computeProvisioningNeed(
      perChain(balancesByChain, { targetChainId, opRequiredUsdc }),
    );
    expect(need.variant).toBe(variant);
  });

  // [R5] Pure: the caller's input (and its nested map) is never written to, so a memoized input can
  // be reused across re-plans without the calculator poisoning it.
  it("does not mutate the caller's input", () => {
    const balancesByChain = Object.freeze({
      [ARBITRUM]: Object.freeze({ nativeUsd: 0, tokenUsd: 0 }),
      [BASE]: Object.freeze({ nativeUsd: 12, tokenUsd: 1_200 }),
    });
    const frozen = Object.freeze(
      perChain(balancesByChain, { targetChainId: ARBITRUM, opRequiredUsdc: 100 }),
    );
    const before = JSON.stringify(frozen);

    expect(() => computeProvisioningNeed(frozen)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe("spendableTokenUsd", () => {
  // The gas selector asks "how much can this wallet actually spend", which is every routable token
  // it holds, on any chain — not the balance of whichever chain it happens to be connected to.
  it("sums routable token value across chains and ignores native", () => {
    expect(
      spendableTokenUsd(
        perChain({
          [ARBITRUM]: { nativeUsd: 5, tokenUsd: 40 },
          [BASE]: { nativeUsd: 10, tokenUsd: 60 },
        }),
      ),
    ).toBeCloseTo(100);
  });

  it("falls back to the legacy scalar balance", () => {
    expect(spendableTokenUsd(input({ usdcBalanceUsd: 250 }))).toBe(250);
  });
});

describe("clampGasUsd", () => {
  it("keeps an in-range value", () => {
    expect(clampGasUsd(50)).toBe(50);
  });
  it("clamps below the min up to the floor", () => {
    expect(clampGasUsd(3)).toBe(GAS_CUSTOM_MIN_USD);
    expect(clampGasUsd(9.99)).toBe(GAS_CUSTOM_MIN_USD);
  });
  it("clamps above the max down to the ceiling", () => {
    expect(clampGasUsd(500)).toBe(GAS_CUSTOM_MAX_USD);
    expect(clampGasUsd(200.01)).toBe(GAS_CUSTOM_MAX_USD);
  });
});

describe("sizeOnRampUsd", () => {
  it("enforces the Paybis $10 floor for tiny shortfalls", () => {
    expect(sizeOnRampUsd(3)).toBe(PAYBIS_MIN_USD);
    expect(sizeOnRampUsd(0)).toBe(PAYBIS_MIN_USD);
  });
  it("adds a 2% slippage buffer and rounds up to whole dollars", () => {
    expect(sizeOnRampUsd(100)).toBe(102); // ceil(100 * 1.02)
    expect(sizeOnRampUsd(100, 2)).toBe(104); // ceil(100 * 1.02 + 2)
  });
  it("rounds a sub-$10 buffered amount up to the floor", () => {
    expect(sizeOnRampUsd(9.5)).toBe(PAYBIS_MIN_USD); // ceil(9.69) = 10
  });
});
