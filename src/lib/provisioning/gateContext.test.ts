/**
 * @id PP-CORE-LIB-057 (POO-1042)
 * @name provisioning gate context, tests
 * @implements-rules-version v2
 * @hackathon POO-1022 (Universal Funding)
 *
 * The read that turns a wallet into everything the pre-flight gate needs. Since POO-1098 the
 * ASSEMBLY lives in pool-party-api and this module is the client of `GET /api/v1/funding/context`,
 * so what is left to test here is the boundary, not the arithmetic: one request per build, and the
 * fail-safe posture [R5] that a degraded or failed read must resolve to "no context" (and therefore
 * no gate) rather than to a wallet that looks empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiParseError } from "@/lib/api/errors";

const apiFetch = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("@/lib/auth/session", () => ({
  getAuthHeader: async () => ({ Authorization: "Bearer t" }),
}));

const { buildProvisioningGateContext } = await import("./gateContext");

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const ARBITRUM = 42161;

beforeEach(() => {
  vi.clearAllMocks();
  // The fail-open paths log (see `observeGateContextFailure`); keep the suite output readable and
  // assert the signal explicitly in the test that owns it.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/**
 * POO-1098: the suite that used to live here is GONE, and that needs saying plainly.
 *
 * It tested the local fan-out (the holdings split, per-chain gas verdicts, the quote-once-per-chain
 * property, the classifier floor). That assembly moved to pool-party-api, so those tests were
 * asserting deleted code. The coverage MOVED, it was not dropped: `src/funding/
 * funding-context.service.spec.ts` (23 cases) and `src/funding/gas-feasibility.spec.ts` own it now,
 * and each deleted case has a named counterpart there. Two are strictly stronger: the sub-$1 native
 * balance is now pinned as "kept out of sources but inside nativeHoldings", and the total-outage
 * case additionally asserts the backend never falls back to a native-less balance source.
 *
 * One test survived the move by ACCIDENT and is worth recording, because it is the failure mode this
 * repository keeps finding: "[R6] a total holdings-read failure yields NO context, so the gate
 * cannot fire" mocked `fetchWalletHoldings` to reject, and after the move nothing here reads
 * holdings. It still passed, but only because the unset `apiFetch` mock returned `undefined`, which
 * this module maps to `null` anyway. It passed for a reason unrelated to what its name claimed. A
 * test that passes vacuously is worse than no test, so it went with the rest, and its real property
 * is covered per failure mode below.
 *
 * (Its sibling, "[R6] never throws across the boundary when the inventory read fails", was NOT
 * vacuous: it asserted a concrete `sources`/`balancesByChain` shape and would have FAILED against
 * the new implementation. It is gone because the behaviour it described is now the backend's, where
 * `[R3] a routability outage empties sources but keeps the balances and verdicts` asserts it.)
 */

