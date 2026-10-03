import { describe, expect, it, vi } from "vitest";
import { createLaunchDriver, type FrozenLaunch } from "./driver";
import { createJournal } from "./journal";
import type { LaunchStep } from "./plan";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  capital: vi.fn(),
  balances: vi.fn(),
  fund: vi.fn(),
}));
vi.mock("@/lib/api/v2/launchActions", () => ({
  buildCreateFundAction: mocks.create,
  buildLaunchCapitalAction: mocks.capital,
  readLaunchBalancesAction: mocks.balances,
  readLaunchFundAction: mocks.fund,
}));
const manager = `0x${"12".repeat(20)}`;
const core = `0x${"34".repeat(20)}`;
const frozen = { request: { manager }, review: {} } as FrozenLaunch;
const setup = () => {
  const wallet = {
    send: vi.fn(async () => "hash"),
    receipt: vi.fn(async () => null),
    sign: vi.fn(async () => "signature"),
  };
  const driver = createLaunchDriver(wallet);
  const journal = createJournal("draft", manager, frozen, []);
  journal.addresses.coreVault = core;
  journal.principal = "99000000";
  return { driver, journal, wallet };
};
describe("just-in-time launch driver [R2, R3, R6]", () => {
  it("skips existing allowance but refuses approval-only payload as create", async () => {
    const { driver, journal } = setup();
    mocks.create.mockResolvedValue({ ok: true, data: { transactions: [] } });
    expect(
      await driver.build(
        { id: "approve", kind: "approve", chain: 42161, dependencies: [] },
        journal,
      ),
    ).toEqual({ complete: true });
    mocks.create.mockResolvedValue({
      ok: true,
      data: { transactions: [], nextAction: "approval" },
    });
    await expect(
      driver.build({ id: "create", kind: "create", chain: 42161, dependencies: [] }, journal),
    ).rejects.toThrow("ALLOWANCE_CHANGED");
  });
  it("allocates net principal and validates sender and chain before the wallet", async () => {
    const { driver, journal, wallet } = setup();
    mocks.capital.mockResolvedValue({
      ok: true,
      data: {
        transactions: [{ from: manager, to: core, chainId: 42161, value: "0", data: "0x12345678" }],
      },
    });
    const step: LaunchStep = {
      id: "allocate",
      kind: "allocate",
      chain: 42161,
      dependencies: [],
      sharePct: 40,
    };
    await driver.build(step, journal);
    expect(mocks.capital).toHaveBeenLastCalledWith(
      core,
      expect.objectContaining({ amount: "39600000" }),
    );
    mocks.capital.mockResolvedValue({
      ok: true,
      data: {
        transactions: [{ from: core, to: core, chainId: 4663, value: "0", data: "0x12345678" }],
      },
    });
    await expect(driver.build(step, journal)).rejects.toThrow("UNSAFE_TRANSACTION");
    expect(wallet.send).not.toHaveBeenCalled();
  });
  it("ambiguous create submission without a hash cannot be retried as new creation", async () => {
    const { driver, journal } = setup();
    await expect(
      driver.reconcile(
        { id: "create", kind: "create", chain: 42161, dependencies: [] },
        {
          stepId: "create",
          chain: 42161,
          status: "failed",
          error: "SUBMISSION_RECONCILIATION_REQUIRED",
        },
        journal,
      ),
    ).rejects.toThrow("SUBMISSION_RECONCILIATION_REQUIRED");
  });
});
