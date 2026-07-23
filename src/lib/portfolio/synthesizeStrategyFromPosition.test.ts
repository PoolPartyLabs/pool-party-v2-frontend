/**
 * @id PP-PORT (POO-526)
 * @name synthesizeStrategyFromPosition tests
 * @implements-rules-version v1
 *
 * [R1][R2] Builds a real-data FE Strategy from a held position's own pool descriptor so a closed
 * holding renders even when the discovery catalog cannot resolve it (wound-down pools are absent
 * from `/pools`). Structural fields only — never a fabricated prospectus (no-mock-in-real).
 */
import { describe, expect, it } from "vitest";
import { strategySchema } from "@/lib/schemas";
import { type ApiPosition, apiPositionSchema } from "./positionsSchema";
import { synthesizeStrategyFromPosition } from "./synthesizeStrategyFromPosition";

/** A closed-with-balance position payload carrying the full pool descriptor (the real `/all` shape). */
const row = (over: Partial<ApiPosition["poolPartyPosition"]> = {}): ApiPosition => ({
  totalBalanceUsd: 1.07,
  totalFeesInUsd: 0.0069,
  poolPartyPosition: {
    positionId: "0xPOOLDETESTE",
    closed: true,
    name: "Pool de teste",
    poolManager: "0xBb7433F0F9EBc996Aa15269cA08a0De3cF1AFab1",
    currency0: { symbol: "ETH", decimals: 18 },
    currency1: { symbol: "USDC", decimals: 6 },
    feesApr: 12.5,
    poolTvlUsd: 3200,
    totalInvestors: "4",
    network: "arbitrum",
    ...over,
  },
});

