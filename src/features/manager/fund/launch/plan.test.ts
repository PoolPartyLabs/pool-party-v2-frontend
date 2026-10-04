import { describe, expect, it } from "vitest";
import { allocationRaw, type CanvasPlan, deriveLaunchSteps, launchPlanError } from "./plan";

const chain = (id: string, kind: string, sharePct = 100) => ({
  id,
  sharePct,
  steps: [
    {
      id: `${id}-position`,
      family: "position" as const,
      kind,
      config: kind === "aaveSupply" ? { assetKey: "arbitrum:0xbase" } : { poolId: "pool" },
    },
  ],
});
const config = { priceLower: "1000", priceUpper: "2000", maxLossBps: 100 };
const fixture = (
  hub: CanvasPlan["hub"]["chains"],
  spokes: CanvasPlan["spokes"] = [],
): CanvasPlan => ({ version: 1, hub: { chains: hub }, spokes });

describe("Build to launch adapter [R2, R4, R5]", () => {
  it("surfaces a clear duplicate reserve reason without leaking unknown errors", () => {
    expect(launchPlanError(new Error("DUPLICATE_AAVE_RESERVE"))).toEqual({
      code: "DUPLICATE_AAVE_RESERVE",
      messageKey: "fundLaunch.duplicateAaveReserve",
    });
    expect(launchPlanError(new Error("private endpoint"))).toEqual({
      code: "BUILD_EXECUTION_GAP",
      messageKey: "fundLaunch.buildGap",
    });
  });
  it("blocks the same Aave reserve across roots, case-insensitively", () => {
    const plan = fixture([chain("first", "aaveSupply", 50), chain("second", "aaveSupply", 50)]);
    const block = plan.hub.chains[1]?.steps[0];
    if (!block) throw new Error("fixture");
    block.config = { assetKey: "ARBITRUM:0xBASE" };
    expect(() => deriveLaunchSteps(plan, {}, false, false)).toThrow("DUPLICATE_AAVE_RESERVE");
  });
  it("blocks repeated Aave leaves even with valid explicit shares", () => {
    const plan = fixture([chain("first", "aaveSupply")]);
    const block = chain("second", "aaveSupply").steps[0];
    if (!block) throw new Error("fixture");
    plan.hub.chains[0]?.steps.push(block);
    expect(() =>
      deriveLaunchSteps(
        plan,
        {
          "first-position": { leafSharePct: 50 },
          "second-position": { leafSharePct: 50 },
        },
        false,
        false,
      ),
    ).toThrow("DUPLICATE_AAVE_RESERVE");
  });
  it("permits separate Aave reserves", () => {
    const plan = fixture([chain("first", "aaveSupply", 50), chain("second", "aaveSupply", 50)]);
    const block = plan.hub.chains[1]?.steps[0];
    if (!block) throw new Error("fixture");
    block.config = { assetKey: "arbitrum:0xother" };
    expect(
      deriveLaunchSteps(plan, {}, false, false).filter((step) => step.kind === "open"),
    ).toHaveLength(2);
  });
  it("consumes typed panel canonical ticks and clamped slippage without another model", () => {
    const plan = fixture([chain("pool", "uniswapV4Pool")]);
    const block = plan.hub.chains[0]?.steps[0];
    if (!block) throw new Error("missing fixture");
    block.config = { poolId: "pool", tickLower: -100, tickUpper: 100, slippagePct: 0.5 };
    const steps = deriveLaunchSteps(plan, {}, false, false);
    expect(steps.find((step) => step.kind === "open")?.config).toMatchObject({
      tickLower: -100,
      tickUpper: 100,
      maxLossBps: 50,
    });
    block.kind = "aaveBorrow";
    expect(() => deriveLaunchSteps(plan, {}, false, false)).toThrow("UNSUPPORTED_POSITION");
  });
  it("never lets stale launch execution override newly applied panel ticks or slippage", () => {
    const plan = fixture([chain("pool", "uniswapV4Pool")]);
    const block = plan.hub.chains[0]?.steps[0];
    if (!block) throw new Error("fixture");
    block.config = { poolId: "pool", tickLower: -100, tickUpper: 100, slippagePct: 0.1 };
    const steps = deriveLaunchSteps(
      plan,
      {
        "pool-position": {
          tickLower: -200,
          tickUpper: 200,
          priceLower: "1000",
          priceUpper: "2000",
          maxLossBps: 500,
          leafSharePct: 100,
        },
      },
      false,
      false,
    );
    expect(steps.find((step) => step.kind === "open")?.config).toMatchObject({
      tickLower: -100,
      tickUpper: 100,
      maxLossBps: 10,
      leafSharePct: 100,
    });
    expect(steps.find((step) => step.kind === "open")?.config?.priceLower).toBeUndefined();
    expect(steps.find((step) => step.kind === "open")?.config?.priceUpper).toBeUndefined();
  });
  it.each([
    0,
    0.01,
    0.099,
    5.01,
    NaN,
    Infinity,
  ])("rejects panel slippage %s before rounding", (slippagePct) => {
    const plan = fixture([chain("pool", "uniswapV4Pool")]);
    const block = plan.hub.chains[0]?.steps[0];
    if (!block) throw new Error("fixture");
    block.config = { poolId: "pool", tickLower: -100, tickUpper: 100, slippagePct };
    expect(() => deriveLaunchSteps(plan, {}, false, false)).toThrow("INVALID_SLIPPAGE");
  });
  it("refuses a zero explicit leaf before creating an unexecutable zero amount", () => {
    expect(() =>
      deriveLaunchSteps(
        fixture([chain("aave", "aaveSupply")]),
        { "aave-position": { leafSharePct: 0 } },
        false,
        false,
      ),
    ).toThrow("INVALID_ALLOCATION");
  });
  it("creates an included empty spoke without bridging zero capital", () => {
    const plan = fixture(
      [chain("aave", "aaveSupply")],
      [{ network: "robinhood", sharePct: 0, chains: [] }],
    );
    const steps = deriveLaunchSteps(plan, {}, false, true);
    expect(steps.filter((step) => step.kind === "spoke")).toHaveLength(1);
    expect(steps.some((step) => step.kind === "bridge")).toBe(false);
  });
  it("converts canvas root shares to fractions of actual Robinhood net arrival", () => {
    const plan = fixture(
      [chain("hub", "aaveSupply", 60)],
      [
        {
          network: "robinhood",
          sharePct: 40,
          chains: [chain("first", "uniswapV4Pool", 20), chain("second", "uniswapV4Pool", 20)],
        },
      ],
    );
    const steps = deriveLaunchSteps(
      plan,
      { "first-position": config, "second-position": config },
      false,
      true,
    );
    const remote = steps.find((step) => step.id === "first-position:open");
    expect(remote?.shareDenominator).toBe(40);
    expect(remote?.sharePct).toBe(20);
  });
  it.each([
    [
      "Aave only",
      fixture([chain("aave", "aaveSupply")]),
      {},
      false,
      ["approve", "create", "discover", "profile", "allocate", "open"],
    ],
    [
      "hub v4",
      fixture([chain("pool", "uniswapV4Pool")]),
      { "pool-position": config },
      false,
      ["approve", "create", "discover", "profile", "allocate", "swap", "open"],
    ],
    [
      "spoke v4",
      fixture(
        [],
        [{ network: "robinhood", sharePct: 100, chains: [chain("remote", "uniswapV4Pool")] }],
      ),
      { "remote-position": config },
      true,
      [
        "approve",
        "create",
        "discover",
        "spoke",
        "discover",
        "profile",
        "report",
        "bridge",
        "arrival",
        "swap",
        "open",
      ],
    ],
  ])("derives real steps for %s", (_name, plan, execution, spoke, expected) => {
    const steps = deriveLaunchSteps(
      plan as CanvasPlan,
      execution as Record<string, typeof config>,
      true,
      spoke as boolean,
    );
    expect(steps.map((step) => step.kind)).toEqual(expected);
    expect(steps.every((step) => [42161, 4663].includes(step.chain))).toBe(true);
  });
  it("allocates Aave as an independent leaf, never as pool funding", () => {
    const steps = deriveLaunchSteps(
      fixture([chain("aave", "aaveSupply", 30), chain("pool", "uniswapV4Pool", 70)]),
      { "pool-position": config },
      false,
      false,
    );
    const pool = steps.find((step) => step.id === "pool-position:swap");
    expect(pool?.dependencies).toEqual(["allocate"]);
    expect(pool?.sharePct).toBe(70);
  });
  it("ignores Collect fees at launch", () => {
    const plan = fixture([chain("aave", "aaveSupply")]);
    plan.hub.chains[0]?.steps.push({ id: "fees", family: "flow", kind: "collectFees", config: {} });
    expect(
      deriveLaunchSteps(plan, {}, false, false).filter((step) => step.kind === "open"),
    ).toHaveLength(1);
  });
  it("refuses missing v4 ranges instead of guessing execution", () => {
    expect(() =>
      deriveLaunchSteps(fixture([chain("pool", "uniswapV4Pool")]), {}, false, false),
    ).toThrow("BUILD_EXECUTION_GAP");
  });
  it("refuses unsupported borrowing and Base", () => {
    expect(() =>
      deriveLaunchSteps(fixture([chain("borrow", "aaveBorrow")]), {}, false, false),
    ).toThrow();
    expect(() =>
      deriveLaunchSteps(
        fixture(
          [],
          [{ network: "base", sharePct: 100, chains: [chain("remote", "uniswapV4Pool")] }],
        ),
        {},
        false,
        true,
      ),
    ).toThrow();
  });
  it("requires explicit leaf shares for serial Aave and pool drawings", () => {
    const plan = fixture([chain("aave", "aaveSupply")]);
    plan.hub.chains[0]?.steps.push(chain("pool", "uniswapV4Pool").steps[0]!);
    expect(() => deriveLaunchSteps(plan, { "pool-position": config }, false, false)).toThrow(
      "BUILD_EXECUTION_GAP",
    );
  });
  it("refuses over-allocation and 8% loss", () => {
    expect(() =>
      deriveLaunchSteps(fixture([chain("aave", "aaveSupply", 101)]), {}, false, false),
    ).toThrow();
    expect(() =>
      deriveLaunchSteps(
        fixture([chain("pool", "uniswapV4Pool")]),
        { "pool-position": { ...config, maxLossBps: 800 } },
        false,
        false,
      ),
    ).toThrow();
  });
  it("allocates percentages of net seed and of net arrival, preserving rounding remainder", () => {
    expect(allocationRaw(BigInt("99000000"), 40)).toBe(BigInt("39600000"));
    expect(allocationRaw(BigInt("39500001"), 50)).toBe(BigInt("19750000"));
  });
});

