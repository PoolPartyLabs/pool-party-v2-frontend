/**
 * @id PP-CORE-LIB-108 (POO-1805) - tests
 * @name on-ramp coverage probe - tests
 * @implements-rules-version v2 (POO-1805 rules v2)
 * @analytics-events none, the probe answers a question and renders nothing.
 *
 * [R1] is the rule everything here defends: a FAILED call is not "no coverage". The SDK's own flow
 * swallows every failure into an empty quote list, so a rail outage and a country nobody sells to
 * look identical from the outside. This module refuses to conflate them, which is why `unknown` is a
 * first-class result and not an error.
 *
 * Rules v2 sharpens that: an empty list is not one observation but THREE. The vendor's own reading,
 * `ul` in `@privy-io/react-auth@3.40.0` `dist/esm/index-rkoxGjIC.mjs`, is
 * `(e,t)=>e.length>0?null:3>parseFloat(t)?"amount_too_low":"provider_errors"` - so even Privy does
 * not read its own empty list as "nobody sells". `uncovered` needs a valid response, no
 * `provider_errors`, AND an amount at or above the rail's display floor.
 *
 * [R4] The request shape is pinned by a contract test against the bundle-derived facts. Re-read
 * `@privy-io/routes@0.2.12` `dist/esm/index.mjs` (the `GetFiatOnrampQuotes` route) and
 * `@privy-io/js-sdk-core@0.73.0` `dist/esm/index.mjs` (the header block) if Privy moves the route.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CoverageProbeDeps,
  type CoverageProbeInput,
  PRIVY_CLIENT_HEADER,
  PRIVY_QUOTE_FLOOR,
  PRIVY_QUOTES_PATH,
  probeOnRampCoverage,
  REQUEST_TIMEOUT_MS,
  RETRY_DELAY_MS,
  THROTTLE_RETRY_DELAY_MS,
  THROTTLE_RETRY_MAX_MS,
} from "./coverageProbe";

/** One quote as `FiatOnrampQuote` declares it (api-types@0.20.0 `resources/onramps.d.ts:166`). */
const QUOTE = {
  payment_method: "card",
  provider: "stripe",
  destination_currency_code: "USDC",
  payment_method_category: "card",
  source_amount: 100,
  source_currency_code: "BRL",
  sub_provider: null,
  warning: null,
};

/** One `FiatOnrampProviderError` (`onramps.d.ts:152-159`): a provider that failed to quote. */
const PROVIDER_ERROR = { error: "provider unavailable", provider: "moonpay" };

/** A full body as `GetFiatOnrampQuotesResponse` declares it (`onramps.d.ts:243-249`). */
function body(quotes: unknown[], providerErrors?: unknown[]) {
  return {
    destination_currency_icon_url: null,
    destination_currency_symbol: "USDC",
    destination_network_icon_url: null,
    quotes,
    ...(providerErrors ? { provider_errors: providerErrors } : {}),
  };
}

function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

const INPUT: CoverageProbeInput = {
  fiat: "brl",
  amount: "100",
  destination: {
    chain: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    address: "0x1111111111111111111111111111111111111111",
  },
  environment: "sandbox",
};

let fetchMock: ReturnType<typeof vi.fn>;
let sleepMock: ReturnType<typeof vi.fn>;
let deps: CoverageProbeDeps;

beforeEach(() => {
  fetchMock = vi.fn();
  // No real waiting in tests; the delay is asserted by the ms this was CALLED with, not by a clock.
  sleepMock = vi.fn(async () => {});
  deps = {
    fetch: fetchMock as unknown as typeof fetch,
    getAccessToken: async () => "test-access-token",
    appId: "app-123",
    clientId: "client-456",
    sleep: sleepMock as unknown as (ms: number) => Promise<void>,
  };
});

