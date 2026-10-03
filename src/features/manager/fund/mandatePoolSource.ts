/**
 * @id PP-MGR-LIB-020
 * @name mandatePoolSource
 * @implements-rules-version v1 (POO-2133 frontend slice A; mock POO-2125 rules v1)
 * @analytics-events none, a data adapter. The Pools step (PP-MGR-CMP-038) emits its own view and
 *   blocked-intent events through the shell's `onBlocked` prop; nothing here touches the dataLayer.
 *
 * Where the Mandate step's Pools list comes from, in both modes. The step itself holds no fetching
 * and no mapping: it asks for pools by network, token and protocol, and renders what comes back.
 *
 * Mock mode serves the V1 catalog (`uniswapPools`, mapped as Uniswap v3) plus the fund fixtures
 * (`fundPools.ts`), through the repo's latency helper and with the usual rare failure, so the step
 * has a loading state and an error state to render before any backend exists.
 *
 * Real mode reads the v2 catalog only: eligible Uniswap v4 pools identified by bytes32 PoolId.
 * PoolKey and catalog token metadata are retained, and unavailable metrics stay null.
 *
 * Errors are never swallowed. A failed read throws and the step owns the error state; an empty list
 * means "no pools matched", which is a different thing a manager must be able to tell apart.
 *
 * PP-INTEGRATION-POINT: resolved POO-2133, server actions read `/api/v2/catalog/uniswap-v4/pools`.
 */

import { ApiError } from "@/lib/api/errors";
import { getCatalogPoolAction, getCatalogPoolsAction } from "@/lib/api/v2/actions";
import type { CatalogPool, V2ChainId } from "@/lib/api/v2/schemas";
import type { UniswapPool } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { findToken } from "@/lib/tokens/tokenList";
import { fundPoolFixtures } from "@/mocks/data/fundPools";
import { uniswapPools } from "@/mocks/data/pools";
import { simulateDelay } from "@/mocks/utils/simulate";
import {
  type DexProtocolId,
  type MandatePoolRef,
  NETWORK_ORDER,
  type NetworkId,
} from "./mandateDraft";

/** What the Pools step asks for. One network, one or two tokens, the mandate's DEX protocols. */
export interface PoolSearchInput {
  network: NetworkId;
  /** The token every returned pool must hold. Case-insensitive. */
  tokenAddress: string;
  /** When present, every returned pool must hold BOTH tokens. Case-insensitive. */
  secondTokenAddress?: string;
  /** The DEX protocols the draft selected. An empty list matches nothing. */
  protocols: DexProtocolId[];
}

/** Mock latency band, in ms. Wide enough that the step's loading state is visible in mock mode. */
const MOCK_LATENCY_MS: readonly [number, number] = [150, 400];

/** Mock failure probability, the "realistic 2-5%" band docs/05_MOCK_STRATEGY.md names. */
const MOCK_FAILURE_RATE = 0.02;

/** The message the mock throws, so a reader of a stack trace knows the failure was synthetic. */
const MOCK_FAILURE_MESSAGE = "mock: pools unavailable";

/**
 * Throw the synthetic failure on a 2% draw.
 *
 * `simulateError` from `@/mocks/utils/simulate` is deliberately not reused: it throws a generic
 * "Simulated error", and this path wants a message that names the surface. The draw is the same
 * `Math.random()` comparison, so a test pins it the same way (`vi.spyOn(Math, "random")`).
 */
function failSometimes(): void {
  if (Math.random() < MOCK_FAILURE_RATE) {
    throw new Error(MOCK_FAILURE_MESSAGE);
  }
}

/** Is this API network slug one the mandate models? */
function isNetworkId(slug: string): slug is NetworkId {
  return (NETWORK_ORDER as readonly string[]).includes(slug);
}

/** One side of a pool, named from the token list when it can be, from the pool itself otherwise. */
function tokenSide(
  network: string,
  address: string,
  fallbackSymbol: string,
): MandatePoolRef["token0"] {
  const lower = address.toLowerCase();
  const info = findToken(network, lower);
  return {
    address: lower,
    // `findToken` already applies `canonicalTokenSymbol`, so the wrapped ether reads "ETH" here the
    // same way it does in the wallet and in the V1 pair labels (POO-589 [R1]).
    symbol: info?.symbol ?? fallbackSymbol,
    // No invented name: an unknown token is shown by its symbol rather than given a prose label.
    name: info?.name ?? fallbackSymbol,
    logoUrl: info?.iconUrl ?? null,
  };
}