describe("deferred pool execution (POO-2204)", () => {
  // @rule R3, R4
  it("omits zero pools and zero spokes while preserving positive execution", () => {
    const plan = fixture(
      [chain("idle", "uniswapV4Pool", 0), chain("active", "aaveSupply", 100)],
      [{ network: "robinhood", sharePct: 0, chains: [chain("rh-idle", "uniswapV4Pool", 0)] }],
    );
    const steps = deriveLaunchSteps(plan, {}, false, true);
    expect(steps.filter((step) => ["swap", "bridge", "arrival"].includes(step.kind))).toHaveLength(
      0,
    );
    expect(steps.filter((step) => step.kind === "open").map((step) => step.blockId)).toEqual([
      "active-position",
    ]);
    expect(plan.hub.chains[0]?.steps[0]?.config).toEqual({ poolId: "pool" });
  });
  // @rule R4
  it("keeps all-idle launch blocked", () => {
    expect(() =>
      deriveLaunchSteps(fixture([chain("idle", "uniswapV4Pool", 0)]), {}, false, false),
    ).toThrow("INVALID_ALLOCATION");
  });
});

describe("deferred pool safety (POO-2204)", () => {
  // @rule R2, R3
  it.each([-1, Number.NaN, 0.5])("rejects invalid deferred allocation %s", (sharePct) => {
    expect(() =>
      deriveLaunchSteps(
        fixture([chain("idle", "uniswapV4Pool", sharePct), chain("active", "aaveSupply", 40)]),
        {},
        false,
        false,
      ),
    ).toThrow("INVALID_ALLOCATION");
  });
  // @rule R2
  it("rejects a malformed deferred pool config", () => {
    const plan = fixture([chain("idle", "uniswapV4Pool", 0), chain("active", "aaveSupply", 40)]);
    const position = plan.hub.chains[0]?.steps[0];
    if (!position) throw new Error("fixture");
    position.config = { poolId: "pool", tickLower: 12, tickUpper: 5 };
    expect(() => deriveLaunchSteps(plan, {}, false, false)).toThrow("INVALID_BUILD");
  });
});
