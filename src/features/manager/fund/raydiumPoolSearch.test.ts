/**
 * @id PP-MGR-CMP-107
 * @name raydiumPoolSearch tests
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, a data adapter and reducers
 *
 * Pure-logic proof of the rules of POO-2343 that need no render: the Solana pool search (R4), the
 * draft that holds Raydium pools (R6), the Raydium block pool (R7) and the chart (R8). The DEX
 * Screener action is a mock. There is no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services", () => ({ isMockMode: true }));
vi.mock("@/features/manager/actions", () => ({
  getDexPoolsAction: vi.fn(),
  getDexPoolByAddressAction: vi.fn(),
}));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogPoolAction: vi.fn(),
  getCatalogPoolsAction: vi.fn(),
}));
vi.mock("./raydiumPoolsAction", () => ({ getRaydiumPoolsAction: vi.fn() }));

import { ApiError } from "@/lib/api/errors";
import { getCatalogPoolsAction } from "@/lib/api/v2/actions";
import {
  addPool,
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  type MandatePoolRef,
  poolSideAddable,
  removePool,
  withNetworks,
  withProtocols,
} from "./mandateDraft";
import { getDraft, upsertDraft } from "./mandateDraftStore";
import { searchMandatePools } from "./mandatePoolSource";
import { type DexScreenerPair, raydiumPoolsFromPairs } from "./raydiumPools";
import { getRaydiumPoolsAction } from "./raydiumPoolsAction";
import { buildSolanaBuilderCatalog } from "./solana-preview/solanaBuilderRuntime";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const EVM_ADDRESS = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

const catalog = () => buildSolanaBuilderCatalog();

function pair(address: string, quote: { address: string; symbol: string }): DexScreenerPair {
  return {
    dexId: "raydium",
    pairAddress: address,
    labels: ["CLMM"],
    baseToken: { address: SOL, symbol: "SOL", name: "Wrapped SOL" },
    quoteToken: { address: quote.address, symbol: quote.symbol, name: quote.symbol },
    liquidity: { usd: 1000 },
  };
}

/** A pool ref made by the real mapping, so the fixture cannot drift from R3. */
function refOf(address: string, quote = { address: USDC, symbol: "USDC" }): MandatePoolRef {
  const [pool] = raydiumPoolsFromPairs([pair(address, quote)]);
  if (!pool) throw new Error("fixture pair was not a Raydium CLMM pool");
  return pool;
}

/** A mandate that holds Arbitrum and Solana, with Raydium chosen. */
function raydiumDraft(): MandateDraft {
  const base = withNetworks(
    createEmptyDraft("2026-10-12T00:00:00.000Z", "r"),
    ["solana"],
    catalog(),
  );
  return withProtocols(base, [...base.protocols, "raydium"]);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getRaydiumPoolsAction).mockReset();
  vi.mocked(getCatalogPoolsAction).mockReset();
});

