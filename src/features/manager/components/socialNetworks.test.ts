/**
 * @id PP-MGR-CMP-032 — tests (POO-572)
 * Behavior: normalizeSocialUrl validates a social link PER NETWORK (POO-572 R1: subdomain-aware
 * domain match) and accepts a bare @handle (POO-572 R2: build the network URL from a handle base),
 * returning the normalized/built http(s) URL or null. Config (domains + handle base) lives on the
 * SOCIAL_NETWORKS entries (POO-572 R5) so it never drifts from the logo/label.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeSocialUrl,
  SOCIAL_NETWORKS,
  type SocialNetwork,
  socialHandlePlaceholder,
  socialHandleValue,
  socialInputPrefix,
} from "./socialNetworks";

/** Look up a network entry by key (the entries carry the per-network config). */
function net(key: SocialNetwork["key"]): SocialNetwork {
  const found = SOCIAL_NETWORKS.find((entry) => entry.key === key);
  if (!found) throw new Error(`missing SOCIAL_NETWORKS entry for ${key}`);
  return found;
}

describe("SOCIAL_NETWORKS config (POO-572 R5)", () => {
  // @rule POO-572 R5: the accepted domains + handle base live next to the logo/label.
  it("carries the per-network domains and handle base on every entry", () => {
    expect(net("x").domains).toEqual(["x.com", "twitter.com"]);
    expect(net("x").handleBase).toBe("https://x.com/");
    expect(net("telegram").domains).toEqual(["t.me", "telegram.me"]);
    expect(net("telegram").handleBase).toBe("https://t.me/");
    expect(net("discord").domains).toEqual(["discord.gg", "discord.com", "discordapp.com"]);
    // POO-657: discord is now prefix-based (discord.gg/<invite>).
    expect(net("discord").handleBase).toBe("https://discord.gg/");
    expect(net("youtube").domains).toEqual(["youtube.com", "youtu.be", "m.youtube.com"]);
    expect(net("youtube").handleBase).toBe("https://youtube.com/@");
    // Website accepts any safe URL and has no handle concept.
    expect(net("website").domains).toBeNull();
    expect(net("website").handleBase).toBeNull();
  });
});

describe("normalizeSocialUrl (POO-572 R1 per-network domain match)", () => {
  // @rule POO-572 R1: a matching-domain URL is valid and returned normalized.
  it("accepts a URL whose host matches the network's domain (X)", () => {
    expect(normalizeSocialUrl("https://x.com/eu", net("x"))).toBe("https://x.com/eu");
  });

  // @rule POO-572 R1: the other accepted domain for X is twitter.com.
  it("accepts twitter.com for X", () => {
    expect(normalizeSocialUrl("https://twitter.com/eu", net("x"))).toBe("https://twitter.com/eu");
  });

  // @rule POO-572 R1: subdomain-aware — host endsWith "." + domain.
  it("accepts a subdomain of an accepted domain (www.x.com)", () => {
    expect(normalizeSocialUrl("https://www.x.com/eu", net("x"))).toBe("https://www.x.com/eu");
  });

  // @rule POO-572 R1: a wrong-domain URL is invalid (google.com in X -> null). THE BUG.
  it("rejects a valid URL on the wrong domain (google.com in X)", () => {
    expect(normalizeSocialUrl("google.com", net("x"))).toBeNull();
    expect(normalizeSocialUrl("https://google.com", net("x"))).toBeNull();
    expect(normalizeSocialUrl("https://instagram.com/eu", net("x"))).toBeNull();
  });

  // @rule POO-572 R1: telegram accepts t.me and telegram.me only.
  it("matches telegram domains and rejects others", () => {
    expect(normalizeSocialUrl("https://t.me/canal", net("telegram"))).toBe("https://t.me/canal");
    expect(normalizeSocialUrl("https://telegram.me/canal", net("telegram"))).toBe(
      "https://telegram.me/canal",
    );
    expect(normalizeSocialUrl("https://x.com/canal", net("telegram"))).toBeNull();
  });

  // @rule POO-572 R1: discord accepts its three domains.
  it("matches discord domains", () => {
    expect(normalizeSocialUrl("https://discord.gg/abc", net("discord"))).toBe(
      "https://discord.gg/abc",
    );
    expect(normalizeSocialUrl("https://discord.com/invite/abc", net("discord"))).toBe(
      "https://discord.com/invite/abc",
    );
    expect(normalizeSocialUrl("https://discordapp.com/invite/abc", net("discord"))).toBe(
      "https://discordapp.com/invite/abc",
    );
    expect(normalizeSocialUrl("https://x.com/abc", net("discord"))).toBeNull();
  });

  // @rule POO-572 R1: youtube accepts its three domains.
  it("matches youtube domains", () => {
    expect(normalizeSocialUrl("https://youtube.com/@eu", net("youtube"))).toBe(
      "https://youtube.com/@eu",
    );
    expect(normalizeSocialUrl("https://youtu.be/abc", net("youtube"))).toBe("https://youtu.be/abc");
    expect(normalizeSocialUrl("https://m.youtube.com/@eu", net("youtube"))).toBe(
      "https://m.youtube.com/@eu",
    );
    expect(normalizeSocialUrl("https://vimeo.com/abc", net("youtube"))).toBeNull();
  });

  // @rule POO-572 R1: website accepts ANY safe http(s) URL (no domain restriction).
  it("accepts any safe URL for website", () => {
    expect(normalizeSocialUrl("google.com", net("website"))).toBe("https://google.com/");
    expect(normalizeSocialUrl("https://carlos.xyz", net("website"))).toBe("https://carlos.xyz/");
    // Still runs safeHttpUrl: a javascript: URL is rejected everywhere.
    expect(normalizeSocialUrl("javascript:alert(1)", net("website"))).toBeNull();
  });
});