/**
 * The V1 pool shape to a mandate pool.
 *
 * `address` reads `pool.address`, not `pool.id`. For real data the two are the same string
 * (`mapDexPool` sets both from `pool.address`), but the V1 MOCK catalog ids are slugs like
 * `arb-eth-usdc-5`, and a pasted-address lookup against a slug can never match.
 *
 * `protocol` is an argument because the pool shape does not carry one: `/dex-pools` is a Uniswap v3
 * endpoint, so the caller states what it fetched rather than this guessing.
 */
export function mapUniswapPoolToMandatePool(
  pool: UniswapPool,
  protocol: DexProtocolId,
): MandatePoolRef {
  return {
    id: pool.id,
    address: pool.address,
    // `UniswapPool.network` is a free string (the API slug). Every slug that can reach this is a
    // NetworkId: real pools are fetched FOR one, and `mockUniverse` drops any mock row whose slug
    // is outside the union before mapping it.
    network: pool.network as NetworkId,
    protocol,
    token0: tokenSide(pool.network, pool.token0Address, pool.token0),
    token1: tokenSide(pool.network, pool.token1Address, pool.token1),
    feeBps: pool.feeBps,
    // The raw tier is absent on mock data; the schema itself documents deriving it from `feeBps`
    // (5 bps → 500 hundredths of a bip). Never rounded the other way (POO-1497).
    feeTier: pool.feeTier ?? pool.feeBps * 100,
    tvlUsd: pool.tvlUsd,
    aprPct: pool.aprPct,
    // Filled by `tierShare` over the pools a search actually returned, never by the mapper: a share
    // of one pool is meaningless, and inventing 100% would be a fabricated figure.
    tierSharePct: null,
    // `/dex-pools` is v3-only and the V1 catalog is v3-only, so nothing here can carry a hook. The
    // fund fixtures set it themselves.
    hasHook: false,
  };
}

/**
 * Share of a pair's TVL held by each pool, as an integer percent, keyed by pool id.
 *
 * Same arithmetic as the V1 builder's "{pct}% selected" column: `MandateStep.tsx` lines 416-428
 * sums `tvlUsd` per pair and answers `Math.round((candidate.tvlUsd / total) * 100)`.
 *
 * Two deliberate differences from V1:
 *
 * 1. The group key carries the network and the protocol, not just the pair. V1 only ever held one
 *    network and one protocol at a time; a mandate holds several, and a Uniswap v3 ETH/USDC pool is
 *    not a tier of the v4 ETH/USDC pool.
 * 2. A pair with no liquidity answers `null`, where V1 printed `0`. "0% selected" reads as a
 *    measured share of nothing; `MandatePoolRef.tierSharePct` is nullable precisely so the row can
 *    say nothing instead (POO-1469, never present an absent figure as a measurement).
 *
 * The pair is unordered: the same two tokens group together whichever side each one is on.
 */
export function tierShare(pools: MandatePoolRef[]): Map<string, number | null> {
  const groupKey = (pool: MandatePoolRef): string => {
    const [a, b] = [pool.token0.address.toLowerCase(), pool.token1.address.toLowerCase()].sort();
    return `${pool.network}|${pool.protocol}|${a}-${b}`;
  };

  const pairTvl = new Map<string, number>();
  for (const pool of pools) {
    const key = groupKey(pool);
    pairTvl.set(key, (pairTvl.get(key) ?? 0) + (pool.tvlUsd ?? 0));
  }

  const shares = new Map<string, number | null>();
  for (const pool of pools) {
    const total = pairTvl.get(groupKey(pool)) ?? 0;
    shares.set(
      pool.id,
      total > 0 && pool.tvlUsd !== null ? Math.round((pool.tvlUsd / total) * 100) : null,
    );
  }
  return shares;
}

