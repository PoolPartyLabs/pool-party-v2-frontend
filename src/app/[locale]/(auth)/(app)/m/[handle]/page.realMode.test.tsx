/**
 * @id PP-MGR-SCR-005 (POO-895)
 * @name ManagerProfilePage.realMode.test
 * @implements-rules-version v1
 *
 * Real-mode route test for /m/[handle]: the owner check resolves SERVER-SIDE from the SIWE session
 * wallet (`getSessionWallet`, the identity the backend trusts), case-insensitively (R1). A signed-out
 * viewer or a different wallet never sees the flag (R3); a missing/expired session resolves as
 * not-owner, never an error (R4); the owner's synthesized profile is owned too (R5). Mock-mode
 * ownership (dashboard address, R6) lives in page.test.tsx.
 */
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagerProfile, Strategy } from "@/lib/schemas";
import ManagerProfilePage from "./page";

const { fetchManagerProfile, getSessionWallet, list, notFound, setRequestLocale } = vi.hoisted(
  () => ({
    fetchManagerProfile: vi.fn<(param: string) => Promise<ManagerProfile | null>>(),
    getSessionWallet: vi.fn<() => Promise<`0x${string}` | null>>(),
    list: vi.fn<() => Promise<Strategy[]>>(),
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    setRequestLocale: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({ setRequestLocale }));
// Real mode: the route must read the registry via fetchManagerProfile and the viewer via the SIWE
// session wallet; the mock manager service must NOT be consulted (its methods are absent here).
vi.mock("@/lib/services", () => ({
  isMockMode: false,
  managerService: {},
}));
vi.mock("@/lib/manager/profile/fetchManagerProfile", () => ({ fetchManagerProfile }));
vi.mock("@/lib/auth/session", () => ({ getSessionWallet }));
vi.mock("@/lib/strategies/strategyCatalog", () => ({ listStrategies: list }));
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

describe("ManagerProfilePage owner flag, real mode (POO-895)", () => {
  beforeEach(() => {
    fetchManagerProfile.mockReset();
    getSessionWallet.mockReset();
    list.mockReset();
    notFound.mockClear();
    setRequestLocale.mockClear();
  });

  it("[R1] owns the registered profile when the session wallet matches, case-insensitively", async () => {
    // Checksummed registry address vs the lowercase session wallet (getSessionWallet lowercases).
    const checksummed = `0x${ADDRESS.slice(2).toUpperCase()}`;
    fetchManagerProfile.mockResolvedValue({
      handle: "",
      name: "",
      address: checksummed,
    } as ManagerProfile);
    getSessionWallet.mockResolvedValue(ADDRESS as `0x${string}`);
    list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS })]);

    const el = await render(ADDRESS);
    expect(el.props.isOwner).toBe(true);
  });

  it("[R3] a DIFFERENT session wallet is not the owner", async () => {
    fetchManagerProfile.mockResolvedValue({
      handle: "",
      name: "",
      address: ADDRESS,
    } as ManagerProfile);
    getSessionWallet.mockResolvedValue("0x00000000000000000000000000000000000000aa");
    list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS })]);

    const el = await render(ADDRESS);
    expect(el.props.isOwner).toBe(false);
  });

  it("[R4] a missing/expired session (null wallet) resolves as not-owner, never an error", async () => {
    fetchManagerProfile.mockResolvedValue({
      handle: "",
      name: "",
      address: ADDRESS,
    } as ManagerProfile);
    // getSessionWallet already maps missing/expired/malformed cookies to null; the route must
    // degrade that to "not owner" without throwing.
    getSessionWallet.mockResolvedValue(null);
    list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS })]);

    const el = await render(ADDRESS);
    expect(notFound).not.toHaveBeenCalled();
    expect(el.props.isOwner).toBe(false);
  });

  it("[R3] a registered profile with NO wallet address is never owned", async () => {
    fetchManagerProfile.mockResolvedValue({ handle: "carlos", name: "Carlos" } as ManagerProfile);
    getSessionWallet.mockResolvedValue(ADDRESS as `0x${string}`);
    list.mockResolvedValue([strategy({ id: "a", managerHandle: "carlos" })]);

    const el = await render("carlos");
    expect(el.props.isOwner).toBe(false);
  });

  it("[R5] the owner's SYNTHESIZED (no-registry-row) profile carries isOwner", async () => {
    fetchManagerProfile.mockResolvedValue(null);
    getSessionWallet.mockResolvedValue(ADDRESS as `0x${string}`);
    // The route param arrives checksummed; ownership still resolves case-insensitively.
    const checksummed = `0x${ADDRESS.slice(2).toUpperCase()}`;
    list.mockResolvedValue([strategy({ id: "a", managerAddress: ADDRESS })]);

    const el = await render(checksummed);
    expect(el.props.profile.name).toBe("");
    expect(el.props.isOwner).toBe(true);
  });
});
