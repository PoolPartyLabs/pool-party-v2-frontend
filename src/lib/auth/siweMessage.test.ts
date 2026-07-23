/**
 * @id PP-AUTH (POO-270, POO-376)
 * @name SIWE message tests
 * @implements-rules-version v1
 *
 * `buildSiweMessage` emits a real EIP-4361 (ERC-4361) message with domain binding and every
 * required field (POO-376). `buildLegacySiweMessage` keeps the pre-4361 branded string
 * byte-for-byte for the flag-off path (the current backend reconstructs that exact string).
 */
import { getAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";
import { buildLegacySiweMessage, buildSiweMessage, SIWE_EXPIRATION_TTL_MS } from "./siweMessage";

const WALLET = "0x1111111111111111111111111111111111111111";
const NONCE = "abcd1234efgh5678"; // valid EIP-4361 nonce: alphanumeric, >= 8 chars.
const ISSUED_AT = new Date("2026-07-01T12:00:00.000Z");

const validInput = {
  domain: "app.poolparty.xyz",
  uri: "https://app.poolparty.xyz",
  address: WALLET,
  chainId: 42161,
  nonce: NONCE,
  statement: "Sign in to Pool Party. This does not cost any gas.",
};

describe("buildSiweMessage (EIP-4361, POO-376)", () => {
  it("emits every required EIP-4361 field", () => {
    // @rule R1
    const parsed = parseSiweMessage(buildSiweMessage({ ...validInput, issuedAt: ISSUED_AT }));
    expect(parsed.domain).toBe(validInput.domain);
    expect(parsed.uri).toBe(validInput.uri);
    expect(parsed.version).toBe("1");
    expect(parsed.chainId).toBe(42161);
    expect(parsed.nonce).toBe(NONCE);
    expect(parsed.statement).toBe(validInput.statement);
    expect(parsed.address).toBe(getAddress(WALLET));
    expect(parsed.issuedAt).toBeInstanceOf(Date);
    expect((parsed.issuedAt as Date).toISOString()).toBe(ISSUED_AT.toISOString());
    expect(parsed.expirationTime).toBeInstanceOf(Date);
  });

  it("checksums the address regardless of input casing", () => {
    // @rule R2
    const parsed = parseSiweMessage(
      buildSiweMessage({ ...validInput, address: WALLET.toLowerCase() }),
    );
    expect(parsed.address).toBe(getAddress(WALLET));
  });

  it("embeds exactly the server-issued nonce", () => {
    // @rule R3
    const parsed = parseSiweMessage(buildSiweMessage({ ...validInput, nonce: "ZZ99aa88bb77" }));
    expect(parsed.nonce).toBe("ZZ99aa88bb77");
  });

  it("sets expirationTime to issuedAt + the default 10-minute TTL", () => {
    // @rule R4
    const parsed = parseSiweMessage(buildSiweMessage({ ...validInput, issuedAt: ISSUED_AT }));
    const delta = (parsed.expirationTime as Date).getTime() - ISSUED_AT.getTime();
    expect(delta).toBe(SIWE_EXPIRATION_TTL_MS);
    expect(SIWE_EXPIRATION_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("honors a custom expiration TTL within the EIP-4361 5-15 min guidance", () => {
    // @rule R4
    const ttl = 5 * 60 * 1000;
    const parsed = parseSiweMessage(
      buildSiweMessage({ ...validInput, issuedAt: ISSUED_AT, expirationTtlMs: ttl }),
    );
    expect((parsed.expirationTime as Date).getTime() - ISSUED_AT.getTime()).toBe(ttl);
  });

  it("binds the message to the caller-provided domain and uri (never a hardcoded literal)", () => {
    // @rule R5 — a phishing origin builds a message carrying ITS host, which the backend (checking
    // against its own known domain) rejects. The origin is load-bearing, so it must not be fixed.
    const msg = buildSiweMessage({
      ...validInput,
      domain: "evil-lookalike.xyz",
      uri: "https://evil-lookalike.xyz",
    });
    const parsed = parseSiweMessage(msg);
    expect(parsed.domain).toBe("evil-lookalike.xyz");
    expect(
      msg.startsWith("evil-lookalike.xyz wants you to sign in with your Ethereum account:"),
    ).toBe(true);
  });

  it("carries the provided chainId", () => {
    // @rule R6
    expect(parseSiweMessage(buildSiweMessage({ ...validInput, chainId: 8453 })).chainId).toBe(8453);
  });

  it("embeds the caller-provided localized statement verbatim (incl. non-ASCII)", () => {
    // @rule R7
    const statement = "Entre no Pool Party. Isso nao custa gas de rede.";
    expect(parseSiweMessage(buildSiweMessage({ ...validInput, statement })).statement).toBe(
      statement,
    );
  });

  it("is NOT the legacy branded string and carries the EIP-4361 domain-binding preamble", () => {
    // @rule R10 — regression for the original defect: a branded string with no domain binding.
    const msg = buildSiweMessage(validInput);
    expect(msg).not.toContain("Welcome to Pool Party!");
    expect(msg).toContain(`${validInput.domain} wants you to sign in with your Ethereum account:`);
    expect(msg).toContain(getAddress(WALLET));
  });
});

describe("buildLegacySiweMessage (pre-4361 branded string, flag-off backend compat)", () => {
  it("matches the backend's exact byte-for-byte format", () => {
    // @rule R8
    expect(buildLegacySiweMessage("0xWALLET", "nonce-123")).toBe(
      "Welcome to Pool Party!\n\nSign this message to prove you have access to this wallet and we'll log you in. This won't cost you any gas fees.\n\nWallet address: 0xWALLET\n\nNonce: nonce-123",
    );
  });
});
