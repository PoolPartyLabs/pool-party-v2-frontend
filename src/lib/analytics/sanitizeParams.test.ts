import { describe, expect, it } from "vitest";
import { sanitizeParams } from "./sanitizeParams";

const RAW_ADDRESS = `0x${"a".repeat(40)}` as const;
const PRIVATE_KEY = `0x${"b".repeat(64)}` as const;

describe("sanitizeParams", () => {
  it("keeps allowed analytics params", () => {
    const clean = sanitizeParams({ value: 100, currency: "USD", token_symbol: "USDC" });
    expect(clean).toEqual({ value: 100, currency: "USD", token_symbol: "USDC" });
  });

  it("drops undefined values", () => {
    const clean = sanitizeParams({ value: 100, token_symbol: undefined });
    expect(clean).toEqual({ value: 100 });
  });

  // R3: never forward a raw address or a private key, even by mistake.
  it("strips a value that looks like a raw EVM address or private key", () => {
    expect(sanitizeParams({ user_id: RAW_ADDRESS })).toEqual({});
    // biome-ignore lint/suspicious/noExplicitAny: testing a defensive scrub against a bad call
    expect(sanitizeParams({ user_id: PRIVATE_KEY } as any)).toEqual({});
  });

  // R3: secret-looking keys are always dropped.
  it("strips blacklisted keys (seed, mnemonic, private key, password)", () => {
    const dirty = {
      value: 5,
      seedPhrase: "test test test",
      mnemonic: "a b c",
      privateKey: "0xabc",
      password: "hunter2",
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input for the scrub
    } as any;
    expect(sanitizeParams(dirty)).toEqual({ value: 5 });
  });

  // R4: user_id only when consent is granted.
  it("drops user_id when not allowed (consent denied)", () => {
    expect(sanitizeParams({ user_id: "hashed", value: 1 }, false)).toEqual({ value: 1 });
    expect(sanitizeParams({ user_id: "hashed", value: 1 }, true)).toEqual({
      user_id: "hashed",
      value: 1,
    });
  });
});
