/**
 * @id PP-AUTH-LIB-005 (tests)
 * @name personal_sign encoding tests
 * @implements-rules-version v2
 *
 * Rules under test (POO-1407 rules v2):
 *   [R8] Every `personal_sign` payload is hex-encoded, at every call site. A raw string is what
 *        Ledger Live decodes to the empty buffer and signs.
 *
 * The assertion that matters is not "it called personal_sign" but "the bytes the wallet received
 * decode back to the exact message we meant", which is the property the backend's verification
 * depends on. Asserting on `toHex(message)` alone would pass just as happily if `toHex` were the
 * wrong transform, so the test decodes rather than re-encodes.
 */

import { hexToString, recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { personalSign } from "./personalSign";

/** Anvil account #1, a published test key. */
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

describe("personalSign", () => {
  it("[R8] hands the wallet the hex encoding, which decodes back to the message", async () => {
    const request = vi.fn().mockResolvedValue("0xsig");
    const message = "Welcome to Pool Party!\n\nNonce: abc123";

    await personalSign({ request }, message, "0xF2cB86A871Fb8B854e8defbdED15Ea4FbA4dF0a6");

    const args = request.mock.calls[0]?.[0];
    expect(args).toBeDefined();
    expect(args.method).toBe("personal_sign");
    const [payload, from] = args.params as [`0x${string}`, string];
    expect(hexToString(payload)).toBe(message);
    expect(from).toBe("0xF2cB86A871Fb8B854e8defbdED15Ea4FbA4dF0a6");
  });

  it("[R8] never sends the raw string, which is what signs the empty message", async () => {
    const request = vi.fn().mockResolvedValue("0xsig");
    const message = "Action: profile.update";

    await personalSign({ request }, message, "0x0000000000000000000000000000000000000001");

    const args = request.mock.calls[0]?.[0];
    expect(args).toBeDefined();
    const [payload] = args.params as [string, string];
    expect(payload).not.toBe(message);
    expect(payload.startsWith("0x")).toBe(true);
  });

  it("[R8] produces a signature that recovers to the signer over the ORIGINAL message", async () => {
    // The end-to-end property. A wallet that decodes the hex signs the message we meant, so the
    // backend recovering over its own rebuilt string arrives at the same address. This is the thing
    // that was broken in production, expressed without needing the broken wallet.
    const account = privateKeyToAccount(TEST_KEY);
    const message = "Welcome to Pool Party!\n\nNonce: deadbeef";
    const provider = {
      request: async (args: { method: string; params?: unknown[] }) => {
        const [payload] = args.params as [`0x${string}`, string];
        // A conforming wallet decodes the hex, then signs the bytes it found.
        return account.signMessage({ message: hexToString(payload) });
      },
    };

    const signature = await personalSign({ ...provider }, message, account.address);

    const recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
    expect(recovered).toBe(account.address);
  });

  it("propagates a rejected prompt rather than turning it into a second one", async () => {
    const request = vi.fn().mockRejectedValue(new Error("User rejected the request"));
    await expect(
      personalSign({ request }, "anything", "0x0000000000000000000000000000000000000001"),
    ).rejects.toThrow("User rejected");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
