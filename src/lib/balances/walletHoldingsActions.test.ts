import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), holdings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: mocks.session }));
vi.mock("@/lib/balances/fetchWalletHoldings", () => ({ fetchWalletHoldings: mocks.holdings }));

import { getWalletHoldingsAction } from "./walletHoldingsActions";

beforeEach(() => {
  vi.clearAllMocks();
});
it("R1 missing SIWE is unavailable, so public reads can fall back", async () => {
  mocks.session.mockResolvedValue(null);
  expect(await getWalletHoldingsAction()).toBeNull();
  expect(mocks.holdings).not.toHaveBeenCalled();
});
it("R1 a successful empty holdings response remains authoritative", async () => {
  mocks.session.mockResolvedValue("0xabc");
  mocks.holdings.mockResolvedValue([]);
  expect(await getWalletHoldingsAction()).toEqual([]);
});
it("R4 rejects a session for a different connected wallet", async () => {
  mocks.session.mockResolvedValue("0xabc");
  expect(await getWalletHoldingsAction("0xdef")).toBeNull();
  expect(mocks.holdings).not.toHaveBeenCalled();
});