describe("normalizeSocialUrl (POO-572 R2 bare @handle)", () => {
  // @rule POO-572 R2: X builds https://x.com/<handle>, stripping a leading @.
  it("builds the X URL from @eu and from eu", () => {
    expect(normalizeSocialUrl("@eu", net("x"))).toBe("https://x.com/eu");
    expect(normalizeSocialUrl("eu", net("x"))).toBe("https://x.com/eu");
  });

  // @rule POO-572 R2: telegram builds https://t.me/<handle>, stripping a leading @.
  it("builds the telegram URL from @canal", () => {
    expect(normalizeSocialUrl("@canal", net("telegram"))).toBe("https://t.me/canal");
    expect(normalizeSocialUrl("canal", net("telegram"))).toBe("https://t.me/canal");
  });

  // @rule POO-572 R2: youtube builds https://youtube.com/@<handle> (exactly one @).
  it("builds the youtube URL from @eu and from eu (one @)", () => {
    expect(normalizeSocialUrl("@eu", net("youtube"))).toBe("https://youtube.com/@eu");
    expect(normalizeSocialUrl("eu", net("youtube"))).toBe("https://youtube.com/@eu");
  });

  // @rule POO-572 R2 / POO-657: discord now builds https://discord.gg/<invite> from a bare handle;
  // only website (no handle concept) rejects a bare handle.
  it("builds a discord URL from a bare handle; rejects a bare handle for website", () => {
    expect(normalizeSocialUrl("@server", net("discord"))).toBe("https://discord.gg/server");
    expect(normalizeSocialUrl("server", net("discord"))).toBe("https://discord.gg/server");
    expect(normalizeSocialUrl("@me", net("website"))).toBeNull();
    expect(normalizeSocialUrl("me", net("website"))).toBeNull();
  });

  // @rule POO-572 R2: a non-URL with a space is not a bare handle and not a URL -> null.
  it("rejects a value with a space (meu insta)", () => {
    expect(normalizeSocialUrl("meu insta", net("x"))).toBeNull();
  });

  // @rule POO-572 R2: an empty/whitespace-only handle is rejected.
  it("rejects an empty or bare-@ handle", () => {
    expect(normalizeSocialUrl("@", net("x"))).toBeNull();
    expect(normalizeSocialUrl("   ", net("x"))).toBeNull();
    expect(normalizeSocialUrl("", net("x"))).toBeNull();
  });
});

describe("socialInputPrefix (POO-657: fixed non-editable prefix)", () => {
  // @rule POO-657: a handle-based network's prefix is its handleBase minus the scheme.
  it("returns the domain prefix for a handle-based network (X)", () => {
    expect(socialInputPrefix(net("x"))).toBe("x.com/");
  });

  // @rule POO-657: Website has no handle concept, so no prefix (it takes a full-URL input).
  it("returns null for website (no handle concept)", () => {
    expect(socialInputPrefix(net("website"))).toBeNull();
  });
});

describe("socialHandlePlaceholder (POO-657: handle-only placeholder)", () => {
  // @rule POO-657: the prefixed input's placeholder is the example minus the handleBase.
  it("strips the handleBase prefix off the placeholder (X)", () => {
    expect(socialHandlePlaceholder(net("x"))).toBe("yourhandle");
  });

  // @rule POO-657: Website keeps the full-URL placeholder (no prefix to strip).
  it("keeps the full-URL placeholder for website", () => {
    expect(socialHandlePlaceholder(net("website"))).toBe("https://yourdomain.xyz");
  });
});

