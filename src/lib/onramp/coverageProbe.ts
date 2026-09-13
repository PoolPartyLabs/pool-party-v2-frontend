/**
 * @id PP-CORE-LIB-108 (POO-1805)
 * @name on-ramp coverage probe
 * @implements-rules-version v2 (POO-1805 rules v2)
 * @analytics-events none, the probe answers a question for its caller and renders nothing; the
 *   funnel events belong to the surface that acts on the answer.
 *
 * We ASK whether anyone will sell, instead of guessing from a table.
 *
 * The quotes response IS the per-country payment-method list: one quote is one selectable method.
 * The route takes exactly three fields and has nowhere to put a country, so coverage is not a
 * lookup we can do offline, it is a question with an answer that changes without a release. Every
 * country table we have ever shipped for this has been wrong within a quarter.
 *
 * ## The request, traced out of the shipped bundles rather than a guide
 *
 * | Fact          | Value                                                          | Where it was read |
 * |---------------|----------------------------------------------------------------|-------------------|
 * | base URL      | `https://auth.privy.io`                                        | `@privy-io/js-sdk-core@0.73.0` `dist/esm/index.mjs`, `this.baseUrl=e.baseUrl??` (offset ~60449) |
 * | path + method | `PUT /api/v1/onramp/fiat/quotes`                               | `@privy-io/routes@0.2.12` `dist/esm/index.mjs`, the object exported as `GetFiatOnrampQuotes` |
 * | call chain    | `getQuotes` to `fetchPrivyRoute(GetFiatOnrampQuotes,{body})` to `_privyInternal.fetch` | `@privy-io/react-auth@3.40.0` `dist/esm/index-rkoxGjIC.mjs` offsets 397601 (call), 399028 (`h`), 3229 (the import aliasing `GetFiatOnrampQuotes`); js-sdk-core offset ~94418 |
 * | headers       | `privy-app-id`, `privy-client-id` (only when the app sets one), `privy-client` (SDK version), `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept: application/json`, `privy-ca-id` (client analytics id), `x-native-app-identifier` (native only) | js-sdk-core, the header block at offset ~62900 |
 * | timeout       | 20s per attempt, `{signal:er(2e4)}` where `er=e=>{let t=new AbortController;setTimeout(()=>t.abort(),e);return t.signal}` | js-sdk-core, same header block |
 * | body          | `{source:{asset,amount},destination:{asset,chain,address},environment}` | react-auth, the `getQuotes` call site |
 * | `source.asset`| ISO 4217, **three UPPERCASE letters**                          | `@privy-io/api-types@0.20.0` `resources/onramps.d.ts:121-123` and `:190`; the SDK uppercases at the call site |
 * | `destination.chain` | CAIP-2 (`eip155:8453`)                                   | `onramps.d.ts:139-143` |
 * | `environment` | `'sandbox' \| 'production'`                                    | `onramps.d.ts:148` |
 * | response      | `{destination_currency_symbol, destination_currency_icon_url, destination_network_icon_url, quotes[], provider_errors?}` | `onramps.d.ts:243-249` |
 * | one quote     | `{payment_method, provider, destination_currency_code?, payment_method_category?, source_amount?, source_currency_code?, sub_provider?, warning?}` | `onramps.d.ts:166-178` |
 * | one provider error | `{error, provider}`                                       | `onramps.d.ts:152-159` |
 *
 * Two of those are traps rather than details. The CASING: `SupportedFiatCurrency`, the union
 * POO-1801 copies, is lowercase, but this request's `source.asset` is uppercase, both typed
 * `string`, so nothing would fail to compile. And the METHOD is `PUT`, not the `POST` a reader
 * assumes for a call that sends a body.
 *
 * ## Why this uses `fetch` and not Privy's client ([R1])
 *
 * The SDK's own flow swallows every failure: its `getQuotes` caller catches and sets
 * `localQuotes: []` (react-auth, just after the call site), so a rail outage and a country nobody
 * sells to are the SAME observation. Going through `fetch` directly is what lets us see the status
 * code and tell them apart, and telling them apart is the entire point of the module: a failed call
 * is NOT "no coverage".
 *
 * The retry is ours for the same reason ([R2]). `js-sdk-core` retries on `[408,409,425,500,502,503,504]`
 * and deliberately NOT on 429, which is correct for a client whose global error handler would
 * otherwise amplify a throttle across every open tab. It is wrong here: this probe fires once per
 * buyer decision, and treating a throttle as an answer would tell a buyer in a covered country that
 * nobody will sell to them. So 429 is retried, exactly once, and a second failure is `unknown`.
 *
 * ## An empty quote list is THREE observations, not one (rules v2 [R1])
 *
 * Rules v1 read `quotes.length === 0` as `uncovered`, and that is wrong on the vendor's own
 * evidence. `@privy-io/react-auth@3.40.0` `dist/esm/index-rkoxGjIC.mjs` reads its own empty list as
 *
 *     ul = (e,t) => e.length>0 ? null : 3>parseFloat(t) ? "amount_too_low" : "provider_errors"
 *
 * (`e` the quotes, `t` the source amount, called as `ul(n,e)` at both quote sites). So even Privy
 * does not treat an empty list as "nobody sells": below its display floor NOBODY quotes in ANY
 * country, and an empty list arriving next to `provider_errors` means the rails were asked and could
 * not answer. `uncovered` therefore needs all three of a valid body, no `provider_errors`, and an
 * amount at or above the floor. See {@link readCoverage}, which is that expression in our vocabulary.
 *
 * ## Owed before a host adopts this
 *
 * ONE live sandbox call. Every fact above is read from a shipped bundle, which pins the shape we
 * send but proves nothing about what the server ACCEPTS from a caller that is not the SDK: whether
 * `privy-client` is validated, whether `privy-ca-id` is required, whether the floor is really
 * currency-blind. The probe is written to fail into `unknown` rather than `uncovered` in every one
 * of those cases, so a wrong guess costs a missing answer and never a hidden rail, but the call is
 * still owed and POO-1807 / POO-1808 must not ship the adoption without it.
 *
 * PP-INTEGRATION-POINT: coverage question to Privy, `PUT https://auth.privy.io/api/v1/onramp/fiat/quotes`
 * with the buyer's own access token. No new dependency: `getAccessToken()` is public, the ids are
 * already wired in `providers.tsx`, and CSP already allows `https://*.privy.io`.
 */
