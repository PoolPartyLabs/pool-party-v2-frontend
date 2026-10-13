/**
 * @tests PP-CORE-SEC-004 (POO-2262)
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ wallet: vi.fn(), enabled: true }));
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: mocks.wallet }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => mocks.enabled }));
const upstream = vi.fn();
const call = (body: unknown) =>
  POST(
    new Request("http://app.test/api/solana-rpc", { method: "POST", body: JSON.stringify(body) }),
  );

beforeEach(() => {
  vi.stubGlobal("fetch", upstream);
  vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example/key-in-path");
  upstream.mockReset();
  mocks.enabled = true;
  mocks.wallet.mockResolvedValue("0x000000000000000000000000000000000000dead");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("forwards an allow-listed call to the server-side provider and returns its JSON-RPC body", async () => {
  upstream.mockResolvedValue(
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "hash" })),
  );
  const response = await call({ jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: "hash" });
  expect(upstream).toHaveBeenCalledWith(
    "https://rpc.example/key-in-path",
    expect.objectContaining({ method: "POST", redirect: "error" }),
  );
});
it("keeps a node refusal (preflight) as a JSON-RPC error the client can classify", async () => {
  upstream.mockResolvedValue(
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: "x" } })),
  );
  const response = await call({
    jsonrpc: "2.0",
    id: 1,
    method: "sendTransaction",
    params: ["AA=="],
  });
  expect((await response.json()).error.code).toBe(-32002);
});
it.each([
  ["a signed-out caller", { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] }, 401],
  ["a batch", [{ jsonrpc: "2.0", id: 1, method: "getBalance" }], 400],
  ["a method outside the allow-list", { jsonrpc: "2.0", id: 1, method: "requestAirdrop" }, 400],
  ["non-array params", { jsonrpc: "2.0", id: 1, method: "getBalance", params: {} }, 400],
])("refuses %s without calling the provider", async (label, body, status) => {
  if (label === "a signed-out caller") mocks.wallet.mockResolvedValue(null);
  expect((await call(body)).status).toBe(status);
  expect(upstream).not.toHaveBeenCalled();
});
it("is not served while the Solana spoke flag is off", async () => {
  mocks.enabled = false;
  expect((await call({ jsonrpc: "2.0", id: 1, method: "getBalance" })).status).toBe(404);
});