describe("synthesizeStrategyFromPosition", () => {
  it("[R1] builds a Strategy from the position's own pool descriptor", () => {
    expect(synthesizeStrategyFromPosition(row())).toMatchObject({
      id: "0xPOOLDETESTE",
      name: "Pool de teste",
      status: "closed",
      estReturn: 12.5,
      rateType: "APR",
      investors: 4,
      tvl: 3200,
      network: "arbitrum",
      poolPair: { token0: "ETH", token1: "USDC" },
    });
  });

  it("[R2] truncates the manager address (real data, not fabricated)", () => {
    expect(synthesizeStrategyFromPosition(row())?.manager).toBe("0xBb74…Fab1");
  });

  it("[R2] derives riskLevel from the token pair (ETH/USDC → dynamic → 3)", () => {
    expect(synthesizeStrategyFromPosition(row())?.riskLevel).toBe(3);
  });

  it("[R4] applies the platform minimum investment", () => {
    expect(synthesizeStrategyFromPosition(row())?.minInvestment).toBe(10);
  });

  it("[R2] never fabricates prospectus: no detail / managerHandle / uniswapPoolTvlUsd", () => {
    const s = synthesizeStrategyFromPosition(row());
    expect(s?.detail).toBeUndefined();
    expect(s?.managerHandle).toBeUndefined();
    expect(s?.uniswapPoolTvlUsd).toBeUndefined();
  });

  it("maps an active (not closed) position's status", () => {
    expect(synthesizeStrategyFromPosition(row({ closed: false }))?.status).toBe("active");
  });

  it("returns undefined when the pool name is absent (cannot render a meaningful row)", () => {
    expect(synthesizeStrategyFromPosition(row({ name: undefined }))).toBeUndefined();
  });

  it("returns undefined when a token currency is absent (cannot derive the pair/risk)", () => {
    expect(synthesizeStrategyFromPosition(row({ currency1: undefined }))).toBeUndefined();
  });

  it("returns undefined when the manager address is absent", () => {
    expect(synthesizeStrategyFromPosition(row({ poolManager: undefined }))).toBeUndefined();
  });

  it("defaults missing enrichment (feesApr/tvl/investors) to zero, staying schema-valid", () => {
    const s = synthesizeStrategyFromPosition(
      row({ feesApr: undefined, poolTvlUsd: undefined, totalInvestors: undefined }),
    );
    expect(s?.estReturn).toBe(0);
    expect(s?.tvl).toBe(0);
    expect(s?.investors).toBe(0);
  });

  it("produces a schema-valid Strategy", () => {
    expect(() => strategySchema.parse(synthesizeStrategyFromPosition(row()))).not.toThrow();
  });

  // POO-771 R3: when the position row carries the embedded `manager` identity (POO-758 R7), the
  // synthesized closed-strategy fallback renders @handle/avatar/verified. @rule R3
  it("[R3] passes through the position-embedded manager identity when present", () => {
    const s = synthesizeStrategyFromPosition({
      ...row(),
      manager: {
        handle: "numen-capital",
        displayName: "Numen Capital",
        avatarUrl: "https://cdn.example/numen.png",
        managerVerification: "valid",
      },
    });
    expect(s?.manager).toBe("@numen-capital");
    expect(s?.managerHandle).toBe("numen-capital");
    expect(s?.managerAvatarUrl).toBe("https://cdn.example/numen.png");
    expect(s?.managerVerified).toBe(true);
    // The full wallet is still kept for the /m/<handle> link + address fallback.
    expect(s?.managerAddress).toBe("0xBb7433F0F9EBc996Aa15269cA08a0De3cF1AFab1");
  });

  // POO-771 R3: absent identity (older backend) stays wallet-only, never fabricated. @rule R3
  it("[R3] stays wallet-only when no embedded manager identity is present", () => {
    const s = synthesizeStrategyFromPosition(row());
    expect(s?.manager).toBe("0xBb74…Fab1");
    expect(s?.managerHandle).toBeUndefined();
    expect(s?.managerAvatarUrl).toBeUndefined();
    // POO-798: no manager object → not "valid" → false.
    expect(s?.managerVerified).toBe(false);
  });

  // POO-798 R1/R2/R4: the synthesized strategy's badge is gated on managerVerification === "valid".
  describe("verified badge gating (POO-798)", () => {
    // @rule R1
    it("[R1] managerVerification 'valid' → managerVerified true", () => {
      const s = synthesizeStrategyFromPosition({
        ...row(),
        manager: { managerVerification: "valid" },
      });
      expect(s?.managerVerified).toBe(true);
    });
    // @rule R1
    it.each([
      "pending",
      "none",
    ] as const)("[R1] managerVerification '%s' → managerVerified false", (status) => {
      const s = synthesizeStrategyFromPosition({
        ...row(),
        manager: { managerVerification: status },
      });
      expect(s?.managerVerified).toBe(false);
    });
    // @rule R4 — absent / null degrades to not-verified.
    it("[R4] managerVerification null → managerVerified false", () => {
      const s = synthesizeStrategyFromPosition({
        ...row(),
        manager: { managerVerification: null },
      });
      expect(s?.managerVerified).toBe(false);
    });
    // @rule R2 — the legacy `verified` boolean is NOT the source anymore.
    it("[R2] legacy verified:true with managerVerification:'none' → managerVerified false", () => {
      const s = synthesizeStrategyFromPosition({
        ...row(),
        manager: { verified: true, managerVerification: "none" },
      });
      expect(s?.managerVerified).toBe(false);
    });
  });

  // POO-771 R1: the raw position schema retains the root-level embedded identity when present, and
  // parses without it (an older backend). apiPositionSchema STRIPS undeclared keys, so this is the
  // load-bearing guard that the identity is not dropped before the synthesizer sees it. @rule R1
  it("[R1] apiPositionSchema keeps the root `manager` object when present and parses without it", () => {
    const parsed = apiPositionSchema.parse({
      ...row(),
      manager: { handle: "numen-capital", avatarUrl: null, verified: true },
    });
    expect(parsed.manager).toMatchObject({ handle: "numen-capital", verified: true });
    // Absent (older backend) parses and leaves manager undefined.
    expect(apiPositionSchema.parse(row()).manager).toBeUndefined();
  });
});
