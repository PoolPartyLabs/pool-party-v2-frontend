/**
 * @id PP-STR-CMP-023 (POO-1039)
 * @name funding selection helpers, tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The pure half of the funding-source selector: the running total [R1], the selectability of a
 * verdict [R3], route order [R4] and the coverage test the CTA gates on [R5].
 */
import { describe, expect, it } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import {
  fundingProgress,
  fundingSourceKey,
  isSelectableVerdict,
  reachesChain,
  seedRequiredUsd,
  toggleFundingSource,
} from "./fundingSelection";

/** A funding source with only the fields these helpers read. */
function source(over: Partial<FundingSource> & Pick<FundingSource, "chainId" | "address">) {
  return {
    symbol: "USDC",
    decimals: 6,
    amount: "1000000",
    usd: 1,
    reachableChainIds: [over.chainId],
    isNative: false,
    logoUrl: "",
    ...over,
  } satisfies FundingSource;
}

describe("fundingSourceKey", () => {
  it("keys a source by chain and address, case-insensitively", () => {
    const upper = fundingSourceKey(source({ chainId: 8453, address: "0xABCD" }));
    const lower = fundingSourceKey(source({ chainId: 8453, address: "0xabcd" }));
    expect(upper).toBe("8453:0xabcd");
    expect(lower).toBe(upper);
  });

  it("distinguishes the same token on two chains", () => {
    expect(fundingSourceKey(source({ chainId: 8453, address: "0xa" }))).not.toBe(
      fundingSourceKey(source({ chainId: 137, address: "0xa" })),
    );
  });
});

describe("isSelectableVerdict", () => {
  it("allows OK and TOP_UP", () => {
    expect(isSelectableVerdict("OK")).toBe(true);
    expect(isSelectableVerdict("TOP_UP")).toBe(true);
  });

  it("refuses BLOCKED [R3]", () => {
    expect(isSelectableVerdict("BLOCKED")).toBe(false);
  });

  it("allows a chain with no verdict, so a degraded classification never hides funds", () => {
    expect(isSelectableVerdict(undefined)).toBe(true);
  });
});

