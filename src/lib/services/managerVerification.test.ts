/**
 * POO-745: the mock `managerService.requestVerification` — the session stand-in for POO-744's
 * `POST /managers/me/verification/request`. Mirrors the API's lifecycle: generate-on-first-request,
 * idempotent-on-pending (same code, no regeneration), reject-when-already-valid.
 */
import { afterEach, describe, expect, it } from "vitest";
import { managerService, resetMockManagerState } from "./index";

afterEach(() => {
  resetMockManagerState();
});

describe("mock managerService.requestVerification", () => {
  it("generates a pending status + an 8-char code on the first request (none -> pending)", async () => {
    // apex-quant is a seeded manager with managerVerification 'none'.
    const result = await managerService.requestVerification("apex-quant");
    expect(result.status).toBe("pending");
    expect(result.code).toMatch(/^[0-9A-Z]{8}$/);
    expect(result.message).toContain(result.code);

    // The session profile now reads pending (so a reload shows "Pending validation").
    const profile = await managerService.getProfile("apex-quant");
    expect(profile?.managerVerification).toBe("pending");
  });

  it("is idempotent while pending: a re-request returns the SAME code with no regeneration", async () => {
    const first = await managerService.requestVerification("apex-quant");
    const second = await managerService.requestVerification("apex-quant");
    expect(second.code).toBe(first.code);
    expect(second.status).toBe("pending");
  });

  it("never exposes the code on the public profile read (secret)", async () => {
    const { code } = await managerService.requestVerification("apex-quant");
    const profile = await managerService.getProfile("apex-quant");
    expect(JSON.stringify(profile)).not.toContain(code);
  });

  it("rejects when the manager is already valid (aave-labs)", async () => {
    await expect(managerService.requestVerification("aave-labs")).rejects.toThrow();
  });

  it("throws for an unknown manager", async () => {
    await expect(managerService.requestVerification("no-such-manager")).rejects.toThrow();
  });
});
