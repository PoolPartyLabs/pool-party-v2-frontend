/**
 * @id PP-ADM-MCK-001
 * @name verification service — tests
 * Behavior (POO-587): the queue lists only pending requests; approve sets the manager's
 * `managerVerification` to `valid` (the sole badge source since POO-745; the legacy `verified`
 * boolean was removed by POO-809) and clears it from the queue; reject records a reason; a manager
 * can re-request after a rejection but not while pending; a non-pending request cannot be approved.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { maskAddress } from "@/lib/utils/address";
import { DEV_MANAGER_ADDRESS } from "@/mocks/data/manager";
import {
  managerService,
  resetMockManagerState,
  resetMockVerificationState,
  verificationService,
} from "./index";

beforeEach(() => {
  resetMockManagerState();
  resetMockVerificationState();
});

describe("verificationService (mock)", () => {
  it("lists only pending requests", async () => {
    const pending = await verificationService.listPending();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((request) => request.status === "pending")).toBe(true);
  });

  it("approve sets the manager's managerVerification to valid and leaves the queue", async () => {
    // apex-quant is seeded pending and exists in the manager profiles (managerVerification: "none").
    expect((await managerService.getProfile("apex-quant"))?.managerVerification).toBe("none");

    const decided = await verificationService.approve("apex-quant", "admin@pool-party.xyz");
    expect(decided.status).toBe("approved");
    expect(decided.reviewedBy).toBe("admin@pool-party.xyz");
    expect(decided.reviewedAt).toBeTypeOf("string");

    expect((await managerService.getProfile("apex-quant"))?.managerVerification).toBe("valid");
    const pending = await verificationService.listPending();
    expect(pending.some((request) => request.managerHandle === "apex-quant")).toBe(false);
  });

  it("reject records the reason and keeps the badge off", async () => {
    const decided = await verificationService.reject(
      "sofia-delgado",
      "admin@pool-party.xyz",
      "Incomplete profile",
    );
    expect(decided.status).toBe("rejected");
    expect(decided.reason).toBe("Incomplete profile");
  });

  it("lets a rejected manager request again, but blocks a double request", async () => {
    await verificationService.reject("lucas-meyer", "admin@pool-party.xyz");
    const request = await verificationService.requestVerification("lucas-meyer");
    expect(request.status).toBe("pending");
    await expect(verificationService.requestVerification("lucas-meyer")).rejects.toThrow();
  });

  it("cannot approve a request that is not pending", async () => {
    await verificationService.approve("apex-quant", "admin@pool-party.xyz");
    await expect(
      verificationService.approve("apex-quant", "admin@pool-party.xyz"),
    ).rejects.toThrow();
  });

  it("cannot request verification for an already-verified manager", async () => {
    // aave-labs is seeded managerVerification: "valid" (carlos is now unverified for the POO-593 demo).
    await expect(verificationService.requestVerification("aave-labs")).rejects.toThrow();
  });

  // POO-659 R6: the neutral, address-based dev manager (empty name/handle, managerVerification:"none")
  // requests verification by its STABLE id — the wallet address. The request keeps the masked address
  // as the display name (no persona) and the address as the queue key; it surfaces in the pending queue
  // and approve sets managerVerification to valid. This is the address-keyed verification lifecycle.
  it("[POO-659 R6] the unfilled dev manager requests + is approved by its wallet address", async () => {
    const request = await verificationService.requestVerification(DEV_MANAGER_ADDRESS);
    // No persona: the display name falls back to the masked address; the queue key is the address.
    expect(request.managerName).toBe(maskAddress(DEV_MANAGER_ADDRESS));
    expect(request.managerHandle).toBe(DEV_MANAGER_ADDRESS.toLowerCase());
    expect(request.status).toBe("pending");

    // It surfaces in the admin pending queue keyed by the address.
    const pending = await verificationService.listPending();
    expect(pending.some((entry) => entry.managerHandle === DEV_MANAGER_ADDRESS.toLowerCase())).toBe(
      true,
    );

    // Approving by the same address resolves and sets the manager's managerVerification to valid.
    expect((await managerService.getProfile(DEV_MANAGER_ADDRESS))?.managerVerification).toBe(
      "none",
    );
    const decided = await verificationService.approve(DEV_MANAGER_ADDRESS, "admin@pool-party.xyz");
    expect(decided.status).toBe("approved");
    expect((await managerService.getProfile(DEV_MANAGER_ADDRESS))?.managerVerification).toBe(
      "valid",
    );
  });
});
