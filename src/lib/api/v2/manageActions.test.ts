import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFund, mockWallet } from "@/mocks/data/v2Funds";
import { ApiError } from "../errors";
import {
  loadManageFundAction,
  loadManagePositionAction,
  reviewManageMoveRangeAction,
} from "./manageActions";

const mocks = vi.hoisted(() => ({
  wallet: vi.fn(),
  auth: vi.fn(),
  verified: vi.fn(),
  read: vi.fn(),
  flag: vi.fn(),
  mockMode: false,
  fund: vi.fn(),
  positions: vi.fn(),
  balances: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: mocks.wallet,
  getAuthHeader: mocks.auth,
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.verified }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: mocks.flag }));
vi.mock("./client", () => ({ v2Fetch: mocks.read }));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
}));
vi.mock("./funds", () => ({
  readFund: mocks.fund,
  readPositions: mocks.positions,
  readBalances: mocks.balances,
}));
const address = (digit: string) => `0x${digit.repeat(40)}`;
const key = `0x${"1".repeat(64)}`;
const core = address("2"),
  wallet = address("3"),
  vault = address("4"),
  adapter = address("5");
const version = { protocolVersion: "v2" as const };
const token0 = { ...version, address: address("6"), symbol: "USDC", decimals: 6 };
const token1 = { ...version, address: address("7"), symbol: "WETH", decimals: 18 };
const amount = { ...version, raw: "1000000", decimal: "1" };
const composition = { ...version, amount0: amount, amount1: amount };
const price = { ...version, token1PerToken0: "1", token0PerToken1: "1" };
const position = () =>
  structuredClone({
    ...version,
    chainId: "4663",
    spokeVault: vault,
    status: "open",
    adapter,
    adapterKind: "uniswap-v4",
    positionKey: key,
    poolKey: key,
    poolId: key,
    tokens: [token0, token1],
    uniswap: {
      ...version,
      poolKey: {
        ...version,
        currency0: token0.address,
        currency1: token1.address,
        fee: 3000,
        tickSpacing: 60,
        hooks: address("0"),
      },
      tickLower: -120,
      tickUpper: 120,
      currentTick: 0,
      tickSpacing: 60,
      fee: 3000,
      liquidity: "100",
      sqrtPriceX96: "79228162514264337593543950336",
      inRange: true,
      lowerPrice: price,
      upperPrice: price,
      currentPrice: price,
    },
    aave: null,
    currentAmounts: composition,
    oracleAmounts: composition,
    uncollectedIncome: composition,
    valueUsd: "2",
    currentValueUsd: "2",
    uncollectedIncomeUsd: "0",
    shareOfNav: "20",
    feesApr: null,
  });
const draft = {
  chainId: 4663,
  positionKey: key,
  tickLower: -180,
  tickUpper: 180,
  slippageBps: 200,
};
let live = position();
beforeEach(() => {
  vi.resetAllMocks();
  live = position();
  mocks.mockMode = false;
  mocks.flag.mockReturnValue(true);
  mocks.wallet.mockResolvedValue(wallet);
  mocks.auth.mockResolvedValue({ Authorization: "Bearer token" });
  mocks.verified.mockResolvedValue({ walletAddress: wallet });
  mocks.read.mockImplementation(async (path: string, schema: { parse(value: unknown): unknown }) =>
    schema.parse(
      path.endsWith(core)
        ? {
            ...version,
            coreVault: core,
            manager: wallet,
            chains: [{ ...version, chainId: "4663", spokeVault: vault, status: "created" }],
          }
        : { ...version, position: live },
    ),
  );
});

