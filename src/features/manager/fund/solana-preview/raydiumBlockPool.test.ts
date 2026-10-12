/**
 * @id PP-MGR-CMP-107
 * @name raydiumBlockPool tests
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, pure helpers.
 *
 * R7: the Raydium block takes its pool from the Raydium pools of the mandate. Its config keeps
 * `poolAddress` and the pair label. With no Raydium pool, it uses the default SOL/USDC pool.
 */
import { describe, expect, it } from "vitest";
import { isConfigFor } from "../build/plan/blockConfig";
import type { BuildPlan } from "../build/plan/buildPlan";
import { validatePlan } from "../build/plan/planInvariants";
import { reconcileAutoBlocks } from "../build/plan/planReducers";
import {
  addPool,
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  withNetworks,
  withProtocols,
} from "../mandateDraft";
import { raydiumPoolsFromPairs } from "../raydiumPools";
import {
  DEFAULT_RAYDIUM_POOL_ADDRESS,
  defaultRaydiumBlockConfig,
  raydiumBlockConfig,
  raydiumBlockPools,
  raydiumPoolInMandate,
} from "./raydiumBlockPool";
import { buildSolanaBuilderCatalog, SOLANA_LOCAL_CONFIGS } from "./solanaBuilderRuntime";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

const catalog = () => buildSolanaBuilderCatalog();
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const POOL_A = "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm";
const POOL_B = "2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv";

function refOf(address: string, base: string, quote: string) {
  const [pool] = raydiumPoolsFromPairs([
    {
      dexId: "raydium",
      pairAddress: address,
      labels: ["CLMM"],
      baseToken: { address: base, symbol: "BASE" },
      quoteToken: { address: quote, symbol: "QUOTE" },
      liquidity: { usd: 10 },
    },
  ]);
  if (!pool) throw new Error("fixture pair was not a Raydium CLMM pool");
  return pool;
}

function solanaDraft(): MandateDraft {
  const base = withNetworks(
    createEmptyDraft("2026-10-12T00:00:00.000Z", "r7"),
    ["solana"],
    catalog(),
  );
  return withProtocols(base, [...base.protocols, "raydium"]);
}

function withPools(...refs: ReturnType<typeof refOf>[]): MandateDraft {
  let draft = solanaDraft();
  for (const ref of refs) {
    const next = addPool(draft, ref, catalog());
    if (isBlocked(next)) throw new Error("the pool was refused");
    draft = next;
  }
  return draft;
}

function planWith(config: unknown): BuildPlan {
  return {
    version: 1,
    hub: { chains: [] },
    spokes: [
      {
        network: "solana",
        sharePct: 100,
        chains: [
          {
            id: "c",
            sharePct: 100,
            steps: [
              {
                id: "b",
                family: "position",
                kind: "solanaRaydiumPool",
                config: config as never,
              },
            ],
          },
        ],
      },
    ],
  };
}

const violations = (draft: MandateDraft, config: unknown) =>
  validatePlan(planWith(config), { draft, catalog: catalog() }).map((entry) => entry.code);

