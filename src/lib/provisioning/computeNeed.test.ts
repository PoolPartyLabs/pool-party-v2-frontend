/**
 * @id PP-CORE-LIB-016 (POO-416, POO-1033, POO-1166, POO-1641)
 * @name computeProvisioningNeed tests
 * @implements-rules-version v4 (POO-1641 rules v1) · v3 (POO-1166 / POO-1129 rules v3) · v2
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
import * as computeNeed from "./computeNeed";
import {
  clampGasUsd,
  computeProvisioningNeed,
  GAS_CUSTOM_MAX_USD,
  GAS_CUSTOM_MIN_USD,
  MOCK_SLIPPAGE_BUFFER_RATE,
  ONRAMP_CHAIN_ID,
  onRampRouteBuysGas,
  PAYBIS_MIN_USD,
  sizeOnRampUsd,
  spendableBalancesByChain,
  spendableTokenUsd,
} from "./computeNeed";
import * as provisioningBarrel from "./index";
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

/**
 * The wallet as the calculator must SEE it (POO-1149 rules v1, lifted here by POO-1559 rules v1).
 *
 * `ChainBalancesUsd.tokenUsd` has always been documented as "the routable non-native tokens held
 * here", but both callers were handing over the RAW per-chain figure, which counts anything a price
 * feed can value whether or not a swap can move it. POO-1552 is what that costs: $1.78 of a token
 * nothing could route suppressed the whole gate for a user who was funded on another chain.
 *
 * The projection lives here, beside the calculator whose contract it satisfies, because two surfaces
 * need it and a rule with two homes has none. WHICH holdings are routable for a given operation
 * stays with the caller: the investment path offers the whole inventory, the swap screen withholds
 * the destination's own USDC because it nets that out of the requirement instead.
 */
