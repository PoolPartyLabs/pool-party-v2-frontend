import { describe, expect, it } from "vitest";
import { allocationRaw, type CanvasPlan, deriveLaunchSteps } from "./plan";

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
