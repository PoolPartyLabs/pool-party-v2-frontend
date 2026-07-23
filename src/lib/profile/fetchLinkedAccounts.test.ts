/**
 * @id PP-PROF-LIB-008 (POO-110, POO-581)
 * @name fetchLinkedAccounts tests
 * @implements-rules-version v1
 *
 * The linked-accounts read + mock/real seam. `fetchLinkedAccounts` reads the OPEN endpoint with a
 * per-wallet cache window + tag and degrades a null read to an empty list. `loadLinkedAccounts` is the
 * seam the social page imports: mock mode returns NO fabricated connections without touching the API;
 * real mode reads the session wallet's accounts and degrades a read failure to an empty list so a
 * non-core outage never crashes the settings screen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  isMockMode: false,
  getSessionWallet: vi.fn(),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.isMockMode;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: (...args: unknown[]) => mocks.getSessionWallet(...args),
}));

import { fetchLinkedAccounts, linkedAccountsTag, loadLinkedAccounts } from "./fetchLinkedAccounts";

const address = "0x1a2b3c4d5e6f7890a1b2c3d4e5f6789012345678";

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.getSessionWallet.mockReset();
  mocks.isMockMode = false;
});

describe("linkedAccountsTag", () => {
  it("is a lowercased per-wallet tag so writer + reader resolve to the same tag", () => {
    expect(linkedAccountsTag("0xABC")).toBe("linked-accounts:0xabc");
  });
});

describe("fetchLinkedAccounts", () => {
  it("reads GET users/:address/linked-accounts with a per-wallet cache window + tag", async () => {
    mocks.apiFetch.mockResolvedValue([{ provider: "x", handle: "https://x.com/m" }]);

    const accounts = await fetchLinkedAccounts(address);

    const [path, opts] = mocks.apiFetch.mock.calls[0] as [
      string,
      { revalidate?: number; tags?: string[] },
    ];
    expect(path).toBe(`users/${address}/linked-accounts`);
    expect(opts.revalidate).toBeGreaterThan(0);
    expect(opts.tags).toEqual([`linked-accounts:${address}`]);
    expect(accounts).toEqual([{ provider: "x", handle: "https://x.com/m" }]);
  });

  it("maps a null (empty/204) read to an empty list", async () => {
    mocks.apiFetch.mockResolvedValue(null);
    expect(await fetchLinkedAccounts(address)).toEqual([]);
  });
});

describe("loadLinkedAccounts", () => {
  it("returns no connections in mock mode without reading the API", async () => {
    mocks.isMockMode = true;
    expect(await loadLinkedAccounts()).toEqual([]);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.getSessionWallet).not.toHaveBeenCalled();
  });

  it("returns no connections when there is no session wallet", async () => {
    mocks.getSessionWallet.mockResolvedValue(null);
    expect(await loadLinkedAccounts()).toEqual([]);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("reads the session wallet's accounts in real mode", async () => {
    mocks.getSessionWallet.mockResolvedValue(address);
    mocks.apiFetch.mockResolvedValue([{ provider: "telegram", handle: "https://t.me/m" }]);
    expect(await loadLinkedAccounts()).toEqual([
      { provider: "telegram", handle: "https://t.me/m" },
    ]);
  });

  it("degrades a read failure to an empty list so the settings screen never crashes", async () => {
    mocks.getSessionWallet.mockResolvedValue(address);
    mocks.apiFetch.mockRejectedValue(new Error("linked-accounts down"));
    expect(await loadLinkedAccounts()).toEqual([]);
  });
});
