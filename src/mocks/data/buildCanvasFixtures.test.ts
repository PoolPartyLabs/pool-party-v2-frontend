/**
 * @id PP-MGR-MCK-004
 * @name buildCanvasFixtures tests
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, a data fixture.
 *
 * The fixtures are oracles, so a typo in them would hide a layout bug. These checks keep them
 * honest as data: every block has its printed content and nothing else does, ids are unique, the
 * shares obey C8 (what hangs below never adds up to more than the node above), every chain holds a
 * position (INV4), and every drawn fixture names the Figma frame it was read from.
 *
 * And every fixture is a VALID PLAN: converted to a `BuildPlan`, it passes the full `validatePlan`
 * (INV1 to INV6) and `reconcileAutoBlocks` leaves it unchanged (it already holds every Swap · auto
 * the app would place, and no other). The mandate it is checked against is the S1 test draft
 * widened with exactly what the fixtures draw and the test draft lacks: Base and Polygon as spokes
 * (D15), Aave v3 and Uniswap v4 offered there, their deposit USDC, and the pools and tokens the
 * cards name. Nothing else is widened, so a fixture that drifts out of the rules fails here.
 */
import { describe, expect, it } from "vitest";
import type { LayoutStep } from "@/features/manager/fund/build/layout/graphTypes";
import type {
  BlockKind,
  BuildPlan,
  Chain,
  FlowKind,
  PositionBlock,
  Step,
} from "@/features/manager/fund/build/plan/buildPlan";
import { validatePlan } from "@/features/manager/fund/build/plan/planInvariants";
import { reconcileAutoBlocks } from "@/features/manager/fund/build/plan/planReducers";
import { makeIdFactory, makeTestDraft } from "@/features/manager/fund/build/plan/planTestKit";
import { buildMandateCatalog, type MandateCatalog } from "@/features/manager/fund/mandateCatalog";
import {
  type MandateDraft,
  type MandatePoolRef,
  type MandateTokenRef,
  type NetworkId,
  tokenKey,
} from "@/features/manager/fund/mandateDraft";
import { BUILD_CANVAS_FIXTURES, type BuildCanvasFixture } from "./buildCanvasFixtures";

const ENTRIES = Object.entries(BUILD_CANVAS_FIXTURES) as Array<[string, BuildCanvasFixture]>;

function chainsOf(fixture: BuildCanvasFixture) {
  return [...fixture.input.hub.chains, ...fixture.input.spokes.flatMap((s) => s.chains)];
}

// ---------------------------------------------------------------------------
// The reference mandate: the S1 test draft, widened with what the fixtures draw
// ---------------------------------------------------------------------------

/** The plan types name the mandate's networks; the fixtures keep Base and Polygon (D15). */
function asNetwork(network: string): NetworkId {
  return network as NetworkId;
}

/** A stable fake address for a token the test draft does not carry. */
function fakeAddress(network: string, symbol: string): string {
  const hex = Array.from(`${network}:${symbol}`, (c) => c.charCodeAt(0).toString(16)).join("");
  return `0x${hex.padEnd(40, "0").slice(0, 40)}`;
}

function tokenOn(draft: MandateDraft, network: string, symbol: string): MandateTokenRef {
  const found = draft.tokens.find((t) => t.network === network && t.symbol === symbol);
  if (found) return found;
  const row: MandateTokenRef = {
    address: fakeAddress(network, symbol),
    symbol,
    name: symbol,
    network: asNetwork(network),
    logoUrl: null,
    locked: false,
  };
  draft.tokens.push(row);
  return row;
}

