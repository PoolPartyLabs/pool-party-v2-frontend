import "server-only";

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
import { fillsFor } from "../data/managerMetadata";
import { decodeShipsFromChain } from "./backfill";
import { type AquaMandateView, aquaMandate, compositionSlices } from "./mandate";

/**
 * Everything the read-only investor page shows, assembled server-side.
 *
 * Two rules shape this file. IDX-R2: money is read fresh from chain on every request, never from
 * a cache and never from a stored copy, so a number on the page is a number on Arbitrum. FE-R7:
 * when real data is missing the page hides the section rather than inventing one, which is why
 * this returns a discriminated state instead of zeros.
 *
 * Everything here comes from chain, including the band geometry, which is decoded from the Aqua
 * registry's own `Shipped` log rather than recovered from a record we kept. The one exception is
 * the settled-purchase list; `readFills` says why, at the point it applies.
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
      /** Assets / protocols / networks, same shape the prospectus already renders. */
      mandate: AquaMandateView;
      /** Live composition slices, or null when the vault is empty (FE-R7). */
      composition: Array<{ label: string; weight: number }> | null;
      /** Manager-set ceiling on total deposits (VLT-R10). */
      maxTvlUsdc: string;
      /** VLT-R2: nobody may deposit until the manager has seeded. */
      seeded: boolean;
      /** USDC the vault can pay out right now: buffer plus what the adapter can unpark. */
      liquidUsdc: string;
    };

/** The connected investor's stake. Read separately so the page renders without a wallet. */
export type AquaPosition = {
  shares: string;
  /** Current value of those shares in raw USDC, via the vault's own conversion. */
  valueUsdc: string;
};

function asAddress(raw: string | undefined): `0x${string}` | null {
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw.trim())) return null;
  return raw.trim() as `0x${string}`;
}

/**
 * The vault this page is about.
 *
 * `NEXT_PUBLIC_AQUA_VAULT_ADDRESS` is the source of truth, deliberately public: a deployed contract
 * address is public by definition, the browser needs the same value to build a deposit, and one
 * variable cannot drift from itself. It is baked at build time, so pointing a deployment at a newly
 * launched vault is an env change plus a rebuild — which is the actual workflow when the current
 * reserve is wound down and a fresh one is opened.
 *
 * `AQUA_VAULT_ADDRESS` stays honoured as a server-only override so an existing environment keeps
 * working, and so a server can be pointed elsewhere without a rebuild.
 *
 * Both are read as STATIC `process.env.X` references. A computed lookup (`process.env[name]`) is
 * replaced at build time only for literals, so the dynamic form silently yields `undefined` in any
 * bundle Next inlines.
 */
function vaultAddress(): `0x${string}` | null {
  return (
    asAddress(process.env.NEXT_PUBLIC_AQUA_VAULT_ADDRESS) ??
    asAddress(process.env.AQUA_VAULT_ADDRESS)
  );
}

