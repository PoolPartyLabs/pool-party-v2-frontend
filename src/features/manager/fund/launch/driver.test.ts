import { parseUnits } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { CatalogPool } from "@/lib/api/v2/schemas";
import { positionAmounts } from "./composition";
import { createLaunchDriver, type FrozenLaunch } from "./driver";
import { createJournal, runLaunch } from "./journal";
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
  positions: vi.fn(),
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
  readLaunchPositionsAction: mocks.positions,
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
const liveUsdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const liveWeth = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const livePoolId = "0xfc7b3ad139daaf1e9c3637ed921c154d1b04286f8a82b805a6c352da57028653";
const livePool = {
  protocolVersion: "v2",
  chainId: "42161",
  adapterKind: "uniswap-v4",
  poolId: livePoolId,
  poolKey: {
    protocolVersion: "v2",
    currency0: liveWeth,
    currency1: liveUsdc,
    fee: 500,
    tickSpacing: 10,
    hooks: `0x${"00".repeat(20)}`,
  },
  tokens: [
    { address: liveWeth, decimals: 18, symbol: "WETH" },
    { address: liveUsdc, decimals: 6, symbol: "USDC" },
  ].map((token) => ({
    protocolVersion: "v2",
    chainId: "42161",
    name: token.symbol,
    logoUrl: null,
    hubPriced: true,
    priceUsd: "1",
    priceUpdatedAt: null,
    priceSource: core,
    priceProvenance: "fixed-1:1",
    priceUnavailableReason: null,
    ...token,
  })),
  pairSymbols: ["WETH", "USDC"],
  hooked: false,
  currentTick: -197307,
  sqrtPriceX96: "4117574002777380615048292",
  currentPrice: {
    protocolVersion: "v2",
    token1PerToken0: "2700.9942459222732204",
    token0PerToken1: "0.000370234037913",
  },
  liquidity: "1",
  eligible: true,
  registration: "at-fund-creation",
  tvlUsd: null,
  feesApr: null,
  tvlUnavailableReason: "unavailable",
  feesAprUnavailableReason: "unavailable",
} as CatalogPool;

function liveSetup(principal = "2000000", allocation = "1200000", share = 30) {
  const { driver, journal, wallet } = setup();
  journal.principal = principal;
  journal.frozen = {
    ...frozen,
    request: {
      manager,
      chains: [{ chainId: 42161, tokens: [liveUsdc, liveWeth], uniswapV4PoolIds: [livePoolId] }],
    },
  };
  const allocate: LaunchStep = {
    id: "allocate",
    kind: "allocate",
    chain: 42161,
    dependencies: [],
    sharePct: share * 2,
  };
  const swap: LaunchStep = {
    id: "v4:swap",
    kind: "swap",
    chain: 42161,
    dependencies: [allocate.id],
    sharePct: share,
    blockId: "v4",
    protocol: "uniswap-v4",
    config: { poolId: livePoolId, tickLower: -198360, tickUpper: -196350, maxLossBps: 200 },
  };
  const open = { ...swap, id: "v4:open", kind: "open" as const, dependencies: [swap.id] };
  const aave: LaunchStep = {
    id: "aave:open",
    kind: "open",
    chain: 42161,
    dependencies: [allocate.id],
    sharePct: share,
    blockId: "aave",
    protocol: "aave-v3",
    config: { assetKey: `arbitrum:${liveUsdc}` },
  };
  journal.steps = [allocate, swap, open, aave];
  journal.checkpoints.allocate = {
    stepId: allocate.id,
    chain: 42161,
    status: "confirmed",
    data: { receipt: { allocated: allocation } },
  };
  mocks.pool.mockResolvedValue({ ok: true, data: livePool });
  mocks.fund.mockResolvedValue({
    ok: true,
    data: {
      chains: [
        { chainId: "42161", uniswapV4Adapter: manager, aaveV3Adapter: manager, spokeVault: core },
      ],
    },
  });
  const built = {
    transactions: [{ from: manager, to: core, chainId: 42161, value: "0", data: "0x1234" }],
  };
  mocks.swap.mockClear();
  mocks.open.mockClear();
  mocks.swap.mockResolvedValue({ ok: true, data: built });
  mocks.open.mockResolvedValue({ ok: true, data: built });
  const balances = (usdc: bigint, weth: bigint) =>
    mocks.balances.mockResolvedValue({
      ok: true,
      data: {
        balancesStatus: "available",
        tokens: [
          { token: liveUsdc, unallocatedBalance: usdc.toString() },
          { token: liveWeth, unallocatedBalance: weth.toString() },
        ],
      },
    });
  return { driver, journal, wallet, allocate, swap, open, aave, balances };
}

