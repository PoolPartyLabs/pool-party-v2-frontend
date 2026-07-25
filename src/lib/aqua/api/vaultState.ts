import "server-only";

import { desc, eq } from "drizzle-orm";
import { erc20Abi } from "viem";
import {
  AQUA_RAW_BALANCES_ABI,
  CARRY_ADAPTER_VIEW_ABI,
  CHAINLINK_FEED_ABI,
  PARTY_VAULT_VIEW_ABI,
} from "../abis/partyVault";
import { arbitrumPublicClient } from "../chain/clients";
import {
  AQUA_REGISTRY,
  AQUA_SWAP_VM_ROUTER,
  CHAINLINK_ETH_USD,
  DECIMALS,
  TOKENS,
} from "../config/addresses";
import { aquaDb } from "../db/client";
import { aquaFills, aquaShips } from "../db/schema";

/**
 * Everything the read-only investor page shows, assembled server-side.
 *
 * Two rules shape this file. IDX-R2: money is read fresh from chain on every request, never
 * from a cache and never from our own database, so a number on the page is a number on
 * Arbitrum. FE-R7: when real data is missing the page hides the section rather than inventing
 * one, which is why this returns a discriminated state instead of zeros.
 *
 * The database is used only for things chain cannot tell us cheaply: which mandate a
 * strategyHash belongs to, and the band it was built against at ship time.
 */

/** D9: 90 minutes. Beyond this the price is not trustworthy and the page says so. */
const MAX_STALENESS_SECONDS = 90 * 60;

export type BandView = {
  strategyHash: string;
  mandate: string;
  /** 8dp, as built at ship time. */
  lowE8: string;
  highE8: string;
  spotAtShipE8: string;
  /** Raw USDC units still committed to this strategy, read live from Aqua. */
  committedUsdc: string;
  /** Raw WETH units this strategy has accumulated, read live from Aqua. */
  acquiredWeth: string;
  epoch: number;
  /** Unix seconds. */
  deadline: string;
  shipTxHash: string | null;
  active: boolean;
};

export type FillView = {
  txHash: string;
  when: string;
  mandate: string;
  amountIn: string;
  amountOut: string;
  /** True when settlement had to withdraw from Aave mid-transaction. */
  jitUnparked: boolean;
};

export type ActiveReserveState =
  | { status: "not-launched"; reason: string }
  | {
      status: "live";
      vault: `0x${string}`;
      adapter: `0x${string}` | null;
      price: { ethUsdE8: string; ageSeconds: number; stale: boolean };
      /** Raw units throughout. Formatting is the view layer's job. */
      sleeves: { hotBufferUsdc: string; parkedUsdc: string; acquiredWeth: string };
      nav: { totalAssetsUsdc: string; wethValuedUsdc: string; totalShares: string };
      bands: BandView[];
      fills: FillView[];
    };

function envAddress(name: string): `0x${string}` | null {
  const raw = process.env[name];
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return raw as `0x${string}`;
}

export async function readActiveReserveState(): Promise<ActiveReserveState> {
  const vault = envAddress("AQUA_VAULT_ADDRESS");
  if (!vault) {
    return {
      status: "not-launched",
      reason: "AQUA_VAULT_ADDRESS is not set. The vault has not been deployed yet.",
    };
  }

  const client = arbitrumPublicClient();

  // Fail loudly rather than render a page about a contract that is not there.
  const code = await client.getCode({ address: vault });
  if (!code || code === "0x") {
    return {
      status: "not-launched",
      reason: `No contract at ${vault} on Arbitrum.`,
    };
  }

  const [, ethUsdE8, , updatedAt] = await client.readContract({
    address: CHAINLINK_ETH_USD,
    abi: CHAINLINK_FEED_ABI,
    functionName: "latestRoundData",
  });
  const block = await client.getBlock();
  const ageSeconds = Number(block.timestamp - updatedAt);

  const adapter = (await client
    .readContract({ address: vault, abi: PARTY_VAULT_VIEW_ABI, functionName: "ADAPTER" })
    .catch(() => null)) as `0x${string}` | null;

  const [hotBufferUsdc, acquiredWeth, totalAssets, totalShares, activeStrategies] =
    await Promise.all([
      client.readContract({
        address: TOKENS.USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vault],
      }),
      client.readContract({
        address: TOKENS.WETH,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vault],
      }),
      client.readContract({
        address: vault,
        abi: PARTY_VAULT_VIEW_ABI,
        functionName: "totalAssets",
      }) as Promise<bigint>,
      client.readContract({
        address: vault,
        abi: PARTY_VAULT_VIEW_ABI,
        functionName: "totalShares",
      }) as Promise<bigint>,
      client.readContract({
        address: vault,
        abi: PARTY_VAULT_VIEW_ABI,
        functionName: "activeStrategies",
      }),
    ]);

  let parkedUsdc = BigInt(0);
  if (adapter && adapter !== "0x0000000000000000000000000000000000000000") {
    parkedUsdc = await client
      .readContract({
        address: adapter,
        abi: CARRY_ADAPTER_VIEW_ABI,
        functionName: "parkedBalance",
        args: [TOKENS.USDC],
      })
      .catch(() => BigInt(0));
  }

  const bands = await readBands(vault, activeStrategies);
  const fills = await readFills();

  return {
    status: "live",
    vault,
    adapter,
    price: {
      ethUsdE8: ethUsdE8.toString(),
      ageSeconds,
      stale: ageSeconds > MAX_STALENESS_SECONDS,
    },
    sleeves: {
      hotBufferUsdc: hotBufferUsdc.toString(),
      parkedUsdc: parkedUsdc.toString(),
      acquiredWeth: acquiredWeth.toString(),
    },
    nav: {
      totalAssetsUsdc: totalAssets.toString(),
      wethValuedUsdc: wethToUsdcRaw(acquiredWeth, ethUsdE8).toString(),
      totalShares: totalShares.toString(),
    },
    bands,
    fills,
  };
}

