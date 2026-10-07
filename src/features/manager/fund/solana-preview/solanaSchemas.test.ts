/**
 * @id PP-MGR-LIB-063
 * @name solanaSchemas tests
 * @description Solana identity, precision and provenance regression cases.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8679-382
 * @linear https://linear.app/yeildbay/issue/POO-2291
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, contract tests.
 */
import { describe, expect, it } from "vitest";
import {
  solanaAddressSchema,
  solanaAmountSchema,
  solanaAmountToDecimal,
  solanaIdentityKey,
  solanaIdentitySchema,
  solanaReadStateSchema,
  solanaSourceSchema,
  solanaTokenSchema,
  USDC_MINT,
  WSOL_MINT,
} from "./solanaSchemas";

const native = {
  network: "solana",
  cluster: "mainnet-beta",
  kind: "native",
  symbol: "SOL",
  decimals: 9,
  unit: "lamports",
};
const wsol = {
  network: "solana",
  cluster: "mainnet-beta",
  kind: "spl",
  symbol: "WSOL",
  mint: WSOL_MINT,
  decimals: 9,
  unit: "base-units",
};
const usdc = { ...wsol, symbol: "USDC", mint: USDC_MINT, decimals: 6 };
const observed = {
  kind: "observed",
  source: "account-read",
  sourceAsOf: "2026-10-07T20:00:00Z",
  slot: "9007199254740993",
  commitment: "confirmed",
};
const fixture = {
  kind: "fixture",
  fixtureId: "unit-case",
  sourceAsOf: "2026-10-07T20:00:00Z",
  slot: null,
};

describe("Solana identity and amount contracts", () => {
  // @rule R2: identities preserve base58 case and decode to exactly 32 bytes.
  it.each([
    WSOL_MINT,
    USDC_MINT,
    "11111111111111111111111111111111",
  ])("accepts a 32-byte address %s unchanged", (address) => {
    expect(solanaAddressSchema.parse(address)).toBe(address);
  });
  it.each([
    "",
    "1".repeat(31),
    "1".repeat(33),
    "z".repeat(44),
    "0".repeat(32),
    "O".repeat(32),
    "I".repeat(32),
    "l".repeat(32),
    ` ${WSOL_MINT}`,
    `0x${"a".repeat(40)}`,
    "1".repeat(1000),
  ])("rejects malformed address %s", (address) => {
    expect(solanaAddressSchema.safeParse(address).success).toBe(false);
  });
  // @rule R2/R8: chain, resource kind and address define identity, never pool labels.
  it("keeps case, cluster and resource identities separate", () => {
    const identity = {
      network: "solana",
      cluster: "mainnet-beta",
      kind: "pool",
      address: USDC_MINT,
    };
    const key = solanaIdentityKey(identity);
    expect(key).not.toBe(solanaIdentityKey({ ...identity, cluster: "devnet" }));
    expect(key).not.toBe(solanaIdentityKey({ ...identity, kind: "position" }));
    expect(solanaAddressSchema.safeParse(USDC_MINT.replace("EPj", "Epj")).success).toBe(true);
    expect(key).not.toBe(
      solanaIdentityKey({ ...identity, address: USDC_MINT.replace("EPj", "Epj") }),
    );
    expect(solanaIdentitySchema.safeParse({ ...identity, network: "arbitrum" }).success).toBe(
      false,
    );
  });
  // @rule R2: native lamports have no SPL mint; canonical assets retain decimals.
  it("distinguishes native SOL from WSOL and validates known token decimals", () => {
    expect(solanaTokenSchema.parse(native)).toEqual(native);
    expect(solanaTokenSchema.parse(wsol)).toEqual(wsol);
    expect(solanaTokenSchema.parse(usdc)).toEqual(usdc);
    expect(solanaTokenSchema.safeParse({ ...native, mint: WSOL_MINT }).success).toBe(false);
    expect(solanaTokenSchema.safeParse({ ...native, decimals: 18 }).success).toBe(false);
    expect(solanaTokenSchema.safeParse({ ...wsol, decimals: 6 }).success).toBe(false);
    expect(solanaTokenSchema.safeParse({ ...usdc, decimals: 18 }).success).toBe(false);
    expect(solanaTokenSchema.safeParse({ ...wsol, decimals: 256 }).success).toBe(false);
  });
  // @rule R2: raw amounts remain exact beyond Number.MAX_SAFE_INTEGER.
  it.each([
    [native, "1", "0.000000001"],
    [native, "9007199254740993", "9007199.254740993"],
    [usdc, "1234567", "1.234567"],
    [wsol, "1000000000", "1"],
    [native, "0", "0"],
    [{ ...usdc, mint: "11111111111111111111111111111111", decimals: 0 }, "10", "10"],
  ])("resolves exact decimal amount %s / %s", (token, raw, expected) => {
    expect(solanaAmountToDecimal({ token, raw })).toBe(expected);
  });
  it.each([
    -1,
    1,
    "-1",
    "+1",
    "01",
    "1.0",
    "1e9",
    "NaN",
    "Infinity",
    " 1",
    "",
  ])("rejects noncanonical raw amount %s", (raw) => {
    expect(solanaAmountSchema.safeParse({ token: native, raw }).success).toBe(false);
  });
});

