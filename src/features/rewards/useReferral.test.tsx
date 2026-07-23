/**
 * @id PP-REW-LIB-001 (POO-661)
 * @name useReferral tests
 * @implements-rules-version v1
 *
 * [R1] The shared referral hook reads the mock rewards service in mock mode (byte-unchanged) and the
 * real pp-api referral data via the `getReferralAction` Server Action in real mode. [R7] A failed real
 * read leaves the program null (surfaces render their skeleton) rather than throwing.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isMockMode: true,
  getReferral: vi.fn(),
  createReferralCode: vi.fn(),
  getReferralAction: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.isMockMode;
  },
  rewardsService: {
    getReferral: (...args: unknown[]) => mocks.getReferral(...args),
    createReferralCode: (...args: unknown[]) => mocks.createReferralCode(...args),
  },
}));
vi.mock("./actions", () => ({
  getReferralAction: (...args: unknown[]) => mocks.getReferralAction(...args),
}));

import { __resetReferralStateForTests, useReferral } from "./useReferral";

const emptyProgram = {
  rewardUsd: 10,
  minInvestUsd: 50,
  totalEarnedUsd: 0,
  friendsJoined: 0,
  code: null,
  inviteLink: null,
  invites: [],
};

afterEach(() => {
  mocks.isMockMode = true;
  mocks.getReferral.mockReset();
  mocks.createReferralCode.mockReset();
  mocks.getReferralAction.mockReset();
  __resetReferralStateForTests();
});

describe("useReferral (mock mode)", () => {
  // @rule R1: mock mode fetches via the mock rewards service, never the server action
  it("fetches the program from the mock rewards service", async () => {
    mocks.getReferral.mockResolvedValue({ ...emptyProgram, code: "MOCK" });
    const { result } = renderHook(() => useReferral());
    expect(result.current.program).toBeNull();
    await waitFor(() => expect(result.current.program?.code).toBe("MOCK"));
    expect(mocks.getReferralAction).not.toHaveBeenCalled();
  });
});

describe("useReferral (real mode)", () => {
  // @rule R1: real mode fetches real pp-api referral data via the server action, never the mock
  it("fetches real pp-api referral data via the server action", async () => {
    mocks.isMockMode = false;
    mocks.getReferralAction.mockResolvedValue({ ...emptyProgram, code: "REAL", friendsJoined: 2 });
    const { result } = renderHook(() => useReferral());
    expect(result.current.program).toBeNull();
    await waitFor(() => expect(result.current.program?.code).toBe("REAL"));
    expect(result.current.program?.friendsJoined).toBe(2);
    expect(mocks.getReferral).not.toHaveBeenCalled();
  });

  // @rule R7: a failed real read leaves the program null (skeleton), never throws
  it("leaves the program null when the real read fails", async () => {
    mocks.isMockMode = false;
    mocks.getReferralAction.mockRejectedValue(new Error("outage"));
    const { result } = renderHook(() => useReferral());
    await waitFor(() => expect(mocks.getReferralAction).toHaveBeenCalled());
    expect(result.current.program).toBeNull();
  });
});
