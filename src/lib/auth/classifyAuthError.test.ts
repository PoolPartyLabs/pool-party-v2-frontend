/**
 * @id PP-AUTH (POO-199)
 * @name classifyAuthError tests
 * @implements-rules-version v1
 */
import { describe, expect, it } from "vitest";
import { classifyAuthError } from "./classifyAuthError";

describe("classifyAuthError", () => {
  // [R2] User-cancelled: exited_auth_flow, oauth_user_denied → "cancelled"
  it("classifies exited_auth_flow as cancelled", () => {
    expect(classifyAuthError("exited_auth_flow")).toBe("cancelled");
  });

  it("classifies oauth_user_denied as cancelled", () => {
    expect(classifyAuthError("oauth_user_denied")).toBe("cancelled");
  });

  // [R4] Unsupported chain → "unsupported-chain"
  it("classifies unsupported_chain_id as unsupported-chain", () => {
    expect(classifyAuthError("unsupported_chain_id")).toBe("unsupported-chain");
  });

  // [R3] Network/SDK errors → "network"
  it("classifies client_request_timeout as network", () => {
    expect(classifyAuthError("client_request_timeout")).toBe("network");
  });

  it("classifies unknown_auth_error as network", () => {
    expect(classifyAuthError("unknown_auth_error")).toBe("network");
  });

  it("classifies generic_connect_wallet_error as network", () => {
    expect(classifyAuthError("generic_connect_wallet_error")).toBe("network");
  });

  it("classifies unknown_connect_wallet_error as network", () => {
    expect(classifyAuthError("unknown_connect_wallet_error")).toBe("network");
  });

  it("classifies oauth_unexpected as network", () => {
    expect(classifyAuthError("oauth_unexpected")).toBe("network");
  });

  // [R3] Any unrecognized code falls back to "network"
  it("classifies an unrecognized code as network", () => {
    expect(classifyAuthError("some_future_error_code")).toBe("network");
  });

  // Edge: undefined/null input → "network" (defensive)
  it("classifies undefined as network", () => {
    expect(classifyAuthError(undefined as unknown as string)).toBe("network");
  });
});
