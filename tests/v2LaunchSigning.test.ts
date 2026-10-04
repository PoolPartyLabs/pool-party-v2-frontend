import { describe, expect, it } from "vitest";
import {
  assertV2LaunchSigningAllowed,
  safeV2WalletCall,
  v2LaunchFailure,
  v2LaunchMode,
  v2LaunchStepLabel,
} from "../e2e/helpers/v2LaunchSigning";
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
  it("R4 normalizes numeric Review chains into journey heading names", () => {
    expect(v2LaunchStepLabel("Approve USDC", 42161)).toBe("Approve USDC · Arbitrum");
    expect(v2LaunchStepLabel("Create Robinhood spoke", 4663)).toBe(
      "Create Robinhood spoke · Robinhood Chain",
    );
    expect(() => v2LaunchStepLabel("Approve USDC", 1)).toThrow("V2_LAUNCH_UNKNOWN_CHAIN");
  });
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
        {
          method: "personal_sign",
          params: [buildLegacySiweMessage(address, "nonce12345"), address.toLowerCase()],
        },
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
      const request = { method, params: ["Authorize fund launch", address] };
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
  it("denies unknown RPC and wallet methods even in armed signed mode", () => {
    for (const method of [
      "eth_sendUserOperation",
      "wallet_sendCalls",
      "eth_signTransaction",
      "wallet_unknown",
      "debug_traceCall",
      "made_up",
    ]) {
      expect(() => assertV2LaunchSigningAllowed({ method }, address, "signed", true, "1")).toThrow(
        "Wallet method is not allowlisted",
      );
    }
  });
  it("requires the personal_sign signer to match the authorized wallet", () => {
    for (const signer of [undefined, `0x${"1".repeat(40)}`, "invalid"]) {
      expect(() =>
        assertV2LaunchSigningAllowed(
          {
            method: "personal_sign",
            params: [buildLegacySiweMessage(address, "nonce12345"), signer],
          },
          address,
          "signed",
          true,
          "1",
        ),
      ).toThrow("Unauthorized personal_sign signer");
    }
  });
  it("allows explicitly listed read RPC and wallet controls", () => {
    for (const method of [
      "eth_call",
      "eth_getBalance",
      "eth_getTransactionReceipt",
      "eth_feeHistory",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
    ]) {
      expect(
        assertV2LaunchSigningAllowed({ method }, address, "dry-launch", false, undefined),
      ).toBe(false);
    }
  });
  it("sanitizes callback failures before they can cross the browser bridge", async () => {
    await expect(
      safeV2WalletCall(async () => {
        throw new Error("upstream endpoint sensitive detail");
      }),
    ).rejects.toThrow(/^V2_WALLET_REQUEST_FAILED$/);
    expect(await safeV2WalletCall(async () => "public result")).toBe("public result");
  });
  it("R1-R5 persists only fixed failure codes rather than exception or UI text", () => {
    expect(v2LaunchFailure(false)).toEqual({ error: "V2_LAUNCH_FAILED" });
    expect(v2LaunchFailure(true)).toEqual({
      error: "V2_LAUNCH_FAILED",
      uiError: "V2_LAUNCH_UI_ERROR",
    });
  });
});
/**
 * @id PP-E2E-V2-003
 * @name launch safety regressions R1-R5
 * @implements-rules-version v1
 */