/**
 * Every pool mock mode knows: the V1 catalog as Uniswap v3, plus the fund fixtures.
 *
 * The V1 rows are kept, but they are not what a mandate's own tokens find: their mock token
 * addresses are synthetic (`mockAddress` in `pools.ts`), and {@link searchMock} matches a pool by
 * the REAL address of a mandate token, so a V1 mock row only ever surfaces through a pasted pool
 * address. The hub's reachable Uniswap v3 book is `fixtures.arbitrumV3`, which exists for exactly
 * that reason (see `fundPools.ts`).
 *
 * Built per call rather than once at module load so the mapping stays honest if a fixture is ever
 * swapped in a test; it is a few dozen rows. `fundPoolFixtures()` is a CALL and not a set of
 * imported constants on purpose: it resolves its token sides against the bundled lists and throws
 * when one is missing, and this module is imported in real mode too (see that file's header).
 */
function mockUniverse(): MandatePoolRef[] {
  const fixtures = fundPoolFixtures();
  return [
    ...uniswapPools
      .filter((pool) => isNetworkId(pool.network))
      .map((pool) => mapUniswapPoolToMandatePool(pool, "uniswap-v3")),
    ...fixtures.uniswapV4,
    ...fixtures.robinhoodV3,
    ...fixtures.arbitrumV3,
  ];
}

/** Does this pool hold `address` on either side? */
function holdsToken(pool: MandatePoolRef, address: string): boolean {
  return (
    pool.token0.address.toLowerCase() === address || pool.token1.address.toLowerCase() === address
  );
}

/** The mock search: filter the local universe, after a plausible round trip. */
async function searchMock(input: PoolSearchInput): Promise<MandatePoolRef[]> {
  await simulateDelay(MOCK_LATENCY_MS[0], MOCK_LATENCY_MS[1]);
  failSometimes();

  const wanted = new Set<DexProtocolId>(input.protocols);
  const first = input.tokenAddress.toLowerCase();
  const second = input.secondTokenAddress?.toLowerCase();

  return mockUniverse().filter(
    (pool) =>
      pool.network === input.network &&
      wanted.has(pool.protocol) &&
      holdsToken(pool, first) &&
      (second === undefined || holdsToken(pool, second)),
  );
}

/**
 * Real v4 pair filtering. API eligibility is checked defensively before mapping a row.
 */
async function searchReal(input: PoolSearchInput): Promise<MandatePoolRef[]> {
  if (!input.protocols.includes("uniswap-v4")) return [];
  const result = await getCatalogPoolsAction(chainFor(input.network), {
    tokenAddress: input.tokenAddress,
    ...(input.secondTokenAddress ? { secondTokenAddress: input.secondTokenAddress } : {}),
  });
  if (!result.ok)
    throw new ApiError(result.error.status, result.error.code, "v2 catalog unavailable");
  return result.data.pools.filter(eligiblePool).map(mapV2Pool);
}

function chainFor(network: NetworkId): V2ChainId {
  return network === "arbitrum" ? 42161 : 4663;
}
function eligiblePool(pool: CatalogPool): boolean {
  return (
    pool.eligible &&
    !pool.hooked &&
    /^0x0{40}$/.test(pool.poolKey.hooks) &&
    ![pool.poolKey.currency0, pool.poolKey.currency1].some((currency) =>
      /^0x0{40}$/.test(currency),
    ) &&
    pool.tokens.every((token) => token.hubPriced) &&
    pool.liquidity !== "0"
  );
}
export function mapV2Pool(pool: CatalogPool): MandatePoolRef {
  const side = (currency: string) => {
    const token = pool.tokens.find(
      (entry) => entry.address.toLowerCase() === currency.toLowerCase(),
    );
    if (!token) throw new Error("catalog pool currency missing");
    return {
      address: token.address.toLowerCase(),
      symbol: token.symbol,
      name: token.name,
      logoUrl: token.logoUrl,
    };
  };
  return {
    id: `${pool.chainId}:${pool.poolId.toLowerCase()}`,
    address: pool.poolId.toLowerCase(),
    poolId: pool.poolId.toLowerCase(),
    poolKey: pool.poolKey,
    network: pool.chainId === "42161" ? "arbitrum" : "robinhood",
    protocol: "uniswap-v4",
    token0: side(pool.poolKey.currency0),
    token1: side(pool.poolKey.currency1),
    feeTier: pool.poolKey.fee,
    feeBps: pool.poolKey.fee / 100,
    tvlUsd: pool.tvlUsd === null ? null : Number(pool.tvlUsd),
    aprPct: pool.feesApr === null ? null : Number(pool.feesApr),
    tierSharePct: null,
    hasHook: pool.hooked,
  };
}