function poolOn(draft: MandateDraft, network: string, pair: string): MandatePoolRef {
  const id = `${network}:${pair}`;
  const found = draft.pools.find((p) => p.id === id);
  if (found) return found;
  const [symbol0 = "", symbol1 = ""] = pair.split(" / ");
  const side = (t: MandateTokenRef) => ({
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    logoUrl: t.logoUrl,
  });
  const pool: MandatePoolRef = {
    id,
    address: fakeAddress(network, pair),
    network: asNetwork(network),
    protocol: "uniswap-v4",
    token0: side(tokenOn(draft, network, symbol0)),
    token1: side(tokenOn(draft, network, symbol1)),
    feeBps: 5,
    feeTier: 500,
    tvlUsd: 1_250_000,
    aprPct: 9.2,
    tierSharePct: null,
    hasHook: false,
  };
  draft.pools.push(pool);
  return pool;
}

function toStep(
  step: LayoutStep,
  network: string,
  fixture: BuildCanvasFixture,
  draft: MandateDraft,
): Step {
  if (step.family === "flow") {
    return { id: step.id, family: "flow", kind: step.kind as FlowKind, auto: step.auto };
  }
  const title = fixture.content[step.id]?.title ?? "";
  const kind = step.kind as BlockKind;
  let config: PositionBlock["config"] = null;
  if (step.configured && kind === "uniswapV4Pool") {
    config = { poolId: poolOn(draft, network, title).id };
  } else if (step.configured) {
    // "Supply USDC", "Borrow USDC": the asset is the card's second word.
    const symbol = title.split(" ")[1] ?? "";
    config = { assetKey: tokenKey(tokenOn(draft, network, symbol)) };
  }
  return { id: step.id, family: "position", kind, config } as PositionBlock;
}

function toPlan(fixture: BuildCanvasFixture, draft: MandateDraft): BuildPlan {
  const chain = (c: BuildCanvasFixture["input"]["hub"]["chains"][number], network: string) =>
    ({
      id: c.id,
      sharePct: c.sharePct,
      steps: c.steps.map((s) => toStep(s, network, fixture, draft)),
    }) satisfies Chain;
  const { input } = fixture;
  return {
    version: 1,
    hub: { chains: input.hub.chains.map((c) => chain(c, input.hubNetwork)) },
    spokes: input.spokes.map((s) => ({
      network: asNetwork(s.network),
      sharePct: s.sharePct,
      chains: s.chains.map((c) => chain(c, s.network)),
    })),
  };
}

/** The test draft and the real catalog, widened with what the fixtures draw; every plan built. */
function referenceMandate(): {
  draft: MandateDraft;
  catalog: MandateCatalog;
  plans: Array<[string, BuildPlan]>;
} {
  const draft = makeTestDraft();
  const extra = [
    ...new Set(ENTRIES.flatMap(([, f]) => f.input.spokes.map((s) => s.network))),
  ].filter((n) => !draft.networks.includes(asNetwork(n)));
  for (const network of extra) {
    draft.networks.push(asNetwork(network));
    // The spoke's deposit token, a locked row: what arrives under its Bridge.
    draft.tokens.push({
      address: fakeAddress(network, "USDC"),
      symbol: "USDC",
      name: "USDC",
      network: asNetwork(network),
      logoUrl: null,
      locked: true,
    });
  }
  const plans = ENTRIES.map(([name, f]): [string, BuildPlan] => [name, toPlan(f, draft)]);
  const catalog = buildMandateCatalog();
  catalog.protocols = catalog.protocols.map((p) =>
    p.id === "aave-v3" || p.id === "uniswap-v4"
      ? { ...p, availableOn: [...new Set([...p.availableOn, ...draft.networks])] }
      : p,
  );
  return { draft, catalog, plans };
}

