/**
 * @id PP-STR-LIB-004 (POO-419, POO-1042)
 * @name buildProvisioningInput.test
 * @implements-rules-version v2 (POO-1042 rules v1)
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

/** A live gate context: money on Polygon, nothing on the Arbitrum operation's chain. */
function context(over: Partial<ProvisioningGateContext> = {}): ProvisioningGateContext {
  return {
    targetChainId: ARBITRUM,
    sources: [],
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
  it("[R1] carries the live per-chain balances rather than a scalar wallet", () => {
    const input = realProvisioningInput("invest", { context: context(), amount: 500 });

    expect(input.balancesByChain).toEqual(context().balancesByChain);
    expect(input.nativeBalanceUsd).toBeUndefined();
    expect(input.usdcBalanceUsd).toBeUndefined();
  });

  it("[R1] a funded wallet on the operation's own chain does NOT trip the gate", () => {
    const input = realProvisioningInput("invest", {
      context: context({
        balancesByChain: { [ARBITRUM]: { nativeUsd: 20, tokenUsd: 5_000 } },
      }),
      amount: 100,
    });

    expect(computeProvisioningNeed(input).needed).toBe(false);
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