describe("Solana read provenance", () => {
  const read = solanaReadStateSchema(solanaAmountSchema);
  // @rule R3: fixture values are distinct from observed values and raw slots stay exact.
  it("preserves explicit fixture/observed provenance and stale snapshots", () => {
    expect(solanaSourceSchema.parse(observed)).toEqual(observed);
    expect(solanaSourceSchema.parse(fixture)).toEqual(fixture);
    for (const source of [observed, fixture]) {
      const state = { status: "available", value: { token: native, raw: "1" }, source };
      expect(read.parse(state)).toEqual(state);
      expect(read.parse({ ...state, status: "stale", reason: "snapshot-expired" })).toMatchObject({
        status: "stale",
        value: { raw: "1" },
        source,
      });
    }
    expect(solanaSourceSchema.safeParse({ ...observed, slot: 9007199254740992 }).success).toBe(
      false,
    );
    expect(solanaSourceSchema.safeParse({ ...observed, sourceAsOf: "yesterday" }).success).toBe(
      false,
    );
    expect(solanaSourceSchema.safeParse({ ...fixture, slot: "1" }).success).toBe(false);
  });
  // @rule R3: zero requires the actual raw zero and a confirmed observed source.
  it("rejects fixture, processed and nonzero readings labelled confirmed-zero", () => {
    const state = {
      status: "confirmed-zero",
      value: { token: native, raw: "0" },
      source: observed,
    };
    expect(read.parse(state)).toEqual(state);
    expect(
      read.parse({ ...state, source: { ...observed, commitment: "finalized" } }),
    ).toMatchObject({ status: "confirmed-zero" });
    for (const invalid of [
      { ...state, source: fixture },
      { ...state, source: { ...observed, commitment: "processed" } },
      { ...state, value: { token: native, raw: "1" } },
      { ...state, source: null },
    ])
      expect(read.safeParse(invalid).success).toBe(false);
  });
  // @rule R3: absence does not become zero or not-applicable without provenance.
  it("keeps unavailable and not-applicable distinct with bounded fields", () => {
    expect(read.parse({ status: "unavailable", reason: "not-integrated", source: null })).toEqual({
      status: "unavailable",
      reason: "not-integrated",
      source: null,
    });
    expect(
      read.parse({ status: "not-applicable", reason: "no-debt", source: observed }),
    ).toMatchObject({ status: "not-applicable" });
    expect(
      read.safeParse({
        status: "unavailable",
        reason: "not-integrated",
        source: null,
        value: { token: native, raw: "0" },
      }).success,
    ).toBe(false);
    expect(
      read.safeParse({ status: "not-applicable", reason: "no-debt", source: null }).success,
    ).toBe(false);
    expect(
      read.safeParse({ status: "available", value: { token: native, raw: "1" }, source: null })
        .success,
    ).toBe(false);
  });
});
