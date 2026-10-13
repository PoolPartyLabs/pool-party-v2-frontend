/**
 * @tests PP-MGR-ACT-015 (POO-2262)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_UNSIGNED_PLAN } from "@/features/manager/fund/launch/solanaV6Launch.fixture";
import {
  buildSendToSolanaAction,
  buildSolanaCreationAction,
  buildSolanaManagerAction,
  getSolanaCreationOptionsAction,
  refreshSolanaLaunchReportAction,
} from "./solanaLaunchActions";

const mocks = vi.hoisted(() => ({
  wallet: vi.fn(),
  auth: vi.fn(),
  verified: vi.fn(),
  fetch: vi.fn(),
  flags: { fundContracts: true, solanaSpoke: true } as Record<string, boolean>,
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: mocks.wallet,
  getAuthHeader: mocks.auth,
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.verified }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: (key: string) => mocks.flags[key] ?? false }));

const MANAGER = "0x000000000000000000000000000000000000dead";
const SOLANA_KEY = "G3FF47T19t1F1HchVDxgZLNvNS65eWWA8vs5rdyQjP43";
const CORE = "0x1E45E497a734b3BcD67e514F0681F161EC78a718";
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status < 300 ? { data } : data), {
    status,
    headers: { "x-pool-party-protocol": "v2" },
  });

beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("PP_API_URL", "http://api.test");
  vi.stubEnv("PP_API_KEY", "key");
  mocks.fetch.mockReset();
  mocks.flags.solanaSpoke = true;
  mocks.wallet.mockResolvedValue(MANAGER);
  mocks.auth.mockResolvedValue({ Authorization: "Bearer token" });
  mocks.verified.mockResolvedValue({ walletAddress: MANAGER });
});

describe("v6 creation actions", () => {
  it("is unavailable while the Solana spoke flag is off", async () => {
    mocks.flags.solanaSpoke = false;
    expect(await getSolanaCreationOptionsAction()).toEqual({
      ok: false,
      error: { status: 404, code: "SOLANA_DISABLED" },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("forwards a strict plan request for the session Manager and returns the parsed plan", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ data: LIVE_UNSIGNED_PLAN }), {
        status: 201,
        headers: { "x-pool-party-protocol": "v2" },
      }),
    );
    const result = await buildSolanaCreationAction({
      manager: MANAGER,
      managerSolanaKey: SOLANA_KEY,
      seedAmount: "20000000",
      minFirstDeposit: "20000000",
      spokeCap: "20000000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.core).toBe(LIVE_UNSIGNED_PLAN.core);
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ spokeCap: "20000000" });
  });
  it("refuses another Manager, unknown fields and a plan for another Solana key", async () => {
    expect(
      await buildSolanaCreationAction({ manager: CORE, managerSolanaKey: SOLANA_KEY }),
    ).toMatchObject({ ok: false, error: { code: "V2_UNAUTHORIZED" } });
    expect(
      await buildSolanaCreationAction({ manager: MANAGER, managerSolanaKey: SOLANA_KEY, extra: 1 }),
    ).toMatchObject({ ok: false, error: { code: "V2_INVALID_REQUEST" } });
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ data: LIVE_UNSIGNED_PLAN }), {
        status: 201,
        headers: { "x-pool-party-protocol": "v2" },
      }),
    );
    expect(
      await buildSolanaCreationAction({
        manager: MANAGER,
        managerSolanaKey: "6VTveiPVZVM7H9BWEsUsu4ivsrPjKw9ePrLQqHaFgJaA",
      }),
    ).toMatchObject({ ok: false, error: { code: "V2_INVALID_RESPONSE" } });
  });
});

describe("Manager-only Fund actions", () => {
  it("refuses a session wallet that is not the Fund's Manager", async () => {
    mocks.fetch.mockResolvedValueOnce(
      response({ protocolVersion: "v2", manager: "0x26cD63ca3fe96e1D963f0160cb7542CEd13A53DE" }),
    );
    expect(await buildSendToSolanaAction(CORE, { amount: "1000000" })).toMatchObject({
      ok: false,
      error: { code: "V2_NOT_MANAGER" },
    });
  });
  it("passes the API's waiting code and hint through for a refreshing Solana report", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: MANAGER }))
      .mockResolvedValueOnce(
        response(
          { code: "SOLANA_REPORT_REFRESHING", response: { retryAfterSeconds: 30 }, message: "x" },
          409,
        ),
      );
    expect(await buildSendToSolanaAction(CORE, { amount: "1000000" })).toEqual({
      ok: false,
      error: { status: 409, code: "SOLANA_REPORT_REFRESHING", retryAfterSeconds: 30 },
    });
  });
  it("refuses builder bodies outside the action's strict schema", async () => {
    mocks.fetch.mockResolvedValue(response({ protocolVersion: "v2", manager: MANAGER }));
    expect(
      await buildSolanaManagerAction(CORE, "kamino-supply", {
        manager: SOLANA_KEY,
        amount: "1",
        lookupTables: [],
      }),
    ).toMatchObject({ ok: false, error: { code: "V2_INVALID_REQUEST" } });
  });
  it("throttles report refreshes per Manager and Fund", async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/reports/fresh")
        ? response({
            protocolVersion: "v2",
            source: "solana",
            ageSeconds: 10,
            usable: true,
            refreshing: false,
            jobId: null,
            waitingOn: null,
            retryAfterSeconds: null,
          })
        : response({ protocolVersion: "v2", manager: MANAGER }),
    );
    expect((await refreshSolanaLaunchReportAction(CORE)).ok).toBe(true);
    expect(await refreshSolanaLaunchReportAction(CORE)).toMatchObject({
      ok: false,
      error: { code: "V2_RATE_LIMITED" },
    });
  });
});
