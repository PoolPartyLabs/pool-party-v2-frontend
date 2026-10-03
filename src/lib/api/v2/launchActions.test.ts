import { beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "./launchActions";
import { buildLaunchSwapAction, triggerLaunchReportAction } from "./launchActions";

const mocks = vi.hoisted(() => ({
  wallet: vi.fn(),
  fetch: vi.fn(),
  verified: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: mocks.wallet,
  getAuthHeader: mocks.auth,
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.verified }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => true }));
const core = `0x${"12".repeat(20)}`;
const wallet = `0x${"34".repeat(20)}`;
const swap = {
  core,
  side: "hub",
  tokenIn: core,
  tokenOut: wallet,
  amountIn: "100",
  maxLossBps: 100,
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status, headers: { "x-pool-party-protocol": "v2" } });

describe("launch server-only admin boundary [R8]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("PP_API_URL", "https://api.example.test");
    vi.stubEnv("PP_API_KEY", "normal-secret");
    vi.stubEnv("PP_API_ADMIN_KEY", "admin-secret");
    mocks.wallet.mockResolvedValue(wallet);
    mocks.auth.mockResolvedValue({ Authorization: "Bearer session-token" });
    mocks.verified.mockResolvedValue({ walletAddress: wallet });
    mocks.fetch.mockImplementation(async () =>
      response({ protocolVersion: "v2", manager: wallet }),
    );
  });
  it("refuses 8% custom loss before any API call", async () => {
    expect(await buildLaunchSwapAction({ ...swap, maxLossBps: 800 })).toMatchObject({ ok: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("quotes swaps with validated query parameters and without an admin key", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(response({ protocolVersion: "v2", quotedAmountOut: "99" }));
    expect(await actions.quoteLaunchSwapAction(swap)).toMatchObject({ ok: true });
    const [url, init] = mocks.fetch.mock.calls.at(-1) ?? [];
    expect(String(url)).toContain("/swap/quote?side=hub&tokenIn=");
    expect(String(url)).toContain("maxLossBps=100");
    expect(init.headers).not.toHaveProperty("x-admin-key");
    expect(await actions.quoteLaunchSwapAction({ ...swap, maxLossBps: 800 })).toMatchObject({
      ok: false,
    });
  });
  it("refuses unauthenticated or non-manager report triggers", async () => {
    mocks.wallet.mockResolvedValue(null);
    expect(await triggerLaunchReportAction(core)).toMatchObject({
      ok: false,
      error: { status: 401 },
    });
    mocks.wallet.mockResolvedValue(core);
    mocks.verified.mockResolvedValue({ walletAddress: core });
    expect(await triggerLaunchReportAction(core)).toMatchObject({
      ok: false,
      error: { status: 403 },
    });
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/report"))).toBe(false);
  });
  it("rejects forged decoded sessions unless the authenticated API verifies the same wallet", async () => {
    mocks.verified.mockResolvedValue({ walletAddress: core });
    expect(await buildLaunchSwapAction(swap)).toMatchObject({ ok: false, error: { status: 401 } });
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.verified.mockRejectedValue(new Error("Bearer session-token rejected"));
    const result = await buildLaunchSwapAction(swap);
    expect(result).toMatchObject({ ok: false, error: { status: 401 } });
    expect(JSON.stringify(result)).not.toContain("session-token");
    expect(mocks.verified).toHaveBeenCalledWith(
      "users/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer session-token" },
      }),
    );
  });
  it("rejects a decoded session without a bearer token before contacting the API", async () => {
    mocks.auth.mockResolvedValue({});
    expect(await buildLaunchSwapAction(swap)).toMatchObject({ ok: false, error: { status: 401 } });
    expect(mocks.verified).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("sends x-api-key and x-admin-key server-side and rate limits duplicate report jobs", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(
        response({ protocolVersion: "v2", jobId: "12345678-1234-4123-8123-123456789012" }),
      );
    const result = await triggerLaunchReportAction(core);
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/report"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "normal-secret",
          "x-admin-key": "admin-secret",
        }),
      }),
    );
    expect(await triggerLaunchReportAction(core)).toMatchObject({
      ok: false,
      error: { status: 429 },
    });
  });
  it("redacts upstream error messages containing secrets", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(response({ message: "admin-secret" }, 500));
    const result = await buildLaunchSwapAction(swap);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("admin-secret");
  });
  it("builds canonical create and spoke with stripped wire metadata", async () => {
    const transaction = { from: wallet, to: core, value: "0", chainId: 42161, data: "0x1234" };
    mocks.fetch.mockResolvedValueOnce(
      response({
        protocolVersion: "v2",
        transactions: [transaction],
        creationNumber: "1",
        mandate: { protocolVersion: "v2", manager: wallet },
        mandateHash: `0x${"ab".repeat(32)}`,
        predictedAddresses: {},
        nextRequests: {
          protocolVersion: "v2",
          profile: { protocolVersion: "v2", profileFields: {} },
        },
      }),
    );
    const result = await actions.buildCreateFundAction({
      manager: wallet,
      chains: [{ chainId: 42161, tokens: [core], uniswapV4PoolIds: [] }],
      aaveV3Reserves: [core],
      spokeCapPercent: null,
      performanceFeeBps: 2000,
      managementFeeBps: 0,
      payoutFeeBps: 200,
      minFirstDeposit: "100",
      seedAmount: "100",
    });
    expect(result).toMatchObject({ ok: true, data: { mandate: { manager: wallet } } });
    if (result.ok) expect(result.data.mandate).not.toHaveProperty("protocolVersion");
    mocks.fetch.mockResolvedValueOnce(
      response({ protocolVersion: "v2", transactions: [{ ...transaction, chainId: 4663 }] }),
    );
    expect(
      await actions.buildSpokeAction({
        from: wallet,
        creationNumber: "1",
        mandate: { manager: wallet },
        mandateHash: `0x${"ab".repeat(32)}`,
      }),
    ).toMatchObject({ ok: true });
  });
  it("dispatches only validated capital, position and discovery DTOs", async () => {
    const transaction = { from: wallet, to: core, value: "0", chainId: 42161, data: "0x1234" };
    mocks.fetch.mockResolvedValueOnce(response({ protocolVersion: "v2", value: "discovered" }));
    expect(await actions.discoverLaunchFundAction({ core })).toMatchObject({ ok: true });
    for (const action of [
      () =>
        actions.buildLaunchCapitalAction(core, {
          action: "allocate-to-hub",
          from: wallet,
          side: "hub",
          amount: "100",
        }),
      () =>
        actions.buildLaunchPositionAction(core, {
          action: "open",
          from: wallet,
          side: "hub",
          adapter: core,
          poolKey: `0x${"ab".repeat(32)}`,
          amount: "100",
        }),
    ]) {
      mocks.fetch
        .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
        .mockResolvedValueOnce(response({ protocolVersion: "v2", transactions: [transaction] }));
      expect(await action()).toMatchObject({ ok: true });
    }
    expect(
      await actions.buildLaunchCapitalAction(core, {
        action: "allocate-to-hub",
        from: core,
        side: "hub",
        amount: "100",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await actions.buildLaunchPositionAction(core, {
        action: "open",
        from: core,
        side: "hub",
        adapter: core,
        poolKey: `0x${"ab".repeat(32)}`,
      }),
    ).toMatchObject({ ok: false });
  });
  it("reads fund, quote, credited transit and actual balances through owned paths", async () => {
    expect(await actions.readLaunchFundAction(core)).toMatchObject({ ok: true });
    expect(await actions.quoteLaunchBridgeAction(core, "100")).toMatchObject({ ok: true });
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(
        response({
          protocolVersion: "v2",
          chainId: "4663",
          balancesStatus: "available",
          tokens: [{ token: core, unallocatedBalance: "99" }],
        }),
      );
    expect(await actions.readLaunchBalancesAction(core, 4663)).toMatchObject({ ok: true });
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(
        response({
          protocolVersion: "v2",
          transitId: `0x${"ab".repeat(32)}`,
          credited: "99",
          readyForNextStep: true,
          stage: "credited",
        }),
      );
    expect(await actions.readLaunchTransitAction(core, `0x${"ab".repeat(32)}`)).toMatchObject({
      ok: true,
    });
  });
  it("manager-binds report job polling and profile reads/writes", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(response({ protocolVersion: "v2", core, status: "delivered" }));
    expect(
      await actions.readLaunchReportAction(core, "12345678-1234-4123-8123-123456789012"),
    ).toEqual({ ok: true, data: { status: "delivered" } });
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(response({ protocolVersion: "v2", core: wallet, status: "pending" }));
    expect(
      await actions.readLaunchReportAction(core, "12345678-1234-4123-8123-123456789012"),
    ).toMatchObject({ ok: false, error: { status: 403 } });
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(response({ protocolVersion: "v2", profile: null }));
    expect(await actions.readLaunchProfileAction(core)).toMatchObject({
      ok: true,
      data: { profile: null },
    });
    expect(
      await actions.putLaunchProfileAction(core, {
        chainId: 42161,
        profile: {},
        nonce: "unique-nonce",
        expiresAt: "2000000000",
        signature: `0x${"ab".repeat(65)}`,
      }),
    ).toMatchObject({ ok: true });
  });
  it("never serializes admin secrets after a successful swap builder", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(
        response({
          protocolVersion: "v2",
          transactions: [{ from: wallet, to: core, value: "0", chainId: 42161, data: "0x1234" }],
        }),
      );
    const result = await buildLaunchSwapAction(swap);
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/build-swap"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-admin-key": "admin-secret" }),
      }),
    );
  });
});
