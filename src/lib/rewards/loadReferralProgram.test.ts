/**
 * @id PP-REW-LIB-005 (POO-661)
 * @name loadReferralProgram tests
 * @implements-rules-version v1
 *
 * [R1][R5] The resolver picks the mock rewards service in mock mode and the real pp-api read (wallet
 * from the SIWE session) in real mode. No session wallet in real mode → the empty program (fetchReferral
 * with no address), never the mock fixture. Mirrors loadInvestorProfile.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionWallet = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: () => getSessionWallet(),
}));

const fetchReferral = vi.fn();
vi.mock("./fetchReferral", () => ({
  fetchReferral: (...args: unknown[]) => fetchReferral(...args),
}));

const getReferral = vi.fn();
let mockModeFlag = true;
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mockModeFlag;
  },
  rewardsService: { getReferral: () => getReferral() },
}));

async function importModule(mockMode: boolean) {
  mockModeFlag = mockMode;
  vi.resetModules();
  return import("./loadReferralProgram");
}

describe("loadReferralProgram", () => {
  beforeEach(() => {
    getSessionWallet.mockReset();
    fetchReferral.mockReset();
    getReferral.mockReset();
  });

  // @rule R1: mock mode → the mock rewards service, no session read, no real fetch
  it("returns the mock program in mock mode (no session read, no real fetch)", async () => {
    getReferral.mockResolvedValue({ code: "MOCK", invites: [] });
    const { loadReferralProgram } = await importModule(true);

    expect(await loadReferralProgram()).toEqual({ code: "MOCK", invites: [] });
    expect(getSessionWallet).not.toHaveBeenCalled();
    expect(fetchReferral).not.toHaveBeenCalled();
  });

  // @rule R1/R5: real mode → fetchReferral with the session wallet
  it("reads the real referral program with the session wallet in real mode", async () => {
    getSessionWallet.mockResolvedValue("0xabc");
    fetchReferral.mockResolvedValue({ code: "REAL", invites: [] });
    const { loadReferralProgram } = await importModule(false);

    expect(await loadReferralProgram()).toEqual({ code: "REAL", invites: [] });
    expect(fetchReferral).toHaveBeenCalledWith("0xabc");
    expect(getReferral).not.toHaveBeenCalled();
  });

  // @rule R5: no session wallet in real mode → fetchReferral(undefined) (empty program), never the mock
  it("calls fetchReferral with no address when there is no session wallet in real mode", async () => {
    getSessionWallet.mockResolvedValue(null);
    fetchReferral.mockResolvedValue({ code: null, invites: [] });
    const { loadReferralProgram } = await importModule(false);

    await loadReferralProgram();
    expect(fetchReferral).toHaveBeenCalledWith(undefined);
    expect(getReferral).not.toHaveBeenCalled();
  });
});
