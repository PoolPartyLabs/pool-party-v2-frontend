/**
 * @id PP-STR (POO-536) · POO-778 (single-request detail, closed-held fallback preserved)
 * @name resolveDetailStrategy tests
 * @implements-rules-version v1
 *
 * The detail route resolves a strategy via the single `getStrategyById` read (POO-778 R1), then (real
 * mode only) falls back to the signed-in wallet's held position's synthesized strategy when the read
 * misses a closed/wound-down pool (POO-536/POO-455). A genuinely unknown id stays null so the page
 * 404s.
 *
 * POO-778 R3/R4: for a SIGNED-OUT visitor an unknown id must never read positions (the 404
 * short-circuit — `getStrategyById` already cost at most one upstream request); for a SIGNED-IN user
 * the closed/held fallback still resolves, ordered strictly AFTER the single-row read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isMockMode: false,
  getStrategyById: vi.fn(),
  fetchPositions: vi.fn(),
  wallet: null as string | null,
  authHeader: { Authorization: "Bearer t" } as Record<string, string>,
}));

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.isMockMode;
  },
}));
vi.mock("./strategyCatalog", () => ({ getStrategyById: mocks.getStrategyById }));
vi.mock("@/lib/portfolio/fetchPositions", () => ({ fetchPositions: mocks.fetchPositions }));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: async () => mocks.wallet,
  getAuthHeader: async () => mocks.authHeader,
}));

import { resolveDetailStrategy } from "./resolveDetailStrategy";

// Structural stand-ins — the resolver only forwards these, it never inspects their shape.
const catalogStrategy = { id: "0xopen", name: "Open" } as never;
const synthStrategy = { id: "0xclosed", name: "Closed", status: "closed" } as never;

describe("resolveDetailStrategy", () => {
  beforeEach(() => {
    mocks.isMockMode = false;
    mocks.wallet = "0xWALLET";
    mocks.getStrategyById.mockReset();
    mocks.fetchPositions.mockReset();
  });

  it("returns the catalog strategy when found, without fetching holdings", async () => {
    mocks.getStrategyById.mockResolvedValue(catalogStrategy);
    expect(await resolveDetailStrategy("0xopen")).toBe(catalogStrategy);
    expect(mocks.fetchPositions).not.toHaveBeenCalled();
  });

  // @rule R4 (POO-778 / POO-455): the closed/held fallback survives the single-request collapse — a
  // strategy the v2 read 404s (dropped from discovery) still resolves for its holder.
  it("[POO-778 R4] falls back to the held position's synthesized strategy when the single read misses (POO-536/POO-455)", async () => {
    mocks.getStrategyById.mockResolvedValue(null);
    mocks.fetchPositions.mockResolvedValue([
      { strategyId: "0xother", fallbackStrategy: { id: "x" } },
      { strategyId: "0xclosed", fallbackStrategy: synthStrategy },
    ]);
    expect(await resolveDetailStrategy("0xclosed")).toBe(synthStrategy);
    // Holdings are read with closed=all so a wound-down position still resolves.
    expect(mocks.fetchPositions).toHaveBeenCalledWith("0xWALLET", mocks.authHeader, "all");
  });

  // @rule R4: the positions fallback is ordered strictly AFTER the single-row read — the read is
  // attempted first, and holdings are only touched on its miss (never before, never in parallel).
  it("[POO-778 R4] reads the strategy first, then holdings only on the miss (ordering)", async () => {
    const order: string[] = [];
    mocks.getStrategyById.mockImplementation(async () => {
      order.push("getStrategyById");
      return null;
    });
    mocks.fetchPositions.mockImplementation(async () => {
      order.push("fetchPositions");
      return [{ strategyId: "0xclosed", fallbackStrategy: synthStrategy }];
    });
    await resolveDetailStrategy("0xclosed");
    expect(order).toEqual(["getStrategyById", "fetchPositions"]);
  });

  it("returns null for an unknown id — no catalog match and not held (still 404s)", async () => {
    mocks.getStrategyById.mockResolvedValue(null);
    mocks.fetchPositions.mockResolvedValue([
      { strategyId: "0xother", fallbackStrategy: synthStrategy },
    ]);
    expect(await resolveDetailStrategy("0xunknown")).toBeNull();
  });

  it("returns null when the held position has no synthesized fallback", async () => {
    mocks.getStrategyById.mockResolvedValue(null);
    mocks.fetchPositions.mockResolvedValue([
      { strategyId: "0xclosed", fallbackStrategy: undefined },
    ]);
    expect(await resolveDetailStrategy("0xclosed")).toBeNull();
  });

  // @rule R3 (POO-778): the 404 short-circuit for a signed-out visitor — an unknown id resolves to
  // null WITHOUT any positions read (getStrategyById already cost at most one upstream request, and
  // there is no wallet to fall back to), so the page 404s cheaply.
  it("[POO-778 R3] does not fetch holdings when not signed in (404 short-circuit)", async () => {
    mocks.getStrategyById.mockResolvedValue(null);
    mocks.wallet = null;
    expect(await resolveDetailStrategy("0xclosed")).toBeNull();
    expect(mocks.fetchPositions).not.toHaveBeenCalled();
  });

  it("mock mode: no real portfolio to fall back to, so a catalog miss stays null", async () => {
    mocks.isMockMode = true;
    mocks.getStrategyById.mockResolvedValue(null);
    expect(await resolveDetailStrategy("0xclosed")).toBeNull();
    expect(mocks.fetchPositions).not.toHaveBeenCalled();
  });
});
