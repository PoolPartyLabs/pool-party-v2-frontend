/**
 * @id PP-CORE-LIB-016 (POO-1030, POO-1033, POO-1131)
 * @name provisioning contract tests
 * @implements-rules-version v6
 * @hackathon POO-1022 (Universal Funding)
 *
 * The contract is types only, so most of it is proven at COMPILE time: `tsconfig.json` includes
 * `**\/*.ts`, so a wrong shape here fails `pnpm typecheck`, and `expectTypeOf` turns "is this field
 * optional" into a real assertion rather than a comment. Vitest still runs the file, which keeps the
 * runtime half (a v2 plan reads identically, the new fields default to `undefined`) honest.
 *
 * Two rules are checked against the file's own SOURCE, because they ARE documentation rules and the
 * repo already does this in `serverBoundary.test.ts`: [R6]'s version bump, and [R1]'s requirement
 * that `planId` be documented as the idempotency key. That single sentence is what makes a bridge
 * retry safe (`docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.1) — a future reader who does not know
 * it can re-execute a step and bridge the user's money twice.
 *
 * Rules under test (POO-1030 rules v1):
 *   [R1] six additive OPTIONAL fields, `planId` documented as the idempotency key
 *   [R2] existing fields keep their meaning: a v2-shaped plan still type-checks and reads the same
 *   [R3] money convention unchanged: token-native = decimal STRING, USD = display-grade number
 *   [R6] `@implements-rules-version` is current and the pinned comment says what each revision added
 *
 * POO-1033 rules v1 took the contract to v4 (per-chain balances on {@link ProvisioningNeedInput});
 * its own branch matrix lives in `computeNeed.test.ts`, and only the version pin moves here.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { OnRampRail } from "@/lib/onramp/onRampProvider";
import type {
  OnRampAttribution,
  ProvisioningOrder,
  ProvisioningPlan,
  ProvisioningStep,
} from "./types";

const TYPES_SOURCE = readFileSync(
  join(resolve(__dirname, "..", "..", ".."), "src", "lib", "provisioning", "types.ts"),
  "utf8",
);

/**
 * A plan exactly as the mock planner (v2) emits it: not one v3 field in sight. It is typed as
 * `ProvisioningPlan`, so if any v3 field were added as REQUIRED this fixture stops compiling — which
 * is precisely the [R2] regression we are guarding against.
 */
const V2_PLAN: ProvisioningPlan = {
  needed: true,
  reason: ["usdc"],
  variant: "multi",
  steps: [
    {
      type: "buy",
      key: "buy",
      labelKey: "provisioning.steps.buy",
      fromToken: "USD",
      toToken: "USDC",
      toChainId: 8453,
      amountUsd: 101.5,
      amountToken: "101.50",
      poweredBy: "paybis",
    },
    { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 100 },
  ],
  quote: {
    shortfallUsd: 100,
    bufferUsd: 2.3,
    feesUsd: 1.02,
    totalPayUsd: 103.32,
    quotedAt: "2026-06-30T12:00:00.000Z",
    ttlMs: 60_000,
  },
  slippagePct: 2,
};

/**
 * The same contract as the real planner (POO-1034) will emit it: a Chained-Actions leg carrying its
 * server-held plan coordinates. Values mirror a real WETH-on-Polygon → USDC-on-Arbitrum route.
 */
const V3_BRIDGE_STEP: ProvisioningStep = {
  type: "bridge",
  key: "bridge",
  labelKey: "provisioning.steps.bridge",
  fromToken: "USDC",
  toToken: "USDC",
  fromChainId: 137,
  toChainId: 42161,
  amountUsd: 100,
  amountToken: "100000000",
  planId: "plan_01JZQ8V3H2M4K7N9P0R1S2T3U4",
  stepIndex: 2,
  method: "SEND_TX",
  payload: { to: "0x0000000000000000000000000000000000000001", data: "0xabcdef", value: "0" },
  chainId: 137,
  etaSeconds: 180,
};

