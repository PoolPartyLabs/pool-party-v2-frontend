/**
 * @id PP-STR-CMP-023 (POO-1039)
 * @name funding selection helpers, tests
 * @implements-rules-version v2 (POO-1499 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The pure half of the funding-source selector: the running total [R1], the selectability of a
 * verdict [R3], route order [R4] and the coverage test the CTA gates on [R5].
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { NATIVE_RESERVE_ETH } from "@/lib/provisioning/nativeReserve";
import {
  belowGasFloor,
  committedUsd,
  fillToTarget,
  fundingProgress,
  fundingSourceKey,
  isSelectableVerdict,
  reachesChain,
  SEED_BUFFER_MAX_RATE,
  SEED_BUFFER_RATE,
  SLIPPAGE_HEADROOM_RATE,
  seedBufferRate,
  seedRequiredUsd,
  spendableSources,
  toggleFundingSource,
} from "./fundingSelection";

/** The native-coin sentinel address the funding inventory uses for ETH / POL. */
const NATIVE = "0x0000000000000000000000000000000000000000";

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

  it("offers a same-chain holding even when the routability list omits its own chain (POO-1155)", () => {
    // Root cause: Uniswap `listSwappableTokens` returns bridge DESTINATIONS and EXCLUDES the source
    // chain, so a USDC holding on the operation's OWN chain arrives with the target absent from its
    // reachable set. Judging same-chain by that list greyed out the one holding that needs no bridge
    // at all. Live on dev: USDC on 42161 -> [137, 8453], with a target of 42161.
    expect(reachesChain({ chainId: 42161, reachableChainIds: [137, 8453] }, 42161)).toBe(true);
    expect(reachesChain({ chainId: 8453, reachableChainIds: [137, 42161] }, 8453)).toBe(true);
  });
});

/**
 * POO-1155: the native coin is a wallet reserve for signing, not a spendable balance to the last wei.
 * `belowGasFloor` / `committedUsd` reserve `NATIVE_RESERVE_ETH` on any chain — a below-floor native
 * cannot be selected at all, and a selected one commits only the excess (you cannot spend the gas you
 * sign with). This is the `NATIVE_RESERVE_ETH` "wallet reserve" use, distinct from its standalone
 * [R1] gas TRIGGER: it never sizes a gas purchase.
 */
function native(over: Partial<FundingSource> = {}) {
  return source({
    chainId: 8453,
    address: NATIVE,
    symbol: "ETH",
    decimals: 18,
    isNative: true,
    reachableChainIds: [42161],
    ...over,
  });
}

/** `eth` whole coins as a base-unit (wei) decimal string. */
function wei(eth: number): string {
  return BigInt(Math.round(eth * 1e6))
    .toString()
    .concat("000000000000");
}

describe("belowGasFloor (POO-1155)", () => {
  it("refuses the native coin held below the signing reserve", () => {
    const belowFloor = NATIVE_RESERVE_ETH * 0.7;
    expect(belowGasFloor(native({ amount: wei(belowFloor), usd: 2 }))).toBe(true);
  });

  it("allows the native coin above the reserve", () => {
    expect(belowGasFloor(native({ amount: wei(NATIVE_RESERVE_ETH * 5.5), usd: 18 }))).toBe(false);
  });

  // @rule POO-1155 — the boundary, pinned. A balance EXACTLY at the floor has nothing to spend:
  // `committedUsd` returns 0 at `balance <= floor` and `reserveNativeFloor` caps the amount to zero
  // there. A strict `<` here left that row SELECTABLE, so it could be ticked, add $0.00 to the running
  // total and hand the engine zero base units, which reads as a broken control. All three agree on
  // `<=`.
  it("refuses the native coin held EXACTLY at the reserve, matching committedUsd", () => {
    const atFloor = native({ amount: wei(NATIVE_RESERVE_ETH), usd: 3.2 });
    expect(belowGasFloor(atFloor)).toBe(true);
    expect(committedUsd(atFloor)).toBe(0);
  });

  it("never applies to a non-native token, however small", () => {
    expect(belowGasFloor(source({ chainId: 8453, address: "0xa", amount: "1", usd: 0.5 }))).toBe(
      false,
    );
  });
});

