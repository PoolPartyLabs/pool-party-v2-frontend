import { describe, expect, it } from "vitest";
import { rehearsalSignInAllowed } from "../e2e/helpers/rehearsalSignIn";
import { buildLegacySiweMessage, buildSiweMessage } from "../src/lib/auth/siweMessage";

const address = "0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a";
describe("non-spending rehearsal sign-in boundary", () => {
  it("allows the actual legacy Pool Party authentication message", () => {
    const message = buildLegacySiweMessage(address, "nonce-12345");
    expect(rehearsalSignInAllowed(message, address)).toBe(true);
    expect(rehearsalSignInAllowed(`0x${Buffer.from(message).toString("hex")}`, address)).toBe(true);
  });
  it("allows EIP-4361 authentication for the expected wallet", () => {
    const message = buildSiweMessage({
      address,
      domain: "v2.dev.pool-party.xyz",
      uri: "https://v2.dev.pool-party.xyz",
      chainId: 42161,
      nonce: "nonce12345",
      statement: "Sign in to Pool Party",
    });
    expect(rehearsalSignInAllowed(message, address)).toBe(true);
  });
  it("allows exact localhost:3000 SIWE and Privy authentication only", () => {
    const message = buildSiweMessage({
      address,
      domain: "localhost:3000",
      uri: "http://localhost:3000",
      chainId: 42161,
      nonce: "nonce12345",
      statement: "Sign in to Pool Party",
    });
    const privy = message
      .replace(
        "Sign in to Pool Party",
        "By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.",
      )
      .replace(/\nExpiration Time: [^\n]+$/, "\nResources:\n- https://privy.io");
    for (const authentication of [message, privy]) {
      expect(rehearsalSignInAllowed(authentication, address)).toBe(true);
      expect(
        rehearsalSignInAllowed(`0x${Buffer.from(authentication).toString("hex")}`, address),
      ).toBe(true);
      for (const unsafe of [
        authentication.replaceAll("localhost:3000", "localhost:3001"),
        authentication.replace("URI: http://localhost:3000", "URI: https://v2.dev.pool-party.xyz"),
        authentication.replace("http://localhost:3000", "http://localhost:3000/authorize"),
        authentication.replace(address, `0x${"1".repeat(40)}`),
        authentication.replace("Chain ID: 42161", "Chain ID: 1"),
        authentication.replace(/\n\n[^\n]+\n\nURI:/, "\n\nAuthorize a fund launch\n\nURI:"),
        `${authentication}\nResources:\n- http://localhost:3000/launch`,
      ]) {
        expect(rehearsalSignInAllowed(unsafe, address)).toBe(false);
      }
    }
  });
  it("rejects profile signatures, malformed authentication and another wallet", () => {
    expect(rehearsalSignInAllowed(`Launch fund with manager ${address}`, address)).toBe(false);
    expect(
      rehearsalSignInAllowed(buildLegacySiweMessage(`0x${"1".repeat(40)}`, "nonce12345"), address),
    ).toBe(false);
    expect(
      rehearsalSignInAllowed(
        `${address} wants you to sign in with your Ethereum account:`,
        address,
      ),
    ).toBe(false);
  });
  it("rejects another origin, financial statements, appended resources and malformed hex", () => {
    const message = buildSiweMessage({
      address,
      domain: "v2.dev.pool-party.xyz",
      uri: "https://v2.dev.pool-party.xyz",
      chainId: 42161,
      nonce: "nonce12345",
      statement: "Sign in to Pool Party",
    });
    for (const unsafe of [
      message.replaceAll("v2.dev.pool-party.xyz", "attacker.example"),
      message.replace("Sign in to Pool Party", "Authorize a fund launch"),
      `${message}\nResources:\n- https://attacker.example/authorization`,
      message.replace("Chain ID: 42161", "Chain ID: 1"),
      `0x${Buffer.from(message).toString("hex")}ffx`,
    ]) {
      expect(rehearsalSignInAllowed(unsafe, address)).toBe(false);
    }
    expect(rehearsalSignInAllowed(message, ".*")).toBe(false);
  });
});