describe("receipt-backed leaf isolation [POO-2211 R1, R2, R3]", () => {
  it("R1 refuses the live .5 allocation versus a .6/.6 frozen hub plan", async () => {
    const { driver, journal, swap, balances, wallet } = liveSetup("2000000", "500000");
    balances(BigInt("500000"), BigInt(0));
    await expect(driver.build(swap, journal)).rejects.toThrow("BALANCE_CHANGED");
    expect(mocks.swap).not.toHaveBeenCalled();
    expect(wallet.send).not.toHaveBeenCalled();
  });
  it.each([
    { principal: "2000000", allocation: "1200000", budget: "600000" },
    { principal: "1995000", allocation: "1197000", budget: "598500" },
    { principal: "1000000", allocation: "600000", budget: "300000" },
  ])("R3 preserves Aave after the real range/price swap and open with net $principal", async ({
    principal,
    allocation,
    budget,
  }) => {
    const { driver, journal, swap, open, aave, balances, wallet } = liveSetup(
      principal,
      allocation,
    );
    balances(BigInt(allocation), BigInt(0));
    await driver.build(swap, journal);
    const spent = BigInt(mocks.swap.mock.lastCall![0].amountIn);
    const received = (spent * BigInt("17635116476090")) / BigInt("47638");
    journal.checkpoints[swap.id] = {
      stepId: swap.id,
      chain: 42161,
      status: "confirmed",
      data: {
        receipt: {
          swapped: {
            tokenIn: liveUsdc,
            tokenOut: liveWeth,
            amountIn: spent.toString(),
            amountOut: received.toString(),
          },
        },
      },
    };
    balances(BigInt(allocation) - spent, received);
    mocks.pool.mockResolvedValueOnce({
      ok: true,
      data: {
        ...livePool,
        currentPrice: { ...livePool.currentPrice, token1PerToken0: "2701.3832415934247232" },
      },
    });
    await driver.build(open, journal);
    const deposited = parseUnits(mocks.open.mock.lastCall![1].amount1, 6);
    const remainder = BigInt(allocation) - spent - deposited;
    expect(spent + deposited).toBeLessThanOrEqual(BigInt(budget));
    expect(remainder * BigInt(100)).toBeGreaterThanOrEqual(BigInt(budget) * BigInt(99));
    journal.checkpoints[open.id] = { stepId: open.id, chain: 42161, status: "confirmed" };
    balances(remainder, BigInt(0));
    await driver.build(aave, journal);
    expect(parseUnits(mocks.open.mock.lastCall![1].amount, 6)).toBe(BigInt(budget));
    expect(wallet.send).not.toHaveBeenCalled();
  });
  it("R1 never swaps the sibling reservation when a leaf's own base capital is missing", async () => {
    const { driver, journal, swap, balances } = liveSetup();
    balances(BigInt("600000"), BigInt(0));
    await expect(driver.build(swap, journal)).rejects.toThrow("BALANCE_CHANGED");
    expect(mocks.swap).not.toHaveBeenCalled();
  });
  it("R3 keeps single-leaf initial sizing unchanged", async () => {
    const { driver, journal, swap, allocate, balances } = liveSetup();
    allocate.sharePct = 30;
    journal.steps = journal.steps.filter((step) => step.protocol !== "aave-v3");
    journal.checkpoints.allocate!.data = { receipt: { allocated: "600000" } };
    balances(BigInt("600000"), BigInt(0));
    await driver.build(swap, journal);
    expect(mocks.swap).toHaveBeenLastCalledWith(expect.objectContaining({ amountIn: "285830" }));
    const before = positionAmounts(
      livePool,
      { [liveUsdc]: BigInt("600000") },
      BigInt("600000"),
      liveUsdc,
      "2430.8903048091282472",
      "2972.0368371156287845",
    );
    expect(before.swapRaw.toString()).toBe("285830");
  });
  it("R2 rehydrates old confirmed allocation receipts read-only and blocks mismatch", async () => {
    const { driver, journal, swap, balances, wallet } = liveSetup();
    journal.checkpoints.allocate!.data = {};
    journal.checkpoints.allocate!.txHash = "historical-allocation";
    balances(BigInt("500000"), BigInt(0));
    wallet.receipt.mockResolvedValueOnce(null);
    await expect(driver.build(swap, journal)).rejects.toThrow("BALANCES_UNAVAILABLE");
    expect(wallet.receipt).toHaveBeenCalledWith(42161, "historical-allocation");
    expect(wallet.send).not.toHaveBeenCalled();
  });
  it("R2 skips a confirmed conversion instead of spending again on a retry", async () => {
    const { driver, journal, swap, balances } = liveSetup();
    journal.checkpoints[swap.id] = {
      stepId: swap.id,
      chain: 42161,
      status: "confirmed",
      data: {
        receipt: {
          swapped: {
            tokenIn: liveUsdc,
            tokenOut: liveWeth,
            amountIn: "285830",
            amountOut: "105810000000000",
          },
        },
      },
    };
    balances(BigInt("914170"), BigInt("105810000000000"));
    expect(await driver.build(swap, journal)).toEqual({ complete: true });
    expect(mocks.swap).not.toHaveBeenCalled();
  });
  it("R2 ignores stale swap receipt data on a reverted checkpoint", async () => {
    const { driver, journal, swap, balances } = liveSetup();
    journal.checkpoints[swap.id] = {
      stepId: swap.id,
      chain: 42161,
      status: "failed",
      receiptStatus: "reverted",
      data: {
        receipt: {
          swapped: {
            tokenIn: liveUsdc,
            tokenOut: liveWeth,
            amountIn: "285830",
            amountOut: "105810000000000",
          },
        },
      },
    };
    balances(BigInt("1200000"), BigInt(0));
    await driver.build(swap, journal);
    expect(mocks.swap).toHaveBeenLastCalledWith(expect.objectContaining({ amountIn: "285830" }));
  });
});

