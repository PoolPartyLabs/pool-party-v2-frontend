/**
 * @id PP-CORE-LIB-061 — tests
 * @name resolveFundingRoutes — tests
 * @implements-rules-version v4 (POO-1784 rules v1) · v3 (POO-1755 rules v1) · v2 (POO-1499 rules v1) · v1 (POO-1084 rules v1)
 *
 * The seven rows of the POO-1082 [R8] case matrix, plus the skip rule [R2] that the whole "Where
 * from" screen hangs on. Every case is stated in the vocabulary of the matrix so a reader can hold
 * the board and this file side by side.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { type GasFeasibility, PAYBIS_MIN_USD } from "@/lib/provisioning";
import type { FundingRoute, FundingRouteKind } from "./fundingRoutes";
import { recommendedRouteKind, resolveFundingRoutes, shouldPickRoute } from "./fundingRoutes";

const BASE = 8453;
const ARBITRUM = 42161;
const POLYGON = 137;
/** Robinhood Chain: the alpha chain whose stable is USDG, not the USDC the rail sells (POO-1784). */
const ROBINHOOD = 4663;

function source(
  over: Partial<FundingSource> & Pick<FundingSource, "chainId" | "usd">,
): FundingSource {
  return {
    address: "0x0000000000000000000000000000000000000001",
    symbol: "USDC",
    decimals: 6,
    amount: "1000000",
    isNative: false,
    logoUrl: "",
    reachableChainIds: [BASE, ARBITRUM, POLYGON],
    ...over,
  };
}

function gas(chainId: number, verdict: GasFeasibility["verdict"]): GasFeasibility {
  return {
    chainId,
    verdict,
    quotedGasUsd: 0.2,
    requiredGasUsd: 0.25,
    shortfallUsd: verdict === "OK" ? 0 : 0.25,
    surplusUsd: verdict === "OK" ? 1 : 0,
    reasonKey: "provisioning.gasVerdict.ok",
  };
}