describe("buildProvisioningGateContext: served by pool-party-api (POO-1098)", () => {
  const CONTEXT = {
    targetChainId: ARBITRUM,
    sources: [],
    gasByChain: {},
    balancesByChain: {},
    nativeHoldings: [],
    gasEstimateUsd: 0.5,
    degraded: false,
  };

  it("[R1] costs ONE request, not a fan-out", async () => {
    apiFetch.mockResolvedValue(CONTEXT);

    const result = await buildProvisioningGateContext(WALLET, ARBITRUM);

    expect(result).not.toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toContain("funding/context");
    expect(path).toContain(`targetChainId=${ARBITRUM}`);
  });

  it("re-keys the served chain records from wire strings to numeric chain ids", async () => {
    apiFetch.mockResolvedValue({
      ...CONTEXT,
      gasByChain: {
        [String(ARBITRUM)]: {
          chainId: ARBITRUM,
          verdict: "OK",
          quotedGasUsd: 0.02,
          requiredGasUsd: 0.07,
          shortfallUsd: 0,
          surplusUsd: 3,
          reasonKey: "k",
        },
      },
      balancesByChain: { [String(ARBITRUM)]: { nativeUsd: 3, tokenUsd: 1_200 } },
    });

    const result = await buildProvisioningGateContext(WALLET, ARBITRUM);

    // Numeric lookup, which is what every consumer does.
    expect(result?.balancesByChain[ARBITRUM]).toEqual({ nativeUsd: 3, tokenUsd: 1_200 });
    expect(result?.gasByChain[ARBITRUM]?.verdict).toBe("OK");
  });

  it("[R3] a degraded read is NO context, so the gate does not fire", async () => {
    apiFetch.mockResolvedValue({ ...CONTEXT, degraded: true, degradedReason: "holdings" });

    expect(await buildProvisioningGateContext(WALLET, ARBITRUM)).toBeNull();
  });

  it.each([
    ["401 no session", 401, "SESSION_MISSING"],
    ["400 bad chain", 400, "VALIDATION_ERROR"],
    ["429 per-wallet quota", 429, "FUNDING_WALLET_RATE_LIMITED"],
    ["429 global throttle", 429, "THROTTLER"],
    ["408 timeout", 408, "SYSTEM_TIMEOUT"],
    ["500 upstream", 500, "SYSTEM_INTERNAL"],
  ])("[R5] fails OPEN on %s, never gating a funded wallet", async (_label, status, code) => {
    apiFetch.mockRejectedValue(new ApiError(status, code, "nope"));

    expect(await buildProvisioningGateContext(WALLET, ARBITRUM)).toBeNull();
  });

  it("[R5] fails open when the response does not match its schema", async () => {
    apiFetch.mockRejectedValue(new ApiParseError("funding/context", []));

    expect(await buildProvisioningGateContext(WALLET, ARBITRUM)).toBeNull();
  });

  it("[R5] fails open on an empty body rather than reading it as an empty wallet", async () => {
    // A consumer that read `balancesByChain: {}` as "this wallet holds nothing" would tell a funded
    // user they have no gas. Absence of an answer is not an answer.
    apiFetch.mockResolvedValue(null);

    expect(await buildProvisioningGateContext(WALLET, ARBITRUM)).toBeNull();
  });

  it("[R5] fails open when the session cookie read throws, before the request is made", async () => {
    // `getAuthHeader()` is awaited as an ARGUMENT, so it must be inside the try. If it ever moves
    // out, this is the test that fails rather than a funded wallet getting gated in production.
    const session = await import("@/lib/auth/session");
    vi.spyOn(session, "getAuthHeader").mockRejectedValueOnce(
      new Error("cookies() outside request"),
    );

    expect(await buildProvisioningGateContext(WALLET, ARBITRUM)).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuses a non-integer target chain instead of smuggling it into the query", async () => {
    // Typed `number`, but it arrives from a `"use server"` argument that Next does not runtime-check.
    apiFetch.mockResolvedValue(CONTEXT);

    expect(
      await buildProvisioningGateContext(WALLET, "137&targetChainId=1" as unknown as number),
    ).toBeNull();
    expect(await buildProvisioningGateContext(WALLET, Number.NaN)).toBeNull();
    expect(await buildProvisioningGateContext(WALLET, 0)).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reports a silently-disabled gate instead of swallowing it", async () => {
    // The catch is deliberately catch-all, so a schema drift or a plain programming error would
    // disable the gate for EVERY user while every request still returns 200 to the browser. The
    // fail-open answer is right; being unable to tell it happened is not.
    apiFetch.mockRejectedValue(new ApiError(500, "SYSTEM_INTERNAL", "boom"));

    await buildProvisioningGateContext(WALLET, ARBITRUM);

    const spy = console.warn as unknown as { mock: { calls: unknown[][] } };
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({
      event: "provisioning.gate_context_unavailable",
      status: 500,
      code: "SYSTEM_INTERNAL",
    });
  });

  /**
   * Contract drift is the one failure this module cannot report usefully: a renamed or retyped
   * backend field fails the schema, fails open, and looks exactly like an outage. The backend lives
   * in another repo, so nothing else in CI would catch it. These run the REAL schema (pulled off the
   * `apiFetch` options, so it stays module-private) against a payload shaped like the merged
   * `FundingContext` contract at pool-party-api `25450aa`.
   */
  describe("servedFundingContextSchema, against the pool-party-api contract", () => {
    /** Every field the backend's `FundingContext` declares, including the optional ones. */
    const SERVED = {
      targetChainId: 42161,
      sources: [
        {
          address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          chainId: 42161,
          symbol: "USDC",
          decimals: 6,
          amount: "1000000000",
          usd: 1000,
          reachableChainIds: [137, 8453, 42161],
          isNative: false,
          logoUrl: "https://example.test/usdc.png",
        },
      ],
      gasByChain: {
        "42161": {
          chainId: 42161,
          verdict: "TOP_UP",
          quotedGasUsd: 0.02,
          requiredGasUsd: 0.075,
          shortfallUsd: 0.055,
          surplusUsd: 0,
          reasonKey: "provisioning.gasVerdict.topUp",
          topUp: {
            token: {
              symbol: "USDC",
              address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
              decimals: 6,
              balanceRaw: "1000000000",
              balanceUsd: 1000,
            },
            amountRaw: "60000",
            amountUsd: 0.06,
            buyNativeUsd: 0.055,
          },
        },
        "8453": {
          chainId: 8453,
          verdict: "BLOCKED",
          quotedGasUsd: 0.01,
          requiredGasUsd: 0.06,
          shortfallUsd: 0.06,
          surplusUsd: 0,
          reasonKey: "provisioning.gasVerdict.noNative",
          escapes: [
            {
              kind: "bridge-native",
              labelKey: "provisioning.gasVerdict.escape.bridgeNative",
              fromChainIds: [42161],
            },
            { kind: "buy-crypto", labelKey: "provisioning.gasVerdict.escape.buyCrypto" },
          ],
        },
      },
      balancesByChain: { "42161": { nativeUsd: 0.02, tokenUsd: 1000 } },
      nativeHoldings: [
        {
          address: "0x0000000000000000000000000000000000000000",
          chainId: 42161,
          symbol: "ETH",
          decimals: 18,
          amount: "10000000000000",
          usd: 0.02,
          reachableChainIds: [],
          isNative: true,
          logoUrl: "https://example.test/eth.png",
        },
      ],
      gasEstimateUsd: 0.075,
      degraded: false,
    } as const;

    /** The schema this module actually hands to `apiFetch`, never re-declared here. */
    async function servedSchema() {
      apiFetch.mockResolvedValue(null);
      await buildProvisioningGateContext(WALLET, ARBITRUM);
      const [, options] = apiFetch.mock.calls[0] as [
        string,
        { schema: { safeParse(v: unknown): { success: boolean } } },
      ];
      return options.schema;
    }

    it("accepts a full served payload, optional topUp/escapes and all", async () => {
      expect((await servedSchema()).safeParse(SERVED).success).toBe(true);
    });

    it("accepts the degraded payload the backend returns as a 200", async () => {
      const degraded = {
        targetChainId: 42161,
        sources: [],
        gasByChain: {},
        balancesByChain: {},
        nativeHoldings: [],
        gasEstimateUsd: 0,
        degraded: true,
        degradedReason: "FUNDING_CONTEXT_HOLDINGS_UNAVAILABLE",
      };

      expect((await servedSchema()).safeParse(degraded).success).toBe(true);
    });

    it("tolerates a field the backend adds later, so an additive change cannot fail closed", async () => {
      expect((await servedSchema()).safeParse({ ...SERVED, somethingNew: 1 }).success).toBe(true);
    });

    it.each([
      ["gasEstimateUsd arrives as a string", { gasEstimateUsd: "0.075" }],
      [
        "a gas verdict is not one of the three",
        { gasByChain: { "42161": { ...SERVED.gasByChain["42161"], verdict: "MAYBE" } } },
      ],
      [
        "requiredGasUsd is missing",
        { gasByChain: { "42161": { ...SERVED.gasByChain["42161"], requiredGasUsd: undefined } } },
      ],
      [
        "a source amount arrives as a number",
        { sources: [{ ...SERVED.sources[0], amount: 1000 }] },
      ],
      ["degraded is missing entirely", { degraded: undefined }],
    ])("rejects drift: %s", async (_label, override) => {
      expect((await servedSchema()).safeParse({ ...SERVED, ...override }).success).toBe(false);
    });
  });
});