describe("provisioning contract v3 (POO-1030)", () => {
  // [R1] Every new field is optional, so nothing that already produces a plan has to change.
  it("the v3 fields are all optional", () => {
    expectTypeOf<ProvisioningStep["planId"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ProvisioningStep["stepIndex"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ProvisioningStep["method"]>().toEqualTypeOf<
      "SEND_TX" | "SIGN_MSG" | "SEND_CALLS" | undefined
    >();
    expectTypeOf<ProvisioningStep["payload"]>().toEqualTypeOf<unknown>();
    expectTypeOf<ProvisioningStep["chainId"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ProvisioningStep["etaSeconds"]>().toEqualTypeOf<number | undefined>();
  });

  // [R1] The plan-level shape is untouched: v3 lands on the STEP, not on the plan or the quote.
  it("carries the plan coordinates the rail needs on a step", () => {
    expect(V3_BRIDGE_STEP.planId).toBe("plan_01JZQ8V3H2M4K7N9P0R1S2T3U4");
    expect(V3_BRIDGE_STEP.stepIndex).toBe(2);
    expect(V3_BRIDGE_STEP.method).toBe("SEND_TX");
    expect(V3_BRIDGE_STEP.chainId).toBe(137);
    // Bridge legs settle in minutes, which is why an ETA exists at all.
    expect(V3_BRIDGE_STEP.etaSeconds).toBeGreaterThan(60);
  });

  // [R1] `payload` is deliberately `unknown`: the API nests it differently per method and the rail
  // (POO-1036) narrows it there. `unknown` forces that narrowing instead of letting `any` through.
  it("leaves payload unnarrowed at the contract level", () => {
    expect(V3_BRIDGE_STEP.payload).toBeTypeOf("object");
    // @ts-expect-error — unknown is not indexable until the rail narrows it per method.
    expect(V3_BRIDGE_STEP.payload.to).toBeDefined();
  });

  // [R2] A v2-shaped plan is still a valid plan, and every v3 field simply reads `undefined`.
  it("a v2-shaped plan still parses, with the v3 fields absent", () => {
    const [buy, op] = V2_PLAN.steps;

    expect(V2_PLAN.steps).toHaveLength(2);
    expect(op?.type).toBe("op");
    for (const step of V2_PLAN.steps) {
      expect(step.planId).toBeUndefined();
      expect(step.stepIndex).toBeUndefined();
      expect(step.method).toBeUndefined();
      expect(step.payload).toBeUndefined();
      expect(step.chainId).toBeUndefined();
      expect(step.etaSeconds).toBeUndefined();
    }
    // [R2] and the v2 fields still mean exactly what they meant.
    expect(buy?.poweredBy).toBe("paybis");
    expect(buy?.toChainId).toBe(8453);
    expect(V2_PLAN.quote.totalPayUsd).toBe(103.32);
  });

  // [R2] `chainId` is additive, NOT a rename of from/toChainId: a step can carry all three, and the
  // view mapper still reads `toChainId` for the bridge row's network name.
  it("chainId does not displace fromChainId / toChainId", () => {
    expect(V3_BRIDGE_STEP.fromChainId).toBe(137);
    expect(V3_BRIDGE_STEP.toChainId).toBe(42161);
    expect(V3_BRIDGE_STEP.chainId).toBe(137);
  });

  // [R3] Token-native amounts stay decimal strings (no float drift), USD stays a display number.
  it("keeps the money convention", () => {
    expectTypeOf<ProvisioningStep["amountToken"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ProvisioningStep["amountUsd"]>().toEqualTypeOf<number>();
    expect(V3_BRIDGE_STEP.amountToken).toBeTypeOf("string");
    expect(V3_BRIDGE_STEP.amountUsd).toBeTypeOf("number");
  });

  // [R1] The one fact that makes a bridge retry safe has to be written down where the field is.
  it("documents planId as the idempotency key", () => {
    expect(TYPES_SOURCE).toMatch(/planId[\s\S]{0,600}idempotency key/i);
  });

  // [R6] The version bump, in the header and in the pinned-contract comment. POO-1927 took the
  // contract to v7 (`poweredBy` widened off the `"paybis"` literal); the assertion moves with it and
  // keeps requiring that EVERY revision is still explained in the file, so the history is not
  // rewritten away by the next bump.
  it("declares the current rules version and keeps its revision history", () => {
    expect(TYPES_SOURCE).toMatch(/@implements-rules-version:?\s*v7/);
    expect(TYPES_SOURCE).toMatch(/POO-1030/);
    expect(TYPES_SOURCE).toMatch(/POO-1033/);
    expect(TYPES_SOURCE).toMatch(/POO-1034/);
    expect(TYPES_SOURCE).toMatch(/POO-1131/);
    expect(TYPES_SOURCE).toMatch(/POO-1927/);
  });

  // v5 [R8] — the leg deliberately holds no quote and no calldata. Every leg is re-quoted at
  // execution time, so a stored quote is at best dead weight and at worst something a future author
  // broadcasts. The same rule binds the recovery journal (02_BRIDGE_ARCHITECTURE.md §3.3), and a
  // comment alone would not survive the next author adding "just the quote, for convenience".
  it("keeps quotes and calldata off ProvisioningLeg", () => {
    const leg = TYPES_SOURCE.slice(
      TYPES_SOURCE.indexOf("export interface ProvisioningLeg {"),
      TYPES_SOURCE.indexOf("export interface ProvisioningQuote"),
    );
    expect(leg).not.toMatch(/^\s*quote[?]?:/m);
    expect(leg).not.toMatch(/^\s*(calldata|data|permitData|signature)[?]?:/m);
  });
});

describe("provisioning contract v6 (POO-1131)", () => {
  // The delivered asset is DATA on the step, not baked into the type name: the whole point of the
  // rename. `toEqualTypeOf` pins the union, so a re-rename or a dropped member fails here.
  it("names the fiat step `buy` and carries its delivered asset as data", () => {
    expectTypeOf<ProvisioningStep["type"]>().toEqualTypeOf<
      "buy" | "bridge" | "bridge-gas" | "swap-gas" | "swap-token" | "op"
    >();
    const [buy] = V2_PLAN.steps;
    expect(buy?.type).toBe("buy");
    expect(buy?.labelKey).toBe("provisioning.steps.buy");
    expect(buy?.toToken).toBe("USDC");
    expect(buy?.toChainId).toBe(8453);
  });

  // The fiat counterpart of `leg`: optional, and the amount is a decimal STRING (no float).
  it("carries an optional fiat `order`", () => {
    expectTypeOf<ProvisioningStep["order"]>().toEqualTypeOf<ProvisioningOrder | undefined>();
    expectTypeOf<ProvisioningOrder["fiatAmount"]>().toEqualTypeOf<string>();
    const order: ProvisioningOrder = {
      currencyCode: "USDC-BASE",
      fiatAmount: "101.50",
      fiatCurrency: "USD",
    };
    expect(order.currencyCode).toBe("USDC-BASE");
    // A v5-shaped plan carries no order, and the field simply reads undefined.
    for (const step of V2_PLAN.steps) expect(step.order).toBeUndefined();
  });

  // [R8] The requestId (5-minute signature window) and quoteId (a TTL) are minted at EXECUTION time,
  // so a plan built earlier must embed neither. Same discipline the leg keeps for its quote.
  it("keeps requestId and quoteId off the step and its order", () => {
    const stepAndOrder = TYPES_SOURCE.slice(
      TYPES_SOURCE.indexOf("export interface ProvisioningStep {"),
      TYPES_SOURCE.indexOf("export interface ProvisioningQuote"),
    );
    expect(stepAndOrder).not.toMatch(/^\s*(requestId|quoteId)[?]?:/m);
  });
});

/**
 * POO-1927 [R3]: the contract can name the rail that actually served.
 *
 * `poweredBy` was `"paybis" | null`, so no other answer was expressible and every fiat leg credited
 * Paybis, including ones Privy brokers through Stripe or MoonPay. These are TYPE assertions on
 * purpose: the defect was in what the type admitted, not in a value, so a runtime check would have
 * passed throughout.
 */
describe("provisioning contract v7 (POO-1927)", () => {
  // @rule R3: the field carries the rail, and `"paybis"` is still one of the answers rather than
  // the only one: widening keeps every existing plan, fixture and builder valid.
  it("[R3] types poweredBy as the rail, not the Paybis literal", () => {
    expectTypeOf<ProvisioningStep["poweredBy"]>().toEqualTypeOf<
      "paybis" | "privy" | null | undefined
    >();
  });

  // @rule R3: and it is spelled off the ONE rail decision table rather than as a second literal
  // union, which is what keeps it from drifting the next time a rail is added or retired.
  it("[R3] derives the attribution type from OnRampRail, minus the no-fiat case", () => {
    expectTypeOf<OnRampAttribution>().toEqualTypeOf<Exclude<OnRampRail, "none">>();
    // `"none"` means fiat is not offered, so there is no purchase to attribute.
    expectTypeOf<OnRampAttribution>().not.toEqualTypeOf<OnRampRail>();
  });
});