describe("resolveFundingRoutes", () => {
  it("[R8 row 4] tokens that cover the requirement offer the tokens route", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 142.1 }), source({ chainId: POLYGON, usd: 182.4 })],
      gasByChainId: { [BASE]: gas(BASE, "OK"), [POLYGON]: gas(POLYGON, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 210,
      onRampEnabled: false,
    });

    expect(routes).toEqual([{ kind: "tokens", availableUsd: 324.5, shortfallUsd: 0 }]);
  });

  it("[R8 row 4] with the on-ramp available the same wallet gets the tokens, buy and deposit peers", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 142.1 }), source({ chainId: POLYGON, usd: 182.4 })],
      gasByChainId: { [BASE]: gas(BASE, "OK"), [POLYGON]: gas(POLYGON, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 210,
      onRampEnabled: true,
    });

    // POO-1155: the deposit-from-external-wallet peer joins the on-ramp era screen.
    expect(routes.map((route) => route.kind)).toEqual(["tokens", "buy", "deposit"]);
    expect(routes[1]).toEqual({ kind: "buy", availableUsd: 0, shortfallUsd: 210 });
  });

  it("[R8 row 5] tokens that fall short offer tokens-plus-buy, carrying both figures", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 88.4 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 210,
      onRampEnabled: true,
    });

    expect(routes).toEqual([
      { kind: "tokens-plus-buy", availableUsd: 88.4, shortfallUsd: 121.6 },
      { kind: "buy", availableUsd: 0, shortfallUsd: 210 },
      { kind: "deposit", availableUsd: 0, shortfallUsd: 0 },
    ]);
  });

  it("[R8 row 5] the same short wallet offers nothing while the on-ramp is off", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 88.4 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 210,
      onRampEnabled: false,
    });

    // Not a "tokens" route: it cannot cover the requirement, and offering it would send the user to
    // a picker whose CTA can never open. The panel falls through to the picker's own short state.
    expect(routes).toEqual([]);
  });

  it("[R8 row 6] an empty wallet with the on-ramp on offers the buy and deposit peers", () => {
    const routes = resolveFundingRoutes({
      sources: [],
      gasByChainId: {},
      targetChainId: ARBITRUM,
      requiredUsd: 210,
      onRampEnabled: true,
    });

    // POO-1155: an empty wallet can be funded by buying OR by depositing from an external wallet, so
    // both peers show and the "Where from" step is a real choice rather than being skipped.
    expect(routes).toEqual([
      { kind: "buy", availableUsd: 0, shortfallUsd: 210 },
      { kind: "deposit", availableUsd: 0, shortfallUsd: 0 },
    ]);
  });

  it("[R8 rows 1-3] a requirement of zero needs no funding route at all", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: ARBITRUM, usd: 500 })],
      gasByChainId: { [ARBITRUM]: gas(ARBITRUM, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 0,
      onRampEnabled: true,
    });

    expect(routes).toEqual([]);
  });

  it("[R3] a holding on a chain that cannot pay its own gas does not count towards a route", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: ARBITRUM, usd: 88.4, symbol: "ARB" })],
      gasByChainId: { [ARBITRUM]: gas(ARBITRUM, "BLOCKED") },
      targetChainId: ARBITRUM,
      requiredUsd: 50,
      onRampEnabled: false,
    });

    expect(routes).toEqual([]);
  });

  it("[R3] a TOP_UP chain still counts: the planner prepends the gas swap that fixes it", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 88.4 })],
      gasByChainId: { [BASE]: gas(BASE, "TOP_UP") },
      targetChainId: ARBITRUM,
      requiredUsd: 50,
      onRampEnabled: false,
    });

    expect(routes).toEqual([{ kind: "tokens", availableUsd: 88.4, shortfallUsd: 0 }]);
  });

  it("[R3] an unclassified chain reads as spendable, not as blocked", () => {
    // A chain we failed to classify is not a chain we know is broken. `buildPlan` is the
    // authoritative second gate; hiding a funded user on a degraded read is the failure UF-20 [R6]
    // forbids.
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 88.4 })],
      gasByChainId: {},
      targetChainId: ARBITRUM,
      requiredUsd: 50,
      onRampEnabled: false,
    });

    expect(routes).toEqual([{ kind: "tokens", availableUsd: 88.4, shortfallUsd: 0 }]);
  });

  it("[R8] a holding that cannot reach the operation's chain does not count", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: POLYGON, usd: 500, reachableChainIds: [POLYGON] })],
      gasByChainId: { [POLYGON]: gas(POLYGON, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 50,
      onRampEnabled: false,
    });

    expect(routes).toEqual([]);
  });

  it("an empty reachable set still counts a same-chain holding", () => {
    // A degraded routability lookup is not a stranded balance: same-chain executes with no bridge,
    // so the fact the lookup would have supplied does not apply.
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: ARBITRUM, usd: 500, reachableChainIds: [] })],
      gasByChainId: { [ARBITRUM]: gas(ARBITRUM, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 50,
      onRampEnabled: false,
    });

    expect(routes).toEqual([{ kind: "tokens", availableUsd: 500, shortfallUsd: 0 }]);
  });

  it("a sub-cent gap is still a gap: the shortfall rounds up, never to zero", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 209.999 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 210,
      onRampEnabled: true,
    });

    expect(routes[0]).toEqual({
      kind: "tokens-plus-buy",
      availableUsd: 210,
      shortfallUsd: 0.01,
    });
  });

  it("a broken USD reading contributes nothing rather than NaN", () => {
    const routes = resolveFundingRoutes({
      sources: [
        source({ chainId: BASE, usd: Number.NaN }),
        source({ chainId: BASE, usd: 60, address: "0x02" }),
      ],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 50,
      onRampEnabled: false,
    });

    expect(routes).toEqual([{ kind: "tokens", availableUsd: 60, shortfallUsd: 0 }]);
  });

  it("does not mutate the sources it is given", () => {
    const sources = [source({ chainId: BASE, usd: 100 })];
    const snapshot = structuredClone(sources);
    resolveFundingRoutes({
      sources,
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 50,
      onRampEnabled: true,
    });
    expect(sources).toEqual(snapshot);
  });

  it("[POO-1155] offers the deposit peer whenever the on-ramp screen renders", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 300 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 50,
      onRampEnabled: true,
    });
    expect(routes.map((route) => route.kind)).toContain("deposit");
  });

  it("[POO-1155] the crypto-only cut has no deposit peer, so its flow is unchanged", () => {
    // The deposit peer is gated on the same flag as the buy route: with the on-ramp off the picker
    // never renders, so a peer on it would be dead weight and the existing sources-first flow stands.
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 300 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 50,
      onRampEnabled: false,
    });
    expect(routes.map((route) => route.kind)).not.toContain("deposit");
  });
});

