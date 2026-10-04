import { describe, expect, it } from "vitest";
import { rehearsalSignInAllowed } from "../../e2e/helpers/rehearsalSignIn";

const address = "0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a";
const message = `v2.dev.pool-party.xyz wants you to sign in with your Ethereum account:
${address}

By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.

URI: https://v2.dev.pool-party.xyz
Version: 1
Chain ID: 42161
Nonce: abcdef0123456789
Issued At: 2026-10-04T06:01:54.664Z
Resources:
- https://privy.io`;

describe("rehearsal authentication allowlist", () => {
  it("accepts the deployed Privy authentication text, raw or hex", () => {
    expect(rehearsalSignInAllowed(message, address)).toBe(true);
    expect(rehearsalSignInAllowed(`0x${Buffer.from(message).toString("hex")}`, address)).toBe(true);
    expect(rehearsalSignInAllowed(message.replace("42161", "4663"), address)).toBe(true);
  });
  it("rejects another wallet, origin, chain, resource and arbitrary signatures", () => {
    for (const candidate of [
      message.replace(address, "0x0000000000000000000000000000000000000001"),
      message.replaceAll("v2.dev.pool-party.xyz", "attacker.invalid"),
      message.replace("42161", "1"),
      message.replace("https://privy.io", "https://attacker.invalid"),
      `${message}\nAuthorize fund profile`,
      "Approve spending USDC",
      "0xabc",
    ])
      expect(rehearsalSignInAllowed(candidate, address)).toBe(false);
  });
});
