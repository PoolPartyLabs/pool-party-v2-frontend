/**
 * @id PP-CORE-SEC-005 — tests
 * @name Privy funds-deposited webhook relay — tests
 * @implements-rules-version v1 (POO-1818 rules v1)
 * @analytics-events none. A server-to-server relay has no browser; the reason is on the route.
 *
 * Two properties carry this file, and both are the kind that fail silently in
 * production:
 *
 *   1. BYTE FIDELITY. The signature downstream is an HMAC over the exact bytes
 *      Privy sent. A relay that re-serialises, re-encodes, or normalises breaks
 *      every delivery in a way that reads as a wrong secret.
 *   2. THE RETRY CONTRACT. Svix stops on a 2xx and retries on anything else. A
 *      200 returned when the API was never reached loses a paid deposit
 *      permanently, which is the exact loss POO-1818 exists to close.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const API_URL = "http://pp_api:5001";
const RELAY_URL = "https://v2.dev.pool-party.xyz/api/webhooks/privy/funds-deposited";

const DELIVERY = {
  appId: "app_dev",
  eventName: "wallet.funds_deposited",
  payload: {
    wallet_id: "kt9x1abc",
    idempotency_key: "dep_0001",
    caip2: "eip155:8453",
    asset: { type: "erc20", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    amount: "25000000",
    transaction_hash: "0xabc",
    sender: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    block: { number: 34567890 },
  },
};

const SVIX_HEADERS = {
  "svix-id": "msg_2vLd",
  "svix-timestamp": "1757000000",
  "svix-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

function delivery(body: string, headers: Record<string, string> = SVIX_HEADERS): NextRequest {
  return new NextRequest(RELAY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ data: { received: true } }), { status: 200 }),
  );
  vi.stubEnv("PP_API_URL", API_URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * The single forwarded call. Asserting it happened here rather than in every test
 * keeps `tsconfig`'s `noUncheckedIndexedAccess` honest AND turns "the relay did
 * not forward at all" into a named failure instead of a cryptic undefined.
 */
function forwardedCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("the relay forwarded nothing");
  return { url: String(call[0]), init: call[1] as RequestInit };
}

/** The bytes the relay actually put on the wire, decoded for comparison only. */
function forwardedBody(): string {
  return Buffer.from(forwardedCall().init.body as Uint8Array).toString("utf8");
}

function forwardedHeaders(): Headers {
  return forwardedCall().init.headers as Headers;
}

describe("POST relay — byte fidelity", () => {
  it("forwards the body byte for byte", async () => {
    const raw = JSON.stringify(DELIVERY);

    await POST(delivery(raw));

    expect(forwardedBody()).toBe(raw);
  });

  /**
   * The failure that looks like a wrong secret. Key order and whitespace are not
   * semantics to JSON but they are everything to an HMAC, so a relay that parses
   * and re-stringifies must fail this.
   */
  it("preserves key order and whitespace that a parse-and-restringify would destroy", async () => {
    const raw = '{ "payload" : {"amount":"1"} ,\n  "eventName":"wallet.funds_deposited" }';

    await POST(delivery(raw));

    const forwarded = forwardedBody();
    expect(forwarded).toBe(raw);
    expect(forwarded).not.toBe(JSON.stringify(JSON.parse(raw)));
  });

  it("preserves non-ASCII bytes without re-encoding them", async () => {
    const raw = JSON.stringify({ eventName: "wallet.funds_deposited", note: "café é€" });

    await POST(delivery(raw));

    expect(forwardedBody()).toBe(raw);
  });

  it("posts to the receiver's versioned route on the internal API", async () => {
    await POST(delivery(JSON.stringify(DELIVERY)));

    const { url, init } = forwardedCall();
    expect(url).toBe(`${API_URL}/api/v1/webhooks/privy/funds-deposited`);
    expect(init.method).toBe("POST");
  });
});

