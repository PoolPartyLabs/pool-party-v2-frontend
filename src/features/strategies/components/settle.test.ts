/**
 * @id PP-STR-LIB-001
 * @name settle — tests
 * @implements-rules-version v2
 *
 * POO-499 R6 (mock determinism): with a gear slippage <= 0.1% the mock confirm step must throw the
 * canned settle slippage error so the notice -> slippage view -> auto-open path is demoable in mock
 * mode; any slippage > 0.1% keeps the happy path. `settleOutcomeForSlippage` folds that decision into
 * the outcome so the modals stay one-liners.
 */
import { describe, expect, it } from "vitest";
import { settleOutcomeForSlippage, settleSwapInfo, settleTxError, settleTxHash } from "./settle";

describe("settleOutcomeForSlippage (POO-499 R6)", () => {
  // @rule R6 — slippage <= 0.1% forces the slippage failure deterministically.
  it("forces an error outcome when slippage is at or below 0.1%", () => {
    expect(settleOutcomeForSlippage(0.1)).toBe("error");
    expect(settleOutcomeForSlippage(0.05)).toBe("error");
    expect(settleOutcomeForSlippage(0)).toBe("error");
  });

  // @rule R6 — slippage > 0.1% keeps the happy path (mock is always success otherwise).
  it("keeps the happy path when slippage is above 0.1%", () => {
    expect(settleOutcomeForSlippage(0.5)).toBe("success");
    expect(settleOutcomeForSlippage(2)).toBe("success");
    expect(settleOutcomeForSlippage(5)).toBe("success");
  });

  // @rule R6 — the canned error still classifies as slippage (message shipped by settle.ts).
  it("the canned settle error message is a slippage message", () => {
    expect(settleTxError().message).toMatch(/slippage tolerance exceeded/i);
  });
});

describe("settleTxHash (POO-541)", () => {
  // @rule POO-541 R1 — the mock receipt/explorer hash self-identifies as mock with a 0xMOCK marker,
  // so a realistic-looking value is never mistaken for a real on-chain hash.
  it("returns an obvious 0xMOCK marker, not a realistic-looking hash", () => {
    const hash = settleTxHash();
    expect(hash.startsWith("0xMOCK")).toBe(true);
    // Regression guard: the old realistic-looking constant must be gone.
    expect(hash).not.toBe("0x7a3f5b8c0d1e2f4a6b8c0d1e2f4a6b8c0d1e9c2e");
  });

  // @rule POO-541 R1 — roughly hash-length so the receipt/explorer UI layout still holds.
  it("keeps roughly the original hash length for layout parity", () => {
    expect(settleTxHash().length).toBe("0x7a3f5b8c0d1e2f4a6b8c0d1e2f4a6b8c0d1e9c2e".length);
  });
});

describe("settleSwapInfo (POO-611)", () => {
  const opts = { slippagePct: 0.5 };

  it("returns three finite numeric fields (a small positive protocol fee)", () => {
    const s = settleSwapInfo(1_000, opts);
    expect(Number.isFinite(s.priceImpactPercentage)).toBe(true);
    expect(Number.isFinite(s.protocolFee)).toBe(true);
    expect(Number.isFinite(s.minAmountInStable)).toBe(true);
    expect(s.protocolFee).toBeGreaterThan(0);
  });

  // @rule R3 — deterministic per (amount, slippage) so flow.rebuild()'s 10s re-quote never flickers.
  it("is deterministic for the same inputs (no re-quote flicker)", () => {
    expect(settleSwapInfo(12_345, opts)).toEqual(settleSwapInfo(12_345, opts));
  });

  // @rule R2 — price impact grows with the swapped amount (a bigger swap moves the pool more).
  it("scales price impact up with the swapped amount", () => {
    const small = settleSwapInfo(100, opts).priceImpactPercentage;
    const mid = settleSwapInfo(100_000, opts).priceImpactPercentage;
    const large = settleSwapInfo(10_000_000, opts).priceImpactPercentage;
    expect(small).toBeLessThan(mid);
    expect(mid).toBeLessThan(large);
  });

  // @rule R2 — typical amounts stay benign; only whale-sized trades reach the >=2% warning band.
  it("keeps typical amounts benign and lets whale-sized trades reach the warning band", () => {
    expect(settleSwapInfo(100, opts).priceImpactPercentage).toBeLessThan(0.5);
    expect(settleSwapInfo(10_000_000, opts).priceImpactPercentage).toBeGreaterThanOrEqual(2);
  });

  // @rule R2 — the minimum received is the amount net of slippage + impact + protocol fee.
  it("returns a minimum received strictly below the swapped amount", () => {
    const amount = 5_000;
    const s = settleSwapInfo(amount, opts);
    expect(s.minAmountInStable).toBeGreaterThan(0);
    expect(s.minAmountInStable).toBeLessThan(amount);
  });

  it("stays non-negative and finite at the zero edge", () => {
    const s = settleSwapInfo(0, opts);
    expect(s.minAmountInStable).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(s.priceImpactPercentage)).toBe(true);
  });
});