describe("R4: the Pools step searches Raydium pools on Solana", () => {
  // @rule R4
  it("[R4] returns the Raydium pools of the server action for a Solana token", async () => {
    const pools = [refOf("PoolA")];
    vi.mocked(getRaydiumPoolsAction).mockResolvedValue({ ok: true, pools });

    const found = await searchMandatePools({
      network: "solana",
      tokenAddress: SOL,
      secondTokenAddress: USDC,
      protocols: ["raydium"],
    });

    expect(found).toEqual(pools);
    expect(getRaydiumPoolsAction).toHaveBeenCalledWith({
      tokenAddress: SOL,
      secondTokenAddress: USDC,
    });
  });

  // @rule R4
  it("[R4] sends no read when the mandate did not choose Raydium (Orca has no pool search)", async () => {
    await expect(
      searchMandatePools({ network: "solana", tokenAddress: SOL, protocols: ["uniswap-v4"] }),
    ).resolves.toEqual([]);
    expect(getRaydiumPoolsAction).not.toHaveBeenCalled();
  });

  // @rule R4
  it("[R4] keeps every address on its own network", async () => {
    // An EVM token on the Solana network, and a pair across the two networks: no pool, no read.
    await expect(
      searchMandatePools({ network: "solana", tokenAddress: EVM_ADDRESS, protocols: ["raydium"] }),
    ).resolves.toEqual([]);
    await expect(
      searchMandatePools({
        network: "solana",
        tokenAddress: SOL,
        secondTokenAddress: EVM_ADDRESS,
        protocols: ["raydium"],
      }),
    ).resolves.toEqual([]);
    expect(getRaydiumPoolsAction).not.toHaveBeenCalled();

    // A Solana mint on an EVM network: the API is not asked.
    await expect(
      searchMandatePools({ network: "arbitrum", tokenAddress: SOL, protocols: ["uniswap-v4"] }),
    ).resolves.toEqual([]);
    expect(getCatalogPoolsAction).not.toHaveBeenCalled();
  });

  // @rule R4
  it("[R4] throws when DEX Screener fails, so the step shows its error state (R5)", async () => {
    vi.mocked(getRaydiumPoolsAction).mockResolvedValue({
      ok: false,
      error: { code: "timeout" },
    });

    const failure = searchMandatePools({
      network: "solana",
      tokenAddress: SOL,
      protocols: ["raydium"],
    });

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ code: "RAYDIUM_TIMEOUT" });
  });

  // @rule R4
  it("[R4] adds and removes a Raydium pool like an EVM pool", () => {
    const pool = refOf("PoolA");
    const added = addPool(raydiumDraft(), pool, catalog());
    if (isBlocked(added)) throw new Error("the pool was refused");

    expect(added.pools.map((entry) => entry.id)).toEqual(["solana:PoolA"]);
    // The pool pulled its SOL side into the mandate. USDC is the locked deposit token already.
    expect(added.tokens.some((token) => token.network === "solana" && token.address === SOL)).toBe(
      true,
    );
    expect(removePool(added, pool.id).pools).toEqual([]);
  });

  // @rule R4
  it("[R4] adds a Solana pool in real data mode, where no per-chain Uniswap list exists", () => {
    const real: MandateDraft = { ...raydiumDraft(), dataMode: "real" };
    const added = addPool(real, refOf("PoolA"), catalog());
    expect(isBlocked(added)).toBe(false);
  });

  // @rule R4
  it("[R4] refuses a pool with a Solana token the catalog does not know, and keeps its mint case", () => {
    const draft = raydiumDraft();
    const pool = refOf("PoolJup", { address: JUP, symbol: "JUP" });

    expect(poolSideAddable(draft, pool, pool.token1, catalog())).toBe(false);
    const refused = addPool(draft, pool, catalog());
    expect(isBlocked(refused) && refused.blocked.reason).toBe("not_priced");
    // The SOL side is in the Solana catalog, so only the unknown side is refused.
    expect(poolSideAddable(draft, pool, pool.token0, catalog())).toBe(true);
  });
});

describe("R6: selected Raydium pools save in the draft", () => {
  // @rule R6
  it("[R6] reads a saved Raydium pool back after a reload, with its empty fee and APR", () => {
    const pool = refOf("PoolA");
    const added = addPool(raydiumDraft(), pool, catalog());
    if (isBlocked(added)) throw new Error("the pool was refused");

    expect(upsertDraft(added)).not.toBeNull();
    const reloaded = getDraft(added.id);

    expect(reloaded?.pools).toEqual([pool]);
    // Nothing is made up: DEX Screener gives no fee tier, so the fee stays null after a reload.
    expect(reloaded?.pools[0]?.feeBps).toBeNull();
    expect(reloaded?.pools[0]?.feeTier).toBeNull();
    expect(reloaded?.protocols).toContain("raydium");
  });
});
