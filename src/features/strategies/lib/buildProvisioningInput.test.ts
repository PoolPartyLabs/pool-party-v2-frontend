/**
 * @id PP-STR-LIB-004 (POO-419)
 * @name buildProvisioningInput.test
 * @implements-rules-version v1
 *
 * The shared op → {@link ProvisioningNeedInput} builder that every op modal (invest / withdraw /
 * collect / compound / move-range / close) feeds into the pre-flight gate. Tests pin the mock demo
 * branch matrix (invest = usdc+bridge+gas "multi"; the no-USDC ops = "gas-only") and the real-mode
 * stub (non-triggering until POO-432 wires real balances, so real behavior is unchanged).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeProvisioningNeed } from "@/lib/provisioning";
import type { Strategy } from "@/lib/schemas";

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

/** Minimal strategy stub — the real-mode stub ignores its fields today (POO-432). */
const strategy = { id: "str-1", name: "Stable Yield" } as unknown as Strategy;

/** The five ops that spend no USDC and therefore route to the gas-only demo. */
const GAS_ONLY_OPS = ["withdraw", "collect", "compound", "move-range", "close"] as const;

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

describe("realProvisioningInput (POO-432 stub)", () => {
  it("is non-triggering for every op, regardless of amount", () => {
    for (const op of PROVISIONING_OPS) {
      // A large invest amount must not make the real stub trip the gate (real behavior unchanged).
      const need = computeProvisioningNeed(realProvisioningInput(op, strategy, 1_000_000));
      expect(need.needed).toBe(false);
      expect(need.variant).toBe("none");
    }
  });
});

describe("buildProvisioningInput (mock vs real seam)", () => {
  it("uses the mock demo scenario in mock mode", () => {
    mockModeValue = true;
    expect(computeProvisioningNeed(buildProvisioningInput("invest", strategy, 100)).needed).toBe(
      true,
    );
  });

  it("uses the non-triggering real stub in real mode", () => {
    mockModeValue = false;
    expect(computeProvisioningNeed(buildProvisioningInput("invest", strategy, 100)).needed).toBe(
      false,
    );
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
