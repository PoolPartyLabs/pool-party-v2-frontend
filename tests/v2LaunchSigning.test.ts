import { describe, expect, it } from "vitest";
import { assertV2LaunchSigningAllowed, v2LaunchMode } from "../e2e/helpers/v2LaunchSigning";
import { buildLegacySiweMessage } from "../src/lib/auth/siweMessage";

const address = "0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a";
const financialMethods = [
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "personal_sign",
];

describe("v2 launch signing safety", () => {
  it("keeps review-only and signed modes and recognizes launch-only dry mode", () => {
    expect(v2LaunchMode("1")).toBe("dry");
    expect(v2LaunchMode("launch")).toBe("dry-launch");
    for (const value of [undefined, "0", ""]) expect(v2LaunchMode(value)).toBe("signed");
  });

  it.each([
    "dry",
    "dry-launch",
  ] as const)("blocks every financial method in %s even when armed and opted in", (mode) => {
    for (const method of financialMethods) {
      expect(() =>
        assertV2LaunchSigningAllowed(
          { method, params: ["Authorize fund launch"] },
          address,
          mode,
          true,
          "1",
        ),
      ).toThrow("Launch signing is disarmed");
    }
  });

  it.each([
    "dry",
    "dry-launch",
    "signed",
  ] as const)("allows only allowlisted SIWE authentication and reads without arming in %s", (mode) => {
    expect(
      assertV2LaunchSigningAllowed(
        { method: "personal_sign", params: [buildLegacySiweMessage(address, "nonce12345")] },
        address,
        mode,
        false,
        undefined,
      ),
    ).toBe(false);
    expect(
      assertV2LaunchSigningAllowed({ method: "eth_accounts" }, address, mode, false, undefined),
    ).toBe(false);
    expect(() =>
      assertV2LaunchSigningAllowed(
        {
          method: "personal_sign",
          params: [buildLegacySiweMessage(`0x${"1".repeat(40)}`, "nonce12345")],
        },
        address,
        mode,
        false,
        "1",
      ),
    ).toThrow("Launch signing is disarmed");
  });

  it("requires both arming and explicit opt-in for signed financial requests", () => {
    for (const method of financialMethods) {
      const request = { method, params: ["Authorize fund launch"] };
      expect(() => assertV2LaunchSigningAllowed(request, address, "signed", false, "1")).toThrow(
        "Launch signing is disarmed",
      );
      expect(() =>
        assertV2LaunchSigningAllowed(request, address, "signed", true, undefined),
      ).toThrow("Launch signing is disarmed");
      expect(() => assertV2LaunchSigningAllowed(request, address, "signed", true, "0")).toThrow(
        "Launch signing is disarmed",
      );
      if (method === "eth_sendRawTransaction") {
        expect(() => assertV2LaunchSigningAllowed(request, address, "signed", true, "1")).toThrow(
          "Only Node-side eth_sendTransaction signing is permitted",
        );
      } else {
        expect(assertV2LaunchSigningAllowed(request, address, "signed", true, "1")).toBe(true);
      }
    }
  });
});