describe("committedUsd (POO-1155)", () => {
  it("commits the full value of a non-native holding", () => {
    expect(committedUsd(source({ chainId: 42161, address: "0xa", usd: 17.54 }))).toBe(17.54);
  });

  it("reserves the signing floor and commits only the excess of the native coin", () => {
    const balance = NATIVE_RESERVE_ETH * 5.5;
    const usd = 18;
    const committed = committedUsd(native({ amount: wei(balance), usd }));
    const expected = usd * ((balance - NATIVE_RESERVE_ETH) / balance);
    expect(committed).toBeCloseTo(expected, 4);
    expect(committed).toBeLessThan(usd);
  });

  it("commits nothing from a native coin at or below the floor", () => {
    expect(committedUsd(native({ amount: wei(NATIVE_RESERVE_ETH * 0.7), usd: 2 }))).toBe(0);
  });
});

describe("fundingProgress counts the native excess only (POO-1155)", () => {
  it("sums a non-native holding in full and a native holding net of the reserve", () => {
    const balance = NATIVE_RESERVE_ETH * 5.5;
    const usdc = source({ chainId: 8453, address: "0xusdc", usd: 17.54 });
    const eth = native({ amount: wei(balance), usd: 18 });
    const progress = fundingProgress(
      [usdc, eth],
      [fundingSourceKey(usdc), fundingSourceKey(eth)],
      100,
    );
    const excess = 18 * ((balance - NATIVE_RESERVE_ETH) / balance);
    expect(progress.selectedUsd).toBeCloseTo(17.54 + excess, 2);
    expect(progress.selectedUsd).toBeLessThan(17.54 + 18);
  });
});

describe("spendableSources: native floor + same-chain (POO-1155)", () => {
  const gas = { 8453: { verdict: "OK" as const } };

  it("drops a native coin held below the signing reserve", () => {
    const eth = native({ amount: wei(NATIVE_RESERVE_ETH * 0.7), usd: 2, reachableChainIds: [] });
    expect(spendableSources([eth], gas, 8453)).toEqual([]);
  });

  it("keeps a same-chain holding whose reachable set omits its own chain", () => {
    const usdc = source({
      chainId: 8453,
      address: "0xusdc",
      usd: 10,
      reachableChainIds: [137, 42161],
    });
    expect(spendableSources([usdc], gas, 8453)).toEqual([usdc]);
  });

  it("keeps a native coin above the reserve", () => {
    const eth = native({ amount: wei(NATIVE_RESERVE_ETH * 5.5), usd: 18, reachableChainIds: [] });
    expect(spendableSources([eth], gas, 8453)).toEqual([eth]);
  });
});

describe("seedRequiredUsd (POO-1042 [R7])", () => {
  it("asks for MORE than the bare shortfall, so the quoted plan lands under the seed", () => {
    expect(seedRequiredUsd(100, 0)).toBeGreaterThan(100);
  });

  // @rule POO-1499 R49 — the buffer covers the gas too, because both halves cross a market between
  // selection and settlement. It used to multiply the shortfall alone and add gas afterwards, which
  // left the gas component unprotected: `(100 * 1.05) + 0.5`, not `(100 + 0.5) * 1.05`.
  it("[R49] buffers the gas along with the shortfall, not after it", () => {
    // (100 + 0.5) * 1.05 = 105.525, ceiling to the cent.
    expect(seedRequiredUsd(100, 0.5)).toBe(105.53);
  });

  // The change is small in dollars and is about WHEN the CTA opens, so it is pinned rather than
  // left to be re-derived: this is the figure POO-1042 [R7]'s gate compares against.
  it("[R49] asks for more than the old base did, by the buffer on the gas", () => {
    const OLD_BASE = 100 * 1.05 + 5; // what shipped before POO-1499
    expect(seedRequiredUsd(100, 5)).toBeGreaterThan(OLD_BASE);
    expect(seedRequiredUsd(100, 5)).toBe(110.25); // (100 + 5) * 1.05
  });

  it("is zero for a zero shortfall with no gas — a gas-only op with gas in hand needs nothing", () => {
    expect(seedRequiredUsd(0, 0)).toBe(0);
  });

  it("never returns NaN or a negative for a broken reading", () => {
    expect(seedRequiredUsd(Number.NaN, Number.NaN)).toBe(0);
    expect(seedRequiredUsd(-5, -1)).toBe(0);
  });
});

/**
 * POO-1502 [R15] / [R16]. The shortcut stopped being "convert everything" because that name is false
 * the moment holdings exceed the target: it selects biggest-USD first and stops as soon as the target
 * is covered.
 */