import { z } from "zod";

/**
 * `FiatOnrampQuote`, COPIED from `@privy-io/api-types@0.20.0` `resources/onramps.d.ts:166-178`
 * rather than imported: this branch builds against 3.29.2, where the type does not exist.
 *
 * Only `payment_method` and `provider` are required, exactly as the declaration has them, and
 * unknown keys pass through: the vendor adds fields to this object without a major, and a strict
 * schema would turn an addition into an outage on the one call that decides whether a buyer sees a
 * purchase at all.
 */
export const onRampQuoteSchema = z
  .object({
    payment_method: z.string(),
    provider: z.string(),
    destination_currency_code: z.string().nullish(),
    payment_method_category: z.string().optional(),
    source_amount: z.number().nullish(),
    source_currency_code: z.string().nullish(),
    sub_provider: z.string().nullish(),
    warning: z.string().nullish(),
  })
  .passthrough();

export type OnRampQuote = z.infer<typeof onRampQuoteSchema>;

/**
 * `FiatOnrampProviderError` (`onramps.d.ts:152-159`: `{error: string, provider: FiatOnrampProvider}`).
 *
 * Both fields are OPTIONAL here while the declaration has them required, and that is deliberate:
 * this module only ever asks whether the array is non-EMPTY, so a renamed field must not fail the
 * parse of a body whose `quotes` are perfectly readable. Requiring them would convert a vendor
 * rename into `contract-drift` for every buyer, including the covered ones.
 */
export const onRampProviderErrorSchema = z
  .object({ error: z.string().optional(), provider: z.string().optional() })
  .passthrough();

/**
 * `GetFiatOnrampQuotesResponse` (`onramps.d.ts:243-249`). Two fields are read: `quotes`, and
 * `provider_errors`, which rules v2 [R1] needs to tell "nobody sells here" from "nobody answered".
 * The icon and symbol fields are presentation the caller does not need to answer "will anyone sell".
 */
export const onRampQuotesResponseSchema = z
  .object({
    quotes: z.array(onRampQuoteSchema),
    provider_errors: z.array(onRampProviderErrorSchema).nullish(),
  })
  .passthrough();

