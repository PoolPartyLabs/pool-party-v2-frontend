/**
 * @id PP-REW-LIB-004 (POO-661)
 * @name fetchReferral tests
 * @implements-rules-version v1
 *
 * [R1][R2][R3] Server-side read of pp-api `GET /referral/:wallet`, Zod-parsed and mapped to a
 * `ReferralProgram`. No address → the empty program without any network call. A null read (wallet has
 * no record) → the empty program. A genuine upstream error propagates (the profile path degrades it
 * separately via readReferralOrNull).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

async function importModule() {
  vi.resetModules();
  return import("./fetchReferral");
}

const address = "0x1a2b3c4d5e6f7890a1b2c3d4e5f6789012345678";

describe("fetchReferral", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  // @rule R2: no address → empty program, no network call
  it("returns the empty program without hitting the network when no address is given", async () => {
    const { fetchReferral } = await importModule();
    const program = await fetchReferral();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(program.code).toBeNull();
    expect(program.friendsJoined).toBe(0);
    expect(program.invites).toHaveLength(0);
  });

  // @rule R1/R2: with an address → GET referral/:wallet (schema + cache tag) then map
  it("reads GET referral/:wallet (schema + revalidate + per-wallet tag) and maps the result", async () => {
    apiFetch.mockResolvedValue({
      wallet: address,
      code: "MARIA2026",
      referees: [{ wallet: "0x1111111111111111111111111111111111111111", createdAt: "2026-01-01" }],
    });
    const { fetchReferral } = await importModule();

    const program = await fetchReferral(address);

    const call = apiFetch.mock.calls[0];
    if (!call) throw new Error("apiFetch was not called");
    const [path, opts] = call as [
      string,
      { revalidate?: number; tags?: string[]; schema?: unknown },
    ];
    expect(path).toBe(`referral/${address}`);
    expect(opts.revalidate).toBeGreaterThan(0);
    expect(opts.tags).toEqual([`referral:${address}`]);
    expect(opts.schema).toBeDefined();
    expect(program.code).toBe("MARIA2026");
    expect(program.friendsJoined).toBe(1);
  });

  // @rule R3: a null read (no record) maps to the empty program
  it("maps a null read to the empty program", async () => {
    apiFetch.mockResolvedValue(null);
    const { fetchReferral } = await importModule();
    const program = await fetchReferral(address);
    expect(program.code).toBeNull();
    expect(program.invites).toHaveLength(0);
  });

  // @rule R7: a genuine upstream error propagates (the profile path degrades it separately)
  it("propagates an upstream error", async () => {
    apiFetch.mockRejectedValue(new ApiError(503, "SYSTEM_INTERNAL", "down"));
    const { fetchReferral } = await importModule();
    await expect(fetchReferral(address)).rejects.toThrow(ApiError);
  });

  // @rule R2: the per-wallet cache tag is lowercased
  it("exposes a lowercased per-wallet cache tag", async () => {
    const { referralTag } = await importModule();
    expect(referralTag("0xABC")).toBe("referral:0xabc");
  });
});
