import { describe, expect, it, vi } from "vitest";
import { createLaunchDriver, type FrozenLaunch } from "./driver";
import { createJournal } from "./journal";
import type { LaunchStep } from "./plan";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  capital: vi.fn(),
  balances: vi.fn(),
  fund: vi.fn(),
  spoke: vi.fn(),
  discover: vi.fn(),
  profile: vi.fn(),
  putProfile: vi.fn(),
  quote: vi.fn(),
  transit: vi.fn(),
  report: vi.fn(),
  trigger: vi.fn(),
  open: vi.fn(),
  swap: vi.fn(),
  pool: vi.fn(),
}));
vi.mock("@/lib/api/v2/launchActions", () => ({
  buildCreateFundAction: mocks.create,
  buildLaunchCapitalAction: mocks.capital,
  readLaunchBalancesAction: mocks.balances,
  readLaunchFundAction: mocks.fund,
  buildSpokeAction: mocks.spoke,
  discoverLaunchFundAction: mocks.discover,
  readLaunchProfileAction: mocks.profile,
  putLaunchProfileAction: mocks.putProfile,
  quoteLaunchBridgeAction: mocks.quote,
  readLaunchTransitAction: mocks.transit,
  readLaunchReportAction: mocks.report,
  triggerLaunchReportAction: mocks.trigger,
  buildLaunchPositionAction: mocks.open,
  buildLaunchSwapAction: mocks.swap,
}));
vi.mock("@/lib/api/v2/actions", () => ({ getCatalogPoolAction: mocks.pool }));
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
  it("opens hub Aave only from actual USDC and refuses insufficient balances", async () => {
    const { driver, journal } = setup();
    journal.frozen = {
      ...frozen,
      request: { manager, chains: [{ chainId: 42161, tokens: [core] }] },
    };
    mocks.fund.mockResolvedValue({
      ok: true,
      data: {
        chains: [
          { chainId: "42161", uniswapV4Adapter: manager, aaveV3Adapter: manager, spokeVault: core },
        ],
      },
    });
    mocks.balances.mockResolvedValue({
      ok: true,
      data: {
        balancesStatus: "available",
        tokens: [{ token: core, unallocatedBalance: "99000000" }],
      },
    });
    mocks.open.mockResolvedValue({
      ok: true,
      data: {
        transactions: [{ from: manager, to: core, chainId: 42161, value: "0", data: "0x1234" }],
      },
    });
    const step: LaunchStep = {
      id: "aave",
      kind: "open",
      chain: 42161,
      dependencies: [],
      sharePct: 40,
      protocol: "aave-v3",
      config: { assetKey: `arbitrum:${core}` },
    };
    await driver.build(step, journal);
    expect(mocks.open).toHaveBeenLastCalledWith(
      core,
      expect.objectContaining({ amount: "39.6", adapter: manager }),
    );
    mocks.balances.mockResolvedValueOnce({
      ok: true,
      data: { balancesStatus: "available", tokens: [{ token: core, unallocatedBalance: "1" }] },
    });
    await expect(driver.build(step, journal)).rejects.toThrow("BALANCE_CHANGED");
    mocks.balances.mockResolvedValueOnce({
      ok: true,
      data: { balancesStatus: "unavailable", tokens: [] },
    });
    await expect(driver.build(step, journal)).rejects.toThrow("BALANCES_UNAVAILABLE");
  });
  it("recomputes v4 swaps and bounded open amounts from live balances", async () => {
    const { driver, journal, wallet } = setup();
    const poolId = `0x${"ab".repeat(32)}`;
    const zero = `0x${"00".repeat(20)}`;
    const token = (address: string, decimals: number) => ({
      protocolVersion: "v2",
      chainId: "42161",
      address,
      symbol: "TKN",
      name: "Token",
      decimals,
      logoUrl: null,
      hubPriced: true,
      priceUsd: "1",
      priceUpdatedAt: null,
      priceSource: core,
      priceProvenance: "fixed-1:1",
      priceUnavailableReason: null,
    });
    const pool = {
      protocolVersion: "v2",
      chainId: "42161",
      adapterKind: "uniswap-v4",
      poolId,
      poolKey: {
        protocolVersion: "v2",
        currency0: core,
        currency1: manager,
        fee: 500,
        tickSpacing: 10,
        hooks: zero,
      },
      tokens: [token(core, 6), token(manager, 18)],
      pairSymbols: ["USDC", "WETH"],
      hooked: false,
      currentTick: 0,
      sqrtPriceX96: "1",
      currentPrice: { protocolVersion: "v2", token1PerToken0: "4", token0PerToken1: "0.25" },
      liquidity: "1",
      eligible: true,
      registration: "at-fund-creation",
      tvlUsd: null,
      feesApr: null,
      tvlUnavailableReason: "unavailable",
      feesAprUnavailableReason: "unavailable",
    };
    journal.frozen = {
      ...frozen,
      request: {
        manager,
        chains: [{ chainId: 42161, tokens: [core, manager], uniswapV4PoolIds: [poolId] }],
      },
    };
    mocks.fund.mockResolvedValue({
      ok: true,
      data: {
        chains: [
          { chainId: "42161", uniswapV4Adapter: manager, aaveV3Adapter: manager, spokeVault: core },
        ],
      },
    });
    mocks.pool.mockResolvedValue({ ok: true, data: pool });
    mocks.balances.mockResolvedValue({
      ok: true,
      data: {
        balancesStatus: "available",
        tokens: [
          { token: core, unallocatedBalance: "99000000" },
          { token: manager, unallocatedBalance: "0" },
        ],
      },
    });
    const built = {
      transactions: [{ from: manager, to: core, chainId: 42161, value: "0", data: "0x1234" }],
    };
    mocks.swap.mockResolvedValue({ ok: true, data: built });
    mocks.open.mockResolvedValue({ ok: true, data: built });
    const step: LaunchStep = {
      id: "v4:swap",
      kind: "swap",
      chain: 42161,
      dependencies: [],
      sharePct: 40,
      protocol: "uniswap-v4",
      config: { poolId, priceLower: "1", priceUpper: "9", maxLossBps: 100 },
    };
    await driver.build(step, journal);
    expect(mocks.swap).toHaveBeenCalledWith(
      expect.objectContaining({ core, tokenIn: core, tokenOut: manager, maxLossBps: 100 }),
    );
    mocks.balances.mockResolvedValue({
      ok: true,
      data: {
        balancesStatus: "available",
        tokens: [
          { token: core, unallocatedBalance: "99000000" },
          { token: manager, unallocatedBalance: "1000000000000000000000" },
        ],
      },
    });
    expect(await driver.build(step, journal)).toEqual({ complete: true });
    await driver.build({ ...step, id: "v4:open", kind: "open" }, journal);
    expect(mocks.open).toHaveBeenLastCalledWith(
      core,
      expect.objectContaining({
        poolKey: poolId,
        priceLower: "1",
        priceUpper: "9",
        amount0Min: expect.not.stringMatching(/^0(?:\.0+)?$/),
      }),
    );
    await driver.send(step, built.transactions[0]);
    expect(wallet.send).toHaveBeenCalled();
    await expect(driver.send({ ...step, chain: 4663 }, built.transactions[0])).rejects.toThrow(
      "UNSAFE_TRANSACTION",
    );
  });
  it("creates the spoke from the exact successful create payload and verifies discovery", async () => {
    const { driver, journal } = setup();
    const hash = `0x${"ab".repeat(32)}`;
    journal.checkpoints.create = {
      stepId: "create",
      chain: 42161,
      status: "confirmed",
      data: { provision: { creationNumber: "1", mandate: { manager }, mandateHash: hash } },
    };
    mocks.spoke.mockResolvedValue({
      ok: true,
      data: {
        transactions: [{ from: manager, to: core, chainId: 4663, value: "0", data: "0x1234" }],
      },
    });
    await driver.build({ id: "spoke", kind: "spoke", chain: 4663, dependencies: [] }, journal);
    expect(mocks.spoke).toHaveBeenLastCalledWith({
      from: manager,
      creationNumber: "1",
      mandate: { manager },
      mandateHash: hash,
    });
    mocks.discover.mockResolvedValue({
      ok: true,
      data: {
        coreVault: core,
        manager,
        mandateHash: hash,
        chains: [{ chainId: "4663", status: "pending" }],
      },
    });
    expect(
      await driver.build(
        { id: "discover-spoke", kind: "discover", chain: 4663, dependencies: [] },
        journal,
      ),
    ).toEqual({});
    mocks.discover.mockResolvedValue({
      ok: true,
      data: {
        coreVault: core,
        manager,
        mandateHash: hash,
        chains: [{ chainId: "4663", status: "created" }],
      },
    });
    expect(
      await driver.build(
        { id: "discover-spoke", kind: "discover", chain: 4663, dependencies: [] },
        journal,
      ),
    ).toMatchObject({ complete: true });
  });
  it("waits for credited arrival, rejects refund and stores actual net credit", async () => {
    const { driver, journal } = setup();
    journal.checkpoints.bridge = {
      stepId: "bridge",
      chain: 42161,
      status: "confirmed",
      data: { transitId: "transit" },
    };
    const step: LaunchStep = { id: "arrival", kind: "arrival", chain: 4663, dependencies: [] };
    mocks.transit.mockResolvedValueOnce({
      ok: true,
      data: { stage: "sent", readyForNextStep: false, credited: "0" },
    });
    expect(await driver.build(step, journal)).toEqual({});
    mocks.transit.mockResolvedValueOnce({
      ok: true,
      data: { stage: "refunded", readyForNextStep: false, credited: "0" },
    });
    await expect(driver.build(step, journal)).rejects.toThrow("BRIDGE_RECONCILIATION_REQUIRED");
    mocks.transit.mockResolvedValueOnce({
      ok: true,
      data: { stage: "credited", readyForNextStep: true, credited: "39500000" },
    });
    mocks.balances.mockResolvedValueOnce({
      ok: true,
      data: {
        balancesStatus: "available",
        tokens: [{ token: core, unallocatedBalance: "39500000" }],
      },
    });
    expect(await driver.build(step, journal)).toEqual({
      complete: true,
      data: { arrival: "39500000" },
    });
    await driver.complete(
      step,
      { stepId: "arrival", chain: 4663, status: "waiting", data: { arrival: "39500000" } },
      journal,
    );
    expect(journal.arrival).toBe("39500000");
  });
  it("shows real report jobs and permits a failed job to be retriggered", async () => {
    const { driver, journal } = setup();
    const step: LaunchStep = { id: "report", kind: "report", chain: 42161, dependencies: [] };
    mocks.fund.mockResolvedValue({ ok: true, data: { lastReport: null } });
    mocks.trigger.mockResolvedValue({ ok: true, data: { jobId: "job" } });
    expect(await driver.build(step, journal)).toEqual({ data: { jobId: "job" } });
    journal.checkpoints.report = {
      stepId: "report",
      chain: 42161,
      status: "waiting",
      data: { jobId: "job" },
    };
    mocks.report.mockResolvedValueOnce({ ok: true, data: { status: "pending" } });
    expect(await driver.build(step, journal)).toEqual({ data: { jobId: "job" } });
    mocks.report.mockResolvedValueOnce({ ok: true, data: { status: "failed" } });
    await expect(driver.build(step, journal)).rejects.toThrow("REPORT_FAILED");
    expect(journal.checkpoints.report.data).not.toHaveProperty("jobId");
    mocks.fund.mockResolvedValueOnce({ ok: true, data: { lastReport: {} } });
    expect(await driver.build(step, journal)).toEqual({ complete: true });
  });
  it("signs canonical server-computed profile intent and reconciles it without recreation", async () => {
    const { driver, journal, wallet } = setup();
    const profile = {
      name: "Demo income fund",
      description: "",
      imageUrl: "",
      managerDisplayName: "",
      websiteUrl: "",
      socialLinks: {},
      tags: [],
      broadMandate: false,
      spokeCapPercent: null,
      launchSnapshotId: "snapshot",
    };
    journal.frozen = { ...frozen, review: { name: profile.name, description: "", imageUrl: "" } };
    journal.checkpoints.create = {
      stepId: "create",
      chain: 42161,
      status: "confirmed",
      data: {
        provision: {
          nextRequests: {
            profile: {
              profileFields: {
                broadMandate: false,
                spokeCapPercent: null,
                launchSnapshotId: "snapshot",
              },
            },
          },
        },
      },
    };
    mocks.profile.mockResolvedValueOnce({ ok: true, data: { profile: null } });
    mocks.putProfile.mockResolvedValue({ ok: true, data: {} });
    const step: LaunchStep = { id: "profile", kind: "profile", chain: 42161, dependencies: [] };
    expect(await driver.build(step, journal)).toEqual({ complete: true });
    expect(wallet.sign).toHaveBeenCalledWith(
      expect.stringContaining("Pool Party v2 fund profile\n"),
    );
    expect(mocks.putProfile).toHaveBeenCalledWith(core, expect.objectContaining({ profile }));
    mocks.profile.mockResolvedValue({ ok: true, data: { profile } });
    expect(
      await driver.reconcile(step, { stepId: "profile", chain: 42161, status: "failed" }, journal),
    ).toBe(true);
    expect(await driver.build(step, journal)).toEqual({ complete: true });
  });
  it("quotes bridge from net seed, stores transit identity and decodes successful seed completion", async () => {
    const { driver, journal } = setup();
    mocks.quote.mockResolvedValue({ ok: true, data: {} });
    mocks.capital.mockResolvedValue({
      ok: true,
      data: {
        transactions: [{ from: manager, to: core, chainId: 42161, value: "0", data: "0x1234" }],
      },
    });
    await driver.build(
      {
        id: "bridge",
        kind: "bridge",
        chain: 42161,
        dependencies: [],
        group: "robinhood",
        sharePct: 40,
      },
      journal,
    );
    expect(mocks.quote).toHaveBeenLastCalledWith(core, "39600000");
    const bridge = {
      stepId: "bridge",
      chain: 42161 as const,
      status: "submitted" as const,
      data: { receipt: { transitId: "actual-transit" } },
    };
    await driver.complete(
      { id: "bridge", kind: "bridge", chain: 42161, dependencies: [] },
      bridge,
      journal,
    );
    expect(bridge.data).toMatchObject({ transitId: "actual-transit" });
    await driver.complete(
      { id: "create", kind: "create", chain: 42161, dependencies: [] },
      {
        stepId: "create",
        chain: 42161,
        status: "submitted",
        data: {
          provision: { predictedAddresses: { coreVault: core } },
          receipt: { seeded: { core, manager, principal: "99000000" } },
        },
      },
      journal,
    );
    expect(journal.principal).toBe("99000000");
    expect(await driver.receipt(42161, "hash")).toEqual({ status: "unknown" });
  });
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