export type OnRampQuotesResponse = z.infer<typeof onRampQuotesResponseSchema>;

/** Why an answer could not be established. Mirrors `describePairsFailure`'s classes, plus ours. */
export type CoverageUnknownReason =
  /** The response did not match the schema. Ship a fix; asking again cannot change it. */
  | "contract-drift"
  /** The API answered, badly (5xx, a throttle that survived the retry, providers that all failed). */
  | "upstream"
  /** The request never got an answer: offline, DNS, CORS, an aborted connection. */
  | "network"
  /** No access token, or one the rail rejected (401/403), so the question was never answered. */
  | "unauthenticated"
  /**
   * Asking for the token THREW or REJECTED. Distinct from `unauthenticated` on purpose: nobody
   * being signed in is a screen, a session refresh breaking is a page in Sentry. Not defensive
   * padding: measured against the installed `@privy-io/react-auth@3.29.2`, `usePrivy()` outside a
   * `PrivyProvider` hands back a `getAccessToken` that REJECTS with `Error("You need to wrap your
   * application with the <PrivyProvider> initialized with your app id.")`.
   */
  | "token-failed"
  /** Mock mode: there is no rail to ask, and inventing an answer would be a fabricated one. */
  | "mock-mode";

/**
 * Covered, uncovered, too small, or unknown, and `unknown` is a first-class answer rather than an
 * error: the caller must be able to say "we could not find out" without saying "nobody sells to you".
 */
export type CoverageResult =
  | { status: "covered"; methods: OnRampQuote[] }
  | { status: "uncovered" }
  /**
   * Below the rail's own display floor, where no provider quotes in ANY country. This is NOT
   * `uncovered`: the buyer typed a small number, and the fix is a bigger one rather than a hidden
   * rail. `railFloor` is the RAIL's threshold and is named as the rail's, never as ours.
   */
  | { status: "amount-too-low"; railFloor: number }
  /** `httpStatus` when there was one to read, for the report; never a body and never a token. */
  | { status: "unknown"; reason: CoverageUnknownReason; httpStatus?: number };

/** Everything the probe touches from outside itself, injected so the module stays pure. */
export interface CoverageProbeDeps {
  fetch: typeof fetch;
  /** `usePrivy().getAccessToken`, bound by the hook twin. May throw; [R1] catches it. */
  getAccessToken: () => Promise<string | null>;
  appId: string;
  /** Only sent when the app sets one, matching the SDK's own conditional header. */
  clientId?: string;
  /**
   * The wait between the two attempts. Injected rather than read from a clock because the probe has
   * no time-dependent BEHAVIOUR, only a delay, and a test that waited real seconds to prove a retry
   * count would be slow for no added truth.
   */
  sleep?: (ms: number) => Promise<void>;
  /** Overridable for a test or a Privy staging host; defaults to the SDK's own base. */
  baseUrl?: string;
}

export interface CoverageProbeInput {
  /**
   * The buyer's fiat code as POO-1801's `toPrivyFiat` produces it (lowercase). [R3]: this module
   * never resolves a currency, it is TOLD one. The server chain (CloudFront, then profile, then
   * USD) stays the producer, and it stays server-side.
   */
  fiat: string;
  /** A positive decimal amount as a string, per `FiatAmount` (`onramps.d.ts:119`). */
  amount: string;
  destination: { chain: string; asset: string; address: string };
  /** From `resolveOnRampEnvironment()` (PP-CORE-LIB-105), never an env var of its own. */
  environment: "production" | "sandbox";
}

/** The SDK's default base, and the only host this module talks to. */
const PRIVY_BASE_URL = "https://auth.privy.io";

/** `GetFiatOnrampQuotes` (`@privy-io/routes@0.2.12`). Exported so the contract test names it once. */
export const PRIVY_QUOTES_PATH = "/api/v1/onramp/fiat/quotes";

