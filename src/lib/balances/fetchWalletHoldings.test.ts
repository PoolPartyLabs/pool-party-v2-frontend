/**
 * @id PP-BALANCES (POO-815, POO-1893)
 * @name fetchWalletHoldings tests
 * @implements-rules-version v3 (POO-1893 rules v2) · v2 (POO-1893 rules v1) · v1 (POO-815)
 * Server-side multi-network wallet-holdings read: per-network fan-out + merge, unpriced rows
 * dropped, a per-network failure tolerated, an all-networks failure surfaced (so the caller falls
 * back to the USDC-only read).
 * POO-1776 [R1]: the fan-out enumerates the ACTIVE chains, so a flag-gated chain is never read
 * while its flag is off.
 * POO-1893: every mocked response is now VALIDATED through the real schema (see `byNetwork`), so
 * this suite can see the drift class that took the read down on all three networks for six days.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeChainMetas, ROBINHOOD_CHAIN_ID, supportedChainMetas } from "@/lib/chains/config";
import { isFeatureEnabled } from "@/lib/features";
import { isTraceId } from "@/lib/observability/trace";

/** The networks this environment actually fans out to (the gated chains are off by default). */
const activeNetworks = () => activeChainMetas(isFeatureEnabled).map((meta) => meta.apiNetworkId);

/** The API slug of the flag-gated alpha chain, read from the config rather than retyped. */
const GATED_NETWORK = supportedChainMetas.find((meta) => meta.chain.id === ROBINHOOD_CHAIN_ID)
  ?.apiNetworkId as string;

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

async function importFetch() {
  vi.resetModules();
  return import("./fetchWalletHoldings");
}

/** A backend holding row with sensible defaults. */
function row(over: Record<string, unknown> = {}) {
  return {
    address: "0xtoken",
    name: "Token",
    symbol: "TKN",
    logo: "l",
    decimals: 18,
    balance: 1,
    formattedBalance: "1",
    priceUSD: 1,
    formattedBalanceInUSD: "1",
    isNative: false,
    ...over,
  };
}

/**
 * A row as the backend sends an UNPRICED token TODAY (POO-1893): `priceUSD` and
 * `formattedBalanceInUSD` are both ABSENT, where the documented contract had them as absent and
 * the string `"NaN"`. Written by OMISSION rather than by `undefined`, because the two are the same
 * to `Number()` and not the same to zod, and zod is where this broke.
 */
function unpricedRow(symbol: string) {
  return {
    address: `0x${symbol.toLowerCase()}`,
    name: symbol,
    symbol,
    decimals: 18,
    balance: 1,
    formattedBalance: "1000",
    isNative: false,
  };
}

/**
 * Resolve apiFetch per network by the `?network=` slug in the path, VALIDATING through the real
 * schema the caller passed.
 *
 * POO-1893: the validation is the point. This mock used to hand the payload back unchecked, so the
 * suite could not see the defect that took the read down on all three networks for six days — the
 * schema rejecting a payload the mapper was built to handle. A mock that skips the schema is
 * testing a layer the production path does not have.
 */
function byNetwork(map: Record<string, unknown>) {
  return (path: string, options?: { schema?: { parse: (value: unknown) => unknown } }) => {
    const slug = /network=([a-z]+)/.exec(path)?.[1] ?? "";
    const data = map[slug];
    if (data instanceof Error) return Promise.reject(data);
    const payload = data ?? { tokensBalance: [] };
    return Promise.resolve(options?.schema ? options.schema.parse(payload) : payload);
  };
}

