/**
 * @id PP-PROF-LIB-005 (POO-233, POO-426)
 * @name loadInvestorProfile tests
 * @implements-rules-version v1
 *
 * The resolver picks the mock session profile in mock mode and the real read (wallet from the SIWE
 * session, POO-233 R1) in real mode; no session wallet in real mode → a blank identity, never the mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionWallet = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: () => getSessionWallet(),
}));

const fetchInvestorProfile = vi.fn();
vi.mock("./fetchInvestorProfile", () => ({
  fetchInvestorProfile: (...args: unknown[]) => fetchInvestorProfile(...args),
}));

const profileGet = vi.fn();
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mockModeFlag;
  },
  profileService: { get: () => profileGet() },
}));

let mockModeFlag = true;

async function importModule(mockMode: boolean) {
  mockModeFlag = mockMode;
  vi.resetModules();
  return import("./loadInvestorProfile");
}

describe("loadInvestorProfile", () => {
  beforeEach(() => {
    getSessionWallet.mockReset();
    fetchInvestorProfile.mockReset();
    profileGet.mockReset();
  });

  // @rule POO-222 R7 (mock path unchanged)
  it("returns the mock session profile in mock mode (no session read)", async () => {
    profileGet.mockResolvedValue({ name: "Maria" });
    const { loadInvestorProfile } = await importModule(true);

    expect(await loadInvestorProfile()).toEqual({ name: "Maria" });
    expect(getSessionWallet).not.toHaveBeenCalled();
    expect(fetchInvestorProfile).not.toHaveBeenCalled();
  });

  // @rule POO-233 R1 (real mode reads after auth, wallet from the session)
  it("reads the real profile with the session wallet in real mode", async () => {
    getSessionWallet.mockResolvedValue("0xabc");
    fetchInvestorProfile.mockResolvedValue({ name: "Ana" });
    const { loadInvestorProfile } = await importModule(false);

    expect(await loadInvestorProfile()).toEqual({ name: "Ana" });
    expect(fetchInvestorProfile).toHaveBeenCalledWith("0xabc");
    expect(profileGet).not.toHaveBeenCalled();
  });

  // @rule POO-233 R1 (no session wallet → blank identity, never the mock fixture)
  it("returns a blank identity when there is no session wallet in real mode", async () => {
    getSessionWallet.mockResolvedValue(null);
    const { loadInvestorProfile } = await importModule(false);

    const user = await loadInvestorProfile();
    expect(user.name).toBe("");
    expect(user.quacks).toBe(0);
    expect(fetchInvestorProfile).not.toHaveBeenCalled();
    expect(profileGet).not.toHaveBeenCalled();
  });
});
