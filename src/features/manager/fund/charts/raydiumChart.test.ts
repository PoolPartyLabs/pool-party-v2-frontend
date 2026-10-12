/**
 * @id PP-MGR-LIB-077-TEST
 * @name raydium chart tests
 * @linear https://linear.app/yeildbay/issue/POO-2343
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, pure context tests.
 *
 * R8: a Raydium block with a pool address shows the DEX Screener embed of POO-2338 for that pool.
 * The tests never fetch DEX Screener.
 */
import { describe, expect, it } from "vitest";
import type { PanelDraftTarget } from "../build/panel/usePanelDraft";
import { makeTestDraft } from "../build/plan/planTestKit";
import { raydiumPoolsFromPairs } from "../raydiumPools";
import { SOLANA_LOCAL_CONFIGS } from "../solana-preview/solanaBuilderRuntime";
import { USDC_MINT, WSOL_MINT } from "../solana-preview/solanaSchemas";
import { buildChartSelection } from "./chartContext";
import { buildChartUrl, CHART_EMBED_PARAMS, resolvePoolChart } from "./chartModel";

const POOL = "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv";
const QUERY = new URLSearchParams(CHART_EMBED_PARAMS).toString();

function target(kind: PanelDraftTarget["kind"]): PanelDraftTarget {
  return {
    blockId: "selected-block",
    kind,
    network: "solana",
    applied: { config: { catalogId: "x", pair: "SOL / USDC" }, sharePct: 25 },
  };
}

const raydiumConfig = {
  catalogId: "solana:mainnet-beta:raydium-clmm",
  pair: "SOL / USDC",
  poolAddress: POOL,
} as const;

describe("R8: the Raydium pool chart", () => {
  // @rule R8
  it("[R8] shows the embed of the pool address with chain solana and the POO-2338 parameters", () => {
    const { availability } = buildChartSelection(
      makeTestDraft(),
      target("solanaRaydiumPool"),
      raydiumConfig,
    );

    if (availability.status !== "available") throw new Error(availability.reason);
    expect(availability.market).toEqual({
      kind: "pool",
      chain: "solana",
      address: POOL,
      label: "SOL / USDC",
      venue: "Raydium CLMM",
    });
    expect(buildChartUrl(availability.market)).toBe(
      `https://dexscreener.com/solana/${POOL}?${QUERY}`,
    );
  });

  // @rule R8
  it("[R8] keeps the case of the Solana address and refuses an address that is not Solana", () => {
    const chart = (poolAddress: string, network = "solana") =>
      resolvePoolChart({ network, protocol: "raydium", poolAddress, label: "SOL / USDC" });

    const kept = chart(POOL);
    expect(kept.status === "available" && kept.market.address).toBe(POOL);
    expect(chart("0xabc")).toEqual({ status: "unavailable", reason: "unconfigured" });
    expect(chart(POOL, "arbitrum")).toEqual({ status: "unavailable", reason: "unsupported_pair" });
    // A Uniswap protocol is still never a Solana pool.
    expect(
      resolvePoolChart({ network: "solana", protocol: "uniswap-v4", poolAddress: POOL, label: "" }),
    ).toEqual({ status: "unavailable", reason: "unsupported_pair" });
  });

  // @rule R8
  it("[R8] keeps the pool in the selection identity, so a new pool resets the chart", () => {
    const other = { ...raydiumConfig, poolAddress: "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm" };
    const one = buildChartSelection(makeTestDraft(), target("solanaRaydiumPool"), raydiumConfig);
    const two = buildChartSelection(makeTestDraft(), target("solanaRaydiumPool"), other);
    expect(one.identity).not.toBe(two.identity);
  });

  // @rule R8
  it("[R8] keeps Orca unsupported and Kamino on USDC", () => {
    const draft = makeTestDraft();
    const orca = { ...raydiumConfig, catalogId: "solana:mainnet-beta:orca-whirlpools" };
    expect(buildChartSelection(draft, target("solanaOrcaPool"), orca).availability).toEqual({
      status: "unavailable",
      reason: "unsupported_pair",
    });
    const kamino = buildChartSelection(
      draft,
      target("solanaKaminoSupply"),
      SOLANA_LOCAL_CONFIGS.solanaKaminoSupply ?? null,
    );
    expect(kamino.availability.status === "available" && kamino.availability.market.address).toBe(
      USDC_MINT,
    );
  });

  // @rule R7
  it("[R7] charts the default pool for a Raydium block with no pool, and the mandate pool when there is one", () => {
    const { poolAddress: _omitted, ...withoutPool } = raydiumConfig;
    const none = buildChartSelection(makeTestDraft(), target("solanaRaydiumPool"), withoutPool);
    expect(none.availability.status === "available" && none.availability.market.address).toBe(POOL);

    const OTHER = "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm";
    const [ref] = raydiumPoolsFromPairs([
      {
        dexId: "raydium",
        pairAddress: OTHER,
        labels: ["CLMM"],
        baseToken: { address: WSOL_MINT, symbol: "SOL" },
        quoteToken: { address: USDC_MINT, symbol: "USDC" },
        liquidity: { usd: 10 },
      },
    ]);
    if (!ref) throw new Error("fixture pair was not a Raydium CLMM pool");
    const draft = { ...makeTestDraft(), pools: [ref] };
    const picked = buildChartSelection(draft, target("solanaRaydiumPool"), withoutPool);
    expect(picked.availability.status === "available" && picked.availability.market.address).toBe(
      OTHER,
    );
  });
});