describe("shouldPickRoute", () => {
  it("[R2] two or more viable options is the only case that renders the step", () => {
    expect(
      shouldPickRoute([
        { kind: "tokens", availableUsd: 1, shortfallUsd: 0 },
        { kind: "buy", availableUsd: 0, shortfallUsd: 1 },
      ]),
    ).toBe(true);
  });

  it("[R2] a single viable option is skipped, not shown", () => {
    expect(shouldPickRoute([{ kind: "tokens", availableUsd: 1, shortfallUsd: 0 }])).toBe(false);
  });

  it("[R2] no viable option is skipped too", () => {
    expect(shouldPickRoute([])).toBe(false);
  });
});

/**
 * POO-1499 [R49], [R52], [R53]. Each route now carries what IT must source, which is not the same
 * figure for two routes funding one operation.
 *
 * The coverage maths is untouched: `requiredUsd` still decides which routes EXIST and whether the
 * wallet covers them. `sourceTargetUsd` is the amount each row prints, and it exists because
 * `Use your {amount}` and `Buy {amount}` are genuinely different numbers ([R5]).
 */
describe("resolveFundingRoutes — per-route source target (POO-1499)", () => {
  /**
   * `gasNeeded` is no longer a caller-supplied flag (POO-1542 [B]): it is derived internally, per
   * route, from `gasByChainId` + `targetChainId`. `targetGasOk` controls the TARGET chain's own
   * verdict (what `tokens` / `tokens-plus-buy` ask); Base stays OK throughout this block so the
   * `buy` route's own predicate (which also asks about Base) tracks the target 1:1 here. The
   * divergence between the two predicates has its own test below.
   */
  function routesFor(over: { transactionUsd?: number; targetGasOk?: boolean } = {}) {
    const targetGasOk = over.targetGasOk ?? false;
    return resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 500 })],
      gasByChainId: {
        [BASE]: gas(BASE, "OK"),
        [ARBITRUM]: gas(ARBITRUM, targetGasOk ? "OK" : "BLOCKED"),
      },
      targetChainId: ARBITRUM,
      requiredUsd: 215.25,
      onRampEnabled: true,
      target: { transactionUsd: over.transactionUsd ?? 200 },
    });
  }

  // @rule R53 — the split is the point: the same operation costs less to buy than to convert.
  it("[R53] gives the tokens and buy rows different targets, buy the cheaper", () => {
    const routes = routesFor();
    const tokens = routes.find((route) => route.kind === "tokens");
    const buy = routes.find((route) => route.kind === "buy");

    expect(tokens?.sourceTargetUsd).toBe(215.25); // (200 + 5) * 1.05
    expect(buy?.sourceTargetUsd).toBe(212); // (200 * 1.05) + 2
    expect(buy?.sourceTargetUsd).toBeLessThan(tokens?.sourceTargetUsd ?? 0);
  });

  // @rule R9 — no gas to cover collapses both routes onto the buffered transaction alone.
  it("[R9] collapses both targets to the buffered transaction when no gas is needed", () => {
    const routes = routesFor({ targetGasOk: true });

    expect(routes.find((route) => route.kind === "tokens")?.sourceTargetUsd).toBe(210);
    expect(routes.find((route) => route.kind === "buy")?.sourceTargetUsd).toBe(210);
  });

  /**
   * POO-1542 [B]: the reachable case named in the issue, now provable at this level. The target
   * chain is fine on its own (so `tokens` needs no gas component) but Base carries NO verdict at
   * all (nothing held there), so the `buy` route still has to buy ETH first. Before this issue a
   * single shared `gasNeeded` made these two rows agree by construction; now they can legitimately
   * differ, and the divergence is exactly the one the plan itself produces.
   */
  it("[B] the buy row prices in a reserve even when the target chain alone would say no gas is needed", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 500 })],
      // No entry for BASE at all: `gateContext.ts` only classifies source chains + the target, so a
      // wallet holding nothing on Base has no Base verdict to read.
      gasByChainId: { [ARBITRUM]: gas(ARBITRUM, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 215.25,
      onRampEnabled: true,
      target: { transactionUsd: 200 },
    });

    const tokens = routes.find((route) => route.kind === "tokens");
    const buy = routes.find((route) => route.kind === "buy");

    // Target OK -> tokens sees no gas component: 200 * 1.05 = 210, not 215.25.
    expect(tokens?.sourceTargetUsd).toBe(210);
    // Base unclassified -> onRampRouteBuysGas is true regardless of the target: (200 * 1.05) + 2.
    expect(buy?.sourceTargetUsd).toBe(212);
  });

  it("carries no target on the deposit route, whose amount is settled elsewhere", () => {
    expect(routesFor().find((route) => route.kind === "deposit")?.sourceTargetUsd).toBeUndefined();
  });

  /**
   * Additive by construction: `target` is optional, so every call site written before POO-1499
   * keeps its exact behaviour and simply reports a zero target rather than a wrong one. A
   * fabricated figure here would print a confident number on a row, which is worse than none.
   */
  it("reports NO target, not a guessed one, when the caller states no transaction", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 500 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 215.25,
      onRampEnabled: true,
    });

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(route.sourceTargetUsd).toBeUndefined();
  });

  /**
   * The group is the guarantee: a caller cannot state a `transactionUsd` outside `target` and have
   * it silently price a row. `gasNeeded` used to live in this same group; POO-1542 [B] moved it OUT
   * (this function derives it per route from `gasByChainId` + `targetChainId` instead), which is why
   * a caller can no longer pass it at all, checked separately below.
   */
  it("rejects a transaction stated outside the target group, at the type level", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 500 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 215.25,
      onRampEnabled: true,
      // @ts-expect-error POO-1499: a bare transactionUsd no longer exists; it travels inside `target`.
      transactionUsd: 200,
    });

    for (const route of routes) expect(route.sourceTargetUsd).toBeUndefined();
  });

  // POO-1542 [B]: `gasNeeded` moved OUT of the caller-supplied group entirely (this function derives
  // it), so a caller can no longer re-introduce the one-shared-flag divergence by passing it.
  it("rejects a caller-supplied gasNeeded, at the type level", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 500 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 215.25,
      onRampEnabled: true,
      // @ts-expect-error POO-1542: `gasNeeded` is derived internally now, never caller-supplied.
      target: { transactionUsd: 200, gasNeeded: true },
    });

    expect(routes.length).toBeGreaterThan(0);
  });

  // The coverage decision must not move: which routes exist is still `requiredUsd`'s answer.
  it("leaves route selection to requiredUsd, unchanged by the new target", () => {
    const shortWallet = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 50 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 215.25,
      onRampEnabled: true,
      target: { transactionUsd: 200 },
    });

    expect(shortWallet.map((route) => route.kind)).toEqual(["tokens-plus-buy", "buy", "deposit"]);
  });

  /**
   * POO-1755 [R1]: a ZERO transaction with gas to source still prices every card.
   *
   * The five non-spending ops carry `opRequiredUsdc: 0` by definition (POO-1042 [R3]), and
   * POO-1033 [R2] deliberately classifies them `multi` when their gas can only come from another
   * chain, so the picker mounts. `targetFor` used to treat the zero as "no target stated" and
   * return `undefined` on every card, which held `FundingRoutePicker`'s D1 skeleton on screen
   * forever with nothing in flight (production, v1.5.0 through v1.6.3).
   */
  it("[POO-1755] prices every card for a zero-cost op whose gas must be sourced", () => {
    const routes = routesFor({ transactionUsd: 0 });

    // (0 + 5) * 1.05: the tokens route sources its gas component alone.
    expect(routes.find((route) => route.kind === "tokens")?.sourceTargetUsd).toBe(5.25);
    // (0 * 1.05) + 2, floored at the Paybis minimum: the smallest order the rail sells.
    expect(routes.find((route) => route.kind === "buy")?.sourceTargetUsd).toBe(PAYBIS_MIN_USD);
  });

  // The reporting wallet's exact shape (POO-1755): empty routable inventory, no native anywhere,
  // an op on a chain that is not the on-ramp's. The only card is `buy`, and it must carry a figure.
  it("[POO-1755] prices the buy card for an empty wallet's zero-cost op", () => {
    const routes = resolveFundingRoutes({
      sources: [],
      gasByChainId: { [ARBITRUM]: gas(ARBITRUM, "BLOCKED") },
      targetChainId: ARBITRUM,
      requiredUsd: 5,
      onRampEnabled: true,
      target: { transactionUsd: 0 },
    });

    expect(routes.map((route) => route.kind)).toEqual(["buy", "deposit"]);
    expect(routes.find((route) => route.kind === "buy")?.sourceTargetUsd).toBe(PAYBIS_MIN_USD);
  });
});