describe("fillToTarget (POO-1502 [R15], [R16])", () => {
  const OK = { verdict: "OK" } as const;
  const gas = { 8453: OK, 137: OK, 42161: OK };

  it("[R15] takes the biggest holding first and stops the moment the target is covered", () => {
    const sources = [
      source({ chainId: 8453, address: "0xa", usd: 148.4 }),
      source({ chainId: 137, address: "0xb", usd: 66.85 }),
      source({ chainId: 42161, address: "0xc", usd: 500 }),
    ];

    const fill = fillToTarget(sources, gas, 215.25);

    // The $500 holding alone covers $215.25, so nothing else is touched. Selecting the other two as
    // well is what "convert everything" did, and it is why the name had to go.
    expect(fill.keys).toEqual(["42161:0xc"]);
    expect(fill.usd).toBe(500);
  });

  it("[R15] keeps taking until the target is covered", () => {
    const sources = [
      source({ chainId: 8453, address: "0xa", usd: 148.4 }),
      source({ chainId: 137, address: "0xb", usd: 66.85 }),
    ];

    const fill = fillToTarget(sources, gas, 215.25);

    expect(fill.keys).toEqual(["8453:0xa", "137:0xb"]);
    expect(fill.usd).toBe(215.25);
  });

  it("[R15] orders by value, not by the order it was handed", () => {
    const sources = [
      source({ chainId: 137, address: "0xsmall", usd: 10 }),
      source({ chainId: 8453, address: "0xbig", usd: 300 }),
    ];

    // Biggest first is route order too ([R4]): `buildPlan` consumes picks in the order given.
    expect(fillToTarget(sources, gas, 250).keys).toEqual(["8453:0xbig"]);
  });

  it("[R16] reports what the click will actually select, overshoot included", () => {
    // The literal formula in [R16] is `min(spendable, sourceTarget)`, which is only right when the
    // holdings cover the target EXACTLY. Whole-source selection (POO-1082 D1) routinely overshoots,
    // and the rule's own sentence is "the amount is what clicking it will select", so the sum of the
    // chosen subset wins over the formula. Printing the target here would promise a precision the
    // click does not deliver.
    const sources = [source({ chainId: 8453, address: "0xa", usd: 300 })];

    const fill = fillToTarget(sources, gas, 215.25);

    expect(fill.usd).toBe(300);
  });

  it("[R11] never fills from a row the list does not render", () => {
    const sources = [
      source({ chainId: 8453, address: "0xa", usd: 500 }),
      source({ chainId: 137, address: "0xb", usd: 90 }),
    ];

    // A BLOCKED chain cannot originate a transaction, so its money is not available to the fill any
    // more than it is available to the list. One predicate, `spendableSources`, decides both.
    const fill = fillToTarget(sources, { 8453: { verdict: "BLOCKED" }, 137: OK }, 50);

    expect(fill.keys).toEqual(["137:0xb"]);
  });

  it("counts what a source COMMITS, so a native never fills with the gas it must keep", () => {
    const native = source({
      chainId: 8453,
      address: NATIVE,
      symbol: "ETH",
      decimals: 18,
      isNative: true,
      // Two floors' worth: only the excess over the signing reserve can fund anything.
      amount: String(Math.round(NATIVE_RESERVE_ETH * 2 * 1e18)),
      usd: 100,
    });

    const fill = fillToTarget([native], { 8453: OK }, 40);

    expect(fill.keys).toEqual([fundingSourceKey(native)]);
    expect(fill.usd).toBe(committedUsd(native));
    expect(fill.usd).toBeLessThan(100);
  });

  it("takes everything it can when nothing covers the target, rather than giving up", () => {
    const sources = [
      source({ chainId: 8453, address: "0xa", usd: 30 }),
      source({ chainId: 137, address: "0xb", usd: 20 }),
    ];

    // A short fill is still the most useful thing the button can do: the on-ramp buys the remainder
    // (POO-1155), and a button that did nothing because it could not finish would strand the user.
    const fill = fillToTarget(sources, gas, 215.25);

    expect(fill.keys).toEqual(["8453:0xa", "137:0xb"]);
    expect(fill.usd).toBe(50);
  });

  it("selects nothing when there is nothing spendable", () => {
    const fill = fillToTarget([], gas, 100);
    expect(fill).toEqual({ keys: [], usd: 0 });
  });
});

/**
 * POO-1812 [R1] (Murilo's decision, 2026-09-04). The seed was blind to slippage, which is what most
 * consumes the buffer: the gear that raises it is reachable, and `suggestedSlippagePct` raises it
 * mid-run, so the number meant to absorb a market move never saw the size of the move it allowed.
 *
 * `rate = min(15%, max(5%, slippage% + 1%))`, quantised to whole percentage points ([R3]). The floor
 * keeps today's behaviour for every investor default; the cap stops a hand-typed slippage from
 * seeding an absurd ask.
 */
