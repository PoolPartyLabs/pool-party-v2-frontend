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