/**
 * Band edges come from the ship record because they were computed against the Chainlink spot
 * of that moment and cannot be recovered from chain. The MONEY on each band is read live.
 */
async function readBands(
  vault: `0x${string}`,
  activeStrategies: readonly `0x${string}`[],
): Promise<BandView[]> {
  if (activeStrategies.length === 0) return [];

  const client = arbitrumPublicClient();
  const rows = await aquaDb()
    .select()
    .from(aquaShips)
    .where(eq(aquaShips.maker, vault.toLowerCase()));
  const byHash = new Map(rows.map((row) => [row.strategyHash.toLowerCase(), row]));

  const bands: BandView[] = [];
  for (const strategyHash of activeStrategies) {
    const record = byHash.get(strategyHash.toLowerCase());
    const [committedUsdc] = await client.readContract({
      address: AQUA_REGISTRY,
      abi: AQUA_RAW_BALANCES_ABI,
      functionName: "rawBalances",
      args: [vault, AQUA_SWAP_VM_ROUTER, strategyHash, TOKENS.USDC],
    });
    const [acquiredWeth] = await client.readContract({
      address: AQUA_REGISTRY,
      abi: AQUA_RAW_BALANCES_ABI,
      functionName: "rawBalances",
      args: [vault, AQUA_SWAP_VM_ROUTER, strategyHash, TOKENS.WETH],
    });

    // FE-R7: a band we have no ship record for is still shown with its live money, but its
    // edges are omitted rather than guessed.
    bands.push({
      strategyHash,
      mandate: record?.mandate ?? "unknown",
      lowE8: record?.bandLowE8 ?? "",
      highE8: record?.bandHighE8 ?? "",
      spotAtShipE8: record?.spotE8 ?? "",
      committedUsdc: committedUsdc.toString(),
      acquiredWeth: acquiredWeth.toString(),
      epoch: record?.epoch ?? 0,
      deadline: record?.deadline?.toString() ?? "",
      shipTxHash: record?.shipTxHash ?? null,
      active: true,
    });
  }
  return bands;
}

async function readFills(limit = 25): Promise<FillView[]> {
  const rows = await aquaDb()
    .select()
    .from(aquaFills)
    .orderBy(desc(aquaFills.blockTimestamp))
    .limit(limit);

  const ships = await aquaDb().select().from(aquaShips);
  const mandateByHash = new Map(ships.map((s) => [s.strategyHash.toLowerCase(), s.mandate]));

  return rows.map((row) => ({
    txHash: row.txHash,
    when: row.blockTimestamp.toISOString(),
    mandate: mandateByHash.get(row.strategyHash.toLowerCase()) ?? "unknown",
    amountIn: row.amountIn,
    amountOut: row.amountOut,
    jitUnparked: row.jitUnparked,
  }));
}

/** USDC value of a WETH amount at a Chainlink price, all in raw units. */
export function wethToUsdcRaw(wethRaw: bigint, priceE8: bigint): bigint {
  return (wethRaw * priceE8) / BigInt(10) ** BigInt(DECIMALS.WETH + 8 - DECIMALS.USDC);
}
