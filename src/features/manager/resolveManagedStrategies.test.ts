/**
 * @id PP-MGR-LIB-014 (POO-779)
 * @name resolveManagedStrategies tests
 * @implements-rules-version v3
 *
 * R4 (v3) core: the manager-console strategy LIST is the managerWallet-scoped v2 read UNION any
 * vanished-but-held managed pool recovered from the wallet's already-fetched positions
 * (`isPoolManager` + `fallbackStrategy`, the POO-373 `missing` / POO-455 / POO-537 case), deduped by
 * strategy id with the scoped-read row winning on conflict. This kills the `listStrategiesForHoldings`
 * catalog drain from the list path while guaranteeing parity regardless of whether the scoped read
 * returns `missing` rows.
 */
import { describe, expect, it } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { composeManagedFromPositions, resolveManagedStrategies } from "./resolveManagedStrategies";

function strategy(id: string, over: Partial<Strategy> = {}): Strategy {
  return {
    id,
    name: over.name ?? `Strategy ${id}`,
    manager: over.manager ?? "0xabc…def",
    riskLevel: over.riskLevel ?? 3,
    minInvestment: 10,
    tvl: over.tvl ?? 1000,
    investors: over.investors ?? 5,
    estReturn: over.estReturn ?? 12,
    rateType: "APR",
    status: over.status ?? "active",
    ...over,
  };
}

function position(strategyId: string, over: Partial<Position> = {}): Position {
  return {
    id: `pos-${strategyId}`,
    strategyId,
    invested: 100,
    currentValue: 100,
    totalYield: over.totalYield ?? 0,
    available: 100,
    reinvestment: "manual-payout",
    status: over.status ?? "active",
    isPoolManager: over.isPoolManager,
    fallbackStrategy: over.fallbackStrategy,
  };
}

describe("resolveManagedStrategies", () => {
  // @rule R4: rows come from the managerWallet-scoped read (not the killed catalog drain).
  it("[R4] returns the scoped-read strategies as the base list", () => {
    const scoped = [strategy("s1"), strategy("s2")];
    const rows = resolveManagedStrategies(scoped, []);
    expect(rows.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  // @rule R4: an empty scoped read + no managed positions yields an empty list (first-run manager).
  it("[R4] empty scoped read + no positions → empty list", () => {
    expect(resolveManagedStrategies([], [])).toEqual([]);
  });

  // @rule R4 (Q2, parity): a managed pool that VANISHED from the indexer (absent from the scoped read)
  // is recovered from the wallet's held position via fallbackStrategy and unioned in — never dropped.
  it("[R4] recovers a vanished-but-held managed pool from position.fallbackStrategy", () => {
    const vanished = strategy("s-gone", { status: "closed", tvl: 2000 });
    const rows = resolveManagedStrategies(
      [strategy("s1")],
      [position("s-gone", { isPoolManager: true, status: "closed", fallbackStrategy: vanished })],
    );
    expect(rows.map((s) => s.id).sort()).toEqual(["s-gone", "s1"]);
    expect(rows.find((s) => s.id === "s-gone")?.status).toBe("closed");
  });

  // @rule R4 (Q2, dedupe): when the scoped read ALSO returns the pool, the scoped-read row wins and
  // the fallback is NOT added twice (harmless no-op union).
  it("[R4] dedupes by id; the scoped-read row wins over the position fallback", () => {
    const scopedRow = strategy("s-dup", { name: "Scoped Name", tvl: 9999 });
    const fallback = strategy("s-dup", { name: "Fallback Name", tvl: 1 });
    const rows = resolveManagedStrategies(
      [scopedRow],
      [position("s-dup", { isPoolManager: true, fallbackStrategy: fallback })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Scoped Name");
    expect(rows[0]?.tvl).toBe(9999);
  });

  // @rule R4: only MANAGED positions (isPoolManager) contribute a recovery — a plain investor holding
  // is never promoted into the manager console list.
  it("[R4] ignores a non-manager position (no recovery from an investor holding)", () => {
    const rows = resolveManagedStrategies(
      [strategy("s1")],
      [
        position("s-invest", {
          isPoolManager: false,
          fallbackStrategy: strategy("s-invest"),
        }),
      ],
    );
    expect(rows.map((s) => s.id)).toEqual(["s1"]);
  });

  // @rule R4: a managed position with no fallbackStrategy (lean read) and no scoped-read match is
  // dropped rather than fabricated — matches the legacy "never fabricate a row" behavior.
  it("[R4] drops a managed position that has neither a scoped row nor a fallback", () => {
    const rows = resolveManagedStrategies(
      [],
      [position("s-orphan", { isPoolManager: true, fallbackStrategy: undefined })],
    );
    expect(rows).toEqual([]);
  });

  // @rule R4: two managed positions on the same vanished pool recover a single deduped row.
  it("[R4] dedupes two positions on the same vanished pool to one row", () => {
    const fallback = strategy("s-gone", { status: "closed" });
    const rows = resolveManagedStrategies(
      [],
      [
        position("s-gone", { isPoolManager: true, fallbackStrategy: fallback }),
        position("s-gone", { isPoolManager: true, fallbackStrategy: fallback }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("s-gone");
  });
});

describe("composeManagedFromPositions (legacy compose: mock mode + Q4 real-mode fallback)", () => {
  // @rule R4/R5: the LEGACY position-derived composition — the pre-R4 behavior, preserved verbatim for
  // mock mode and for the real-mode scoped-read-error fallback. Rows = the wallet's isPoolManager
  // positions joined to the (mock/holdings) catalog by id, or the position's fallbackStrategy.

  const catalog = [strategy("s1"), strategy("s2"), strategy("s3")];

  it("includes only managed positions, joined to the catalog", () => {
    const rows = composeManagedFromPositions(catalog, [
      position("s1", { isPoolManager: true }),
      position("s2", { isPoolManager: true }),
      position("s3", { isPoolManager: false }),
    ]);
    expect(rows.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("recovers a managed pool via fallbackStrategy when the catalog omits it (POO-526)", () => {
    const rows = composeManagedFromPositions(
      [strategy("s1")],
      [
        position("s1", { isPoolManager: true }),
        position("s-gone", {
          isPoolManager: true,
          status: "closed",
          fallbackStrategy: strategy("s-gone", { status: "closed" }),
        }),
      ],
    );
    expect(rows.map((s) => s.id).sort()).toEqual(["s-gone", "s1"]);
  });

  it("drops a managed position with no catalog match and no fallback (never fabricated)", () => {
    const rows = composeManagedFromPositions(catalog, [
      position("s-orphan", { isPoolManager: true, status: "closed", fallbackStrategy: undefined }),
    ]);
    expect(rows).toEqual([]);
  });

  it("prefers the catalog row over the position fallback on a match", () => {
    const rows = composeManagedFromPositions(
      [strategy("s1", { name: "Catalog Name" })],
      [
        position("s1", {
          isPoolManager: true,
          fallbackStrategy: strategy("s1", { name: "Fallback Name" }),
        }),
      ],
    );
    expect(rows[0]?.name).toBe("Catalog Name");
  });

  it("dedupes two managed positions on the same catalog strategy to one row", () => {
    const rows = composeManagedFromPositions(
      [strategy("s1")],
      [position("s1", { isPoolManager: true }), position("s1", { isPoolManager: true })],
    );
    expect(rows).toHaveLength(1);
  });
});