/**
 * The pools a mandate may add, for one network and one or two tokens.
 *
 * Deepest first, with `tierSharePct` filled across the result set, so the Pools step can render the
 * tier rows of a pair in the order a manager reads them.
 */
export async function searchMandatePools(input: PoolSearchInput): Promise<MandatePoolRef[]> {
  const found = isMockMode ? await searchMock(input) : await searchReal(input);

  const ordered = [...found].sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  const shares = isMockMode ? tierShare(ordered) : new Map<string, number | null>();
  // A new object per row: the fixtures are module-level constants and must not be written through.
  return ordered.map((pool) => ({ ...pool, tierSharePct: shares.get(pool.id) ?? null }));
}

/**
 * Where a pasted pool address is, as far as one network's read can tell.
 *
 * Two fields rather than a nullable pool, because "not here" and "not anywhere" are different facts
 * to a manager and only one of them is a dead end. A null `pool` with `foundOn` set is the pool
 * existing somewhere the mandate does not reach (R30); both null is nowhere.
 */
export interface MandatePoolLocation {
  /** The pool, when `network` is where it lives. */
  pool: MandatePoolRef | null;
  /** The network it really lives on, when that is NOT `network`. Null when unknown or irrelevant. */
  foundOn: NetworkId | null;
}

/**
 * One pool by its own contract address, the paste-an-address entry point.
 *
 * `tierSharePct` stays null: resolving one address fetches no siblings, so there is no pair total to
 * divide by. The lookup is scoped to `network`, because a mandate pool belongs to the network it was
 * chosen on, but a miss is not silent: both modes report the network the address DOES live on when
 * they know it.
 *
 * Real mode resolves a bytes32 PoolId on the selected chain. Only a 404 probes the other supported
 * chain; transport, protocol or dormant errors remain errors rather than wrong-chain advice.
 *
 * Mock mode knows because it holds the whole universe locally, and answers the same shape so the
 * step needs no mode branch of its own.
 *
 * `protocols` is the mandate's own DEX selection, and it is required rather than defaulted: a pool
 * of a protocol the mandate never named is one `addPool` refuses, so offering it could only ever be
 * an Add that fails. Worse, an address resolved that way entered `draft.pools` on the left side of
 * the Broad-mandate comparison (R13) while never appearing in the universe on its right. An empty
 * `protocols` therefore matches nothing, exactly as it does in {@link searchMandatePools}.
 *
 * @param protocols The DEX protocols the draft selected. Empty matches nothing.
 */
export async function findMandatePoolByAddress(
  network: NetworkId,
  address: string,
  protocols: DexProtocolId[],
): Promise<MandatePoolLocation> {
  const wanted = address.toLowerCase();

  if (isMockMode) {
    await simulateDelay(MOCK_LATENCY_MS[0], MOCK_LATENCY_MS[1]);
    failSometimes();
    const chosen = new Set<DexProtocolId>(protocols);
    const matches = mockUniverse().filter(
      (pool) => pool.address.toLowerCase() === wanted && chosen.has(pool.protocol),
    );
    const here = matches.find((pool) => pool.network === network);
    if (here) return { pool: here, foundOn: null };
    // Nothing of a chosen protocol anywhere is "nowhere", never a wrong-network advisory: the pool
    // is not on another network, it is simply not part of this mandate.
    return { pool: null, foundOn: matches[0]?.network ?? null };
  }

  if (!protocols.includes("uniswap-v4") || !/^0x[0-9a-f]{64}$/.test(wanted))
    return { pool: null, foundOn: null };
  const result = await getCatalogPoolAction(chainFor(network), wanted);
  if (result.ok)
    return { pool: eligiblePool(result.data) ? mapV2Pool(result.data) : null, foundOn: null };
  if (result.error.status !== 404)
    throw new ApiError(result.error.status, result.error.code, "v2 catalog unavailable");
  const other = network === "arbitrum" ? "robinhood" : "arbitrum";
  const elsewhere = await getCatalogPoolAction(chainFor(other), wanted);
  if (!elsewhere.ok && elsewhere.error.status !== 404)
    throw new ApiError(elsewhere.error.status, elsewhere.error.code, "v2 catalog unavailable");
  return { pool: null, foundOn: elsewhere.ok && eligiblePool(elsewhere.data) ? other : null };
}