describe("spendableBalancesByChain (POO-1149 / POO-1559)", () => {
  /** A routable holding, in the shape the funding inventory reports (a `FundingSource` superset). */
  function holding(chainId: number, usd: number, isNative = false) {
    return { chainId, usd, isNative };
  }

  // @rule R1 - the token half is the routable inventory, never the raw per-chain figure. This is the
  // reported wallet: $1.78 of a token no route would take, on the chain the operation runs on.
  it("[R1] reads no spendable token on a chain whose holdings are all unroutable", () => {
    const out = spendableBalancesByChain({ [BASE]: { nativeUsd: 3.25, tokenUsd: 1.78 } }, []);

    expect(out[BASE]).toEqual({ nativeUsd: 3.25, tokenUsd: 0 });
  });

  // @rule R1 - and the native half stays RAW, because gas is paid in the chain's own coin whether or
  // not anything would route it. Dropping it would invent a gas shortfall on a funded chain.
  it("[R1] keeps the native figure raw while the token figure comes from the routable list", () => {
    const out = spendableBalancesByChain(
      {
        [ARBITRUM]: { nativeUsd: 4.38, tokenUsd: 900 },
        [BASE]: { nativeUsd: 3.25, tokenUsd: 1.78 },
      },
      [holding(ARBITRUM, 3.05)],
    );

    expect(out).toEqual({
      [ARBITRUM]: { nativeUsd: 4.38, tokenUsd: 3.05 },
      [BASE]: { nativeUsd: 3.25, tokenUsd: 0 },
    });
  });

  // @rule R5 - the case a naive fix loses: build the map from the holdings alone and every chain with
  // native and nothing routable disappears, taking its gas verdict with it.
  it("[R5] keeps a chain that holds native and no routable token", () => {
    const out = spendableBalancesByChain({ [BASE]: { nativeUsd: 0.001, tokenUsd: 1.78 } }, []);

    expect(out[BASE]).toEqual({ nativeUsd: 0.001, tokenUsd: 0 });
  });

  // @rule R5 - and its mirror: a routable holding on a chain the raw map never mentioned must not
  // vanish from the off-target sum.
  it("[R5] keeps a routable holding whose chain has no raw entry", () => {
    const out = spendableBalancesByChain({ [BASE]: { nativeUsd: 3.25, tokenUsd: 0 } }, [
      holding(ARBITRUM, 3.05),
    ]);

    expect(out[ARBITRUM]).toEqual({ nativeUsd: 0, tokenUsd: 3.05 });
  });

  // @rule R4 - a native holding would double against `nativeUsd`. Excluding it under-counts, which is
  // the direction that offers provisioning rather than suppressing it.
  it("[R4] does not count a native holding as spendable token value", () => {
    const out = spendableBalancesByChain({ [BASE]: { nativeUsd: 3.25, tokenUsd: 3.25 } }, [
      holding(BASE, 3.25, true),
    ]);

    expect(out[BASE]).toEqual({ nativeUsd: 3.25, tokenUsd: 0 });
  });

  it("sums every routable holding a chain carries", () => {
    const out = spendableBalancesByChain({ [POLYGON]: { nativeUsd: 5, tokenUsd: 800 } }, [
      holding(POLYGON, 120.5),
      holding(POLYGON, 79.5),
    ]);

    expect(out[POLYGON]).toEqual({ nativeUsd: 5, tokenUsd: 200 });
  });

  // @rule R6 - junk reads as ABSENT, never as funded. A `NaN` propagates into every comparison the
  // verdict makes, and `NaN < required` is false, so the gate would stand aside for exactly the
  // reason it did in POO-1552: a wrong input answering confidently.
  it("[R6] reads a non-finite figure as zero rather than poisoning the sum", () => {
    const out = spendableBalancesByChain(
      {
        [BASE]: { nativeUsd: Number.NaN, tokenUsd: 10 },
        [ARBITRUM]: { nativeUsd: 1, tokenUsd: 0 },
      },
      [holding(BASE, 40), holding(BASE, Number.NaN), holding(ARBITRUM, Number.POSITIVE_INFINITY)],
    );

    expect(out).toEqual({
      [BASE]: { nativeUsd: 0, tokenUsd: 40 },
      [ARBITRUM]: { nativeUsd: 1, tokenUsd: 0 },
    });
  });

  it("ignores a key that is not a chain id", () => {
    const raw = { [BASE]: { nativeUsd: 1, tokenUsd: 0 }, abc: { nativeUsd: 9, tokenUsd: 9 } };

    const out = spendableBalancesByChain(raw as unknown as Record<number, ChainBalancesUsd>, []);

    expect(Object.keys(out)).toEqual([String(BASE)]);
  });

  it("does not mutate the caller's map", () => {
    const raw = Object.freeze({ [BASE]: { nativeUsd: 3.25, tokenUsd: 1.78 } });

    expect(() => spendableBalancesByChain(raw, [holding(BASE, 1)])).not.toThrow();
    expect(raw[BASE]).toEqual({ nativeUsd: 3.25, tokenUsd: 1.78 });
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
    expect(sizeOnRampUsd(250.37)).toBe(256); // ceil(255.3774)
  });
  it("rounds a sub-$10 buffered amount up to the floor", () => {
    expect(sizeOnRampUsd(9.5)).toBe(PAYBIS_MIN_USD); // ceil(9.69) = 10
  });
});