describe("just-in-time launch driver [R2, R3, R6]", () => {
  it.each([
    { balance: "29610900", maxLossBps: undefined, amount: "29.6109" },
    { balance: "29700000", maxLossBps: undefined, amount: "29.7" },
    { balance: "99000000", maxLossBps: undefined, amount: "29.7" },
    { balance: "29403000", maxLossBps: 50, amount: "29.403" },
    { balance: "28809000", maxLossBps: 300, amount: "28.809" },
    { balance: "28215000", maxLossBps: 1000, amount: "28.215" },
    { balance: "26730000", maxLossBps: undefined, amount: null },
    { balance: "0", maxLossBps: undefined, amount: null },
    { balance: "29402999", maxLossBps: undefined, amount: null },
    { balance: "28214999", maxLossBps: 1000, amount: null },
  ])("bounds Aave remainder [R1, R3]: $balance raw, $maxLossBps bps", async ({
    balance,
    maxLossBps,
    amount,
  }) => {
    const { driver, journal, wallet } = setup();
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
      data: { balancesStatus: "available", tokens: [{ token: core, unallocatedBalance: balance }] },
    });
    mocks.open.mockClear();
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
      sharePct: 30,
      protocol: "aave-v3",
      config: { assetKey: `arbitrum:${core}`, maxLossBps },
    };
    if (amount === null) {
      await expect(driver.build(step, journal)).rejects.toThrow("BALANCE_CHANGED");
      expect(mocks.open).not.toHaveBeenCalled();
    } else {
      await driver.build(step, journal);
      expect(mocks.open).toHaveBeenLastCalledWith(core, expect.objectContaining({ amount }));
    }
    expect(wallet.send).not.toHaveBeenCalled();
  });
  it("verifies mined Aave by positionKey and chain, not pool registration or USD value", async () => {
    const { driver, journal } = setup();
    const positionKey = `0x${"00".repeat(12)}af88d065e77c8cc2239327c5edb3a432268e5831`;
    const step: LaunchStep = {
      id: "aave",
      kind: "open",
      chain: 42161,
      dependencies: [],
      config: { assetKey: `arbitrum:${core}` },
    };
    const checkpoint = {
      stepId: step.id,
      chain: step.chain,
      status: "waiting" as const,
      data: { receipt: { positionKey } },
    };
    mocks.positions.mockResolvedValueOnce({
      ok: true,
      data: {
        positions: [
          { chainId: "42161", positionKey, poolKey: positionKey, status: "open", valueUsd: "0.25" },
        ],
      },
    });
    await expect(driver.complete(step, checkpoint, journal)).resolves.toBeUndefined();
    expect(mocks.positions).toHaveBeenCalledWith(core);
    mocks.positions.mockResolvedValueOnce({
      ok: true,
      data: { positions: [{ chainId: "4663", positionKey, status: "open" }] },
    });
    await expect(driver.complete(step, checkpoint, journal)).rejects.toMatchObject({
      code: "V2_DISCOVERY_PENDING",
    });
    mocks.positions.mockResolvedValueOnce({ ok: true, data: { positions: [] } });
    await expect(driver.complete(step, checkpoint, journal)).rejects.toMatchObject({
      code: "V2_DISCOVERY_PENDING",
    });
    mocks.positions.mockResolvedValueOnce({
      ok: false,
      error: { status: 500, code: "V2_REQUEST_FAILED" },
    });
    await expect(driver.complete(step, checkpoint, journal)).rejects.toThrow("V2_REQUEST_FAILED");
  });
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
  it("recomputes v4 swaps and retries Aave after confirmed v4 with a 0.3% remainder [R2, R4]", async () => {
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
    const aave: LaunchStep = {
      id: "aave:open",
      kind: "open",
      chain: 42161,
      dependencies: ["v4:open"],
      sharePct: 30,
      protocol: "aave-v3",
      config: { assetKey: `arbitrum:${core}` },
    };
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
      expect.objectContaining({
        core,
        tokenIn: core,
        tokenOut: manager,
        maxLossBps: 100,
        amountIn: "23760000",
      }),
    );
    const plannedSwap = BigInt(23760000);
    const swapRemainder = (plannedSwap * BigInt(997)) / BigInt(1000);
    mocks.balances.mockResolvedValue({
      ok: true,
      data: {
        balancesStatus: "available",
        tokens: [
          { token: core, unallocatedBalance: swapRemainder.toString() },
          { token: manager, unallocatedBalance: "0" },
        ],
      },
    });
    await driver.build(step, journal);
    expect(mocks.swap).toHaveBeenLastCalledWith(
      expect.objectContaining({ amountIn: swapRemainder.toString() }),
    );
    for (const { available, maxLossBps, succeeds } of [
      { available: "23760000", maxLossBps: 100, succeeds: true },
      { available: "23522400", maxLossBps: 50, succeeds: true },
      { available: "23522399", maxLossBps: 50, succeeds: false },
      { available: "22572000", maxLossBps: 1000, succeeds: true },
      { available: "22571999", maxLossBps: 1000, succeeds: false },
      { available: "21384000", maxLossBps: 100, succeeds: false },
      { available: "0", maxLossBps: 100, succeeds: false },
    ]) {
      mocks.balances.mockResolvedValue({
        ok: true,
        data: {
          balancesStatus: "available",
          tokens: [
            { token: core, unallocatedBalance: available },
            { token: manager, unallocatedBalance: "0" },
          ],
        },
      });
      mocks.swap.mockClear();
      const boundedStep = { ...step, config: { ...step.config, maxLossBps } };
      if (succeeds) {
        await driver.build(boundedStep, journal);
        expect(mocks.swap).toHaveBeenLastCalledWith(
          expect.objectContaining({ amountIn: available }),
        );
      } else {
        await expect(driver.build(boundedStep, journal)).rejects.toThrow("BALANCE_CHANGED");
        expect(mocks.swap).not.toHaveBeenCalled();
      }
    }
    await expect(driver.build({ ...step, kind: "open" }, journal)).rejects.toThrow(
      "BALANCE_CHANGED",
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
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    journal.steps = [{ ...step, id: "v4:open", kind: "open" }, aave];
    journal.checkpoints["v4:open"] = {
      stepId: "v4:open",
      chain: 42161,
      status: "confirmed",
      txHash: "confirmed-v4",
    };
    mocks.balances.mockResolvedValue({
      ok: true,
      data: {
        balancesStatus: "available",
        tokens: [{ token: core, unallocatedBalance: "26730000" }],
      },
    });
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints[aave.id]).toMatchObject({
      status: "failed",
      error: "BALANCE_CHANGED",
    });
    expect(journal.checkpoints[aave.id]?.data).toBeUndefined();
    expect(wallet.send).not.toHaveBeenCalled();
    mocks.open.mockClear();
    mocks.balances.mockResolvedValue({
      ok: true,
      data: {
        balancesStatus: "available",
        tokens: [{ token: core, unallocatedBalance: "29610900" }],
      },
    });
    await runLaunch(journal, storage, driver);
    expect(mocks.open).toHaveBeenLastCalledWith(
      core,
      expect.objectContaining({ amount: "29.6109", adapter: manager }),
    );
    expect(journal.checkpoints[aave.id]?.status).toBe("waiting");
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(wallet.send).toHaveBeenCalledTimes(1);
    expect(journal.checkpoints["v4:open"]).toEqual({
      stepId: "v4:open",
      chain: 42161,
      status: "confirmed",
      txHash: "confirmed-v4",
    });
    await driver.send(step, built.transactions[0]);
    expect(wallet.send).toHaveBeenCalled();
    mocks.swap.mockClear();
    mocks.open.mockClear();
    await expect(
      driver.build(
        { ...step, config: { ...step.config, tickLower: -101, tickUpper: 100 } },
        journal,
      ),
    ).rejects.toThrow("BUILD_TICK_ALIGNMENT");
    expect(mocks.swap).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    await expect(driver.send({ ...step, chain: 4663 }, built.transactions[0])).rejects.toThrow(
      "UNSAFE_TRANSACTION",
    );
  });
  it("R9 observes successful signatures only, excluding rejection", async () => {
    const { wallet } = setup();
    const signed = vi.fn();
    const driver = createLaunchDriver(wallet, signed);
    const step: LaunchStep = { id: "create", kind: "create", chain: 42161, dependencies: [] };
    const transaction = {
      protocolVersion: "v2",
      from: manager,
      to: core,
      chainId: 42161,
      value: "0",
      data: "0x1234",
    };
    await driver.send(step, transaction);
    expect(signed).toHaveBeenCalledExactlyOnceWith(step);
    wallet.send.mockRejectedValueOnce(new Error("USER_REJECTED"));
    await expect(driver.send(step, transaction)).rejects.toThrow("USER_REJECTED");
    expect(signed).toHaveBeenCalledTimes(1);
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
  it("waits for the keeper's accepted report without an admin trigger, including legacy jobs", async () => {
    const { driver, journal, wallet } = setup();
    const step: LaunchStep = { id: "report", kind: "report", chain: 42161, dependencies: [] };
    mocks.fund.mockResolvedValue({ ok: true, data: { lastReport: null } });
    mocks.trigger.mockResolvedValue({ ok: true, data: { jobId: "job" } });
    expect(await driver.build(step, journal)).toEqual({});
    journal.checkpoints.report = {
      stepId: "report",
      chain: 42161,
      status: "waiting",
      data: { jobId: "job" },
    };
    expect(await driver.build(step, journal)).toEqual({});
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(wallet.send).not.toHaveBeenCalled();
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
