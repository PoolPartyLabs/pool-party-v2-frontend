/**
 * @id PP-MGR-LIB-021
 * @name planTestKit
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, test support: it builds data and emits nothing.
 *
 * TEST SUPPORT for the Build canvas, inside the plan folder on purpose (plan section 3.1): the plan
 * tests, the layout tests (S3, `toLayoutInput`) and the interaction tests (S5, insert and remove)
 * all start from the same draft and the same valid plans, so a rule change is fixed in one place.
 * Nothing in the app imports this file.
 *
 * Every builder returns a FRESH object with FIXED ids, so a test can name a block by id and mutate
 * its copy freely. Each plan is valid against {@link makeTestDraft}: `validatePlan` of every one of
 * them returns `[]`, which `planInvariants.test.ts` asserts.
 *
 * PP-NOTE: the issue lists "one v4 WETH / USDC pool per network". Robinhood Chain's stable is USDG
 * (the deposit token `depositTokenRefFor` resolves there, POO-1779), and a mandate pool must hold
 * mandate tokens of its own network, so the Robinhood pool is WETH / USDG.
 */

import { buildMandateCatalog } from "../../mandateCatalog";
import {
  createEmptyDraft,
  depositTokenRefFor,
  type MandateDraft,
  type MandatePoolRef,
  type MandateTokenRef,
  type NetworkId,
  tokenKey,
} from "../../mandateDraft";
import {
  type BuildPlan,
  type Chain,
  createEmptyPlan,
  type FlowBlock,
  type PlanContext,
  type PositionBlock,
} from "./buildPlan";

/** The deposit token row of a network, which the chain config always carries for these two. */
function depositRow(network: NetworkId): MandateTokenRef {
  const row = depositTokenRefFor(network);
  if (!row) throw new Error(`planTestKit: no deposit token for ${network}`);
  return row;
}

/** WETH, as the bundled token lists carry it on each network (lowercased addresses). */
const WETH_ADDRESS: Record<NetworkId, string> = {
  arbitrum: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  robinhood: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
};

function wethRow(network: NetworkId): MandateTokenRef {
  return {
    address: WETH_ADDRESS[network],
    symbol: "WETH",
    name: "Wrapped Ether",
    network,
    logoUrl: null,
    locked: false,
  };
}

/** A hookless Uniswap v4 WETH / stable pool at 0.05%, token0 and token1 in address order. */
function v4Pool(id: string, network: NetworkId): MandatePoolRef {
  const weth = wethRow(network);
  const stable = depositRow(network);
  const side = (t: MandateTokenRef) => ({
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    logoUrl: t.logoUrl,
  });
  const ascending = weth.address < stable.address;
  return {
    id,
    // A fixture address: no such pool exists, and nothing in the plan reads it.
    address: network === "arbitrum" ? `0x${"a1".repeat(20)}` : `0x${"b2".repeat(20)}`,
    network,
    protocol: "uniswap-v4",
    token0: side(ascending ? weth : stable),
    token1: side(ascending ? stable : weth),
    feeBps: 5,
    feeTier: 500,
    tvlUsd: 4_820_000,
    aprPct: 11.4,
    tierSharePct: null,
    hasHook: false,
  };
}

/** The ids and keys the plans below configure their blocks with. */
export const TEST_POOL_IDS = {
  arbitrum: "arb-v4-weth-usdc-5",
  robinhood: "rh-v4-weth-usdg-5",
} as const;

export const TEST_ASSET_KEYS = {
  usdcArbitrum: tokenKey(depositRow("arbitrum")),
  usdgRobinhood: tokenKey(depositRow("robinhood")),
  wethArbitrum: tokenKey(wethRow("arbitrum")),
  wethRobinhood: tokenKey(wethRow("robinhood")),
} as const;

/**
 * The mandate every plan test runs against: Arbitrum (hub) and Robinhood Chain; the two required
 * protocols plus Aave v3 and Uniswap v4; USDC (hub deposit), USDG (Robinhood deposit) and WETH on
 * both networks; one Uniswap v4 WETH / stable pool per network.
 */
export function makeTestDraft(): MandateDraft {
  const base = createEmptyDraft("2026-10-03T00:00:00.000Z", "test-draft");
  return {
    ...base,
    name: "Test fund on two networks",
    networks: ["arbitrum", "robinhood"],
    protocols: ["uniswap-v3-swap", "across", "aave-v3", "uniswap-v4"],
    tokens: [
      depositRow("arbitrum"),
      depositRow("robinhood"),
      wethRow("arbitrum"),
      wethRow("robinhood"),
    ],
    pools: [
      v4Pool(TEST_POOL_IDS.arbitrum, "arbitrum"),
      v4Pool(TEST_POOL_IDS.robinhood, "robinhood"),
    ],
    caps: {
      networks: { arbitrum: { noCap: true, pct: 0 }, robinhood: { noCap: false, pct: 50 } },
      protocols: { "aave-v3": { noCap: true, pct: 0 }, "uniswap-v4": { noCap: true, pct: 0 } },
      tokens: {
        [TEST_ASSET_KEYS.wethArbitrum]: { noCap: true, pct: 0 },
        [TEST_ASSET_KEYS.wethRobinhood]: { noCap: true, pct: 0 },
      },
    },
    completedAt: "2026-10-03T00:00:00.000Z",
    passedSteps: ["networks", "protocols", "tokens", "pools", "limits"],
    lastStep: "limits",
  };
}

