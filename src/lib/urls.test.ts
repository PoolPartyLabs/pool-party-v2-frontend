/**
 * @id PP-CORE-LIB-029 (POO-649, POO-735)
 * @name publicUrls — tests
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  absoluteUrl,
  appHost,
  appOrigin,
  managerProfileReferralUrl,
  managerProfileUrl,
  publicStrategyUrl,
  referralUrl,
  strategyReferralUrl,
  uniswapPositionUrl,
} from "./urls";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("app origin resolution (POO-735)", () => {
  // @rule R3 (unset NEXT_PUBLIC_APP_URL falls back to the prod origin, never a dev host)
  it("falls back to the prod origin when NEXT_PUBLIC_APP_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(appOrigin()).toBe("https://app.pool-party.xyz");
    expect(appHost()).toBe("app.pool-party.xyz");
  });

  // @rule R2 (the origin is the deployed value, scheme included)
  it("uses the configured dev origin (v2.dev)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://v2.dev.pool-party.xyz");
    expect(appOrigin()).toBe("https://v2.dev.pool-party.xyz");
    expect(appHost()).toBe("v2.dev.pool-party.xyz");
  });

  // @rule R2/R4 (localhost keeps its http scheme and port)
  it("keeps the http scheme + port for a localhost origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(appOrigin()).toBe("http://localhost:3000");
    expect(appHost()).toBe("localhost:3000");
  });

  // @rule R2 (a trailing slash is normalized away so builders never double-up separators)
  it("strips a trailing slash from the configured origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pool-party.xyz/");
    expect(appOrigin()).toBe("https://app.pool-party.xyz");
    expect(appHost()).toBe("app.pool-party.xyz");
  });
});

describe("public URL builders (POO-649, POO-735)", () => {
  // @rule R1 (builders derive their host from the env origin, display form is schemeless)
  it("builds the manager profile + strategy URLs from the deployed host", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://v2.dev.pool-party.xyz");
    expect(managerProfileUrl("delta-desk")).toBe("v2.dev.pool-party.xyz/m/delta-desk");
    expect(publicStrategyUrl("strat-treasury-plus")).toBe(
      "v2.dev.pool-party.xyz/strategies/strat-treasury-plus",
    );
  });

  // POO-717 R3: the canonical referral link is the `?ref=` query form, code kept AS TYPED.
  it("builds the referral URL as `?ref=<code>`, keeping the code as typed", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pool-party.xyz");
    expect(referralUrl("Maria2026")).toBe("app.pool-party.xyz?ref=Maria2026");
    expect(referralUrl("MARIA2026")).toBe("app.pool-party.xyz?ref=MARIA2026");
  });

  // POO-717 hardening: a code with URL-significant characters is percent-encoded at the query boundary.
  it("percent-encodes a code with URL-significant characters (defense-in-depth)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pool-party.xyz");
    expect(referralUrl("a&b=c d")).toBe("app.pool-party.xyz?ref=a%26b%3Dc%20d");
  });

  // @rule R4 (POO-853): the pool-scoped referral deep link is `<host>/strategies/<id>?ref=<code>`,
  // code kept AS TYPED and percent-encoded.
  it("builds the pool-id referral URL as `/strategies/<id>?ref=<code>`", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pool-party.xyz");
    expect(strategyReferralUrl("strat-treasury-plus", "Maria2026")).toBe(
      "app.pool-party.xyz/strategies/strat-treasury-plus?ref=Maria2026",
    );
    expect(strategyReferralUrl("strat-1", "a&b=c d")).toBe(
      "app.pool-party.xyz/strategies/strat-1?ref=a%26b%3Dc%20d",
    );
  });

  // @rule R3 (POO-901): the manager-profile referral deep link mirrors strategyReferralUrl —
  // `<host>/m/<handle>?ref=<code>`, handle and code both percent-encoded, code kept AS TYPED.
  it("builds the manager-profile referral URL as `/m/<handle>?ref=<code>` (POO-901 R3)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pool-party.xyz");
    expect(managerProfileReferralUrl("delta-desk", "Maria2026")).toBe(
      "app.pool-party.xyz/m/delta-desk?ref=Maria2026",
    );
    expect(managerProfileReferralUrl("delta desk", "a&b=c d")).toBe(
      "app.pool-party.xyz/m/delta%20desk?ref=a%26b%3Dc%20d",
    );
  });
});

describe("absoluteUrl scheme handling (POO-735 R4)", () => {
  // @rule R4 (share/copy absolutizes with https for a prod/dev https origin)
  it("prefixes a bare host/path with the origin scheme (https by default)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://v2.dev.pool-party.xyz");
    expect(absoluteUrl(referralUrl("Maria2026"))).toBe(
      "https://v2.dev.pool-party.xyz?ref=Maria2026",
    );
    expect(absoluteUrl("app.pool-party.xyz/strategies/x")).toBe(
      "https://app.pool-party.xyz/strategies/x",
    );
  });

  // @rule R4 (a localhost origin keeps http:// — never force https on the share link)
  it("uses http:// when the origin is localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(absoluteUrl(referralUrl("Maria2026"))).toBe("http://localhost:3000?ref=Maria2026");
  });

  // An already-absolute URL is returned unchanged (either scheme).
  it("returns an already-absolute URL unchanged", () => {
    expect(absoluteUrl("https://app.pool-party.xyz/x")).toBe("https://app.pool-party.xyz/x");
    expect(absoluteUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
  });
});

describe("Uniswap deep-link builders (POO-750)", () => {
  // POO-750 R1/R5: the manager "View on Uniswap" link targets the position NFT, not the pool. The
  // network slug is the API slug (arbitrum/base/polygon), which matches Uniswap's path segments.
  it("builds the Uniswap v3 position URL from a network slug + NFT token id", () => {
    expect(uniswapPositionUrl("arbitrum", "115990")).toBe(
      "https://app.uniswap.org/positions/v3/arbitrum/115990",
    );
    expect(uniswapPositionUrl("base", "45678")).toBe(
      "https://app.uniswap.org/positions/v3/base/45678",
    );
  });

  // POO-750 hardening: both path segments are URL-encoded. Identity for the fixed slug + numeric id
  // (above), but a value with URL-significant characters cannot break out of the path — it is
  // percent-encoded at this boundary (as `referralUrl` encodes its query code).
  it("percent-encodes path segments with URL-significant characters (defense-in-depth)", () => {
    expect(uniswapPositionUrl("a/b", "1 2?x")).toBe(
      "https://app.uniswap.org/positions/v3/a%2Fb/1%202%3Fx",
    );
  });
});
