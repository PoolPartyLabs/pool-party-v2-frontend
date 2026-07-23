/**
 * @id PP-STR (POO-458, POO-455) · PP-STR-LIB-008 (POO-579) · POO-778 (single-request detail)
 * @name strategyCatalog tests
 * @implements-rules-version v1
 *
 * The Explore discovery catalog (listStrategies) reads the v2 catalog in real mode and excludes closed
 * strategies in BOTH modes; a v2 error falls back to the v1 `/pools` catalog. The holdings resolver
 * (listStrategiesForHoldings) also reads the v2 catalog (POO-721) but drains EVERY lifecycle state
 * (closed-inclusive, POO-455), falling back to v1 `/pools` on error.
 *
 * POO-778: getStrategyById resolves the strategy DETAIL in ONE request — `fetchStrategyV2ById`
 * shape-routes it (POO-776): a UUID hits the UUID-only `GET /api/v2/strategies/:id`, a chain-bound
 * positionId hits the case-insensitive `GET /api/v2/strategies/by-position/:positionId`. Both return the
 * same `{data: StrategyV2}` envelope, retiring the drain-and-find that POO-741 used for the logoUrl. A
 * clean v2 404 returns null WITHOUT the v1 3-network drain (R3); only a genuine v2 error degrades to the
 * v1 by-id read (POO-579 resilience). The list surfaces (listStrategies / listStrategiesForHoldings) keep
 * their catalog drains (R5). (`fetchStrategyV2ById` is mocked here as a black box; the endpoint routing
 * itself is asserted in `fetchStrategiesV2.test.ts`.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  mockMode: false,
  v1List: [] as Strategy[],
  v1ById: null as Strategy | null,
  v2Page: { strategies: [] as Array<{ id: string; status: string }>, totalItems: 0 },
  v2Throws: false,
  v2ById: null as { id: string; status: string } | null,
  v2ByIdThrows: false,
  mockList: [] as Strategy[],
  mockAll: [] as Strategy[],
  mockById: null as Strategy | null,
}));

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
  strategyService: {
    list: async () => mocks.mockList,
    listAll: async () => mocks.mockAll,
    getById: async () => mocks.mockById,
  },
}));
vi.mock("./fetchStrategies", () => ({
  fetchStrategies: vi.fn(async () => mocks.v1List),
  fetchStrategyById: vi.fn(async () => mocks.v1ById),
}));
vi.mock("./v2/fetchStrategiesV2", () => ({
  fetchStrategiesV2: vi.fn(async () => {
    if (mocks.v2Throws) throw new Error("v2 down");
    return mocks.v2Page;
  }),
  fetchStrategyV2ById: vi.fn(async () => {
    if (mocks.v2ByIdThrows) throw new Error("v2 down");
    return mocks.v2ById;
  }),
}));
// Map the lightweight v2 row into a Strategy for routing assertions (real mapper is unit-tested apart).
// The real mapper carries the manager-uploaded logoUrl (POO-721); model that so the catalog path can be
// asserted to preserve it (POO-741).
vi.mock("./v2/mapStrategyV2", () => ({
  mapStrategyV2: (row: { id: string; status: string }) => ({
    ...mk(row.id, row.status as Strategy["status"]),
    logoUrl: `logo-${row.id}`,
  }),
}));

import { fetchStrategies, fetchStrategyById } from "./fetchStrategies";
import {
  getStrategyById,
  listManagedStrategies,
  listStrategies,
  listStrategiesForHoldings,
} from "./strategyCatalog";
import { fetchStrategiesV2, fetchStrategyV2ById } from "./v2/fetchStrategiesV2";

function mk(id: string, status: Strategy["status"]): Strategy {
  return {
    id,
    name: id,
    manager: "0x",
    riskLevel: 3,
    minInvestment: 0,
    tvl: 0,
    investors: 0,
    estReturn: 0,
    rateType: "APR",
    status,
  };
}

const UUID = "9f8b9430-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const POSITION_ID = "0x691593cfc196dd25215d944080863f0b55ca8cbaa2b8a07595febca7897753f3";

describe("strategyCatalog", () => {
  beforeEach(() => {
    mocks.mockMode = false;
    mocks.v1List = [];
    mocks.v1ById = null;
    mocks.v2Page = { strategies: [], totalItems: 0 };
    mocks.v2Throws = false;
    mocks.v2ById = null;
    mocks.v2ByIdThrows = false;
    mocks.mockList = [];
    mocks.mockAll = [];
    mocks.mockById = null;
    vi.mocked(fetchStrategies).mockClear();
    vi.mocked(fetchStrategyById).mockClear();
    vi.mocked(fetchStrategiesV2).mockClear();
    vi.mocked(fetchStrategyV2ById).mockClear();
  });

  // --- listStrategies (Explore discovery) --------------------------------------------------------

  it("[POO-579] listStrategies reads the v2 catalog in real mode and excludes closed", async () => {
    mocks.v2Page = {
      strategies: [
        { id: "a", status: "active" },
        { id: "c", status: "closed" },
        { id: "p", status: "paused" },
      ],
      totalItems: 3,
    };
    expect((await listStrategies()).map((s) => s.id)).toEqual(["a", "p"]);
    // POO-667: the drain requests lifecycle=live so the backend excludes closed server-side; the
    // status!=="closed" filter below is belt-and-braces (still needed for the v1 fallback + mock).
    expect(fetchStrategiesV2).toHaveBeenCalledWith(expect.objectContaining({ lifecycle: "live" }));
    // The v1 catalog is NOT touched on the happy v2 path.
    expect(fetchStrategies).not.toHaveBeenCalled();
  });

  it("[POO-579] listStrategies falls back to the v1 catalog when the v2 read errors", async () => {
    mocks.v2Throws = true;
    mocks.v1List = [mk("a", "active"), mk("c", "closed")];
    expect((await listStrategies()).map((s) => s.id)).toEqual(["a"]);
    expect(fetchStrategies).toHaveBeenCalled();
  });

  // @rule R7
  it("[POO-458] listStrategies excludes closed in mock mode too (defence in depth)", async () => {
    mocks.mockMode = true;
    mocks.mockList = [mk("a", "active"), mk("c", "closed")];
    expect((await listStrategies()).map((s) => s.id)).toEqual(["a"]);
    expect(fetchStrategiesV2).not.toHaveBeenCalled();
  });

  // --- listStrategiesForHoldings (portfolio join) ------------------------------------------------

  it("[POO-721] listStrategiesForHoldings reads the v2 catalog and keeps EVERY status (closed-inclusive)", async () => {
    mocks.v2Page = {
      strategies: [
        { id: "a", status: "active" },
        { id: "c", status: "closed" },
      ],
      totalItems: 2,
    };
    // R1/R2: holdings map from v2 AND keep closed — no discovery `status !== "closed"` filter.
    expect((await listStrategiesForHoldings()).map((s) => s.id)).toEqual(["a", "c"]);
    // R2: drains WITHOUT a lifecycle filter (vs discovery's lifecycle=live) so the backend returns
    // closed too.
    const callArg = vi.mocked(fetchStrategiesV2).mock.calls[0]?.[0];
    expect(callArg).not.toHaveProperty("lifecycle");
    // R1: the happy v2 path never touches v1 `/pools`.
    expect(fetchStrategies).not.toHaveBeenCalled();
  });

  it("[POO-721] listStrategiesForHoldings falls back to the v1 /pools catalog when v2 errors (keeps closed)", async () => {
    mocks.v2Throws = true;
    mocks.v1List = [mk("a", "active"), mk("c", "closed")];
    // R3: degrade to v1 rather than fail; still closed-inclusive.
    expect((await listStrategiesForHoldings()).map((s) => s.id)).toEqual(["a", "c"]);
    expect(fetchStrategies).toHaveBeenCalled();
  });

  it("[POO-455] listStrategiesForHoldings uses the unfiltered mock list in mock mode", async () => {
    mocks.mockMode = true;
    mocks.mockAll = [mk("a", "active"), mk("c", "closed")];
    expect((await listStrategiesForHoldings()).map((s) => s.id)).toEqual(["a", "c"]);
    // R5: mock mode never hits either real catalog.
    expect(fetchStrategiesV2).not.toHaveBeenCalled();
    expect(fetchStrategies).not.toHaveBeenCalled();
  });

  // --- getStrategyById (single-request detail resolve, POO-778) ----------------------------------
  // POO-778 R1: BOTH id shapes resolve via ONE `fetchStrategyV2ById` read, which shape-routes to the
  // UUID-only `/:id` or the case-insensitive `/by-position/:positionId` (POO-776). The full-catalog
  // drain-and-find (POO-741) leaves the detail path; `getStrategyById` no longer calls `fetchStrategiesV2`
  // at all. (Which endpoint `fetchStrategyV2ById` hits is asserted in `fetchStrategiesV2.test.ts`.)

  // @rule R1 (regression): a UUID still resolves via the single v2 read.
  it("[POO-579][POO-778 R1] getStrategyById routes a UUID to the single v2 read and maps it", async () => {
    mocks.v2ById = { id: UUID, status: "active" };
    const strategy = await getStrategyById(UUID);
    expect(strategy?.id).toBe(UUID);
    expect(fetchStrategyV2ById).toHaveBeenCalledWith(UUID);
    expect(fetchStrategyById).not.toHaveBeenCalled();
    // R1: the detail resolve never drains the catalog.
    expect(fetchStrategiesV2).not.toHaveBeenCalled();
  });

  // @rule R1: a positionId resolves via the SAME single v2 read (routed to /by-position, POO-776) — no
  // catalog drain.
  it("[POO-778 R1] getStrategyById(positionId) resolves via ONE v2 read, never draining the catalog", async () => {
    mocks.v2ById = { id: POSITION_ID, status: "active" };
    const strategy = await getStrategyById(POSITION_ID);
    expect(strategy?.id).toBe(POSITION_ID);
    // The manager-uploaded logoUrl still rides the single read (mapStrategyV2 mock adds it).
    expect(strategy?.logoUrl).toBe(`logo-${POSITION_ID}`);
    expect(fetchStrategyV2ById).toHaveBeenCalledWith(POSITION_ID);
    // R1: the drain-and-find path is gone from the detail resolve.
    expect(fetchStrategiesV2).not.toHaveBeenCalled();
    // R3: a hit never touches the v1 `/pools` read either.
    expect(fetchStrategyById).not.toHaveBeenCalled();
  });

  // @rule R3: a clean v2 404 for a positionId returns null WITHOUT the v1 3-network drain (unknown id
  // costs at most one upstream request — the 404-short-circuit).
  it("[POO-778 R3] getStrategyById(positionId) returns null on a clean v2 404, no v1 fetchStrategies drain", async () => {
    mocks.v2ById = null; // 404 → fetchStrategyV2ById resolves null
    expect(await getStrategyById(POSITION_ID)).toBeNull();
    expect(fetchStrategyById).not.toHaveBeenCalled();
    expect(fetchStrategies).not.toHaveBeenCalled();
    expect(fetchStrategiesV2).not.toHaveBeenCalled();
  });

  // @rule R3: same short-circuit for a UUID deep link (unchanged POO-579 behavior, re-locked).
  it("[POO-579][POO-778 R3] getStrategyById returns null on a clean v2 404 for a UUID (no v1 scan)", async () => {
    mocks.v2ById = null; // 404 → fetchStrategyV2ById resolves null
    expect(await getStrategyById(UUID)).toBeNull();
    expect(fetchStrategyById).not.toHaveBeenCalled();
    expect(fetchStrategies).not.toHaveBeenCalled();
  });

  // A genuine v2 ERROR (not a 404) still degrades to the v1 by-id read (POO-579 resilience), for BOTH
  // shapes — this is the ONLY path that reaches v1 now, and it is an outage, not an unknown id.
  it("[POO-579] getStrategyById falls back to the v1 by-id read when the v2 read errors (UUID)", async () => {
    mocks.v2ByIdThrows = true;
    mocks.v1ById = mk(UUID, "active");
    const strategy = await getStrategyById(UUID);
    expect(strategy?.id).toBe(UUID);
    expect(fetchStrategyById).toHaveBeenCalledWith(UUID);
  });

  it("[POO-579] getStrategyById falls back to the v1 by-id read when the v2 read errors (positionId)", async () => {
    mocks.v2ByIdThrows = true;
    mocks.v1ById = mk(POSITION_ID, "active");
    const strategy = await getStrategyById(POSITION_ID);
    expect(strategy?.id).toBe(POSITION_ID);
    expect(fetchStrategyById).toHaveBeenCalledWith(POSITION_ID);
  });

  it("getStrategyById uses the mock service in mock mode (UUID)", async () => {
    mocks.mockMode = true;
    mocks.mockById = mk(UUID, "active");
    expect((await getStrategyById(UUID))?.id).toBe(UUID);
    expect(fetchStrategyV2ById).not.toHaveBeenCalled();
  });

  // Mock mode is unaffected by the POO-778 shape routing: getStrategyById short-circuits to the mock
  // getById (an exact-id match) for a positionId too, never touching the real by-position/`:id` reads.
  it("getStrategyById uses the mock service in mock mode (positionId)", async () => {
    mocks.mockMode = true;
    mocks.mockById = mk(POSITION_ID, "active");
    expect((await getStrategyById(POSITION_ID))?.id).toBe(POSITION_ID);
    expect(fetchStrategyV2ById).not.toHaveBeenCalled();
  });

  // --- listManagedStrategies (POO-779 R4: manager-scoped console-list read) -----------------------
  // This is the REAL-mode scoped-read fetcher only: it drains GET /api/v2/strategies?managerWallet=…
  // and returns Strategy[] (or null on error, so the caller degrades). The mock-mode branch + the
  // vanished-pool union with positions live in getManagerConsoleAction (see actions.test.ts).

  // @rule R4: real mode drains the managerWallet-scoped v2 read (the killed catalog drain is gone).
  it("[POO-779 R4] drains the managerWallet-scoped v2 read and maps the rows (real mode)", async () => {
    mocks.v2Page = {
      strategies: [
        { id: "m1", status: "active" },
        { id: "m2", status: "closed" },
      ],
      totalItems: 2,
    };
    const rows = await listManagedStrategies("0xManagerWallet");
    expect(rows?.map((s) => s.id)).toEqual(["m1", "m2"]);
    // The scoped read carries the managerWallet filter and NO lifecycle coupling (closed kept).
    const callArg = vi.mocked(fetchStrategiesV2).mock.calls[0]?.[0];
    expect(callArg).toMatchObject({ managerWallet: "0xManagerWallet" });
    expect(callArg).not.toHaveProperty("lifecycle");
    // R4: the console-list path no longer touches the v1 `/pools` catalog on the happy path.
    expect(fetchStrategies).not.toHaveBeenCalled();
  });

  // @rule R4 (Q4): on a scoped-read error in real mode, return null so the caller degrades to the
  // legacy position-derived compose path (baseline preserved) — it does NOT silently blank the list.
  it("[POO-779 R4/Q4] returns null on a scoped-read error (real mode) so the caller falls back", async () => {
    mocks.v2Throws = true;
    expect(await listManagedStrategies("0xManagerWallet")).toBeNull();
  });

  // @rule R5: mock mode returns the full mock catalog as the scoped-read stand-in (getManagerConsoleAction
  // then joins it to the managed positions), never hitting the v2 read.
  it("[POO-779 R5] mock mode returns the mock catalog and never hits the v2 read", async () => {
    mocks.mockMode = true;
    mocks.mockAll = [mk("a", "active"), mk("c", "closed")];
    const rows = await listManagedStrategies("0xIgnoredInMock");
    expect(rows?.map((s) => s.id)).toEqual(["a", "c"]);
    expect(fetchStrategiesV2).not.toHaveBeenCalled();
    expect(fetchStrategies).not.toHaveBeenCalled();
  });
});