describe("seedBufferRate (POO-1812 [R1])", () => {
  // @rule R1 -- the floor. Every one of these is at or under 4%, so 5% already covers them.
  it.each([0.5, 1, 2, 4])("[R1] floors at 5%% for %s%% slippage", (pct) => {
    expect(seedBufferRate(pct)).toBeCloseTo(0.05, 10);
  });

  // @rule R1 -- above the floor the rate tracks the slippage, plus one point of headroom.
  it("[R1] tracks slippage plus headroom above the floor", () => {
    expect(seedBufferRate(5)).toBeCloseTo(0.06, 10);
    expect(seedBufferRate(10)).toBeCloseTo(0.11, 10);
    expect(seedBufferRate(14)).toBeCloseTo(0.15, 10);
  });

  // @rule R1 -- the cap. A hand-typed 50% must not seed a 51% ask.
  it.each([20, 50, 100])("[R1] caps at 15%% for %s%% slippage", (pct) => {
    expect(seedBufferRate(pct)).toBeCloseTo(SEED_BUFFER_MAX_RATE, 10);
  });

  // @rule R5 -- a broken or absent reading is the FLOOR, never a computed value. The rate gates a
  // CTA, and a `NaN` reaching that comparison would silently open it.
  it.each([
    undefined,
    Number.NaN,
    -1,
    Number.POSITIVE_INFINITY,
  ])("[R5] falls back to the floor for %s", (pct) => {
    expect(seedBufferRate(pct as number | undefined)).toBeCloseTo(SEED_BUFFER_RATE, 10);
  });

  // @rule R1 -- the constants are what the formula says they are, so a future edit to one of them
  // cannot silently change the rule while the tables above still pass.
  it("[R1] is exactly the stated formula, to the whole percentage point", () => {
    expect(SEED_BUFFER_RATE).toBe(0.05);
    expect(SLIPPAGE_HEADROOM_RATE).toBe(0.01);
    expect(SEED_BUFFER_MAX_RATE).toBe(0.15);
    for (const pct of [0, 3, 4.5, 6, 12, 30]) {
      const clamped = Math.min(
        SEED_BUFFER_MAX_RATE,
        Math.max(SEED_BUFFER_RATE, pct / 100 + SLIPPAGE_HEADROOM_RATE),
      );
      expect(seedBufferRate(pct)).toBeCloseTo(Math.round(clamped * 100) / 100, 10);
    }
  });

  // @rule R3 -- quantised at the SOURCE, so the percent the disclosures print and the basis points
  // the ledger and the analytics row hold are both exact. Unquantised, `slippage% + 1%` is not a
  // whole number of points for a fractional tolerance (the control accepts one decimal, and 4.5%
  // gives 5.5), and the rate does not convert cleanly either: 5% produces `0.060000000000000005`,
  // which is `699.9999999999999` basis points, for 34 of the 201 settings the control accepts.
  it("[R3] is a whole number of percentage points for every setting the control accepts", () => {
    for (let tenths = 0; tenths <= 1000; tenths += 1) {
      const points = seedBufferRate(tenths / 10) * 100;
      expect(Math.abs(points - Math.round(points))).toBeLessThan(1e-9);
    }
  });

  // @rule R3 -- and therefore rounds to integer basis points, which is what the ledger's budget and
  // the event's `rate_bps` carry. 6% is the exact rate a mid-run raise off a 5% tolerance produces,
  // which is the value the drift was worst on.
  it("[R3] rounds to whole-point basis points, the mid-run raise value included", () => {
    expect(Math.round(seedBufferRate(5) * 10_000)).toBe(600);
    expect(Math.round(seedBufferRate(6) * 10_000)).toBe(700);
    for (let tenths = 0; tenths <= 1000; tenths += 1) {
      expect(Math.round(seedBufferRate(tenths / 10) * 10_000) % 100).toBe(0);
    }
  });
});