/**
 * POO-1501 [R6]. Exactly one route carries `Recommended`, and only when there is something to
 * compare it against.
 */
describe("recommendedRouteKind (POO-1501 [R6])", () => {
  function routes(...kinds: FundingRouteKind[]): FundingRoute[] {
    return kinds.map((kind) => ({ kind, availableUsd: 0, shortfallUsd: 0 }));
  }

  // @rule R6 — fewest steps wins. A `tokens` route only exists when the wallet COVERS the target
  // (`resolveFundingRoutes` pushes it under `progress.covered`), so its presence is the answer.
  it("[R6] recommends the tokens route when the wallet covers it", () => {
    expect(recommendedRouteKind(routes("tokens", "buy", "deposit"))).toBe("tokens");
  });

  // @rule R6 — tokens do not cover it, so buy wins: one step beats convert + buy + move.
  it("[R6] recommends buy over the mixed route when the wallet falls short", () => {
    expect(recommendedRouteKind(routes("tokens-plus-buy", "buy", "deposit"))).toBe("buy");
  });

  // @rule R6 — with nothing to compare against, recommending is noise rather than guidance.
  it("[R6] recommends nothing when only one CARD route is on screen", () => {
    // `1d`, the empty wallet: one card plus the deposit ghost link, which is not a card ([R7]).
    expect(recommendedRouteKind(routes("buy", "deposit"))).toBeUndefined();
    expect(recommendedRouteKind(routes("tokens"))).toBeUndefined();
  });

  it("[R6] recommends nothing for an empty route list", () => {
    expect(recommendedRouteKind([])).toBeUndefined();
  });

  // The deposit route is a ghost LINK, not a card ([R7]), so it can never be the recommendation and
  // it never counts toward "is there anything to compare".
  it("[R6] never recommends the deposit link, and does not count it as a comparison", () => {
    expect(recommendedRouteKind(routes("deposit"))).toBeUndefined();
    expect(recommendedRouteKind(routes("tokens", "deposit"))).toBeUndefined();
  });
});

