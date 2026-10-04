/**
 * @id PP-MGR-MCK-003
 * @name fund pool catalog (mock) tests
 * @implements-rules-version v2 (POO-2125 rules v1, POO-2142 rules v2)
 * @analytics-events none, a data fixture
 *
 * Invariants of the fund-contracts pool fixtures. These are not "does the array have items" tests:
 * every assertion below is a property the Pools step (S5b) and `mandatePoolSource` rely on, and
 * each one has already been a real defect class somewhere in this repo: a fee tier that is not a
 * real Uniswap tier (POO-1497), a token address that no list can resolve to a name, a fabricated
 * figure presented as measured (POO-1469). A fixture that drifts out of these bounds stops looking
 * like production data, which is the whole point of the mock layer (docs/05_MOCK_STRATEGY.md).
 *
 * One case here is not about the data at all: the module must be IMPORTABLE without building the
 * fixtures. `listed`/`stable` throw on an unresolvable token, deliberately, and the real-mode Pools
 * step imports the adapter that imports this file, so a throw at module scope would take a real
 * screen down over a mock. The last case pins that the throw waits for the call.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMandateCatalog } from "@/features/manager/fund/mandateCatalog";
import type { MandatePoolRef, NetworkId } from "@/features/manager/fund/mandateDraft";
import { getUsdcAddress, networkToChainId } from "@/lib/chains/config";
import { findToken } from "@/lib/tokens/tokenList";
import { CANONICAL_FEE_BPS } from "@/lib/uniswap/tick";
import { fundPoolFixtures } from "./fundPools";

const {
  uniswapV4: fundUniswapV4Pools,
  robinhoodV3: fundRobinhoodV3Pools,
  arbitrumV3: fundArbitrumV3Pools,
} = fundPoolFixtures();

/** Every fixture pool, the way `mandatePoolSource` assembles its mock universe. */
const all: MandatePoolRef[] = [
  ...fundUniswapV4Pools,
  ...fundRobinhoodV3Pools,
  ...fundArbitrumV3Pools,
];

/** A lowercase EVM address, exactly 42 characters. */
const ADDRESS = /^0x[0-9a-f]{40}$/;

/** The chain's stable address, from the one place the app defines it. */
function stableAddress(network: NetworkId): string {
  const chainId = networkToChainId(network);
  const address = chainId == null ? undefined : getUsdcAddress(chainId);
  return (address ?? "").toLowerCase();
}