export async function readActiveReserveState(): Promise<ActiveReserveState> {
  const vault = vaultAddress();
  if (!vault) {
    return {
      status: "not-launched",
      reason: "NEXT_PUBLIC_AQUA_VAULT_ADDRESS is not set. The vault has not been deployed yet.",
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

  const [
    hotBufferUsdc,
    acquiredWeth,
    totalAssets,
    totalShares,
    activeStrategies,
    maxTvl,
    seeded,
    liquidUsdc,
  ] = await Promise.all([
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
    client.readContract({ address: vault, abi: PARTY_VAULT_VIEW_ABI, functionName: "maxTvl" }),
    client.readContract({ address: vault, abi: PARTY_VAULT_VIEW_ABI, functionName: "seeded" }),
    client.readContract({ address: vault, abi: PARTY_VAULT_VIEW_ABI, functionName: "liquidUsdc" }),
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
  const fills = readFills(bands);

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
    mandate: aquaMandate(),
    composition: compositionSlices({
      parkedUsdc,
      hotBufferUsdc,
      wethValuedUsdc: wethToUsdcRaw(acquiredWeth, ethUsdE8),
    }),
    maxTvlUsdc: maxTvl.toString(),
    seeded,
    liquidUsdc: liquidUsdc.toString(),
  };
}

/**
 * The connected investor's stake, valued through the vault's OWN `convertToAssets` rather than
 * a share-price we compute here. IDX-R3: any divergence from the on-chain conversion beyond
 * rounding is a bug, so the safest thing is not to have a second implementation at all.
 */
export async function readAquaPosition(investor: `0x${string}`): Promise<AquaPosition | null> {
  const vault = vaultAddress();
  if (!vault) return null;

  const client = arbitrumPublicClient();
  const shares = await client.readContract({
    address: vault,
    abi: PARTY_VAULT_VIEW_ABI,
    functionName: "sharesOf",
    args: [investor],
  });
  if (shares === BigInt(0)) return null;

  const valueUsdc = await client.readContract({
    address: vault,
    abi: PARTY_VAULT_VIEW_ABI,
    functionName: "convertToAssets",
    args: [shares],
  });
  return { shares: shares.toString(), valueUsdc: valueUsdc.toString() };
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

  // The band's geometry, decoded from the registry's own `Shipped` log (POO-1067, #677). This is
  // the same data an earlier revision kept in a table and then in a committed fixture, and both
  // were wrong for the same reason: it was recoverable from chain all along. The `Shipped` event
  // carries the ABI-encoded Order, the program inside carries the deadline and concentrate bounds,
  // and the band edges invert exactly out of that encoding. The mandate follows from the high/low
  // ratio, which is distinct per mandate and needs no knowledge of the price at ship time.
  //
  // One read for the whole vault rather than one per strategy: the decode scans a log range, so
  // asking it per band would rescan the same range once per band.
  const decoded = new Map<string, Awaited<ReturnType<typeof decodeShipsFromChain>>[number]>();
  try {
    for (const ship of await decodeShipsFromChain(vault)) {
      decoded.set(ship.strategyHash.toLowerCase(), ship);
    }
  } catch {
    // FE-R7: a decode that fails must not take the page down. The money below is read separately
    // and is still true, so the bands render without their edges rather than not at all.
  }

  const bands: BandView[] = [];
  for (const strategyHash of activeStrategies) {
    const record = decoded.get(strategyHash.toLowerCase());
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

    // FE-R7: a band whose `Shipped` log we could not decode is still shown with its live money,
    // but its edges are omitted rather than guessed, and its mandate stays "unknown".
    bands.push({
      strategyHash,
      mandate: record?.mandate ?? "unknown",
      lowE8: record?.bandLowE8 ?? "",
      highE8: record?.bandHighE8 ?? "",
      spotAtShipE8: record?.spotE8 ?? "",
      committedUsdc: committedUsdc.toString(),
      acquiredWeth: acquiredWeth.toString(),
      epoch: record?.epochIndex ?? 0,
      deadline: record ? record.deadline.toString() : "",
      shipTxHash: record?.shipTxHash ?? null,
      active: true,
    });
  }
  return bands;
}

/**
 * Settled purchases for the vault's active bands.
 *
 * The ONLY thing on this page not read from chain. Every row is a real Arbitrum transaction and
 * links to Arbiscan, but they are a committed list rather than an indexed feed: decoding a fill
 * means matching settlement logs across the router and the vault, and that indexer is named as
 * not built (`docs/_hackathon_aqua/03_PRE_EXISTING_VS_NEW.md`). The mandate label comes from the
 * band it belongs to, which IS decoded from chain, so a fill can never claim a mandate the band
 * does not have.
 */
function readFills(bands: readonly BandView[], limit = 25): FillView[] {
  const mandateOf = new Map(bands.map((band) => [band.strategyHash.toLowerCase(), band.mandate]));
  return fillsFor(
    bands.map((band) => band.strategyHash),
    limit,
  ).map((fill) => ({
    txHash: fill.txHash,
    when: fill.when,
    mandate: mandateOf.get(fill.strategyHash.toLowerCase()) ?? "unknown",
    amountIn: fill.amountIn,
    amountOut: fill.amountOut,
    jitUnparked: fill.jitUnparked,
  }));
}

/** USDC value of a WETH amount at a Chainlink price, all in raw units. */
export function wethToUsdcRaw(wethRaw: bigint, priceE8: bigint): bigint {
  return (wethRaw * priceE8) / BigInt(10) ** BigInt(DECIMALS.WETH + 8 - DECIMALS.USDC);
}