describe("fetchWalletHoldings", () => {
  beforeEach(() => apiFetch.mockReset());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns [] without any call when no address is given", async () => {
    const { fetchWalletHoldings } = await importFetch();
    expect(await fetchWalletHoldings("")).toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fans out over every network and merges the holdings", async () => {
    apiFetch.mockImplementation(
      byNetwork({
        arbitrum: { tokensBalance: [row({ symbol: "USDC", formattedBalanceInUSD: "340.5" })] },
        base: {
          tokensBalance: [row({ symbol: "ETH", isNative: true, formattedBalanceInUSD: "50" })],
        },
        polygon: { tokensBalance: [row({ symbol: "DAI", formattedBalanceInUSD: "30" })] },
      }),
    );
    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");
    // One request per ACTIVE chain, counted from the config rather than pinned at 3 — a literal
    // count turns "the new chain is never read" into a green test (POO-1776 [R2]).
    expect(apiFetch).toHaveBeenCalledTimes(activeNetworks().length);
    expect(balances.map((b) => b.symbol).sort()).toEqual(["DAI", "ETH", "USDC"]);
    // The USD value comes from formattedBalanceInUSD.
    expect(balances.find((b) => b.symbol === "USDC")?.usd).toBe(340.5);
    // Native ETH lands on Base (chain 8453).
    expect(balances.find((b) => b.symbol === "ETH")?.chainId).toBe(8453);
  });

  it("drops unpriced rows (null priceUSD)", async () => {
    apiFetch.mockImplementation(
      byNetwork({
        base: {
          tokensBalance: [
            row({ symbol: "USDC", formattedBalanceInUSD: "100" }),
            row({ symbol: "SCAM", priceUSD: null, formattedBalanceInUSD: "NaN" }),
          ],
        },
      }),
    );
    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");
    expect(balances.map((b) => b.symbol)).toEqual(["USDC"]);
  });

  /**
   * @rule POO-1893 [R4] — the regression, at the level the outage happened. Sentry
   * `POOL-PARTY-FRONTEND-1` recorded 388+ HTTP 200 responses rejected on
   * `tokensBalance.{3,4,5,6}.formattedBalanceInUSD`: the four tokens `tokens/multi` could not
   * price. The THREE priced rows above them were discarded with them, on all three networks at
   * once, so the user was served a USDC-only balance for six days with no error shown.
   *
   * Pre-fix this test throws (the schema rejects every network); post-fix the priced rows come
   * back and the unpriced ones are dropped by the mapper, which is what it was already written to
   * do.
   */
  it("[R4] returns the priced rows of a payload whose unpriced rows omit formattedBalanceInUSD", async () => {
    apiFetch.mockImplementation(
      byNetwork({
        arbitrum: {
          wallet: "0xwallet",
          tokensBalance: [
            row({ symbol: "USDC", formattedBalanceInUSD: "1200.5" }),
            row({ symbol: "ARB", formattedBalanceInUSD: "40" }),
            row({ symbol: "WBTC", formattedBalanceInUSD: "300" }),
            unpricedRow("AAA"),
            unpricedRow("BBB"),
            unpricedRow("CCC"),
            unpricedRow("DDD"),
          ],
          transactions: [],
        },
      }),
    );

    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");

    expect(balances.map((b) => b.symbol).sort()).toEqual(["ARB", "USDC", "WBTC"]);
    expect(balances.find((b) => b.symbol === "USDC")?.usd).toBe(1200.5);
  });

  /**
   * @rule POO-1893 [R2] — one unparseable row never invalidates a whole network, and the drop is
   * NOT silent. Silent tolerance is how the next dropped field becomes invisible instead of merely
   * wrong, which is the difference between this fix and the one the portfolio dashboard got.
   */
  it("[R2] keeps a network's readable rows when one row is unreadable, and logs how many it dropped", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    apiFetch.mockImplementation(
      byNetwork({
        base: {
          tokensBalance: [
            row({ symbol: "USDC", formattedBalanceInUSD: "100" }),
            // A drift [R1] does NOT cover: the amount arrives as a number, not a decimal string.
            row({ symbol: "DAI", formattedBalance: 30, formattedBalanceInUSD: "30" }),
            row({ symbol: "ETH", isNative: true, formattedBalanceInUSD: "50" }),
          ],
        },
      }),
    );

    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");

    expect(balances.map((b) => b.symbol).sort()).toEqual(["ETH", "USDC"]);

    const record = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "error",
      event: "api.response_parse_failed",
      code: "SYSTEM_PARSE_ERROR",
      network: "base",
      rowsReceived: 3,
      rowsDropped: 1,
      issueCount: 1,
    });
    expect(record.issues).toEqual([
      expect.objectContaining({ path: "tokensBalance.1.formattedBalance" }),
    ]);
    // The degrade line carries the trace-id, like `apiFetch`'s own [R15] log: a drop that cannot be
    // joined to its request, or to the rest of the trace, is not diagnosable — and that join is
    // what made POO-1893 findable. Asserted through `isTraceId` so the format contract is not
    // retyped here.
    expect(isTraceId(record.traceId)).toBe(true);
    errorSpy.mockRestore();
  });

  /**
   * @rule POO-1893 [R3] — tolerance stops where it would hide a contract break. A non-empty
   * payload in which NOT ONE row is readable is a shape change, and answering "no holdings" for it
   * renders a FUNDED wallet as empty (`[]` is not nullish, so it never reaches the USDC-only
   * fallback). The network fails instead, and [R3]'s last resort stays reachable for the case it
   * was designed for — just no longer for metadata drift alone.
   */
  it("[R3] throws when no row on any network is readable, so the USDC-only fallback still fires", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    apiFetch.mockImplementation(
      byNetwork(
        Object.fromEntries(
          activeNetworks().map((network) => [
            network,
            { tokensBalance: [{ token: "USDC", amount: "100" }] },
          ]),
        ),
      ),
    );

    const { fetchWalletHoldings } = await importFetch();
    await expect(fetchWalletHoldings("0xwallet")).rejects.toThrow();
  });

  // @rule POO-1893 [R3] — and one network breaking that way still never hides funds held elsewhere.
  it("[R3] keeps the other networks when one network's rows are all unreadable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    apiFetch.mockImplementation(
      byNetwork({
        arbitrum: { tokensBalance: [{ token: "USDC" }] },
        base: { tokensBalance: [row({ symbol: "USDC", formattedBalanceInUSD: "100" })] },
      }),
    );

    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");

    expect(balances.map((b) => b.symbol)).toEqual(["USDC"]);
  });

  /**
   * @rule POO-1893 rules v2 [R5] — the same "funded wallet renders empty" outcome, one layer below
   * [R3]. Every row PARSES and every row is then dropped by the mapper for having no price, which
   * is a total pricing outage seen from here (the incident's co-timed `tokens/multi returned 0 of
   * 4`, at its limit). That used to return `[]`, and `[]` is not nullish, so it reached the modal
   * as $0.00 for a funded wallet instead of the USDC-only fallback.
   */
  it("[R5] throws when every row parses but not one is priced, so the USDC-only fallback still fires", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    apiFetch.mockImplementation(
      byNetwork(
        Object.fromEntries(
          activeNetworks().map((network) => [
            network,
            { tokensBalance: [unpricedRow("AAA"), unpricedRow("BBB")] },
          ]),
        ),
      ),
    );

    const { fetchWalletHoldings } = await importFetch();
    await expect(fetchWalletHoldings("0xwallet")).rejects.toThrow(/No priced holding row/);

    // Same event token and same shape as the row-drop line, so one saved search sees both degrade
    // paths; `reason` is what tells an operator to look at the price feed and not at the schema.
    const record = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "error",
      event: "api.response_parse_failed",
      reason: "no_priced_row",
      rowsReceived: 2,
      rowsDropped: 2,
    });
    expect(isTraceId(record.traceId)).toBe(true);
    errorSpy.mockRestore();
  });

  // @rule POO-1893 rules v2 [R5] — and the guard stops at NOTHING priced. One priced row is a
  // working wallet: any wallet holding USDC (priced, unit price > $0.01) never sees this path.
  it("[R5] does not throw when at least one row is priced", async () => {
    apiFetch.mockImplementation(
      byNetwork({
        base: {
          tokensBalance: [
            unpricedRow("AAA"),
            row({ symbol: "USDC", formattedBalanceInUSD: "100" }),
            unpricedRow("BBB"),
          ],
        },
      }),
    );

    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");

    expect(balances.map((b) => b.symbol)).toEqual(["USDC"]);
  });

  it("skips a network whose read fails instead of hiding funds held elsewhere", async () => {
    apiFetch.mockImplementation(
      byNetwork({
        arbitrum: new Error("rpc down"),
        base: { tokensBalance: [row({ symbol: "USDC", formattedBalanceInUSD: "100" })] },
        polygon: { tokensBalance: [] },
      }),
    );
    const { fetchWalletHoldings } = await importFetch();
    const balances = await fetchWalletHoldings("0xwallet");
    expect(balances.map((b) => b.symbol)).toEqual(["USDC"]);
  });

  it("throws when every network read fails (so the caller can fall back)", async () => {
    apiFetch.mockImplementation(
      byNetwork(
        Object.fromEntries(
          activeNetworks().map((network) => [network, new Error("endpoint not enabled")]),
        ),
      ),
    );
    const { fetchWalletHoldings } = await importFetch();
    await expect(fetchWalletHoldings("0xwallet")).rejects.toThrow("endpoint not enabled");
  });

  /**
   * @rule POO-1776 [R1] — the flag gates the DATA FAN-OUT, not only the network picker. With the
   * alpha chain off, no `wallet/{address}?network=robinhood` is issued: the prod API does not know
   * the slug, so the call is a guaranteed failure attached to every wallet read.
   */
  it("[R1] never reads a flag-gated network while its flag is off", async () => {
    apiFetch.mockImplementation(byNetwork({}));

    const { fetchWalletHoldings } = await importFetch();
    await fetchWalletHoldings("0xwallet");

    const paths = apiFetch.mock.calls.map((c) => String(c[0]));
    expect(paths.some((path) => path.includes(`network=${GATED_NETWORK}`))).toBe(false);
    expect(paths).toHaveLength(activeNetworks().length);
  });

  // @rule POO-1776 [R1] — flag on, the gated chain is read like any other.
  it("[R1] reads a flag-gated network once its flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_ROBINHOOD_CHAIN", "on");
    apiFetch.mockImplementation(byNetwork({}));

    const { fetchWalletHoldings } = await importFetch();
    await fetchWalletHoldings("0xwallet");

    const paths = apiFetch.mock.calls.map((c) => String(c[0]));
    expect(paths).toContain(`wallet/0xwallet?network=${GATED_NETWORK}`);
    expect(paths).toHaveLength(supportedChainMetas.length);
  });
});
