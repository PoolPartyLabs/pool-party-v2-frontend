/**
 * @id PP-MGR-SCR-005 (POO-631)
 * @name ManagerProfilePage.test
 * Route test for /m/[handle]: resolves a registered handle/profile, synthesizes a generic profile
 * for a wallet address that runs strategies, and 404s otherwise (POO-618 / POO-631). POO-895 adds
 * the mock-mode owner flag (viewer = the mock dashboard address); the real-mode owner flag (SIWE
 * session wallet) lives in page.realMode.test.tsx.
 */
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagerProfile, Strategy } from "@/lib/schemas";
import ManagerProfilePage from "./page";

const { getProfile, getDashboard, list, notFound, setRequestLocale, log } = vi.hoisted(() => ({
  getProfile: vi.fn<(param: string) => Promise<ManagerProfile | null>>(),
  // POO-895 R6: in mock mode the viewer identity is the mock dashboard's manager address.
  getDashboard: vi.fn<() => Promise<{ address?: string }>>(),
  list: vi.fn<() => Promise<Strategy[]>>(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  setRequestLocale: vi.fn(),
  // POO-781 R3 (site 1): an ordered log of which read entered, so a timing test can prove the catalog
  // drain and the profile read run concurrently rather than the catalog serializing ahead of it.
  log: { calls: [] as string[] },
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({ setRequestLocale }));
// isMockMode true so the route resolves the registered profile via the mock service (POO-579: real
// mode reads the deployed registry via fetchManagerProfile — covered in that module's own tests).
vi.mock("@/lib/services", () => ({
  isMockMode: true,
  managerService: { getProfile, getDashboard },
}));
vi.mock("@/lib/strategies/strategyCatalog", () => ({
  listStrategies: list,
}));
// Keep the test about routing — stub the screen so we can read the props the route passes it without
// loading the full component tree.
vi.mock("@/features/manager/ManagerProfileScreen", () => ({
  ManagerProfileScreen: () => null,
}));

const ADDRESS = "0x77d2e9a1b3c5d7f9a0b1c2d3e4f5a6b7c8d9e0f1";

function strategy(overrides: Partial<Strategy>): Strategy {
  return {
    id: "s",
    name: "S",
    manager: "M",
    riskLevel: 3,
    minInvestment: 100,
    tvl: 0,
    investors: 0,
    estReturn: 0,
    rateType: "APR",
    status: "active",
    ...overrides,
  };
}

type ScreenProps = { profile: ManagerProfile; strategies: Strategy[]; isOwner: boolean };

async function render(param: string): Promise<ReactElement<ScreenProps>> {
  return (await ManagerProfilePage({
    params: Promise.resolve({ locale: "en", handle: param }),
  })) as ReactElement<ScreenProps>;
}

/** A manually-released deferred promise, for the POO-781 R3 concurrency gate. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("ManagerProfilePage (POO-631)", () => {
  beforeEach(() => {
    getProfile.mockReset();
    getDashboard.mockReset();
    // POO-895: default viewer = some OTHER manager, so pre-existing tests exercise the non-owner path.
    getDashboard.mockResolvedValue({ address: "0x00000000000000000000000000000000000000aa" });
    list.mockReset();
    notFound.mockClear();
    setRequestLocale.mockClear();
    log.calls = [];
  });

  // POO-781 @rule R1/R3 (site 1): the catalog drain (`listStrategies`) and the profile read run
  // concurrently — the profile no longer waits for the full catalog first. We GATE the catalog drain:
  // if the route still did `await listStrategies()` before reading the profile, the profile read would
  // never enter while the gate holds, and the assertion below fails.
  it("[POO-781 R3] reads the manager profile without awaiting the full catalog first", async () => {
    const gate = deferred();
    list.mockImplementation(async () => {
      log.calls.push("catalog");
      await gate.promise;
      return [strategy({ id: "a", managerAddress: ADDRESS })];
    });
    getProfile.mockImplementation(async () => {
      log.calls.push("profile");
      return { handle: "", name: "", address: ADDRESS } as ManagerProfile;
    });

    const pending = render(ADDRESS);
    // Drain the microtask queue (a macrotask flush) so both concurrently-initiated legs reach their
    // entry log while the catalog stays blocked on the gate.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The profile read has entered even though the catalog drain is still blocked, proving both legs
    // were initiated together.
    expect(log.calls).toContain("catalog");
    expect(log.calls).toContain("profile");

    // Release the gate; the route resolves with identical rendering semantics.
    gate.release();
    const el = await pending;
    expect(el.props.strategies.map((s) => s.id)).toEqual(["a"]);
    expect(el.props.profile.address).toBe(ADDRESS);
  });

  it("renders a registered address profile with its strategies (filtered by managerAddress)", async () => {
    // POO-659: the dev-login manager is now UNFILLED + address-based (empty handle), so a registered
    // profile filters its strategies by `managerAddress`, not by handle.
    const profile = { handle: "", name: "", address: ADDRESS } as ManagerProfile;
    getProfile.mockResolvedValue(profile);
    list.mockResolvedValue([
      strategy({ id: "a", managerAddress: ADDRESS }),
      strategy({ id: "b", managerAddress: "0x0000000000000000000000000000000000000001" }),
    ]);

    const el = await render(ADDRESS);
    expect(setRequestLocale).toHaveBeenCalledWith("en");
    expect(el.props.profile).toBe(profile);
    expect(el.props.strategies.map((s: Strategy) => s.id)).toEqual(["a"]);
  });

  it("[R3] synthesizes a generic profile for an address that runs strategies", async () => {
    getProfile.mockResolvedValue(null);
    list.mockResolvedValue([
      strategy({ id: "a", managerAddress: ADDRESS, tvl: 84_500, investors: 37, estReturn: 6.4 }),
      strategy({ id: "b", managerAddress: "0x0000000000000000000000000000000000000001" }),
    ]);

    const el = await render(ADDRESS);
    expect(notFound).not.toHaveBeenCalled();
    expect(el.props.profile.name).toBe("");
    expect(el.props.profile.address).toBe(ADDRESS);
    expect(el.props.profile.stats).toEqual({
      aum: 84_500,
      investors: 37,
      strategies: 1,
      avgApy: 6.4,
    });
    expect(el.props.strategies.map((s: Strategy) => s.id)).toEqual(["a"]);
  });

  it("[R3] matches the address case-insensitively (checksummed input)", async () => {
    getProfile.mockResolvedValue(null);
    // A checksummed address keeps `0x` lowercase and mixes the hex case.
    const checksummed = `0x${ADDRESS.slice(2).toUpperCase()}`;
    list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS.toLowerCase() })]);
    const el = await render(checksummed);
    expect(el.props.strategies.map((s) => s.id)).toEqual(["a"]);
    expect(el.props.profile.address).toBe(checksummed);
  });

  it("[R3] 404s for an address with no strategies", async () => {
    getProfile.mockResolvedValue(null);
    list.mockResolvedValue([
      strategy({ id: "a", managerAddress: "0x0000000000000000000000000000000000000009" }),
    ]);
    await expect(render(ADDRESS)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("404s for an unknown, non-address handle", async () => {
    getProfile.mockResolvedValue(null);
    list.mockResolvedValue([strategy({ id: "a", managerHandle: "carlos" })]);
    await expect(render("no-such-manager")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  // POO-895 rules v1 (mock-mode half). Real mode (SIWE session wallet) lives in
  // page.realMode.test.tsx; here the viewer identity is the mock dashboard address (R6).
  describe("[POO-895] owner Edit-profile flag (mock mode)", () => {
    it("[R6/R1] the dashboard manager owns their registered profile (case-insensitive)", async () => {
      // Checksummed dashboard wallet vs lowercase profile address: ownership must not depend on case.
      getDashboard.mockResolvedValue({ address: `0x${ADDRESS.slice(2).toUpperCase()}` });
      getProfile.mockResolvedValue({ handle: "", name: "", address: ADDRESS } as ManagerProfile);
      list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS })]);

      const el = await render(ADDRESS);
      expect(el.props.isOwner).toBe(true);
    });

    it("[R6/R3] a registered profile of a DIFFERENT wallet is not owned", async () => {
      getProfile.mockResolvedValue({ handle: "", name: "", address: ADDRESS } as ManagerProfile);
      list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS })]);

      const el = await render(ADDRESS);
      expect(el.props.isOwner).toBe(false);
    });

    it("[R3] a registered profile with NO wallet address is never owned", async () => {
      getDashboard.mockResolvedValue({ address: ADDRESS });
      getProfile.mockResolvedValue({ handle: "carlos", name: "Carlos" } as ManagerProfile);
      list.mockResolvedValue([strategy({ id: "a", managerHandle: "carlos" })]);

      const el = await render("carlos");
      expect(el.props.isOwner).toBe(false);
    });

    it("[R3] a missing dashboard address (no viewer identity) resolves as not-owner, never an error", async () => {
      getDashboard.mockResolvedValue({});
      getProfile.mockResolvedValue({ handle: "", name: "", address: ADDRESS } as ManagerProfile);
      list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS })]);

      const el = await render(ADDRESS);
      expect(el.props.isOwner).toBe(false);
    });

    it("[R5] the owner's SYNTHESIZED (no-registry-row) profile carries isOwner too", async () => {
      getDashboard.mockResolvedValue({ address: ADDRESS });
      getProfile.mockResolvedValue(null);
      list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS })]);

      const el = await render(ADDRESS);
      expect(el.props.profile.name).toBe("");
      expect(el.props.isOwner).toBe(true);
    });

    it("[R5/R3] someone ELSE's synthesized profile is not owned", async () => {
      getProfile.mockResolvedValue(null);
      list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS })]);

      const el = await render(ADDRESS);
      expect(el.props.isOwner).toBe(false);
    });
  });
});