describe("buildCanvasFixtures", () => {
  it.each(ENTRIES)("%s maps every block id to its content, and only those", (_name, fixture) => {
    const ids = chainsOf(fixture).flatMap((c) => c.steps.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(fixture.content).sort()).toEqual([...ids].sort());
  });

  it.each(ENTRIES)("%s has unique chain ids and spoke networks", (_name, fixture) => {
    const chainIds = chainsOf(fixture).map((c) => c.id);
    expect(new Set(chainIds).size).toBe(chainIds.length);
    const networks = [fixture.input.hubNetwork, ...fixture.input.spokes.map((s) => s.network)];
    expect(new Set(networks).size).toBe(networks.length);
  });

  // @rule C8
  it.each(ENTRIES)("%s keeps every share within the node above it", (_name, fixture) => {
    const { hub, spokes } = fixture.input;
    const top = [...hub.chains, ...spokes].reduce((sum, n) => sum + n.sharePct, 0);
    expect(top).toBeLessThanOrEqual(100);
    for (const spoke of spokes) {
      const inner = spoke.chains.reduce((sum, c) => sum + c.sharePct, 0);
      expect(inner).toBeLessThanOrEqual(spoke.sharePct);
    }
  });

  it.each(ENTRIES)("%s gives every chain at least one position block", (_name, fixture) => {
    for (const chain of chainsOf(fixture)) {
      expect(chain.steps.some((s) => s.family === "position")).toBe(true);
    }
  });

  it("names the Figma frame of every drawn fixture and none for the undrawn ones", () => {
    const drawn = ENTRIES.filter(([, f]) => f.figmaNode !== null).map(([name]) => name);
    expect(drawn.sort()).toEqual(
      ["buildState3", "buildState5", "canvasA", "canvasB", "canvasC", "canvasD"].sort(),
    );
    for (const [, f] of ENTRIES) {
      if (f.figmaNode !== null) expect(f.figmaNode).toMatch(/^\d+:\d+$/);
    }
  });

  it("draws canvas A with 10 positions on 3 networks", () => {
    const { canvasA } = BUILD_CANVAS_FIXTURES;
    const positions = chainsOf(canvasA).flatMap((c) =>
      c.steps.filter((s) => s.family === "position"),
    );
    expect(positions).toHaveLength(10);
    expect(canvasA.input.spokes.map((s) => s.network)).toEqual(["base", "robinhood"]);
  });

  it("draws canvas B with no pool, so no Collect fees anywhere", () => {
    const steps = chainsOf(BUILD_CANVAS_FIXTURES.canvasB).flatMap((c) => c.steps);
    expect(steps.some((s) => s.kind === "uniswapV4Pool" || s.kind === "collectFees")).toBe(false);
  });
});

describe("every fixture is a valid plan", () => {
  const { draft, catalog, plans } = referenceMandate();

  it("widens the test mandate only with the spokes the fixtures draw (D15)", () => {
    expect(draft.networks).toEqual(["arbitrum", "robinhood", "base", "polygon"]);
    expect(draft.tokens.filter((t) => t.locked).map((t) => tokenKey(t))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^base:/), expect.stringMatching(/^polygon:/)]),
    );
  });

  // @rule INV1 @rule INV2 @rule INV3 @rule INV4 @rule INV5 @rule INV6
  it.each(plans)("%s passes the full validatePlan with no violation", (_name, plan) => {
    expect(validatePlan(plan, { draft, catalog })).toEqual([]);
  });

  // @rule C13 @rule INV6
  it.each(plans)("%s already holds every Swap · auto the app would place", (_name, plan) => {
    expect(reconcileAutoBlocks(plan, { draft, newId: makeIdFactory("unexpected") })).toEqual(plan);
  });

  it("would catch a fixture that drifts: canvas A without one of its Swap · auto", () => {
    const plan = structuredClone(plans.find(([name]) => name === "canvasA")?.[1]);
    const chain = plan?.hub.chains[0];
    if (!plan || !chain) throw new Error("fixture changed");
    chain.steps = chain.steps.filter((s) => s.id !== "a-hub-1-swap");
    expect(validatePlan(plan, { draft, catalog })).toEqual([
      { invariant: 6, code: "missing_auto", targetId: "a-hub-1-pool" },
    ]);
  });
});