describe("POST relay — headers", () => {
  it("forwards the three headers the signature is computed over", async () => {
    await POST(delivery(JSON.stringify(DELIVERY)));

    const headers = forwardedHeaders();
    expect(headers.get("svix-id")).toBe(SVIX_HEADERS["svix-id"]);
    expect(headers.get("svix-timestamp")).toBe(SVIX_HEADERS["svix-timestamp"]);
    expect(headers.get("svix-signature")).toBe(SVIX_HEADERS["svix-signature"]);
  });

  it("forwards the unbranded Standard Webhooks spelling too", async () => {
    await POST(
      delivery(JSON.stringify(DELIVERY), {
        "webhook-id": "msg_2vLd",
        "webhook-timestamp": "1757000000",
        "webhook-signature": "v1,abc",
      }),
    );

    const headers = forwardedHeaders();
    expect(headers.get("webhook-id")).toBe("msg_2vLd");
    expect(headers.get("webhook-signature")).toBe("v1,abc");
  });

  /**
   * Nothing downstream authorises on a forwarded header, so the set that crosses
   * the internal network is an allowlist rather than a passthrough. A cookie or
   * an `authorization` reaching an internal service from the public internet is
   * how a relay becomes a confused deputy.
   */
  it("drops every header outside the allowlist", async () => {
    await POST(
      delivery(JSON.stringify(DELIVERY), {
        ...SVIX_HEADERS,
        cookie: "session=stolen",
        authorization: "Bearer nope",
        "x-forwarded-host": "evil.example",
        "x-api-key": "not-ours-to-send",
      }),
    );

    const headers = forwardedHeaders();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
  });
});

describe("POST relay — the retry contract", () => {
  it("answers 200 when the receiver answered, so Svix stops retrying", async () => {
    const response = await POST(delivery(JSON.stringify(DELIVERY)));

    expect(response.status).toBe(200);
  });

  /**
   * The receiver answers 200 even to a body it rejects, because a retry cannot
   * fix a bad signature. The relay must pass that decision through rather than
   * invent a retry of its own.
   */
  it("answers 200 when the receiver rejected the body but answered", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { outcome: "rejected-unsigned" } }), { status: 200 }),
    );

    const response = await POST(delivery(JSON.stringify(DELIVERY)));

    expect(response.status).toBe(200);
  });

  it("answers 502 when the receiver is unreachable, so the delivery is retried", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await POST(delivery(JSON.stringify(DELIVERY)));

    expect(response.status).toBe(502);
  });

  /**
   * `fetch` defaults to `redirect: "follow"`, and for a POST the spec downgrades a
   * 301/302/303 to a GET and DROPS the body. The followed 200 would then read as
   * success, Svix would stop retrying, and the delivery would be lost through the
   * one path that looks like it worked. `redirect: "manual"` keeps the 3xx visible
   * as `ok === false`, which the existing mapping already turns into a 502.
   */
  it("answers 502 when the receiver answers a redirect, instead of following it", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } }),
    );

    const response = await POST(delivery(JSON.stringify(DELIVERY)));

    expect(response.status).toBe(502);
    expect(forwardedCall().init.redirect).toBe("manual");
  });

  it("answers 502 when the receiver itself faults", async () => {
    fetchMock.mockResolvedValue(new Response("upstream on fire", { status: 500 }));

    const response = await POST(delivery(JSON.stringify(DELIVERY)));

    expect(response.status).toBe(502);
  });

  /**
   * An unconfigured relay is a temporary state that a redeploy fixes, and the
   * delivery is real. Swallowing it with a 200 would drop a paid deposit for
   * good.
   */
  it("answers 502 and forwards nothing when PP_API_URL is unset", async () => {
    vi.stubEnv("PP_API_URL", "");

    const response = await POST(delivery(JSON.stringify(DELIVERY)));

    expect(response.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST relay — bounds", () => {
  it("refuses an oversized body without crossing the internal network", async () => {
    const oversized = `{"pad":"${"a".repeat(20_000)}"}`;

    const response = await POST(delivery(oversized));

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The cap has to fire on the DECLARED size, BEFORE `arrayBuffer()` pulls the body
   * into the heap. That the read never happened is the whole assertion: a check that
   * runs afterwards has already paid for the bytes it refuses, and on the only public
   * door the stack has, that cost is what an unauthenticated flood is buying.
   */
  it("refuses a declared content-length over the cap without reading the body", async () => {
    const request = delivery(JSON.stringify(DELIVERY), {
      ...SVIX_HEADERS,
      "content-length": "1000000",
    });
    const read = vi.spyOn(request, "arrayBuffer");

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(read).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Svix never sends an empty body, so zero bytes means our own runtime failed to
   * hand us the request. That is ours, and a 200 would end the retry schedule on a
   * delivery that may well carry a real deposit.
   */
  it("asks for a retry on an empty body rather than swallowing it", async () => {
    const response = await POST(delivery(""));

    expect(response.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still refuses an oversized body terminally, because a retry cannot shrink it", async () => {
    const response = await POST(delivery(`{"pad":"${"a".repeat(20_000)}"}`));

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("names the endpoint instead of rendering a 405", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ method: "POST" });
  });
});
