import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLaunchSwapAction, triggerLaunchReportAction } from "./launchActions";

const mocks = vi.hoisted(() => ({ wallet: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: mocks.wallet }));
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
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("PP_API_URL", "https://api.example.test");
    vi.stubEnv("PP_API_KEY", "normal-secret");
    vi.stubEnv("PP_API_ADMIN_KEY", "admin-secret");
    mocks.wallet.mockResolvedValue(wallet);
    mocks.fetch.mockResolvedValue(response({ protocolVersion: "v2", manager: wallet }));
  });
  it("refuses 8% custom loss before any API call", async () => {
    expect(await buildLaunchSwapAction({ ...swap, maxLossBps: 800 })).toMatchObject({ ok: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated or non-manager report triggers", async () => {
    mocks.wallet.mockResolvedValue(null);
    expect(await triggerLaunchReportAction(core)).toMatchObject({
      ok: false,
      error: { status: 401 },
    });
    mocks.wallet.mockResolvedValue(core);
    expect(await triggerLaunchReportAction(core)).toMatchObject({
      ok: false,
      error: { status: 403 },
    });
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/report"))).toBe(false);
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
});
