/**
 * @id PP-STR-LIB-004 (POO-419, POO-1042, POO-1749)
 * @name buildProvisioningInput.test
 * @implements-rules-version v5 (POO-1749 rules v1) · v4 (POO-1149 rules v1) · v3 (POO-1549 rules v1) · v2 (POO-1042 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The shared op → {@link ProvisioningNeedInput} builder that every op modal (invest / withdraw /
 * collect / compound / move-range / close) feeds into the pre-flight gate.
 *
 * Mock mode is pinned unchanged (invest = usdc+bridge+gas "multi"; the no-USDC ops = "gas-only").
 * Real mode is the POO-1042 subject: it now assembles from the LIVE gate context [R1] — per-chain
 * balances, the operation's own chain [R2], the entered amount [R3] and a quoted gas figure [R4] —
 * and falls back to today's non-triggering behavior the moment that context is missing [R6].
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeProvisioningNeed } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";

// isMockMode is a module-level const derived from an env var; a getter lets each test flip it.
let mockModeValue = true;
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mockModeValue;
  },
}));

// Import AFTER the mock is registered so the SUT binds the mocked `@/lib/services`.
const {
  buildProvisioningInput,
  mockProvisioningInput,
  realProvisioningInput,
  provisioningOpLabelKey,
  OP_LABEL_KEY,
  PROVISIONING_OPS,
} = await import("./buildProvisioningInput");

const ARBITRUM = 42161;
const POLYGON = 137;

/** The five ops that spend no USDC and therefore route to the gas-only demo. */
const GAS_ONLY_OPS = ["withdraw", "collect", "compound", "move-range", "close"] as const;

/**
 * One routable holding, so the fixture describes a wallet that can EXIST.
 *
 * POO-1149: `balancesByChain` is the RAW per-chain figure and `sources` is the routable inventory, and
 * the gate now judges "can this fund the operation" on the second. A fixture with $800 of raw token and
 * an empty inventory described a wallet holding money nothing could convert, which is exactly the shape
 * that produced the reported defect (POO-1552: 3.2263 VIRTUAL on Base suppressing the gate). Stating
 * both keeps these tests meaning what they say.
 */
function routable(chainId: number, usd: number) {
  return {
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    chainId,
    symbol: "USDC",
    decimals: 6,
    amount: "800000000",
    usd,
    reachableChainIds: [42161, 8453],
    isNative: false,
    logoUrl: "",
  };
}