describe("toggleFundingSource", () => {
  it("appends a new key, so selection order is route order [R4]", () => {
    expect(toggleFundingSource(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes a selected key and keeps the order of the rest [R4]", () => {
    expect(toggleFundingSource(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("never mutates the input array", () => {
    const selected = ["a"];
    toggleFundingSource(selected, "b");
    expect(selected).toEqual(["a"]);
  });
});

describe("fundingProgress", () => {
  const sources = [
    source({ chainId: 8453, address: "0xa", usd: 60 }),
    source({ chainId: 137, address: "0xb", usd: 30 }),
    source({ chainId: 42161, address: "0xc", usd: 25 }),
  ];
  const key = (index: number) => fundingSourceKey(sources[index] as FundingSource);

  it("totals nothing when nothing is selected [R1]", () => {
    const progress = fundingProgress(sources, [], 100);
    expect(progress.selectedUsd).toBe(0);
    expect(progress.remainingUsd).toBe(100);
    expect(progress.covered).toBe(false);
  });

  it("sums the selected sources and reports the remaining shortfall [R1]", () => {
    const progress = fundingProgress(sources, [key(0), key(1)], 100);
    expect(progress.selectedUsd).toBe(90);
    expect(progress.remainingUsd).toBe(10);
    expect(progress.surplusUsd).toBe(0);
    expect(progress.covered).toBe(false);
  });

  it("reports the surplus once the requirement is passed [R1]", () => {
    const progress = fundingProgress(sources, [key(0), key(1), key(2)], 100);
    expect(progress.selectedUsd).toBe(115);
    expect(progress.remainingUsd).toBe(0);
    expect(progress.surplusUsd).toBe(15);
    expect(progress.covered).toBe(true);
  });

  it("covers an exact match [R5]", () => {
    const progress = fundingProgress(sources, [key(0)], 60);
    expect(progress.covered).toBe(true);
    expect(progress.remainingUsd).toBe(0);
    expect(progress.surplusUsd).toBe(0);
  });

  it("counts a key only once, however many times it is listed", () => {
    const progress = fundingProgress(sources, [key(0), key(0)], 100);
    expect(progress.selectedUsd).toBe(60);
  });

  it("ignores a key that names no current source (a stale selection after a re-read)", () => {
    const progress = fundingProgress(sources, [key(0), "1:0xgone"], 100);
    expect(progress.selectedUsd).toBe(60);
  });

  it("ignores a source whose USD value is not a usable figure", () => {
    const broken = [
      source({ chainId: 8453, address: "0xa", usd: Number.NaN }),
      source({ chainId: 137, address: "0xb", usd: -5 }),
    ];
    const progress = fundingProgress(broken, broken.map(fundingSourceKey), 10);
    expect(progress.selectedUsd).toBe(0);
    expect(progress.covered).toBe(false);
  });

  it("adds cents without float drift (100 + 1.27 + 0.1 is not 101.36999999999999)", () => {
    const cents = [
      source({ chainId: 8453, address: "0xa", usd: 100 }),
      source({ chainId: 137, address: "0xb", usd: 1.27 }),
      source({ chainId: 42161, address: "0xc", usd: 0.1 }),
    ];
    const progress = fundingProgress(cents, cents.map(fundingSourceKey), 101.37);
    expect(progress.selectedUsd).toBe(101.37);
    expect(progress.covered).toBe(true);
  });

  it("never rounds a real shortfall down to $0.00 while the CTA stays shut [R5]", () => {
    const progress = fundingProgress(sources, [key(0)], 60.001);
    expect(progress.covered).toBe(false);
    expect(progress.remainingUsd).toBe(0.01);
  });

  it("never rounds a sub-cent surplus up into money the user does not have", () => {
    const progress = fundingProgress(
      [source({ chainId: 8453, address: "0xa", usd: 60.009 })],
      ["8453:0xa"],
      60,
    );
    expect(progress.covered).toBe(true);
    expect(progress.surplusUsd).toBe(0);
  });

  it("treats a zero or malformed requirement as already covered", () => {
    expect(fundingProgress(sources, [], 0).covered).toBe(true);
    expect(fundingProgress(sources, [], Number.NaN).covered).toBe(true);
  });
});

/**
 * POO-1042 (UF-20) additions: the two facts the SELECTOR cannot know but the gate host can — whether
 * a source can route to the operation's chain [R8], and how much to ask for before a route has been
 * quoted [R7].
 */
describe("reachesChain (POO-1042 [R8])", () => {
  it("is true when the target chain is on the source's reachable set", () => {
    expect(reachesChain({ chainId: 137, reachableChainIds: [137, 42161] }, 42161)).toBe(true);
  });

  it("is false when the target chain is absent — the plan would 404 at quote time", () => {
    expect(reachesChain({ chainId: 137, reachableChainIds: [137] }, 42161)).toBe(false);
  });

  it("falls back to same-chain when reachability is unknown, never hiding a funded row", () => {
    // An empty/absent set means the routability lookup degraded, not that the token is stranded.
    // Same-chain still executes with no bridge at all, so it must stay offerable [R6].
    expect(reachesChain({ chainId: 8453, reachableChainIds: [] }, 8453)).toBe(true);
    expect(reachesChain({ chainId: 8453, reachableChainIds: [] }, 42161)).toBe(false);
  });
});

describe("seedRequiredUsd (POO-1042 [R7])", () => {
  it("asks for MORE than the bare shortfall, so the quoted plan lands under the seed", () => {
    expect(seedRequiredUsd(100, 0)).toBeGreaterThan(100);
  });

  it("adds the quoted gas on top of the proportional buffer", () => {
    expect(seedRequiredUsd(100, 0.5)).toBeCloseTo(105.5, 2);
  });

  it("is zero for a zero shortfall with no gas — a gas-only op with gas in hand needs nothing", () => {
    expect(seedRequiredUsd(0, 0)).toBe(0);
  });

  it("never returns NaN or a negative for a broken reading", () => {
    expect(seedRequiredUsd(Number.NaN, Number.NaN)).toBe(0);
    expect(seedRequiredUsd(-5, -1)).toBe(0);
  });
});
