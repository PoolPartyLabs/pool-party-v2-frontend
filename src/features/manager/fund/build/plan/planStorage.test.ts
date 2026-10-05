/**
 * @id PP-MGR-LIB-021
 * @name planStorage tests
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure storage helper.
 *
 * Covers the Storage rule (a stored plan reads back deep-equal; an unreadable one is refused, so the
 * draft store marks the draft `planUnreadable` and keeps the raw plan) and the Dirty rule (the
 * fingerprint the unsaved check compares, D17).
 */
import { describe, expect, it } from "vitest";
import { createEmptyPlan } from "./buildPlan";
import { normalizePlan, planFingerprint } from "./planStorage";
import { hubPoolPlan, spokePoolPlan, supplyBorrowPlan, VALID_TEST_PLANS } from "./planTestKit";

/** A plan as JSON hands it back, loosely typed so a test can break it. */
interface RawStep {
  id?: unknown;
  family?: unknown;
  kind?: unknown;
  auto?: unknown;
  config?: unknown;
}
interface RawChain {
  id?: unknown;
  sharePct?: unknown;
  steps: RawStep[] | null;
}
interface RawPlan {
  version?: unknown;
  hub: { chains: RawChain[] };
  spokes: Array<{ network?: unknown; sharePct?: unknown; chains?: unknown }>;
}

/** A value as storage hands it back: through JSON. */
function stored<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The first hub chain of a raw plan. */
function firstChain(raw: RawPlan): RawChain {
  const chain = raw.hub.chains[0];
  if (!chain) throw new Error("fixture: no chain");
  return chain;
}

/** Step `index` of the first hub chain of a raw plan. */
function stepAt(raw: RawPlan, index: number): RawStep {
  const step = firstChain(raw).steps?.[index];
  if (!step) throw new Error("fixture: no step");
  return step;
}

/** The stored hub pool plan ([Swap · auto, pool]) with one change applied to its raw JSON. */
function broken(edit: (raw: RawPlan) => void): unknown {
  const raw = stored(hubPoolPlan()) as unknown as RawPlan;
  edit(raw);
  return raw;
}

describe("normalizePlan", () => {
  it("rejects malformed stored manual Swap config without discarding the original raw value", () => {
    const raw = broken((plan) => {
      stepAt(plan, 0).auto = false;
      stepAt(plan, 0).config = { tokenInKey: 42, tokenOutKey: "", slippagePct: 2 };
    });
    expect(normalizePlan(raw)).toBeNull();
    expect(stepAt(raw as RawPlan, 0).config).toEqual({
      tokenInKey: 42,
      tokenOutKey: "",
      slippagePct: 2,
    });
  });
  for (const [name, build] of Object.entries(VALID_TEST_PLANS)) {
    it(`reads ${name} back deep-equal`, () => {
      // @rule Storage
      expect(normalizePlan(stored(build()))).toEqual(build());
    });
  }

  it("keeps fields a later batch adds to a config", () => {
    // @rule Storage
    const plan = hubPoolPlan();
    const pool = plan.hub.chains[0]?.steps[1];
    if (pool?.family === "position" && pool.config) {
      Object.assign(pool.config, { tickLower: -200, tickUpper: 200 });
    }
    expect(normalizePlan(stored(plan))).toEqual(plan);
  });

  it("reads structure only: a plan naming things outside the mandate is still a plan", () => {
    // @rule Storage
    const raw = broken((plan) => {
      stepAt(plan, 1).config = { poolId: "a-pool-the-mandate-lost" };
    });
    expect(normalizePlan(raw)).not.toBeNull();
  });

  it("refuses what is not a plan of this version", () => {
    // @rule Storage
    expect(normalizePlan(null)).toBeNull();
    expect(normalizePlan("plan")).toBeNull();
    expect(normalizePlan([])).toBeNull();
    expect(normalizePlan({ ...createEmptyPlan(), version: 2 })).toBeNull();
    expect(normalizePlan({ version: 1, spokes: [] })).toBeNull();
    expect(normalizePlan({ version: 1, hub: { chains: {} }, spokes: [] })).toBeNull();
    expect(normalizePlan({ version: 1, hub: { chains: [] } })).toBeNull();
  });

  it("refuses a malformed spoke or chain", () => {
    // @rule Storage
    const spoke = stored(spokePoolPlan()) as unknown as RawPlan;
    const first = spoke.spokes[0];
    if (first) first.network = 7;
    expect(normalizePlan(spoke)).toBeNull();
    expect(normalizePlan(broken((plan) => delete firstChain(plan).id))).toBeNull();
    expect(
      normalizePlan(
        broken((plan) => {
          firstChain(plan).sharePct = "60";
        }),
      ),
    ).toBeNull();
    expect(
      normalizePlan(
        broken((plan) => {
          firstChain(plan).steps = null;
        }),
      ),
    ).toBeNull();
  });

  it("refuses a malformed step", () => {
    // @rule Storage
    const edits: Array<(plan: RawPlan) => void> = [
      (plan) => {
        stepAt(plan, 0).family = "pill";
      },
      (plan) => {
        stepAt(plan, 0).kind = "bridge";
      },
      (plan) => {
        stepAt(plan, 0).auto = "yes";
      },
      (plan) => {
        stepAt(plan, 1).kind = "curve";
      },
      (plan) => {
        stepAt(plan, 1).config = { assetKey: "x" };
      },
      (plan) => {
        stepAt(plan, 1).config = "pool";
      },
    ];
    for (const edit of edits) expect(normalizePlan(broken(edit))).toBeNull();
  });

  it("refuses two steps or two chains with the same id", () => {
    // @rule Storage
    expect(
      normalizePlan(
        broken((plan) => {
          stepAt(plan, 0).id = "hub-pool-pool";
        }),
      ),
    ).toBeNull();
    expect(normalizePlan(broken((plan) => plan.hub.chains.push(firstChain(plan))))).toBeNull();
  });
});

describe("planFingerprint", () => {
  it("is equal for equal plans and differs after an edit", () => {
    // @rule Dirty
    expect(planFingerprint(supplyBorrowPlan())).toBe(planFingerprint(supplyBorrowPlan()));
    const edited = supplyBorrowPlan();
    const chain = edited.hub.chains[0];
    if (chain) chain.sharePct = 10;
    expect(planFingerprint(edited)).not.toBe(planFingerprint(supplyBorrowPlan()));
  });

  it("reads no plan as the empty plan, which is the same work", () => {
    // @rule Dirty
    expect(planFingerprint(undefined)).toBe(planFingerprint(createEmptyPlan()));
    expect(planFingerprint(undefined)).not.toBe(planFingerprint(hubPoolPlan()));
  });
});