/**
 * POO-1916, superseding POO-1784 [R1]-[R3]. The route picker offers the purchase again.
 *
 * POO-1784 suppressed `buy`, `tokens-plus-buy` and the `deposit` ghost link on Robinhood Chain
 * (4663) on the premise that the leg carrying a purchase onwards is a SAME-TOKEN bridge, so the only
 * stable a card could land was Base's own. Probed live 2026-09-11 and 2026-09-12:
 * `USDC(8453) -> USDG(4663)` answers `200`, `routing: "BRIDGE"`, 10.000000 USDC in for ~9.95 USDG
 * out. The premise was false, so the suppression withheld a route that works.
 *
 * `deposit` is the one that stays gone, and for its OWN reason ([R4]): `depositNetworks.ts` excludes
 * 4663 per POO-1776 [R4], so the link would point at a surface that does not serve the chain. That
 * reason now lives at the gate rather than being inherited from the buy card it used to ride along
 * with.
 */
describe("resolveFundingRoutes on a chain whose stable is not USDC (POO-1916)", () => {
  /** A wallet that covers the requirement outright, so `tokens` is present independent of the ramp. */
  const covering = [source({ chainId: BASE, usd: 400, reachableChainIds: [BASE, ROBINHOOD] })];
  /** A wallet that falls short, which is what produces `tokens-plus-buy` beside the buy card. */
  const short = [source({ chainId: BASE, usd: 88.4, reachableChainIds: [BASE, ROBINHOOD] })];

  // @rule R1
  it("[R1] offers the buy and mixed routes for a USDG target with the ramp on", () => {
    const routes = resolveFundingRoutes({
      sources: short,
      gasByChainId: { [BASE]: gas(BASE, "OK"), [ROBINHOOD]: gas(ROBINHOOD, "OK") },
      targetChainId: ROBINHOOD,
      requiredUsd: 210,
      onRampEnabled: true,
    });

    // The acceptance criterion in words: a Robinhood target with a short wallet gets a buy route
    // back, and the picker no longer falls through to its empty short state for this case.
    expect(routes.map((route) => route.kind)).toEqual(["tokens-plus-buy", "buy"]);
    expect(routes).not.toEqual([]);
  });

  // @rule R1
  it("[R1] offers the buy route for a USDG target the wallet cannot contribute to at all", () => {
    const routes = resolveFundingRoutes({
      sources: [],
      gasByChainId: { [BASE]: gas(BASE, "OK"), [ROBINHOOD]: gas(ROBINHOOD, "OK") },
      targetChainId: ROBINHOOD,
      requiredUsd: 210,
      onRampEnabled: true,
    });

    expect(routes.map((route) => route.kind)).toEqual(["buy"]);
  });

  // @rule R4
  it("[R4] keeps the deposit ghost link suppressed on a USDG target, unlike the buy card", () => {
    // The two used to share one gate, so un-suppressing the purchase would have un-suppressed this
    // with it. `/deposit` does not serve 4663 (POO-1776 [R4]), so the link would send the user to a
    // surface that cannot name their chain.
    const routes = resolveFundingRoutes({
      sources: short,
      gasByChainId: { [BASE]: gas(BASE, "OK"), [ROBINHOOD]: gas(ROBINHOOD, "OK") },
      targetChainId: ROBINHOOD,
      requiredUsd: 210,
      onRampEnabled: true,
    });

    expect(routes.map((route) => route.kind)).toContain("buy");
    expect(routes.map((route) => route.kind)).not.toContain("deposit");
  });

  // @rule R4
  it("[R4] still offers the deposit link on every chain the deposit surface does serve", () => {
    for (const targetChainId of [ARBITRUM, BASE, POLYGON]) {
      const routes = resolveFundingRoutes({
        sources: [],
        gasByChainId: {
          [BASE]: gas(BASE, "OK"),
          [ARBITRUM]: gas(ARBITRUM, "OK"),
          [POLYGON]: gas(POLYGON, "OK"),
        },
        targetChainId,
        requiredUsd: 210,
        onRampEnabled: true,
      });

      expect(routes.map((route) => route.kind)).toEqual(["buy", "deposit"]);
    }
  });

  // @rule R1
  it("[R1] a covering wallet on a USDG target reads exactly like one on a launch chain", () => {
    // `tokens` first (a wallet that covers the operation is still the preferred route), `buy` beside
    // it because the ramp is a genuine second answer once the bridge can deliver, and no `deposit`
    // ([R4]). The launch-chain shape is the same list WITH the link, so the only difference between
    // the two chains is the one this issue leaves in place deliberately.
    const onRobinhood = resolveFundingRoutes({
      sources: covering,
      gasByChainId: { [BASE]: gas(BASE, "OK"), [ROBINHOOD]: gas(ROBINHOOD, "OK") },
      targetChainId: ROBINHOOD,
      requiredUsd: 210,
      onRampEnabled: true,
    });
    const onArbitrum = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 400, reachableChainIds: [BASE, ARBITRUM] })],
      gasByChainId: { [BASE]: gas(BASE, "OK"), [ARBITRUM]: gas(ARBITRUM, "OK") },
      targetChainId: ARBITRUM,
      requiredUsd: 210,
      onRampEnabled: true,
    });

    expect(onRobinhood.map((route) => route.kind)).toEqual(["tokens", "buy"]);
    expect(onArbitrum.map((route) => route.kind)).toEqual(["tokens", "buy", "deposit"]);
  });

  // @rule R1
  it("[R1] a USDG target with the ramp OFF is unchanged, so the flag is still the flag", () => {
    // The mirror of POO-1784's "reads identically on and off", which was the sharpest statement of a
    // premise that turned out to be false. What must stay true is the other direction: the chain
    // never grants a route the flag has not.
    const input = {
      sources: short,
      gasByChainId: { [BASE]: gas(BASE, "OK"), [ROBINHOOD]: gas(ROBINHOOD, "OK") },
      targetChainId: ROBINHOOD,
      requiredUsd: 210,
      onRampEnabled: false,
    };

    expect(resolveFundingRoutes(input)).toEqual([]);
    expect(resolveFundingRoutes({ ...input, sources: covering })).toEqual(
      resolveFundingRoutes({ ...input, sources: covering, onRampEnabled: true }).filter(
        (route) => route.kind === "tokens",
      ),
    );
  });

  // @rule R3
  it("[R3] a Base target with the ramp on still offers the mixed, buy and deposit routes", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 88.4 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: BASE,
      requiredUsd: 210,
      onRampEnabled: true,
    });

    expect(routes.map((route) => route.kind)).toEqual(["tokens-plus-buy", "buy", "deposit"]);
  });

  // @rule R3
  it("[R3] a Base target with the ramp off is unchanged", () => {
    const routes = resolveFundingRoutes({
      sources: [source({ chainId: BASE, usd: 400 })],
      gasByChainId: { [BASE]: gas(BASE, "OK") },
      targetChainId: BASE,
      requiredUsd: 210,
      onRampEnabled: false,
    });

    expect(routes.map((route) => route.kind)).toEqual(["tokens"]);
  });

  // @rule R2
  it("[R2] every launch chain keeps every route it offers today", () => {
    // Stated as a sweep rather than three copies of one case, so a fourth USDC chain is covered the
    // day it ships and a chain that quietly changes its stable reds this instead of a user's
    // checkout.
    for (const targetChainId of [ARBITRUM, BASE, POLYGON]) {
      const routes = resolveFundingRoutes({
        sources: [source({ chainId: BASE, usd: 88.4 })],
        gasByChainId: {
          [BASE]: gas(BASE, "OK"),
          [ARBITRUM]: gas(ARBITRUM, "OK"),
          [POLYGON]: gas(POLYGON, "OK"),
        },
        targetChainId,
        requiredUsd: 210,
        onRampEnabled: true,
      });

      expect(routes.map((route) => route.kind)).toEqual(["tokens-plus-buy", "buy", "deposit"]);
    }
  });

  // @rule R1: "share it, do not duplicate it". A second comparison here is how the picker and the
  // planner start disagreeing about the same chain, which is the defect POO-1784 exists to close.
  it("[R1] derives the answer from the shared predicate rather than re-deriving it", () => {
    // Named `moduleSource` rather than `source`, which is this file's FundingSource factory: a
    // shadow there reads as a call site and would send the next editor looking for the wrong thing.
    const moduleSource = readFileSync(join(__dirname, "fundingRoutes.ts"), "utf8");
    expect(moduleSource).toContain("onRampCanDeliverStable");
    // No second reading of the stable's identity, in any of the spellings that would drift.
    expect(moduleSource).not.toMatch(/stableSymbol|ONRAMP_CHAIN_ID|"USDC"|'USDC'/);
  });
});