describe("R7: the pool of the Raydium block", () => {
  // @rule R7
  it("[R7] uses the Raydium pools of the mandate, in mandate order, with their pair label", () => {
    const draft = withPools(
      refOf(POOL_A, WSOL_MINT, USDC_MINT),
      refOf(POOL_B, USDC_MINT, WSOL_MINT),
    );

    expect(raydiumBlockPools(draft)).toEqual([
      { poolAddress: POOL_A, pair: "SOL / USDC" },
      { poolAddress: POOL_B, pair: "USDC / SOL" },
    ]);
    expect(defaultRaydiumBlockConfig(draft)).toEqual({
      catalogId: "solana:mainnet-beta:raydium-clmm",
      pair: "SOL / USDC",
      poolAddress: POOL_A,
    });
  });

  // @rule R7
  it("[R7] uses the SOL/USDC pool when the mandate has no Raydium pool", () => {
    expect(DEFAULT_RAYDIUM_POOL_ADDRESS).toBe("3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv");
    expect(raydiumBlockPools(solanaDraft())).toEqual([
      { poolAddress: DEFAULT_RAYDIUM_POOL_ADDRESS, pair: "SOL / USDC" },
    ]);
  });

  // @rule R7
  it("[R7] seeds a new Raydium block with the default pool, a valid config for the plan", () => {
    const seed = SOLANA_LOCAL_CONFIGS.solanaRaydiumPool;
    expect(seed).toEqual({
      catalogId: "solana:mainnet-beta:raydium-clmm",
      pair: "SOL / USDC",
      poolAddress: DEFAULT_RAYDIUM_POOL_ADDRESS,
    });
    const draft = withPools(refOf(POOL_A, WSOL_MINT, USDC_MINT));
    expect(violations(draft, seed)).not.toContain("config_not_in_mandate");
  });

  // @rule R7
  it("[R7] leaves out a mandate pool whose pair the block cannot name", () => {
    // The catalog refuses a JUP side at add time, so build the draft by hand.
    const draft = { ...solanaDraft(), pools: [refOf(POOL_A, WSOL_MINT, JUP)] };
    expect(raydiumBlockPools(draft)).toEqual([
      { poolAddress: DEFAULT_RAYDIUM_POOL_ADDRESS, pair: "SOL / USDC" },
    ]);
  });

  // @rule R7
  it("[R7] keeps poolAddress and the pair label in a valid block config", () => {
    const config = raydiumBlockConfig({ poolAddress: POOL_A, pair: "SOL / USDC" });

    expect(config).toEqual({
      catalogId: "solana:mainnet-beta:raydium-clmm",
      pair: "SOL / USDC",
      poolAddress: POOL_A,
    });
    expect(isConfigFor("solanaRaydiumPool", config)).toBe(true);
    // Without a pool address (a plan from before POO-2343) the config is still valid.
    expect(
      isConfigFor("solanaRaydiumPool", { catalogId: config.catalogId, pair: config.pair }),
    ).toBe(true);
    // Another block takes no pool address, and a Raydium address must be a Solana address.
    expect(
      isConfigFor("solanaOrcaPool", {
        ...config,
        catalogId: "solana:mainnet-beta:orca-whirlpools",
      }),
    ).toBe(false);
    expect(isConfigFor("solanaRaydiumPool", { ...config, poolAddress: "0xabc" })).toBe(false);
  });

  // @rule R7
  it("[R7] accepts a pool of the mandate or the default pool, and refuses any other pool", () => {
    const draft = withPools(refOf(POOL_A, WSOL_MINT, USDC_MINT));
    const config = (poolAddress: string) => ({
      catalogId: "solana:mainnet-beta:raydium-clmm",
      pair: "SOL / USDC",
      poolAddress,
    });

    expect(raydiumPoolInMandate(draft, POOL_A)).toBe(true);
    expect(raydiumPoolInMandate(draft, DEFAULT_RAYDIUM_POOL_ADDRESS)).toBe(true);
    expect(raydiumPoolInMandate(draft, POOL_B)).toBe(false);
    expect(violations(draft, config(POOL_A))).not.toContain("config_not_in_mandate");
    expect(violations(draft, config(POOL_B))).toContain("config_not_in_mandate");
  });

  // @rule R7
  it("[R7] re-derives the pool of a block when its pool left the mandate, and keeps a pool that stayed", () => {
    const config = (poolAddress: string) => ({
      catalogId: "solana:mainnet-beta:raydium-clmm",
      pair: "SOL / USDC",
      poolAddress,
    });
    const poolOf = (plan: BuildPlan) => {
      const step = plan.spokes[0]?.chains[0]?.steps.find((entry) => entry.id === "b");
      return step && "config" in step ? (step.config as { poolAddress?: string }) : undefined;
    };
    const newId = () => "auto";
    const stale = planWith(config(POOL_B));

    // POOL_B left the mandate; POOL_A is the first pool that remains.
    const onlyA = withPools(refOf(POOL_A, WSOL_MINT, USDC_MINT));
    expect(poolOf(reconcileAutoBlocks(stale, { draft: onlyA, newId }))?.poolAddress).toBe(POOL_A);
    expect(
      violations(onlyA, poolOf(reconcileAutoBlocks(stale, { draft: onlyA, newId }))),
    ).not.toContain("config_not_in_mandate");

    // No Raydium pool is left: the default pool.
    expect(poolOf(reconcileAutoBlocks(stale, { draft: solanaDraft(), newId }))?.poolAddress).toBe(
      DEFAULT_RAYDIUM_POOL_ADDRESS,
    );

    // A pool that is still in the mandate keeps its block as the same object.
    const both = withPools(
      refOf(POOL_A, WSOL_MINT, USDC_MINT),
      refOf(POOL_B, USDC_MINT, WSOL_MINT),
    );
    const keptConfig = config(POOL_B);
    const kept = planWith(keptConfig);
    expect(poolOf(reconcileAutoBlocks(kept, { draft: both, newId }))).toBe(keptConfig);
  });
});