// -------------------------------------------------------------------------------------------------
// POO-1641: the on-ramp fee term is GONE. POO-1166 sized every purchase up by 1% so that our own cut
// would still leave the requirement landing whole. There is no such cut: the partner-side
// configuration is already inside the price Paybis quotes, so the delivered crypto arrives whole and
// the gross-up was inflating every order for a deduction that does not happen (Rafael, 2026-08-16).
//
// These tests are the negative space POO-1166's suite used to occupy. They assert the absence of the
// term rather than a new value for it, because a "rate of 0" left in the code is the same fiction one
// commit away from being switched back on.
// -------------------------------------------------------------------------------------------------
describe("POO-1641: no on-ramp fee term survives anywhere", () => {
  // @rule R1 — the module and the client barrel both stop offering a fee term. This is the assertion
  // that fails if a later change reintroduces the rate under any of its three old names.
  it("exports no fee rate, no gross-up and no fee helper", () => {
    for (const module of [computeNeed, provisioningBarrel]) {
      expect(module).not.toHaveProperty("ONRAMP_FEE_RATE");
      expect(module).not.toHaveProperty("grossUpForOnRampFee");
      expect(module).not.toHaveProperty("onRampFeeUsd");
    }
  });

  // @rule R4 — the $10 Paybis floor is untouched, and it was always applied DOWNSTREAM of the removed
  // gross-up, so nothing can now fall under it. `sizeOnRampUsd`'s second parameter existed ONLY to
  // carry `onRampFeeUsd` and is gone with it, which `pnpm typecheck` is what enforces: a two-argument
  // call no longer compiles. What is assertable at runtime is that the floor still holds.
  it("still floors every sub-minimum requirement at the Paybis minimum", () => {
    expect(sizeOnRampUsd(2)).toBe(PAYBIS_MIN_USD);
    expect(sizeOnRampUsd(9.5)).toBe(PAYBIS_MIN_USD);
    expect(sizeOnRampUsd(0)).toBe(PAYBIS_MIN_USD);
    // The band the gross-up used to lift over the floor on its own. This heuristic ceils to whole
    // dollars BEFORE the floor, so it clears $10 by that route instead; the real sizer's own
    // behaviour in the same band is pinned in `buildPlan.test.ts`, where it lands exactly on $10.
    expect(sizeOnRampUsd(9.95)).toBeGreaterThanOrEqual(PAYBIS_MIN_USD);
  });

  // @rule R6 — the buffer is a DIFFERENT thing and it stays. It covers swap and bridge slippage, not
  // a fee, and POO-1641 explicitly leaves it alone. Sizing is now buffer-then-floor and nothing else.
  it("keeps the 2% mock slippage buffer exactly where it was", () => {
    expect(MOCK_SLIPPAGE_BUFFER_RATE).toBe(0.02);
    expect(sizeOnRampUsd(100)).toBe(102); // ceil(100 * 1.02), no fee term added
    expect(sizeOnRampUsd(110)).toBe(113); // was 114 with the fee: ceil(112.2 + 1.12)
  });
});

// POO-1542 [B]: the ONE predicate `buildPlan.buildOnRampSteps` and `resolveFundingRoutes` both call
// for "does this buy route have to buy gas". Testing it here, once, is what makes the two call sites
// unable to diverge again: they import this same function rather than each spelling the question.
describe("onRampRouteBuysGas: the buy route's gas predicate (POO-1542 [B])", () => {
  const OK = { verdict: "OK" };
  const BLOCKED = { verdict: "BLOCKED" };

  it("needs no gas when both Base and the target are OK", () => {
    expect(onRampRouteBuysGas({ [ONRAMP_CHAIN_ID]: OK, [ARBITRUM]: OK }, ARBITRUM)).toBe(false);
  });

  it("buys gas when Base is not OK, even if the target is fine", () => {
    expect(onRampRouteBuysGas({ [ONRAMP_CHAIN_ID]: BLOCKED, [ARBITRUM]: OK }, ARBITRUM)).toBe(true);
  });

  it("buys gas when the target is not OK, even if Base is fine", () => {
    expect(onRampRouteBuysGas({ [ONRAMP_CHAIN_ID]: OK, [ARBITRUM]: BLOCKED }, ARBITRUM)).toBe(true);
  });

  // POO-1542's reachable case: a wallet with nothing at all on Base has no Base verdict to read
  // (`gateContext.ts` only classifies source chains + the target), which must NOT read as "fine".
  it("buys gas when Base has no verdict at all, target OK (the reachable case)", () => {
    expect(onRampRouteBuysGas({ [ARBITRUM]: OK }, ARBITRUM)).toBe(true);
  });

  it("buys gas when the target has no verdict at all, Base OK", () => {
    expect(onRampRouteBuysGas({ [ONRAMP_CHAIN_ID]: OK }, ARBITRUM)).toBe(true);
  });

  it("needs no gas for a Base operation whose only chain (Base) is OK", () => {
    expect(onRampRouteBuysGas({ [ONRAMP_CHAIN_ID]: OK }, ONRAMP_CHAIN_ID)).toBe(false);
  });
});