describe("seedRequiredUsd reads slippage (POO-1812 [R1])", () => {
  // @rule R1 -- byte-identical without the argument, so every caller that has not opted in is
  // unchanged. This is what lets the change land without touching six call sites at once.
  it("[R1] is unchanged when no slippage is given", () => {
    expect(seedRequiredUsd(100, 5)).toBe(seedRequiredUsd(100, 5, undefined));
    // $105 x 1.05, the POO-1499 [R49] figure this file already documents.
    expect(seedRequiredUsd(100, 5)).toBeCloseTo(110.25, 2);
  });

  // @rule R1 -- and at or below the floor's slippage, opting in changes nothing either.
  it("[R1] is unchanged for an investor-default 2% slippage", () => {
    expect(seedRequiredUsd(100, 5, 2)).toBe(seedRequiredUsd(100, 5));
  });

  // @rule R1 -- above 4% the ask moves. Deliberately NOT called "the manager console default": the
  // manager flows (`MoveRangeModal`, `RemoveLiquidityModal`, `CollectModal`, `CompoundModal`) pass
  // NO slippage to `useProvisioningGate`, so their seed is still the floor whatever their own gear
  // is set to. This is the buyer who set 5% on a flow that does thread it (invest, withdraw).
  // Threading the rest is POO-1866.
  it("[R1] raises the ask for a buyer who set 5% in the settings gear", () => {
    // $1,000 operation with $5 of gas: $1,055.25 at the floor, $1,065.30 at the 6% that 5% implies.
    expect(seedRequiredUsd(1000, 5)).toBeCloseTo(1055.25, 2);
    expect(seedRequiredUsd(1000, 5, 5)).toBeCloseTo(1065.3, 2);
  });

  // @rule R1 -- the cap reaches the money, not only the rate.
  it("[R1] caps the ask at the 15% rate", () => {
    expect(seedRequiredUsd(1000, 0, 50)).toBe(seedRequiredUsd(1000, 0, 14));
    expect(seedRequiredUsd(1000, 0, 50)).toBeCloseTo(1150, 2);
  });

  // @rule R1 -- it still rounds UP to the cent, for the reason the header gives: a sub-cent gap must
  // never read as covered.
  it("[R1] still rounds up to the cent", () => {
    expect(Number.isInteger(Math.round(seedRequiredUsd(33.33, 0, 7) * 100))).toBe(true);
  });
});

/**
 * POO-1812 [R3]: ONE rate per run, on every surface that shows or spends it. [R4]: the ledger's
 * budget is the rate the run was SEEDED with, and a mid-run raise does not move it.
 *
 * A source scan, in the same spirit as `layout.source.test.ts`, because the property is about where
 * a number comes FROM and that is not observable from rendered output: every surface would still
 * read 5 in the default case whether it derived the rate or hard-coded the constant. What must not
 * come back is a second derivation, which is how a row and a meter start disagreeing about the same
 * cent, or a second float conversion, which is how a budget ends up at 699.9999999999999 bps. The
 * BEHAVIOUR of [R4] under a real raise is pinned in `ProvisioningPanel.slippageRetry.test.tsx`.
 */
describe("one rate per run, in the panel (POO-1812 [R3]/[R4])", () => {
  // Resolved from the repo root, the way the other source-scan suites do it: `import.meta.url` is a
  // vite module id under vitest, not a filesystem path.
  const panel = readFileSync(
    join(process.cwd(), "src/features/strategies/components/ProvisioningPanel.tsx"),
    "utf8",
  );

  // @rule R3 -- the rate is computed once, from the slippage the run will actually allow, and its
  // basis points once from that.
  it("[R3] derives the rate once, and its basis points once from the rate", () => {
    expect(panel).toContain("const bufferRate = seedBufferRate(effectiveSlippagePct);");
    expect(panel).toContain("const bufferRateBps = Math.round(bufferRate * 10_000);");
  });

  // @rule R3 -- and every consumer reads THAT, never the constant.
  it("[R3] spends the derived rate on the seed, the route targets and the copy", () => {
    // The seed opts in.
    expect(panel).toMatch(/seedRequiredUsd\([\s\S]{0,200}effectiveSlippagePct,/);
    // The route cards' target.
    expect(panel).toContain("bufferRate }");
    // The two disclosures and the price-move body.
    expect(panel.match(/Math\.round\(bufferRate \* 100\)/g)?.length).toBe(3);
  });

  // @rule R4 -- the ledger is held to the SEEDED rate; only the reported rate follows a raise.
  it("[R4] holds the ledger budget on the seeded rate, and reports the live one beside it", () => {
    expect(panel).toContain("budgetBps: seededBufferRateBpsRef.current");
    expect(panel).toContain("rateBps: bufferRateBpsRef.current");
    // Pinned where a genuinely NEW run resets the running total, and nowhere else.
    expect(panel).toContain("seededBufferRateBpsRef.current = bufferRateBpsRef.current;");
    expect(panel.match(/seededBufferRateBpsRef\.current =/g)?.length).toBe(1);
  });

  // @rule R3 -- the drift guard proper: the old constant is no longer spent anywhere in the panel,
  // and the rate is converted to basis points exactly once.
  it("[R3] never re-derives: no constant percentage, no second bps conversion", () => {
    expect(panel).not.toMatch(/DEFAULT_SOURCE_BUFFER_RATE \* /);
    expect(panel.match(/bufferRate \* 10_000/g)?.length).toBe(1);
  });
});