/** A deterministic id source: "<prefix>-1", "<prefix>-2", ... */
export function makeIdFactory(prefix = "id"): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${next}`;
  };
}

/** A full reducer context over {@link makeTestDraft}, the real catalog and a counting id source. */
export function makeTestContext(draft: MandateDraft = makeTestDraft()): PlanContext {
  return { draft, catalog: buildMandateCatalog(), newId: makeIdFactory("new") };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function autoSwap(id: string): FlowBlock {
  return { id, family: "flow", kind: "swap", auto: true };
}

function collectFees(id: string): FlowBlock {
  return { id, family: "flow", kind: "collectFees", auto: false };
}

function pool(id: string, poolId: string | null): PositionBlock {
  return { id, family: "position", kind: "uniswapV4Pool", config: poolId ? { poolId } : null };
}

function supply(id: string, assetKey: string | null): PositionBlock {
  return { id, family: "position", kind: "aaveSupply", config: assetKey ? { assetKey } : null };
}

function borrow(id: string, assetKey: string | null): PositionBlock {
  return { id, family: "position", kind: "aaveBorrow", config: assetKey ? { assetKey } : null };
}

function withHub(...chains: Chain[]): BuildPlan {
  return { ...createEmptyPlan(), hub: { chains } };
}

// ---------------------------------------------------------------------------
// Valid plans
// ---------------------------------------------------------------------------

/** The empty canvas. */
export function emptyPlan(): BuildPlan {
  return createEmptyPlan();
}

/** One hub chain at 60%: [Swap · auto, WETH / USDC pool configured]. */
export function hubPoolPlan(): BuildPlan {
  return withHub({
    id: "hub-pool",
    sharePct: 60,
    steps: [autoSwap("hub-pool-swap"), pool("hub-pool-pool", TEST_POOL_IDS.arbitrum)],
  });
}

/** The same chain ending in Collect fees: [Swap · auto, pool, Collect fees]. */
export function hubPoolWithFeesPlan(): BuildPlan {
  return withHub({
    id: "hub-pool",
    sharePct: 60,
    steps: [
      autoSwap("hub-pool-swap"),
      pool("hub-pool-pool", TEST_POOL_IDS.arbitrum),
      collectFees("hub-pool-fees"),
    ],
  });
}

/** One hub chain at 40%: [Supply USDC]. USDC is what arrives on the hub, so no Swap · auto. */
export function hubSupplyPlan(): BuildPlan {
  return withHub({
    id: "hub-supply",
    sharePct: 40,
    steps: [supply("hub-supply-supply", TEST_ASSET_KEYS.usdcArbitrum)],
  });
}

/** One hub chain at 50%: [Swap · auto, Supply WETH, Borrow USDC]. */
export function supplyBorrowPlan(): BuildPlan {
  return withHub({
    id: "hub-aave",
    sharePct: 50,
    steps: [
      autoSwap("hub-aave-swap"),
      supply("hub-aave-supply", TEST_ASSET_KEYS.wethArbitrum),
      borrow("hub-aave-borrow", TEST_ASSET_KEYS.usdcArbitrum),
    ],
  });
}

/** A Robinhood Chain spoke at 40% with one pool chain at 40%: [Swap · auto, WETH / USDG pool]. */
export function spokePoolPlan(): BuildPlan {
  return {
    ...createEmptyPlan(),
    spokes: [
      {
        network: "robinhood",
        sharePct: 40,
        chains: [
          {
            id: "rh-pool",
            sharePct: 40,
            steps: [autoSwap("rh-pool-swap"), pool("rh-pool-pool", TEST_POOL_IDS.robinhood)],
          },
        ],
      },
    ],
  };
}

/** A Robinhood Chain spoke just added: no chain, 0%. */
export function emptySpokePlan(): BuildPlan {
  return { ...createEmptyPlan(), spokes: [{ network: "robinhood", sharePct: 0, chains: [] }] };
}

/** Every valid plan above, by name, for tests that sweep them all. */
export const VALID_TEST_PLANS: Readonly<Record<string, () => BuildPlan>> = {
  emptyPlan,
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  supplyBorrowPlan,
  spokePoolPlan,
  emptySpokePlan,
};