describe("socialHandleValue (POO-657: strip the prefix off the stored URL)", () => {
  // @rule POO-657: a stored URL matching the handleBase displays as just the handle.
  it("strips the handleBase off a matching stored URL (X)", () => {
    expect(socialHandleValue("https://x.com/carlos", net("x"))).toBe("carlos");
  });

  // @rule POO-657: a stored value that doesn't match the base is shown raw (edge case).
  it("returns the raw value when it doesn't match the base", () => {
    expect(socialHandleValue("https://twitter.com/carlos", net("x"))).toBe(
      "https://twitter.com/carlos",
    );
  });

  // @rule POO-657: no stored value shows an empty input.
  it("returns '' for undefined", () => {
    expect(socialHandleValue(undefined, net("x"))).toBe("");
  });
});

describe("parity with the deployed pool-party-api social-links.ts (POO-579)", () => {
  // These fixtures are the backend `social-links.spec.ts` canonical cases. The FE normalizer must
  // produce the SAME outcome for the five persisted networks so an invalid link fails locally instead
  // of a server 400. (No `instagram` — the registry does not persist it, POO-593/POO-579.)
  it("mirrors the backend for X / Telegram / YouTube / Website (bare handle, scheme-less, wrong host, unsafe)", () => {
    // X: bare @handle + scheme-less both expand/enforce the domain; a foreign host is rejected.
    expect(normalizeSocialUrl("@carlos", net("x"))).toBe("https://x.com/carlos");
    expect(normalizeSocialUrl("x.com/carlos", net("x"))).toBe("https://x.com/carlos");
    expect(normalizeSocialUrl("twitter.com/carlos", net("x"))).toBe("https://twitter.com/carlos");
    expect(normalizeSocialUrl("https://evil.com/carlos", net("x"))).toBeNull();

    // Telegram: allowed hosts only.
    expect(normalizeSocialUrl("@canal", net("telegram"))).toBe("https://t.me/canal");
    expect(normalizeSocialUrl("https://x.com/canal", net("telegram"))).toBeNull();

    // YouTube: the base ends in `@`, so a bare handle keeps exactly one.
    expect(normalizeSocialUrl("@chan", net("youtube"))).toBe("https://youtube.com/@chan");
    expect(normalizeSocialUrl("https://vimeo.com/x", net("youtube"))).toBeNull();

    // Website: any safe dotted http(s) URL; non-http scheme + non-dotted host rejected (stored-XSS guard).
    expect(normalizeSocialUrl("mysite.xyz", net("website"))).toBe("https://mysite.xyz/");
    expect(normalizeSocialUrl("http://mysite.xyz", net("website"))).toBe("http://mysite.xyz/");
    expect(normalizeSocialUrl("javascript:alert(1)", net("website"))).toBeNull();
    expect(normalizeSocialUrl("data:text/html,x", net("website"))).toBeNull();
    expect(normalizeSocialUrl("https://localhost", net("website"))).toBeNull();

    // Empty / whitespace / nullish is "no value" (null), never flagged — same as the backend.
    expect(normalizeSocialUrl("   ", net("x"))).toBeNull();
    expect(normalizeSocialUrl(undefined, net("x"))).toBeNull();
  });

  it("accepts a full discord.gg/discord.com URL, matching the backend allow-list", () => {
    expect(normalizeSocialUrl("https://discord.gg/abc", net("discord"))).toBe(
      "https://discord.gg/abc",
    );
    expect(normalizeSocialUrl("https://discord.com/invite/abc", net("discord"))).toBe(
      "https://discord.com/invite/abc",
    );
    expect(normalizeSocialUrl("https://x.com/abc", net("discord"))).toBeNull();
  });

  it("[intentional divergence] expands a bare Discord token to a backend-valid discord.gg URL", () => {
    // The deployed backend rejects a *bare* Discord handle (its `handleBase` is null), but the FE input
    // is prefix-based (POO-657) and EMITS the expanded `https://discord.gg/<token>` URL — which the
    // backend accepts (discord.gg is an allowed host). So the divergence is only in the input
    // affordance; the WIRE payload the FE sends is backend-valid and never 400s (POO-579).
    expect(normalizeSocialUrl("abc123", net("discord"))).toBe("https://discord.gg/abc123");
  });
});