describe("probeOnRampCoverage", () => {
  // @rule R1
  it("[R1] an empty list is uncovered only with a valid body, no provider errors and enough money", async () => {
    fetchMock.mockResolvedValueOnce(ok(body([])));
    await expect(probeOnRampCoverage(deps, INPUT)).resolves.toEqual({ status: "uncovered" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("a non-empty list is coverage, and the methods ride back", async () => {
    // The quotes response IS the per-country method list: one quote is one selectable method.
    fetchMock.mockResolvedValueOnce(ok(body([QUOTE, { ...QUOTE, payment_method: "pix" }])));
    const result = await probeOnRampCoverage(deps, INPUT);
    expect(result.status).toBe("covered");
    expect(result.status === "covered" && result.methods.map((m) => m.payment_method)).toEqual([
      "card",
      "pix",
    ]);
  });

  // @rule R1
  it("[R1] an empty list WITH provider_errors is unknown, never uncovered", async () => {
    // The rails were asked and could not answer. Privy's own reading of this pair is the
    // `provider_errors` warning (`ul`, react-auth@3.40.0 `index-rkoxGjIC.mjs`), not "no coverage",
    // and calling it `uncovered` would tell a buyer in a covered country that nobody sells to them
    // because one provider had a bad minute.
    fetchMock.mockResolvedValueOnce(ok(body([], [PROVIDER_ERROR])));
    await expect(probeOnRampCoverage(deps, INPUT)).resolves.toEqual({
      status: "unknown",
      reason: "upstream",
    });
  });

  // @rule R1
  it("[R1] an empty provider_errors array does not turn a real empty list into unknown", async () => {
    fetchMock.mockResolvedValueOnce(ok(body([], [])));
    await expect(probeOnRampCoverage(deps, INPUT)).resolves.toEqual({ status: "uncovered" });
  });

  // @rule R1
  it("[R1] a below-floor amount is its own answer, never uncovered", async () => {
    // `3>parseFloat(t)?"amount_too_low":"provider_errors"`: below the rail's display floor NOBODY
    // quotes, in any country, so the empty list says nothing about coverage at all. Answering
    // `uncovered` here would hide the whole rail from a buyer who only typed a small number.
    fetchMock.mockResolvedValueOnce(ok(body([])));
    await expect(probeOnRampCoverage(deps, { ...INPUT, amount: "2" })).resolves.toEqual({
      status: "amount-too-low",
      railFloor: PRIVY_QUOTE_FLOOR,
    });
  });

  // @rule R1
  it("[R1] the floor is read exactly as the vendor reads it, so 3 itself is not too low", async () => {
    // `3 > parseFloat(t)` is a STRICT comparison: 3 is at the floor, not below it.
    fetchMock.mockResolvedValueOnce(ok(body([])));
    await expect(probeOnRampCoverage(deps, { ...INPUT, amount: "3" })).resolves.toEqual({
      status: "uncovered",
    });
  });

  // @rule R1
  it("[R1] below the floor wins over provider errors, matching the vendor's own order", async () => {
    fetchMock.mockResolvedValueOnce(ok(body([], [PROVIDER_ERROR])));
    await expect(probeOnRampCoverage(deps, { ...INPUT, amount: "1" })).resolves.toEqual({
      status: "amount-too-low",
      railFloor: PRIVY_QUOTE_FLOOR,
    });
  });

  // @rule R1
  it("[R1] a non-empty list is covered even when some providers failed", async () => {
    // Someone will sell, which is the whole question. `ul` returns no warning at all here.
    fetchMock.mockResolvedValueOnce(ok(body([QUOTE], [PROVIDER_ERROR])));
    const result = await probeOnRampCoverage(deps, INPUT);
    expect(result.status).toBe("covered");
  });

  // @rule R1
  it("[R1] retries a 5xx exactly once, then answers unknown rather than uncovered", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    const result = await probeOnRampCoverage(deps, INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: "unknown", reason: "upstream", httpStatus: 500 });
  });

  // @rule R1
  it("[R1] retries a network error exactly once, then answers unknown", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await probeOnRampCoverage(deps, INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: "unknown", reason: "network" });
  });

  // @rule R2
  it("[R2] retries a 429, which Privy's own retry list deliberately excludes", async () => {
    // `@privy-io/js-sdk-core@0.73.0` retries on `[408,409,425,500,502,503,504]` and NOT on 429,
    // which is right for a client that would otherwise amplify a throttle across every open tab.
    // It is wrong HERE: this probe fires once per buyer decision, and treating a throttle as an
    // answer would tell a buyer in a covered country that nobody sells to them.
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(ok(body([QUOTE])));
    const result = await probeOnRampCoverage(deps, INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("covered");
  });

  // @rule R2
  it("[R2] a throttle waits longer than a 5xx, and honours Retry-After when it is sent", async () => {
    // A throttle is the one failure where retrying too soon is worse than not retrying: it earns a
    // second refusal and doubles the load that caused the first. The server's own number wins when
    // it sends one, clamped so a large or hostile value cannot park a buyer's screen.
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(ok(body([QUOTE])));
    await probeOnRampCoverage(deps, INPUT);
    expect(sleepMock).toHaveBeenCalledWith(2_000);
    expect(THROTTLE_RETRY_DELAY_MS).toBeGreaterThan(RETRY_DELAY_MS);
  });

  // @rule R2
  it("[R2] clamps an oversized Retry-After rather than parking the screen on it", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "600" } }))
      .mockResolvedValueOnce(ok(body([QUOTE])));
    await probeOnRampCoverage(deps, INPUT);
    expect(sleepMock).toHaveBeenCalledWith(THROTTLE_RETRY_MAX_MS);
  });

  // @rule R2
  it("[R2] falls back to its own throttle delay for an HTTP-date or missing Retry-After", async () => {
    // RFC 9110 allows a date form. Turning one into a wait means trusting the buyer's clock against
    // the server's, and a skew there is worse than our own fixed number.
    fetchMock
      .mockResolvedValueOnce(
        new Response("", {
          status: 429,
          headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
        }),
      )
      .mockResolvedValueOnce(ok(body([QUOTE])));
    await probeOnRampCoverage(deps, INPUT);
    expect(sleepMock).toHaveBeenCalledWith(THROTTLE_RETRY_DELAY_MS);
  });

  // @rule R1
  it("[R1] a 5xx waits the short delay, not the throttle one", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    await probeOnRampCoverage(deps, INPUT);
    expect(sleepMock).toHaveBeenCalledWith(RETRY_DELAY_MS);
  });

  // @rule R1
  it("[R1] a retry that succeeds with an empty list still means uncovered", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(ok(body([])));
    await expect(probeOnRampCoverage(deps, INPUT)).resolves.toEqual({ status: "uncovered" });
  });

  // @rule R1
  it("[R1] retries at most once, never a storm", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await probeOnRampCoverage(deps, INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // @rule R1
  it("[R1] a malformed body is contract-drift, never uncovered", async () => {
    // Mirrors `describePairsFailure` in `resolveOnRampCurrency.ts`: drift means ship a fix, upstream
    // means wait. Answering `uncovered` here would bill a whole country in the fallback currency on
    // the strength of a schema change.
    fetchMock.mockResolvedValueOnce(ok({ quotes: "not-an-array" }));
    await expect(probeOnRampCoverage(deps, INPUT)).resolves.toEqual({
      status: "unknown",
      reason: "contract-drift",
    });
  });

  it("a body that is not JSON at all is contract-drift", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>nope</html>", { status: 200 }));
    await expect(probeOnRampCoverage(deps, INPUT)).resolves.toEqual({
      status: "unknown",
      reason: "contract-drift",
      httpStatus: 200,
    });
  });

  it("does not retry a body that parsed but drifted", async () => {
    // Drift is deterministic: asking twice cannot change a schema.
    fetchMock.mockResolvedValue(ok({ quotes: "not-an-array" }));
    await probeOnRampCoverage(deps, INPUT);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("a provider error whose fields moved does not break the read", async () => {
    // `provider_errors` is parsed loosely on purpose: the vendor adds and renames fields on this
    // object without a major, and a strict schema would turn an addition into `contract-drift` on
    // the one call that decides whether a buyer sees a purchase at all.
    fetchMock.mockResolvedValueOnce(ok(body([], [{ reason: "renamed", provider: "meld" }])));
    await expect(probeOnRampCoverage(deps, INPUT)).resolves.toEqual({
      status: "unknown",
      reason: "upstream",
    });
  });

  // @rule R1
  it("[R1] a missing access token is unknown, never uncovered", async () => {
    deps.getAccessToken = async () => null;
    const result = await probeOnRampCoverage(deps, INPUT);
    expect(result).toEqual({ status: "unknown", reason: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // @rule R1
  it("[R1] a token getter that THROWS is unknown, not a crash and not uncovered", async () => {
    // Not theoretical: measured against the installed `@privy-io/react-auth@3.29.2`, `usePrivy()`
    // outside a `PrivyProvider` hands back a `getAccessToken` that rejects with "You need to wrap
    // your application with the <PrivyProvider>...". Without this catch that failure escapes a
    // callback every caller treats as total.
    deps.getAccessToken = () => {
      throw new Error("Privy: usePrivy must be used within a PrivyProvider");
    };
    const result = await probeOnRampCoverage(deps, INPUT);
    expect(result).toEqual({ status: "unknown", reason: "token-failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // @rule R1
  it("[R1] a token getter that REJECTS is token-failed, distinct from an absent token", async () => {
    // The distinction is the point: `unauthenticated` means nobody is signed in, `token-failed`
    // means the session refresh broke. One is a screen, the other is a page in Sentry.
    deps.getAccessToken = async () => {
      throw new Error("refresh failed");
    };
    await expect(probeOnRampCoverage(deps, INPUT)).resolves.toEqual({
      status: "unknown",
      reason: "token-failed",
    });
  });

  // @rule R1
  it.each([401, 403])("[R1] a %i is unauthenticated and is not retried", async (status) => {
    // A rejected token does not become accepted by asking again, and reporting it as `upstream`
    // would put a signed-out buyer in the same bucket as a rail outage.
    fetchMock.mockResolvedValue(new Response("", { status }));
    const result = await probeOnRampCoverage(deps, INPUT);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "unknown", reason: "unauthenticated", httpStatus: status });
  });

  // @rule R4
  it("[R4] sends the request shape the bundle says Privy expects", async () => {
    // CONTRACT TEST. Every value here was read out of a shipped file, never a guide:
    //   route  `@privy-io/routes@0.2.12` dist/esm/index.mjs: {path:"/api/v1/onramp/fiat/quotes",method:"PUT"}
    //   base   `@privy-io/js-sdk-core@0.73.0` dist/esm/index.mjs: baseUrl ?? "https://auth.privy.io"
    //   heads  same file, the header block: privy-app-id, privy-client-id, privy-client,
    //          Authorization: Bearer, Content-Type, Accept
    //   body   `@privy-io/react-auth@3.40.0` dist/esm/index-rkoxGjIC.mjs (the getQuotes call site):
    //          {source:{asset,amount},destination:{asset,chain,address},environment}
    // If Privy moves the route, re-read those three files rather than guessing from this test.
    fetchMock.mockResolvedValueOnce(ok(body([QUOTE])));
    await probeOnRampCoverage(deps, INPUT);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://auth.privy.io${PRIVY_QUOTES_PATH}`);
    expect(init.method).toBe("PUT");
    const headers = new Headers(init.headers);
    expect(headers.get("privy-app-id")).toBe("app-123");
    expect(headers.get("privy-client-id")).toBe("client-456");
    expect(headers.get("privy-client")).toBe(PRIVY_CLIENT_HEADER);
    expect(headers.get("authorization")).toBe("Bearer test-access-token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      source: { asset: "BRL", amount: "100" },
      destination: {
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        chain: "eip155:8453",
        address: "0x1111111111111111111111111111111111111111",
      },
      environment: "sandbox",
    });
  });

  // @rule R4
  it("[R4] the privy-client value keeps the SDK's shape and does not impersonate it", async () => {
    // `n.set("privy-client", this._sdkVersion)`, set UNCONDITIONALLY on every request
    // (js-sdk-core@0.73.0 `_beforeRequestWithoutInitialize`), where `_sdkVersion` is
    // `"react-auth:3.40.0"` for this SDK and `"js-sdk-core:0.73.0"` bare. Same `<client>:<version>`
    // shape, our own name: this request is ours, not the SDK's.
    expect(PRIVY_CLIENT_HEADER).toMatch(/^[a-z0-9-]+:[0-9]+$/);
    expect(PRIVY_CLIENT_HEADER).not.toMatch(/^(react-auth|js-sdk-core):/);
  });

  // @rule R4
  it("[R4] carries a fresh 20s abort signal on EVERY attempt", async () => {
    // The SDK aborts at 20s (`signal:er(2e4)`, js-sdk-core@0.73.0). A signal built once and reused
    // would already be aborted by the time the retry runs, which aborts the retry instantly and
    // turns "one more try" into a second `network` for free.
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(ok(body([QUOTE])));
    await probeOnRampCoverage(deps, INPUT);

    const first = (fetchMock.mock.calls[0] as [string, RequestInit])[1].signal;
    const second = (fetchMock.mock.calls[1] as [string, RequestInit])[1].signal;
    expect(first).toBeInstanceOf(AbortSignal);
    expect(second).toBeInstanceOf(AbortSignal);
    expect(second).not.toBe(first);
    expect(REQUEST_TIMEOUT_MS).toBe(20_000);
  });

  // @rule R4
  it("[R4] uppercases the fiat code, because the request field is not the config field", async () => {
    // The trap this test exists for. `SupportedFiatCurrency` (the fund() config union POO-1801
    // copies) is LOWERCASE, but the QUOTES request's `source.asset` is documented as "ISO 4217 fiat
    // currency code. Three uppercase ASCII letters." (api-types@0.20.0 onramps.d.ts:121-123, used at
    // :190), and the SDK's own call site uppercases it (`selectedAsset.toUpperCase()`). Two fields,
    // two casings, one `string` type on both, so nothing would have caught this at compile time.
    fetchMock.mockResolvedValueOnce(ok(body([QUOTE])));
    await probeOnRampCoverage(deps, { ...INPUT, fiat: "brl" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).source.asset).toBe("BRL");
  });

  // @rule R4
  it("[R4] omits privy-client-id when the app does not set one", async () => {
    // The SDK sets it conditionally (`this.appClientId && n.set(...)`), so sending an empty header
    // would be a shape this app invented.
    deps.clientId = undefined;
    fetchMock.mockResolvedValueOnce(ok(body([QUOTE])));
    await probeOnRampCoverage(deps, INPUT);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("privy-client-id")).toBe(false);
  });

  // @rule R3
  it("[R3] never resolves a currency of its own", async () => {
    // The server chain (CloudFront -> profile -> USD) stays the producer. This module takes the
    // fiat code it is given and asks; it has no country table and no default.
    const source = readFileSync(join(__dirname, "coverageProbe.ts"), "utf8");
    expect(source).not.toMatch(/COUNTRY|resolveBuyerCurrency|FALLBACK_CURRENCY/);
  });
});