describe("fund pool fixtures", () => {
  // @rule R-S5a-1 (fixtures): ids are unique and stable, because the draft stores pools by id and a
  // duplicate would make `removePool` ambiguous.
  it("gives every pool a unique id", () => {
    const ids = all.map((pool) => pool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // `findMandatePoolByAddress` resolves a pasted address against these, so two pools sharing one
  // address would make that lookup answer the wrong pool.
  it("gives every pool a unique address", () => {
    const addresses = all.map((pool) => pool.address);
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("names ids as lowercase slugs", () => {
    for (const pool of all) {
      expect(pool.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  // @rule R-S5a-2 (fixtures): only real Uniswap fee tiers, and `feeTier` is the same fee expressed
  // in hundredths of a bip. POO-1497: a tier outside this set mis-snaps every tick derived from it.
  it("carries only canonical fee tiers, consistent between feeBps and feeTier", () => {
    for (const pool of all) {
      expect(CANONICAL_FEE_BPS as readonly number[]).toContain(pool.feeBps);
      expect(pool.feeTier).toBe(pool.feeBps * 100);
    }
  });

  // @rule R-S5a-3 (fixtures): exactly two hooked pools, so the Pools step's `has_hook` refusal has
  // something to refuse, and no v3 pool claims a hook, which v3 cannot have.
  it("marks exactly two pools as hooked, both of them Uniswap v4", () => {
    const hooked = all.filter((pool) => pool.hasHook);
    expect(hooked).toHaveLength(2);
    for (const pool of hooked) {
      expect(pool.protocol).toBe("uniswap-v4");
    }
    for (const pool of [...fundRobinhoodV3Pools, ...fundArbitrumV3Pools]) {
      expect(pool.hasHook).toBe(false);
    }
  });

  // @rule R-S5a-4 (fixtures): protocol and network scoping. v4 exists on the hub and the spoke
  // (mandateCatalog `availableOn`), and the v3 fixtures exist to fill the gap the V1 mock catalog
  // leaves on Robinhood Chain.
  it("scopes each fixture set to its protocol and networks", () => {
    expect(fundUniswapV4Pools.length).toBeGreaterThanOrEqual(10);
    for (const pool of fundUniswapV4Pools) {
      expect(pool.protocol).toBe("uniswap-v4");
      expect(["arbitrum", "robinhood"]).toContain(pool.network);
    }
    expect(fundRobinhoodV3Pools.length).toBeGreaterThanOrEqual(4);
    for (const pool of fundRobinhoodV3Pools) {
      expect(pool.protocol).toBe("uniswap-v3");
      expect(pool.network).toBe("robinhood");
    }
    expect(fundArbitrumV3Pools.length).toBeGreaterThanOrEqual(8);
    for (const pool of fundArbitrumV3Pools) {
      expect(pool.protocol).toBe("uniswap-v3");
      expect(pool.network).toBe("arbitrum");
    }
  });

  it("covers both networks with Uniswap v4 pools", () => {
    const networks = new Set(fundUniswapV4Pools.map((pool) => pool.network));
    expect(networks).toContain("arbitrum");
    expect(networks).toContain("robinhood");
  });

  // @rule R-S5a-5 (fixtures): plausible scale. TVL 200k to 60M and APR 2 to 40%, the bands
  // docs/05_MOCK_STRATEGY.md fixes for this product.
  it("keeps TVL and APR inside the mock-strategy bands", () => {
    for (const pool of all) {
      expect(pool.tvlUsd).toBeGreaterThanOrEqual(200_000);
      expect(pool.tvlUsd).toBeLessThanOrEqual(60_000_000);
      expect(pool.aprPct).toBeGreaterThanOrEqual(2);
      expect(pool.aprPct).toBeLessThanOrEqual(40);
    }
  });

  // A flat catalog is not realistic: real pool TVL is a power law, so the fixture must span orders
  // of magnitude rather than clustering at one size.
  it("spreads TVL across orders of magnitude", () => {
    const tvls = all.map((pool) => pool.tvlUsd ?? 0);
    expect(Math.max(...tvls)).toBeGreaterThan(20_000_000);
    expect(Math.min(...tvls)).toBeLessThan(1_000_000);
  });

  // @rule R-S5a-6 (fixtures): every address is a real lowercase EVM address. The Pools step compares
  // pasted addresses case-insensitively against these, and the Tokens step keys caps on them.
  it("writes every address as a lowercase 42-character hex string", () => {
    for (const pool of all) {
      expect(pool.address).toMatch(ADDRESS);
      expect(pool.token0.address).toMatch(ADDRESS);
      expect(pool.token1.address).toMatch(ADDRESS);
    }
  });

  // @rule R-S5a-7 (fixtures): token identity is never invented. Each side resolves in the network's
  // bundled token list, and the symbol/name the fixture prints is the list's own.
  it("resolves every token side in the network's token list, with the list's own symbol and name", () => {
    for (const pool of all) {
      for (const side of [pool.token0, pool.token1]) {
        const info = findToken(pool.network, side.address);
        expect(info, `${pool.id} / ${side.address}`).toBeDefined();
        expect(side.symbol).toBe(info?.symbol);
        expect(side.name).toBe(info?.name);
        expect(side.logoUrl).toBe(info?.iconUrl ?? null);
      }
    }
  });

  // @rule R-S5a-8 (fixtures): the stable side is the chain's own stable, read from
  // `src/lib/chains/config.ts`, so a fixture can never drift from the deposit token the draft locks.
  it("pairs against the chain's configured stable on every network it covers", () => {
    // The deposit token the draft locks IS the chain stable, so a network whose fixtures never pair
    // against it would offer the manager no pool reachable from the one token they always hold.
    for (const network of ["arbitrum", "robinhood"] as const) {
      const stable = stableAddress(network);
      expect(stable).toMatch(ADDRESS);
      const paired = all.filter(
        (pool) =>
          pool.network === network &&
          (pool.token0.address === stable || pool.token1.address === stable),
      );
      expect(paired.length, network).toBeGreaterThan(0);
    }
  });

  // @rule R-S5a-9 (fixtures): Uniswap assigns token0/token1 by ascending address, and the app never
  // re-orders a pair (POO-1428). A fixture that ordered them by taste would teach the UI a pair
  // label the chain does not use.
  it("orders token0 before token1 by address, and never pairs a token with itself", () => {
    for (const pool of all) {
      expect(pool.token0.address < pool.token1.address).toBe(true);
    }
  });

  // @rule R-S5a-10 (fixtures): the fixture never claims a tier share. `tierSharePct` is derived from
  // the pools actually fetched (see `tierShare`), so a baked-in number would be a fabricated figure.
  it("leaves tierSharePct unset", () => {
    for (const pool of all) {
      expect(pool.tierSharePct).toBeNull();
    }
  });

  // One pair at several tiers is what makes the tier-share column mean anything.
  it("offers at least one pair at three or more fee tiers", () => {
    const counts = new Map<string, number>();
    for (const pool of all) {
      const key = `${pool.network}|${pool.protocol}|${pool.token0.address}|${pool.token1.address}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(3);
  });

  // The fixtures are built once and handed back by reference, so the adapter can call the accessor
  // per request (it does) without rebuilding a few dozen rows every time.
  it("builds the fixtures once", () => {
    expect(fundPoolFixtures()).toBe(fundPoolFixtures());
  });
});

/**
 * The hub Uniswap v3 set, and the defect it closes.
 *
 * The mock universe also carries the V1 catalog (`uniswapPools`), mapped as Uniswap v3, and on paper
 * that covered Arbitrum. It never did: those rows carry SYNTHETIC token addresses (`mockAddress`),
 * while the mock search matches a pool by the REAL address of a mandate token, so no V1 mock row can
 * ever match one. The result was a hub-only mandate on Uniswap v3 alone finding no pool at all in
 * mock mode, which refuses Next and strands the manager unless they go back and add Uniswap v4. Mock
 * mode is what every design review and preview runs on, so that is the state most people see.
 */
describe("fund pool fixtures, the hub Uniswap v3 set", () => {
  /** The priced tokens the catalog offers on Arbitrum, deposit token included, by address. */
  function pricedHubTokens(): string[] {
    const catalog = buildMandateCatalog();
    const deposit = catalog.depositTokenFor("arbitrum");
    const rest = catalog
      .tokensFor(["arbitrum"], ["uniswap-v3"])
      .filter((token) => token.priced)
      .map((token) => token.address.toLowerCase());
    return deposit ? [deposit.address.toLowerCase(), ...rest] : rest;
  }

  // @rule R-C1-1 (fixtures): a mandate holding ANY priced hub token finds a Uniswap v3 pool. Keyed
  // by address rather than by symbol, because the mock search matches on the address and a symbol
  // match would pass while the one address the Tokens step hands over still found nothing.
  it("pairs every priced Arbitrum catalog token into at least one pool", () => {
    const held = new Set(
      fundArbitrumV3Pools.flatMap((pool) => [
        pool.token0.address.toLowerCase(),
        pool.token1.address.toLowerCase(),
      ]),
    );

    const tokens = pricedHubTokens();
    expect(tokens.length).toBeGreaterThanOrEqual(8);
    for (const address of tokens) {
      expect(held, address).toContain(address);
    }
  });

  // @rule R-C1-2 (fixtures): one pair across several tiers, so the step's "{pct}% selected" column
  // has a share to divide on the hub's v3 tab and not only on its v4 one.
  it("offers at least one pair at two or more fee tiers", () => {
    const counts = new Map<string, number>();
    for (const pool of fundArbitrumV3Pools) {
      const key = `${pool.token0.address}|${pool.token1.address}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(2);
  });

  // A catalog where every tier is 0.05% teaches the tier column nothing. Real Arbitrum v3 carries
  // all four, from the stable pairs at 0.01% to the long tail at 1%.
  it("spreads the pools across more than one canonical tier", () => {
    const tiers = new Set(fundArbitrumV3Pools.map((pool) => pool.feeBps));
    expect(tiers.size).toBeGreaterThanOrEqual(3);
    for (const tier of tiers) {
      expect(CANONICAL_FEE_BPS as readonly number[]).toContain(tier);
    }
  });

  // Flat figures read as invented. These are per-pool values a manager compares side by side, so no
  // two pools may carry the same TVL or the same APR.
  it("gives every pool its own TVL and its own APR", () => {
    const tvls = fundArbitrumV3Pools.map((pool) => pool.tvlUsd);
    const aprs = fundArbitrumV3Pools.map((pool) => pool.aprPct);
    expect(new Set(tvls).size).toBe(tvls.length);
    expect(new Set(aprs).size).toBe(aprs.length);
  });
});

describe("fund pool fixtures, laziness", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/tokens/tokenList");
    vi.resetModules();
  });

  // The guard for the real-mode Pools step: `mandatePoolSource` imports this module in BOTH modes,
  // so a fixture whose token list cannot be resolved must not throw until something asks for it.
  // With the arrays at module scope the import itself threw, and a PP-MOCK file took down a screen
  // that never wanted a mock.
  it("does not touch the token list until the fixtures are asked for", async () => {
    vi.resetModules();
    vi.doMock("@/lib/tokens/tokenList", () => ({ findToken: () => undefined }));

    // The import is the assertion: it must resolve rather than throw.
    const module = await import("./fundPools");

    expect(() => module.fundPoolFixtures()).toThrow(/is not in the/);
  });
});

/**
 * The id these two files are headed with.
 *
 * An artifact id is the one thing two concurrent sessions cannot both allocate, and these fixtures
 * shipped headed `PP-MGR-MCK-001`, which `src/mocks/data/manager.ts` has held since POO-502. The
 * registry's own uniqueness check (`tests/hackathonDocs.test.ts`) reads registry ROWS, so a second
 * module quietly headed with a taken id passes it: nothing in the gate was looking at the headers.
 * This is the narrow guard for the one id this slice owns.
 *
 * PP-NOTE: narrow on purpose. `src/mocks/data` holds older collisions this slice did not create and
 * must not quietly renumber: `PP-CORE-MCK-003` heads five modules (onRampPaymentMethods, positions,
 * strategies, tokens, transactions) and `PP-CORE-MCK-005` heads two (balances, rewards). Widening
 * the assertion to the whole folder means re-issuing those ids and rewriting their registry rows,
 * which is its own change with its own review.
 */
describe("fund pool fixtures, the artifact id", () => {
  const DATA_DIR = resolve(__dirname);

  /** The `@id` in a file's header comment, or null when it has none. */
  function headerId(file: string): string | null {
    return readFileSync(join(DATA_DIR, file), "utf8").match(/@id\s+(PP-[A-Z0-9-]+)/)?.[1] ?? null;
  }

  it("is PP-MGR-MCK-003 in both files, and no other mock module holds it", () => {
    expect(headerId("fundPools.ts")).toBe("PP-MGR-MCK-003");
    expect(headerId("fundPools.test.ts")).toBe("PP-MGR-MCK-003");

    const claimants = readdirSync(DATA_DIR)
      .filter((file) => file.endsWith(".ts") && !/^fundPools(\.test)?\.ts$/.test(file))
      .filter((file) => headerId(file) === "PP-MGR-MCK-003");
    expect(claimants).toEqual([]);
  });

  it("is not an id another mock module already holds", () => {
    const taken = readdirSync(DATA_DIR)
      .filter((file) => file.endsWith(".ts") && !/^fundPools(\.test)?\.ts$/.test(file))
      .map(headerId);
    expect(taken).not.toContain(headerId("fundPools.ts"));
  });
});