/**
 * `privy-client`, which the SDK sets UNCONDITIONALLY on every request
 * (`n.set("privy-client", this._sdkVersion)`, js-sdk-core@0.73.0 `_beforeRequestWithoutInitialize`)
 * unlike `privy-client-id`, which it guards. `_sdkVersion` is `"js-sdk-core:0.73.0"` bare and
 * `"react-auth:3.40.0"` when react-auth constructs the client, and the constructor accepts any
 * caller-supplied `sdkVersion` (`this._sdkVersion = e.sdkVersion ?? this._sdkVersion`), so the
 * server tolerates a range of values by construction.
 *
 * Same `<client>:<version>` shape, OUR OWN name, for two reasons: this request is ours and not the
 * SDK's, so claiming to be react-auth would misattribute it in Privy's own telemetry; and
 * `@privy-io/react-auth` is a caret range in `package.json`, so any version string pinned here
 * would silently drift from the SDK actually shipped on the next bump.
 */
export const PRIVY_CLIENT_HEADER = "pool-party-coverage-probe:1";

/**
 * The rail's own display floor, in SOURCE-CURRENCY units, read from the vendor's `ul`
 * (`3>parseFloat(t)`). Applied currency-blind by Privy: 3 is 3 whether the buyer types BRL, JPY or
 * USD, which is one of the things the owed live sandbox call should confirm. Below it the empty
 * list says nothing about coverage, so it never becomes `uncovered`.
 */
export const PRIVY_QUOTE_FLOOR = 3;

/** Per attempt, matching the SDK's own `signal:er(2e4)`. Fresh each time, never reused. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Between the two attempts, for a fault. One wait, not a ladder: there is only ever one retry. */
export const RETRY_DELAY_MS = 500;

/**
 * Between the two attempts, for a THROTTLE with no `Retry-After`. Longer than {@link RETRY_DELAY_MS}
 * because a throttle is the one failure where retrying too soon is worse than not retrying at all:
 * it earns a second refusal and adds to the load that caused the first.
 */
export const THROTTLE_RETRY_DELAY_MS = 2_000;

/** The clamp on a server-sent `Retry-After`, so a large or hostile value cannot park a screen. */
export const THROTTLE_RETRY_MAX_MS = 5_000;

/**
 * Statuses worth exactly one more try. 429 is here ON PURPOSE ([R2]); see the header. 401 and 403
 * deliberately are not: a rejected token does not become accepted by asking again.
 */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** What one attempt produced: a parsed body, a retryable failure, or a terminal one. */
type Attempt =
  | { kind: "body"; value: unknown; httpStatus: number }
  | { kind: "retryable"; reason: CoverageUnknownReason; httpStatus?: number; delayMs: number }
  | { kind: "terminal"; reason: CoverageUnknownReason; httpStatus?: number };

/**
 * How long to wait before retrying a throttle. The server's own number when it sends a usable one,
 * clamped; ours otherwise.
 *
 * RFC 9110 also allows an HTTP-date, which is deliberately NOT honoured: turning one into a wait
 * means trusting the buyer's clock against the server's, and a skew there is worse than a fixed
 * number. `Number.parseInt` yields `NaN` for a date, which falls through to the same default.
 */
export function throttleDelayMs(retryAfter: string | null): number {
  const seconds = Number.parseInt((retryAfter ?? "").trim(), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return THROTTLE_RETRY_DELAY_MS;
  return Math.min(seconds * 1_000, THROTTLE_RETRY_MAX_MS);
}

async function attempt(deps: CoverageProbeDeps, url: string, init: RequestInit): Promise<Attempt> {
  let response: Response;
  try {
    // A FRESH signal per attempt. One built alongside `init` and reused would already be aborted by
    // the time the retry runs, aborting it instantly and turning "one more try" into a free second
    // failure.
    response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    // No status to read: offline, DNS, CORS, an aborted connection, our own 20s timeout. Worth one
    // more try.
    return { kind: "retryable", reason: "network", delayMs: RETRY_DELAY_MS };
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      // The rail rejected the buyer's token. Same class as having none: the question was never
      // answered, and it is not the rail being down.
      return { kind: "terminal", reason: "unauthenticated", httpStatus: response.status };
    }
    if (!RETRYABLE_STATUS.has(response.status)) {
      return { kind: "terminal", reason: "upstream", httpStatus: response.status };
    }
    return {
      kind: "retryable",
      reason: "upstream",
      httpStatus: response.status,
      delayMs:
        response.status === 429
          ? throttleDelayMs(response.headers.get("retry-after"))
          : RETRY_DELAY_MS,
    };
  }
  try {
    return { kind: "body", value: await response.json(), httpStatus: response.status };
  } catch {
    // A 200 that is not JSON is the contract breaking, not the rail failing. Asking again cannot
    // change it, so it does not consume the retry.
    return { kind: "terminal", reason: "contract-drift", httpStatus: response.status };
  }
}