/** A live gate context: money on Polygon, nothing on the Arbitrum operation's chain. */
function context(over: Partial<ProvisioningGateContext> = {}): ProvisioningGateContext {
  return {
    targetChainId: ARBITRUM,
    sources: [routable(POLYGON, 800) as ProvisioningGateContext["sources"][number]],
    gasByChain: {},
    balancesByChain: {
      [POLYGON]: { nativeUsd: 5, tokenUsd: 800 },
      [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
    },
    gasEstimateUsd: 0.07,
    ...over,
  };
}

afterEach(() => {
  mockModeValue = true;
});

describe("mockProvisioningInput (demo scenarios)", () => {
  it("invest → multi (gas + usdc + network), carrying the op amount", () => {
    const input = mockProvisioningInput("invest", 250);
    expect(input.opRequiredUsdc).toBe(250);

    const need = computeProvisioningNeed(input);
    expect(need.needed).toBe(true);
    expect(need.variant).toBe("multi");
    expect(need.reason).toEqual(expect.arrayContaining(["gas", "usdc", "network"]));
  });

  it("invest without an amount falls back to the scenario's op amount", () => {
    const input = mockProvisioningInput("invest");
    expect(input.opRequiredUsdc).toBeGreaterThan(0);
    expect(computeProvisioningNeed(input).variant).toBe("multi");
  });

  it.each(GAS_ONLY_OPS)("%s → gas-only, spends no USDC", (op) => {
    const input = mockProvisioningInput(op);
    expect(input.opRequiredUsdc).toBe(0);

    const need = computeProvisioningNeed(input);
    expect(need.needed).toBe(true);
    expect(need.variant).toBe("gas-only");
    expect(need.reason).toEqual(["gas"]);
  });
});

describe("realProvisioningInput (POO-1042: the live gate)", () => {
  // @rule POO-1149 — the live per-chain map still travels rather than a scalar wallet, and its TOKEN
  // half is now the routable inventory rather than the raw holdings. The raw figure is what let a
  // holding nothing could convert suppress the gate (POO-1552), so this assertion names both halves
  // instead of deep-equalling the context it came from.
  it("[R1] carries the live per-chain balances rather than a scalar wallet", () => {
    const input = realProvisioningInput("invest", { context: context(), amount: 500 });

    expect(input.balancesByChain).toEqual({
      // Native raw, because gas is paid in the chain's own coin whether or not anything routes it.
      // Token from `sources`, because that is the answer to "what can pay for this".
      [POLYGON]: { nativeUsd: 5, tokenUsd: 800 },
      [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
    });
    expect(input.nativeBalanceUsd).toBeUndefined();
    expect(input.usdcBalanceUsd).toBeUndefined();
  });

  // @rule POO-1149 — "funded" means funded with money something can CONVERT, so the fixture states it
  // in the routable inventory as well as in the raw balances. Overriding only `balancesByChain` used to
  // be enough and is exactly the shape that suppressed the gate in production (POO-1552).
  it("[R1] a funded wallet on the operation's own chain does NOT trip the gate", () => {
    const input = realProvisioningInput("invest", {
      context: context({
        sources: [routable(ARBITRUM, 5_000) as ProvisioningGateContext["sources"][number]],
        balancesByChain: { [ARBITRUM]: { nativeUsd: 20, tokenUsd: 5_000 } },
      }),
      amount: 100,
    });

    expect(computeProvisioningNeed(input).needed).toBe(false);
  });

  // And the mirror, which is the defect itself: the same raw figure with nothing routable behind it
  // must NOT read as funded. Without this the test above passes for the wrong reason.
  it("[R1] raw holdings with an empty routable inventory do NOT count as funded", () => {
    const input = realProvisioningInput("invest", {
      context: context({
        sources: [],
        balancesByChain: { [ARBITRUM]: { nativeUsd: 20, tokenUsd: 5_000 } },
      }),
      amount: 100,
    });

    expect(computeProvisioningNeed(input).needed).toBe(true);
  });

  it("[R1] money a chain away from the operation trips the network branch", () => {
    const input = realProvisioningInput("invest", { context: context(), amount: 100 });

    const need = computeProvisioningNeed(input);
    expect(need.needed).toBe(true);
    expect(need.reason).toEqual(expect.arrayContaining(["gas", "network"]));
  });

  it.each(PROVISIONING_OPS)("[R2] %s takes its target chain from the op context", (op) => {
    // Deliberately NOT Base: the retired stub hardcoded 8453, so a Base assertion would pass
    // against it and prove nothing. Move-range and close reach this through the same path, which
    // is the whole point of [R2] — they used to pass no op context at all.
    const input = realProvisioningInput(op, {
      context: context({ targetChainId: POLYGON }),
    });

    expect(input.targetChainId).toBe(POLYGON);
    expect(computeProvisioningNeed(input).targetChainId).toBe(POLYGON);
  });

  it("[R3] opRequiredUsdc is the entered amount for invest", () => {
    expect(
      realProvisioningInput("invest", { context: context(), amount: 250 }).opRequiredUsdc,
    ).toBe(250);
  });

  it.each(GAS_ONLY_OPS)("[R3] %s spends no USDC even when an amount rides along", (op) => {
    // Withdraw/close carry a USD figure of their own (how much is coming OUT). It must never be
    // read as USDC the wallet has to provide.
    expect(realProvisioningInput(op, { context: context(), amount: 900 }).opRequiredUsdc).toBe(0);
  });

  it("[R4] gasEstimateUsd comes from the context's quoted figure, never the hardcoded 0.5", () => {
    const input = realProvisioningInput("close", {
      context: context({ gasEstimateUsd: 0.12 }),
    });

    expect(input.gasEstimateUsd).toBe(0.12);
    expect(input.gasEstimateUsd).not.toBe(0.5);
  });

  it("[R6] a missing context is non-triggering for every op, regardless of amount", () => {
    for (const op of PROVISIONING_OPS) {
      const need = computeProvisioningNeed(
        realProvisioningInput(op, { context: null, amount: 1_000_000 }),
      );
      expect(need.needed).toBe(false);
      expect(need.variant).toBe("none");
    }
  });

  it("carries the settings gear's max slippage through to the planner", () => {
    expect(
      realProvisioningInput("invest", { context: context(), amount: 10, slippagePct: 0.5 })
        .slippagePct,
    ).toBe(0.5);
  });
});

describe("realProvisioningInput (POO-1749: the host's direct USDC read floors the target chain)", () => {
  /**
   * The 2026-08-24 production incident, to the cent: $10,885.73 of USDC on Arbitrum PRESENT in the
   * raw balances and ABSENT from `sources` (pool-party-api renders any ~$10k+ stable balance in
   * scientific notation and the funding context's base-unit parse rejects it, dropping the row on
   * every read, POO-1750), with only the chain's own ETH ($4.71) surviving the inventory. The
   * projection then read the wallet's token value as zero and a funded investor was sent to buy
   * $11,337.78.
   */
  function incidentContext(): ProvisioningGateContext {
    return {
      targetChainId: ARBITRUM,
      sources: [
        {
          address: "0x0000000000000000000000000000000000000000",
          chainId: ARBITRUM,
          symbol: "ETH",
          decimals: 18,
          amount: "1897000000000000",
          usd: 4.71,
          reachableChainIds: [],
          isNative: true,
          logoUrl: "",
        } as ProvisioningGateContext["sources"][number],
      ],
      gasByChain: {},
      balancesByChain: { [ARBITRUM]: { nativeUsd: 4.71, tokenUsd: 10_885.73 } },
      gasEstimateUsd: 0.07,
    };
  }

  // The defect, pinned: without the host's figure the projection alone still reads the wallet as
  // empty and fires the full buy funnel. If this ever starts failing, the projection semantics
  // changed and the floor below may no longer be the right seam.
  it("[R6] regression baseline: the incident context WITHOUT the floor fires the multi funnel", () => {
    const need = computeProvisioningNeed(
      realProvisioningInput("invest", { context: incidentContext(), amount: 10_800 }),
    );
    expect(need.needed).toBe(true);
    expect(need.variant).toBe("multi");
  });

  it("[R1]/[R6] the host's direct read floors the target chain and the gate stands aside", () => {
    const input = realProvisioningInput("invest", {
      context: incidentContext(),
      amount: 10_800,
      targetUsdcBalanceUsd: 10_885.73,
    });

    expect(input.balancesByChain?.[ARBITRUM]?.tokenUsd).toBe(10_885.73);
    const need = computeProvisioningNeed(input);
    expect(need.needed).toBe(false);
    expect(need.variant).toBe("none");
  });

  it("[R1]/[R6] Max: investing the EXACT full direct balance stands aside too", () => {
    // The Max chip fills the amount with the whole spendable balance, so amount === floor to the
    // last float bit. `needsUsdc` compares with a strict `<` and `unmetOnTargetUsd` is exactly 0,
    // so equality must resolve to "funded", not to the funnel.
    const need = computeProvisioningNeed(
      realProvisioningInput("invest", {
        context: incidentContext(),
        amount: 10_885.73,
        targetUsdcBalanceUsd: 10_885.73,
      }),
    );

    expect(need.needed).toBe(false);
    expect(need.variant).toBe("none");
  });

  /**
   * The SECOND deterministic trigger (verified against the live backend, 2026-08-25): a wallet of
   * ANY size whose row SURVIVES the inventory. `sources[].usd` arrives cent-rounded
   * (`(balance * price).toFixed(2)` upstream), while the Max chip fills the amount with the
   * wallet's full-precision figure, so `spendableUsd 17.58 < opRequiredUsdc 17.584572` fired the
   * funnel on roughly every second wallet's Max press. Same floor, same cure: the host's
   * full-precision read raises the rounded projection to the figure the amount was filled from.
   */
  function centRoundedContext(): ProvisioningGateContext {
    return {
      targetChainId: ARBITRUM,
      sources: [
        {
          address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          chainId: ARBITRUM,
          symbol: "USDC",
          decimals: 6,
          amount: "17584572",
          usd: 17.58,
          reachableChainIds: [ARBITRUM, 8453],
          isNative: false,
          logoUrl: "",
        } as ProvisioningGateContext["sources"][number],
      ],
      gasByChain: {},
      balancesByChain: { [ARBITRUM]: { nativeUsd: 5, tokenUsd: 17.58 } },
      gasEstimateUsd: 0.07,
    };
  }

  it("[R6] regression baseline: a cent-rounded row undercounts the full-precision Max amount and fires", () => {
    const need = computeProvisioningNeed(
      realProvisioningInput("invest", { context: centRoundedContext(), amount: 17.584572 }),
    );

    expect(need.needed).toBe(true);
    expect(need.needsUsdc).toBe(true);
  });

  it("[R1]/[R6] the host's full-precision read floors the cent-rounded projection: Max stands aside", () => {
    const need = computeProvisioningNeed(
      realProvisioningInput("invest", {
        context: centRoundedContext(),
        amount: 17.584572,
        targetUsdcBalanceUsd: 17.584572,
      }),
    );

    expect(need.needed).toBe(false);
    expect(need.variant).toBe("none");
  });

  it("[R2] only the operation's target chain is floored; other chains keep their projection", () => {
    const input = realProvisioningInput("invest", {
      context: context(),
      amount: 100,
      targetUsdcBalanceUsd: 10_000,
    });

    expect(input.balancesByChain?.[ARBITRUM]?.tokenUsd).toBe(10_000);
    expect(input.balancesByChain?.[POLYGON]).toEqual({ nativeUsd: 5, tokenUsd: 800 });
  });

  it("[R3] the floor can only raise the projection, never lower it", () => {
    const input = realProvisioningInput("invest", {
      context: context({
        sources: [routable(ARBITRUM, 800) as ProvisioningGateContext["sources"][number]],
        balancesByChain: { [ARBITRUM]: { nativeUsd: 20, tokenUsd: 800 } },
      }),
      amount: 100,
      targetUsdcBalanceUsd: 500,
    });

    expect(input.balancesByChain?.[ARBITRUM]?.tokenUsd).toBe(800);
  });

  it.each([
    Number.NaN,
    -5,
    Number.POSITIVE_INFINITY,
    0,
  ])("[R4] an unusable floor (%s) contributes nothing", (floor) => {
    const withFloor = realProvisioningInput("invest", {
      context: incidentContext(),
      amount: 10_800,
      targetUsdcBalanceUsd: floor,
    });
    const without = realProvisioningInput("invest", {
      context: incidentContext(),
      amount: 10_800,
    });

    expect(withFloor).toEqual(without);
  });

  it("[R1] a floor on a chain the balances map does not know still counts", () => {
    // A raw read can miss the target chain entirely (per-network holdings failure is skipped, not
    // fatal) while the host's own on-chain read succeeded. The host's figure is still real money.
    const input = realProvisioningInput("invest", {
      context: context({ balancesByChain: { [POLYGON]: { nativeUsd: 5, tokenUsd: 800 } } }),
      amount: 100,
      targetUsdcBalanceUsd: 250,
    });

    expect(input.balancesByChain?.[ARBITRUM]).toEqual({ nativeUsd: 0, tokenUsd: 250 });
  });

  it("[R2] a context echoing a different chain than the host read disables the floor", () => {
    // The floor writes under the CONTEXT's chain key, so it must only apply when that echo agrees
    // with the chain the host actually read its balance on. A drifted echo crediting one chain's
    // verified USDC to another is the exact [R2] violation.
    const withMismatch = realProvisioningInput("invest", {
      context: incidentContext(),
      amount: 10_800,
      targetUsdcBalanceUsd: 10_885.73,
      targetChainId: POLYGON, // the host read Polygon; the context claims Arbitrum
    });
    const without = realProvisioningInput("invest", {
      context: incidentContext(),
      amount: 10_800,
      targetChainId: POLYGON,
    });

    expect(withMismatch).toEqual(without);
    expect(withMismatch.balancesByChain?.[ARBITRUM]?.tokenUsd).toBe(0);
  });

  it("[R1] the agreeing echo keeps the floor: the hook passes both from the same resolution", () => {
    const input = realProvisioningInput("invest", {
      context: incidentContext(),
      amount: 10_800,
      targetUsdcBalanceUsd: 10_885.73,
      targetChainId: ARBITRUM,
    });

    expect(input.balancesByChain?.[ARBITRUM]?.tokenUsd).toBe(10_885.73);
  });

  it("[R5] the gas half is untouched: a genuine gas shortfall still gates, as gas-only", () => {
    const need = computeProvisioningNeed(
      realProvisioningInput("invest", {
        context: { ...incidentContext(), gasEstimateUsd: 10 },
        amount: 10_800,
        targetUsdcBalanceUsd: 10_885.73,
      }),
    );

    expect(need.needed).toBe(true);
    expect(need.needsGas).toBe(true);
    expect(need.variant).toBe("gas-only");
  });

  it("[R7] mock mode ignores the floor entirely", () => {
    mockModeValue = true;
    const need = computeProvisioningNeed(
      buildProvisioningInput("invest", {
        context: null,
        amount: 250,
        targetUsdcBalanceUsd: 1_000_000,
      }),
    );
    expect(need.needed).toBe(true);
    expect(need.variant).toBe("multi");
  });
});

describe("buildProvisioningInput (mock vs real seam)", () => {
  it("uses the mock demo scenario in mock mode, ignoring the live context", () => {
    mockModeValue = true;
    expect(
      computeProvisioningNeed(buildProvisioningInput("invest", { context: null, amount: 100 }))
        .needed,
    ).toBe(true);
  });

  it("uses the live assembly in real mode", () => {
    mockModeValue = false;
    const need = computeProvisioningNeed(
      buildProvisioningInput("invest", { context: context(), amount: 100 }),
    );
    expect(need.needed).toBe(true);
    expect(need.targetChainId).toBe(ARBITRUM);
  });

  it("[R6] real mode with a degraded read leaves today's behavior untouched", () => {
    mockModeValue = false;
    expect(
      computeProvisioningNeed(buildProvisioningInput("invest", { context: null, amount: 100 }))
        .needed,
    ).toBe(false);
  });
});

describe("op label keys", () => {
  it("maps every op to its strategies-namespace i18n key", () => {
    expect(OP_LABEL_KEY).toEqual({
      invest: "provisioning.opLabel.invest",
      withdraw: "provisioning.opLabel.withdraw",
      collect: "provisioning.opLabel.collect",
      compound: "provisioning.opLabel.compound",
      "move-range": "provisioning.opLabel.moveRange",
      close: "provisioning.opLabel.close",
    });
  });

  it("provisioningOpLabelKey resolves each op", () => {
    for (const op of PROVISIONING_OPS) {
      expect(provisioningOpLabelKey(op)).toBe(OP_LABEL_KEY[op]);
    }
  });
});