describe("Manager fund load [POO-2226 R1]", () => {
  const realFund = () => ({ ...structuredClone(mockFund), manager: wallet });
  beforeEach(() => {
    mocks.fund.mockResolvedValue(realFund());
    mocks.balances.mockRejectedValue(new ApiError(503, "UPSTREAM", "secret"));
  });
  it("uses manager read without holder/transit dependencies and preserves available positions", async () => {
    expect(await loadManageFundAction(core)).toMatchObject({
      ok: true,
      data: { wallet, balances: [], fund: { positionsSummary: mockFund.positionsSummary } },
    });
    expect(mocks.positions).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("fetches positions only when summary is absent and never converts failed positions to empty", async () => {
    const fund = realFund();
    delete fund.positionsSummary;
    mocks.fund.mockResolvedValue(fund);
    mocks.positions.mockRejectedValue(new ApiError(503, "UPSTREAM", "secret"));
    expect(await loadManageFundAction(core)).toMatchObject({
      ok: false,
      error: { status: 503, code: "V2_UNAVAILABLE" },
    });
    mocks.positions.mockResolvedValue(mockFund.positionsSummary);
    expect(await loadManageFundAction(core)).toMatchObject({
      ok: true,
      data: { fund: { positionsSummary: mockFund.positionsSummary } },
    });
  });
  it("omits independently failed balances while preserving a valid sibling", async () => {
    mocks.balances.mockImplementation(async (_core: string, chain: number) => {
      if (chain === 42161) throw new ApiError(503, "UPSTREAM", "secret");
      return {
        protocolVersion: "v2",
        chainId: "4663",
        status: "created",
        balancesStatus: "available",
        operatingCash: "0",
        readyForNextStep: true,
        tokens: [],
      };
    });
    expect(await loadManageFundAction(core)).toMatchObject({
      ok: true,
      data: { balances: [{ chainId: "4663" }] },
    });
  });
  it("rejects a fund identity or manager mismatch", async () => {
    mocks.fund.mockResolvedValue({ ...realFund(), coreVault: wallet });
    expect(await loadManageFundAction(core)).toMatchObject({
      ok: false,
      error: { code: "V2_INVALID_RESPONSE" },
    });
    mocks.fund.mockResolvedValue({ ...realFund(), manager: core });
    expect(await loadManageFundAction(core)).toMatchObject({
      ok: false,
      error: { status: 403, code: "V2_NOT_MANAGER" },
    });
  });
  it("loads explicit mock mode without network and rejects other core addresses", async () => {
    mocks.mockMode = true;
    mocks.wallet.mockResolvedValue(null);
    expect(await loadManageFundAction(core)).toMatchObject({
      ok: true,
      data: { wallet: mockWallet, fund: { coreVault: core } },
    });
    expect(mocks.fund).not.toHaveBeenCalled();
    expect(await loadManageFundAction(wallet)).toMatchObject({ ok: false });
    mocks.flag.mockReturnValue(false);
    expect(await loadManageFundAction(core)).toMatchObject({ ok: false, error: { status: 404 } });
  });
});
describe("Manager V2 read and unavailable review [POO-2228]", () => {
  // @rule R1
  it("loads exact position identity, protocol pool metadata and token order", async () => {
    expect(await loadManagePositionAction(core, 4663, key)).toMatchObject({
      ok: true,
      data: {
        position: { poolId: key, adapter, uniswap: { tickSpacing: 60 }, tokens: [token0, token1] },
      },
    });
    expect(mocks.read).toHaveBeenLastCalledWith(
      `/funds/${core}/positions/4663/${key}`,
      expect.anything(),
    );
  });
  // @rule R2, R8
  it("returns only unavailable review with every missing execution capability", async () => {
    const result = await reviewManageMoveRangeAction(core, draft);
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "unavailable",
        canConfirm: false,
        draft,
        missing: [
          "principal-budgets",
          "post-close-preview",
          "network-fee",
          "move-range-fee-semantics",
          "price-impact",
          "continuation-recovery",
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("transactions");
    expect(mocks.read.mock.calls.every(([path]) => !String(path).includes("build"))).toBe(true);
  });
  // @rule R1
  it.each([
    "flag",
    "session",
    "bearer",
    "verification",
    "manager",
  ])("rejects missing authorization: %s", async (cause) => {
    if (cause === "flag") mocks.flag.mockReturnValue(false);
    if (cause === "session") mocks.wallet.mockResolvedValue(null);
    if (cause === "bearer") mocks.auth.mockResolvedValue({});
    if (cause === "verification") mocks.verified.mockResolvedValue({ walletAddress: core });
    if (cause === "manager") {
      mocks.wallet.mockResolvedValue(core);
      mocks.verified.mockResolvedValue({ walletAddress: core });
    }
    expect(await loadManagePositionAction(core, 4663, key)).toMatchObject({ ok: false });
  });
  // @rule R1, R3
  it.each([
    "key",
    "chain",
    "vault",
    "token-order",
    "spacing",
    "price",
  ])("rejects mismatched or incomplete metadata: %s", async (cause) => {
    if (cause === "key") live.positionKey = `0x${"9".repeat(64)}`;
    if (cause === "chain") live.chainId = "42161";
    if (cause === "vault") live.spokeVault = core;
    if (cause === "token-order") live.tokens = [token1, token0];
    if (cause === "spacing") live.uniswap.tickSpacing = 10;
    if (cause === "price") live.uniswap.currentPrice.token1PerToken0 = "0";
    expect(await loadManagePositionAction(core, 4663, key)).toMatchObject({
      ok: false,
      error: { code: "V2_INVALID_RESPONSE" },
    });
  });
  // @rule R2, R3
  it.each([
    { tickLower: 0, tickUpper: 0 },
    { tickLower: -121 },
    { slippageBps: 501 },
    { tickLower: -120, tickUpper: 120 },
    { amount0: "1" },
  ])("rejects invalid or unchanged range and caller-supplied budgets: %j", async (change) => {
    expect(await reviewManageMoveRangeAction(core, { ...draft, ...change })).toMatchObject({
      ok: false,
    });
  });
  // @rule R2, R8
  it("refuses a position with no current liquidity", async () => {
    live.uniswap.liquidity = "0";
    expect(await reviewManageMoveRangeAction(core, draft)).toMatchObject({
      ok: false,
      error: { code: "V2_POSITION_UNAVAILABLE" },
    });
  });
  // @rule R2, R8
  it.each([409, 503])("preserves HTTP %i and redacts upstream error content", async (status) => {
    mocks.read.mockRejectedValue(new ApiError(status, "secret-code", "secret-token"));
    const result = await reviewManageMoveRangeAction(core, draft);
    expect(result).toMatchObject({
      ok: false,
      error: { status, code: status === 409 ? "V2_CONFLICT" : "V2_UNAVAILABLE" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