/**
 * The vendor's own reading of a quotes response, in our vocabulary ([R1], rules v2).
 *
 * `ul = (e,t) => e.length>0 ? null : 3>parseFloat(t) ? "amount_too_low" : "provider_errors"`
 * (`@privy-io/react-auth@3.40.0` `dist/esm/index-rkoxGjIC.mjs`). The ORDER is the vendor's too: below
 * the floor wins over provider errors, because below the floor nobody was ever going to quote and
 * "raise the amount" is the actionable answer. A non-parseable amount yields `NaN`, and `3 > NaN` is
 * `false`, so it falls through exactly as the vendor's expression does.
 */
function readCoverage(response: OnRampQuotesResponse, amount: string): CoverageResult {
  if (response.quotes.length > 0) return { status: "covered", methods: response.quotes };
  if (Number.parseFloat(amount) < PRIVY_QUOTE_FLOOR) {
    return { status: "amount-too-low", railFloor: PRIVY_QUOTE_FLOOR };
  }
  if (response.provider_errors && response.provider_errors.length > 0) {
    // The rails were ASKED and could not answer. Calling this `uncovered` would tell a buyer in a
    // covered country that nobody sells to them because one provider had a bad minute.
    return { status: "unknown", reason: "upstream" };
  }
  return { status: "uncovered" };
}

/**
 * Ask whether any provider will sell this buyer this asset, for this amount, right now.
 *
 * [R1] Never answers `uncovered` on a failure, on a below-floor amount, or on a list that came back
 * empty next to `provider_errors`. Only a VALID, EMPTY, ERROR-FREE list at or above the rail's floor
 * means nobody sells.
 */
export async function probeOnRampCoverage(
  deps: CoverageProbeDeps,
  input: CoverageProbeInput,
): Promise<CoverageResult> {
  let token: string | null;
  try {
    token = await deps.getAccessToken();
  } catch {
    // Privy's DEFAULT context getter rejects outside a `PrivyProvider` (measured, see
    // `CoverageUnknownReason`), and the real one can reject on a failed session refresh. Either way
    // this callback stays total: every caller treats it as an answer, not as something to wrap in
    // its own try/catch.
    return { status: "unknown", reason: "token-failed" };
  }
  // Not an error and not "uncovered": we never got to ask.
  if (!token) return { status: "unknown", reason: "unauthenticated" };

  const headers = new Headers({
    "privy-app-id": deps.appId,
    "privy-client": PRIVY_CLIENT_HEADER,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  // Conditional, exactly as the SDK sets it: an empty header would be a shape we invented.
  if (deps.clientId) headers.set("privy-client-id", deps.clientId);

  const init: RequestInit = {
    method: "PUT",
    headers,
    body: JSON.stringify({
      // UPPERCASE: the request field is not the config field. See the header's casing note.
      source: { asset: input.fiat.trim().toUpperCase(), amount: input.amount },
      destination: {
        asset: input.destination.asset,
        chain: input.destination.chain,
        address: input.destination.address,
      },
      environment: input.environment,
    }),
  };
  const url = `${deps.baseUrl ?? PRIVY_BASE_URL}${PRIVY_QUOTES_PATH}`;

  let result = await attempt(deps, url, init);
  if (result.kind === "retryable") {
    await (deps.sleep ?? defaultSleep)(result.delayMs);
    result = await attempt(deps, url, init);
  }
  if (result.kind !== "body") {
    return {
      status: "unknown",
      reason: result.reason,
      ...(result.httpStatus === undefined ? {} : { httpStatus: result.httpStatus }),
    };
  }

  const parsed = onRampQuotesResponseSchema.safeParse(result.value);
  // [R1] Drift is NOT absence. Answering `uncovered` here would bill a whole country in the
  // fallback currency on the strength of a schema change.
  if (!parsed.success) return { status: "unknown", reason: "contract-drift" };

  return readCoverage(parsed.data, input.amount);
}

/** The real wait, used when no `sleep` is injected. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
