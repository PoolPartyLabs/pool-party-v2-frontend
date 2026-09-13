/**
 * @id PP-CORE-LIB-064 (POO-1133, POO-1573)
 * @name sizeOnRampOrder tests
 * @implements-rules-version v3 (POO-1573 rules v2) · v2 (POO-1129 rules v2)
 *
 * Pure sizing decision for a fiat on-ramp order: pick ETH-BASE vs USDC-BASE and the fiat amount, in
 * both shapes the epic ships (an in-flow provisioning leg, and a standalone buy-crypto CTA). Rules v2
 * (POO-1129):
 *   [R1] the gas TRIGGER is split by context. In-flow: the resolved classifier/GasFundingSource answer
 *        (buy ETH iff the on-ramp funds the op's gas); PAYBIS_GAS_FLOOR_ETH must NOT participate.
 *        Standalone: native ETH on Base < gasFloorEth. Either way, needs gas => ETH-BASE + swap the
 *        op-funding portion to USDC; has gas => USDC-BASE direct. The gas component is
 *        max(classifier figure, gasFloorEth*ethUsd when standalone, gasChoiceUsd), computed here (not
 *        via raiseTopUpToUsd, which is balance-capped and cannot size a fiat target).
 *   [R3] standalone: no bridge/op anchor downstream; sizing is otherwise identical.
 *   [R6] the whole order floors at PAYBIS_MIN_USD ($10), which is the CARD ladder's floor
 *        (GAS_PRESETS_USD[0]) and never the USDC ladder's $5.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ProvisioningOrder } from "@/lib/provisioning";
import { GAS_PRESETS_USD, GAS_PRESETS_USDC_USD, PAYBIS_MIN_USD } from "@/lib/provisioning";
import type { SizeOnRampOrderInput } from "./sizeOnRampOrder";
import { sizeOnRampOrder } from "./sizeOnRampOrder";

/** An in-flow order (an operation exists), fully specified so each test varies only what it asserts. */
function inFlow(overrides: Partial<SizeOnRampOrderInput> = {}): SizeOnRampOrderInput {
  return {
    standalone: false,
    requiredUsd: 0,
    gasFundedByOnRamp: false,
    classifierGasUsd: 0,
    ...overrides,
  };
}

/** A standalone order (buy-crypto CTA, no operation). */
function standalone(overrides: Partial<SizeOnRampOrderInput> = {}): SizeOnRampOrderInput {
  return {
    standalone: true,
    requiredUsd: 0,
    baseNativeEth: 0,
    gasFloorEth: 0.001,
    ethUsd: 3_000,
    ...overrides,
  };
}

describe("sizeOnRampOrder", () => {
  // --- [R1] currency decision: in-flow ---------------------------------------------------------
  describe("[R1] in-flow currency", () => {
    // @rule R1: has gas (on-ramp does not fund gas) => USDC-BASE, direct, no downstream swap.
    it("buys USDC-BASE directly when the op does not need on-ramp gas", () => {
      const { order, needsSwapToUsdc } = sizeOnRampOrder(
        inFlow({ requiredUsd: 210, gasFundedByOnRamp: false }),
      );
      expect(order.currencyCode).toBe("USDC-BASE");
      expect(order.fiatAmount).toBe("210.00");
      expect(needsSwapToUsdc).toBe(false);
    });

    // @rule R1: needs gas (on-ramp funds gas) => ETH-BASE, sized requiredUsd + gas, swap to USDC.
    it("buys ETH-BASE sized to requiredUsd + the classifier gas figure and swaps to USDC", () => {
      const { order, needsSwapToUsdc } = sizeOnRampOrder(
        inFlow({ requiredUsd: 210, gasFundedByOnRamp: true, classifierGasUsd: 4 }),
      );
      expect(order.currencyCode).toBe("ETH-BASE");
      expect(order.fiatAmount).toBe("214.00");
      expect(needsSwapToUsdc).toBe(true);
    });

    // @rule R1: PAYBIS_GAS_FLOOR_ETH must NOT participate in-flow (quote-driven verdict only).
    it("ignores gasFloorEth / baseNativeEth entirely in the in-flow branch", () => {
      const withFloor = sizeOnRampOrder(
        inFlow({
          requiredUsd: 210,
          gasFundedByOnRamp: true,
          classifierGasUsd: 4,
          // A large floor and a starved native balance would flip a standalone order, but must be
          // inert in-flow: the classifier already priced the gas.
          gasFloorEth: 999,
          baseNativeEth: 0,
          ethUsd: 3_000,
        }),
      );
      expect(withFloor.order.currencyCode).toBe("ETH-BASE");
      expect(withFloor.order.fiatAmount).toBe("214.00");
    });

    // @rule R1: in standalone the classifier CANNOT run, so classifierGasUsd must not leak in.
    it("ignores classifierGasUsd in the standalone branch", () => {
      const order = sizeOnRampOrder(
        standalone({
          baseNativeEth: 0,
          gasFloorEth: 0.001,
          ethUsd: 3_000,
          // A stray classifier figure (100) must NOT size a standalone order; only the ETH floor does.
          classifierGasUsd: 100,
        }),
      );
      // gas floor 0.001 * 3000 = $3, floored to the $10 Paybis minimum, NOT $100.
      expect(order.order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
    });
  });

  // --- [R1] currency decision: standalone ------------------------------------------------------
  describe("[R1]/[R3] standalone currency", () => {
    // @rule R1: standalone with native ETH below the floor => ETH-BASE (the locked [R1] trigger).
    it("buys ETH-BASE when native ETH on Base is below gasFloorEth", () => {
      const { order, needsSwapToUsdc } = sizeOnRampOrder(
        standalone({ baseNativeEth: 0.0005, gasFloorEth: 0.001, ethUsd: 3_000 }),
      );
      expect(order.currencyCode).toBe("ETH-BASE");
      expect(needsSwapToUsdc).toBe(true);
    });

    // @rule R1: standalone with native ETH at/above the floor => USDC-BASE.
    it("buys USDC-BASE when native ETH on Base meets gasFloorEth", () => {
      const { order, needsSwapToUsdc } = sizeOnRampOrder(
        standalone({ baseNativeEth: 0.002, gasFloorEth: 0.001, requiredUsd: 100 }),
      );
      expect(order.currencyCode).toBe("USDC-BASE");
      expect(order.fiatAmount).toBe("100.00");
      expect(needsSwapToUsdc).toBe(false);
    });

    // @rule R1: standalone ETH floor valued in USD, then requiredUsd added.
    it("sizes standalone gas as gasFloorEth * ethUsd", () => {
      // 0.001 ETH * $3000 = $3 gas; requiredUsd 0; floored to the $10 minimum.
      const gasOnly = sizeOnRampOrder(standalone({ baseNativeEth: 0, requiredUsd: 0 }));
      expect(gasOnly.order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
      // With a real USDC purchase on top, the gas rides above the floor: $50 + $3 = $53.
      const withBuy = sizeOnRampOrder(standalone({ baseNativeEth: 0, requiredUsd: 50 }));
      expect(withBuy.order.fiatAmount).toBe("53.00");
    });

    // @rule R6/R1: gasFloorEth = 0 is the kill switch (native < 0 is never true) => USDC-BASE.
    it("never buys gas standalone when gasFloorEth is 0 (kill switch)", () => {
      const { order, needsSwapToUsdc } = sizeOnRampOrder(
        standalone({ baseNativeEth: 0, gasFloorEth: 0, requiredUsd: 40 }),
      );
      expect(order.currencyCode).toBe("USDC-BASE");
      expect(order.fiatAmount).toBe("40.00");
      expect(needsSwapToUsdc).toBe(false);
    });
  });

  // --- gas amount: user choice vs the classifier floor -----------------------------------------
  describe("gas component composition", () => {
    // @rule R1: gasChoiceUsd ABOVE the classifier figure raises the gas (raise-only floor).
    it("raises the in-flow gas to the user's choice when it exceeds the classifier figure", () => {
      const { order } = sizeOnRampOrder(
        inFlow({ requiredUsd: 0, gasFundedByOnRamp: true, classifierGasUsd: 15, gasChoiceUsd: 30 }),
      );
      expect(order.fiatAmount).toBe("30.00");
    });

    // @rule R1: gasChoiceUsd BELOW the classifier figure is ignored (the classifier is the floor).
    it("keeps the classifier figure when the user's choice is below it", () => {
      const { order } = sizeOnRampOrder(
        inFlow({ requiredUsd: 0, gasFundedByOnRamp: true, classifierGasUsd: 15, gasChoiceUsd: 12 }),
      );
      expect(order.fiatAmount).toBe("15.00");
    });

    // @rule R1: standalone honours gasChoiceUsd over the ETH floor when higher.
    it("raises standalone gas to the user's choice above the ETH floor", () => {
      // floor 0.001 * 3000 = $3; user picks $25 (a card-ladder rung).
      const { order } = sizeOnRampOrder(standalone({ baseNativeEth: 0, gasChoiceUsd: 25 }));
      expect(order.fiatAmount).toBe("25.00");
      expect(GAS_PRESETS_USD).toContain(25);
    });
  });

  // --- [R6] the $10 floor is the CARD ladder floor, never the USDC ladder ----------------------
  describe("[R6] PAYBIS_MIN_USD floor", () => {
    // @rule R6: a total below the minimum floors up to PAYBIS_MIN_USD.
    it("floors a sub-minimum order at PAYBIS_MIN_USD", () => {
      const { order } = sizeOnRampOrder(standalone({ baseNativeEth: 0.002, requiredUsd: 3 }));
      expect(order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
    });

    // @rule R6: a $5 gas choice (a USDC-ladder value) still floors to the $10 card floor, never $5.
    it("uses the CARD ladder floor ($10), never the USDC ladder floor ($5)", () => {
      const { order } = sizeOnRampOrder(
        standalone({ baseNativeEth: 0, gasChoiceUsd: GAS_PRESETS_USDC_USD[0] }),
      );
      expect(GAS_PRESETS_USDC_USD[0]).toBe(5);
      expect(order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
      expect(order.fiatAmount).not.toBe("5.00");
    });
  });

  // --- ETH price extremes ----------------------------------------------------------------------
  describe("ETH price extremes", () => {
    // @rule R1: a very high ETH price scales the standalone gas floor up.
    it("scales standalone gas with a high ETH price", () => {
      const { order } = sizeOnRampOrder(
        standalone({ baseNativeEth: 0, gasFloorEth: 0.001, ethUsd: 100_000 }),
      );
      // 0.001 * 100000 = $100.
      expect(order.fiatAmount).toBe("100.00");
    });

    // @rule R1: a degraded (zero/missing) ETH price still buys ETH, floored at the minimum.
    it("degrades a missing ETH price to the $10 floor without failing", () => {
      const { order } = sizeOnRampOrder(standalone({ baseNativeEth: 0, ethUsd: 0 }));
      expect(order.currencyCode).toBe("ETH-BASE");
      expect(order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
    });
  });

  // --- defensive input handling ----------------------------------------------------------------
  describe("defensive input handling", () => {
    // @rule R6: non-finite / negative amounts read as zero, never propagate as NaN.
    it("treats NaN / negative requiredUsd as zero", () => {
      const nan = sizeOnRampOrder(inFlow({ requiredUsd: Number.NaN, gasFundedByOnRamp: false }));
      expect(nan.order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
      const negative = sizeOnRampOrder(inFlow({ requiredUsd: -50, gasFundedByOnRamp: false }));
      expect(negative.order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
    });

    // @rule R1: a negative classifier figure reads as zero (broken read is not a gas figure).
    it("treats a negative classifier figure as zero", () => {
      const { order } = sizeOnRampOrder(
        inFlow({ requiredUsd: 200, gasFundedByOnRamp: true, classifierGasUsd: -5 }),
      );
      expect(order.fiatAmount).toBe("200.00");
    });

    // @rule R1: a broken native read (NaN) reads as "has gas" standalone, so we never auto-buy ETH.
    it("does not buy standalone gas on a broken native read", () => {
      const { order } = sizeOnRampOrder(standalone({ baseNativeEth: Number.NaN, requiredUsd: 40 }));
      expect(order.currencyCode).toBe("USDC-BASE");
    });
  });

  // --- output shape ----------------------------------------------------------------------------
  describe("output shape", () => {
    // @rule R1: the money field is fiatAmount (a decimal string) + fiatCurrency, the ProvisioningOrder
    // shape, so a caller drops `order` straight into a buy step with no remap.
    it("returns a ProvisioningOrder-shaped order in USD", () => {
      const { order } = sizeOnRampOrder(inFlow({ requiredUsd: 100 }));
      expect(order.fiatCurrency).toBe("USD");
      expect(typeof order.fiatAmount).toBe("string");
      expect(order.fiatAmount).toMatch(/^\d+\.\d{2}$/);
      expectTypeOf(order).toMatchTypeOf<ProvisioningOrder>();
    });

    // @rule R6: minUsd defaults to PAYBIS_MIN_USD (one home, never a second $10 constant).
    it("defaults the floor to PAYBIS_MIN_USD and honours an explicit override", () => {
      const def = sizeOnRampOrder(inFlow({ requiredUsd: 0 }));
      expect(def.order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
      const overridden = sizeOnRampOrder(inFlow({ requiredUsd: 0, minUsd: 20 }));
      expect(overridden.order.fiatAmount).toBe("20.00");
    });

    // @rule R6: minUsd CLAMPS, it does not replace. An override below PAYBIS_MIN_USD (e.g. the USDC
    // ladder's $5, which a caller must never apply to a card purchase) is raised back to the $10 Paybis
    // accepts, so we can never emit an order Paybis will reject.
    it("clamps a minUsd override below PAYBIS_MIN_USD up to the floor", () => {
      const belowFloor = sizeOnRampOrder(
        inFlow({ requiredUsd: 0, minUsd: GAS_PRESETS_USDC_USD[0] }),
      );
      expect(GAS_PRESETS_USDC_USD[0]).toBeLessThan(PAYBIS_MIN_USD);
      expect(belowFloor.order.fiatAmount).toBe(PAYBIS_MIN_USD.toFixed(2));
    });
  });

  /* ───────────────────────────────────────────────────────────────────────────────────────────────
   * POO-1573 rules v1: the ETH-BASE leg's received-fixed target
   *
   * [R1] the gas-first leg is quoted received-fixed against an ETH target, so it omits
   *      `currencyCodeFrom` and the buyer is charged in their own currency, exactly as the USDC-BASE
   *      leg already is. The sizer cannot compute that target: it takes no I/O and an ETH price is
   *      perishable, so it emits the RECIPE (`gasFloorEth + fundingUsd / ethUsd`) and the mint solves
   *      it seconds before the widget opens.
   * [R2] no figure computed in USD is ever sent as another currency's amount: `fiatAmount` and every
   *      USD term behind it (PAYBIS_MIN_USD, the classifier's gas, the caller's gross-up) are
   *      UNCHANGED, and the recipe's own USD half carries the same floor.
   * [R3] the target is derived from values already in hand: the ETH gas floor stays ETH-denominated
   *      rather than being priced through the `ethUsd` that reads 0 for the empty wallet this leg
   *      exists to serve.
   * ──────────────────────────────────────────────────────────────────────────────────────────────*/
  describe("[POO-1573 R1] the ETH-BASE received-fixed target recipe", () => {
    // @rule POO-1573 R1: a USDC-BASE order is already received-fixed against its own `fiatAmount`
    // (USDC ~ 1:1 with USD), so it carries no ETH recipe at all.
    it("omits ethTarget on a USDC-BASE order", () => {
      const { order } = sizeOnRampOrder(inFlow({ requiredUsd: 210, gasFundedByOnRamp: false }));
      expect(order.currencyCode).toBe("USDC-BASE");
      expect(order.ethTarget).toBeUndefined();
    });

    // @rule POO-1573 R3: standalone, the gas floor is an ETH quantity and stays one. Pricing it
    // through `ethUsd` is exactly what reads 0 for a wallet holding no ETH.
    it("carries the standalone gas floor in ETH and the funding half in USD", () => {
      const { order } = sizeOnRampOrder(
        standalone({ requiredUsd: 50, baseNativeEth: 0, gasFloorEth: 0.001, ethUsd: 0 }),
      );
      expect(order.currencyCode).toBe("ETH-BASE");
      expect(order.ethTarget).toEqual({ gasFloorEth: "0.001", fundingUsd: "50.00" });
    });

    // @rule POO-1573 R2: the USD figure the floor and the gross-up act on is untouched. A degraded
    // `ethUsd` still lands on the same `fiatAmount` it shipped with, so nothing about the dollar
    // sizing moves in this issue.
    it("leaves fiatAmount exactly as it was while adding the recipe", () => {
      const { order } = sizeOnRampOrder(
        standalone({ requiredUsd: 50, baseNativeEth: 0, gasFloorEth: 0.001, ethUsd: 0 }),
      );
      expect(order.fiatAmount).toBe("50.00");
      expect(order.fiatCurrency).toBe("USD");
    });

    // @rule POO-1573 R2: the recipe's USD half carries PAYBIS_MIN_USD, because the fiat floor applies
    // BEFORE the conversion. $4 of funding is a $10 order, and therefore a $10-worth ETH target.
    it("floors the recipe's USD half at PAYBIS_MIN_USD", () => {
      const { order } = sizeOnRampOrder(standalone({ requiredUsd: 4, baseNativeEth: 0 }));
      expect(order.ethTarget?.fundingUsd).toBe(PAYBIS_MIN_USD.toFixed(2));
    });

    // @rule POO-1573 R3 / R1: in-flow the gas figure is the classifier's, which is USD-denominated,
    // so the recipe's ETH half is zero and the whole target converts from dollars. `gasFloorEth` is
    // inert in-flow (rules v2 [R1]) and must not leak into the recipe either.
    it("gives an in-flow order a zero ETH floor and folds the classifier gas into the USD half", () => {
      const { order } = sizeOnRampOrder(
        inFlow({
          requiredUsd: 210,
          gasFundedByOnRamp: true,
          classifierGasUsd: 4,
          gasFloorEth: 999,
        }),
      );
      expect(order.ethTarget).toEqual({ gasFloorEth: "0", fundingUsd: "214.00" });
    });

    // @rule POO-1573 R2: the user's gas CHOICE is a USD figure (the card ladder), so it raises the
    // USD half exactly as it raises `fiatAmount`, and never the ETH half.
    it("raises the recipe's USD half with the user's gas choice", () => {
      const { order } = sizeOnRampOrder(
        inFlow({
          requiredUsd: 210,
          gasFundedByOnRamp: true,
          classifierGasUsd: 4,
          gasChoiceUsd: 25,
        }),
      );
      expect(order.fiatAmount).toBe("235.00");
      expect(order.ethTarget?.fundingUsd).toBe("235.00");
    });

    /**
     * @rule POO-1573 R2 — `CR-TOK-006`, PINNED (PR #875 review, F1).
     *
     * `fiatAmount` no longer describes the order it sizes on the gas-first leg, and that is a
     * DECIDED divergence (Rafael, 2026-08-13), not an oversight: it is recorded on `CR-TOK-006` and
     * pinned here so nobody closes it by accident.
     *
     * The two figures agree exactly whenever `ethUsd` is real, which is what this case fixes in
     * place: the caller's balance ratio values the ETH floor at $2.50, `fiatAmount` carries it, and
     * the recipe carries the same floor in ETH instead. Convert the recipe back at that same price
     * and you land on `fiatAmount` to the cent.
     */
    it("agrees with fiatAmount to the cent when the caller's ethUsd is real", () => {
      const { order } = sizeOnRampOrder(
        standalone({
          requiredUsd: 100,
          // Below the floor, so the gas-first leg fires, but NOT zero, so the planner's
          // `native.usd / native.amount` ratio prices ETH for real.
          baseNativeEth: 0.0005,
          gasFloorEth: 0.001,
          ethUsd: 2_500,
        }),
      );

      expect(order.currencyCode).toBe("ETH-BASE");
      // The ETH floor valued in dollars ($2.50) rides in `fiatAmount`...
      expect(order.fiatAmount).toBe("102.50");
      // ...and in ETH in the recipe, which is why the USD half excludes it. 0.001 + 100/2500 = 0.041,
      // which is $102.50 at the same price. Same order, two units, no divergence.
      expect(order.ethTarget).toEqual({ gasFloorEth: "0.001", fundingUsd: "100.00" });
    });

    /**
     * @rule POO-1573 R2 — the divergence itself, and its exact size (`CR-TOK-006`, PR #875 F1).
     *
     * `ethUsd` is EXACTLY 0 for a wallet holding no ETH (`readBaseNativeEth` prices the native
     * holding), and that wallet is the only one the standalone gas-first leg ever serves. So the ETH
     * floor is valued at $0 in `fiatAmount` while the recipe still carries it as an ETH quantity the
     * mint prices for real: the charge exceeds the recorded figure by `gasFloorEth x ethUsd`, $2.50
     * at $2,500/ETH.
     *
     * DECIDED, not tolerated by omission: the figure is NOT changed, because the ETH leg now
     * genuinely funds gas (it did not before: the leg was spend-fixed at `fiatAmount`, so what it
     * bought was whatever that bought), and the surplus lands in the buyer's own wallet, which is the
     * assurance the buy row already prints (POO-1446 rules v3). Recorded on `CR-TOK-006`.
     */
    it("[CR-TOK-006] leaves fiatAmount BELOW the charge by exactly the ETH floor for a zero-ETH wallet", () => {
      const { order } = sizeOnRampOrder(
        standalone({ requiredUsd: 100, baseNativeEth: 0, gasFloorEth: 0.001, ethUsd: 0 }),
      );

      // The recorded figure prices the floor at zero, because the buyer's own ETH holding is zero.
      expect(order.fiatAmount).toBe("100.00");
      // The recipe does not. `ethTarget.test.ts` converts this at a real mint price and pins the gap.
      expect(order.ethTarget).toEqual({ gasFloorEth: "0.001", fundingUsd: "100.00" });
    });

    /**
     * @rule POO-1573 R2 / rules v2 [R1] — PR #875 review, F4: the two halves must be ALTERNATIVES.
     *
     * The gas is ONE figure, picked by a `max` between a USD half and an ETH half. The header used to
     * justify that with "context-disjoint by construction", which is true of `classifierGasUsd`
     * (in-flow only, guarded) and of `gasFloorEth` (standalone only), and NOT true of `gasChoiceUsd`:
     * rules v2 [R1] deliberately lets a STANDALONE order raise its gas from the card ladder (pinned
     * by "raises standalone gas to the user's choice above the ETH floor" above), so one order can
     * hold both halves at once. The dollar figure MAXed them; the recipe SUMMED them, charging the
     * gas floor a second time on top of a choice that already outbid it.
     *
     * $25 of gas at $2,500/ETH is 0.01 ETH, ten times the 0.001 floor, so the floor adds nothing but
     * an extra $2.50 on the charge. The winner takes the whole gas, in its own unit.
     */
    it("[F4] drops the ETH gas floor when a standalone gas choice already outbids it", () => {
      const { order } = sizeOnRampOrder(
        standalone({
          requiredUsd: 100,
          baseNativeEth: 0.0005,
          gasFloorEth: 0.001,
          ethUsd: 2_500,
          gasChoiceUsd: 25,
        }),
      );

      // The dollar sizing is untouched ([R2]): max($25 choice, $2.50 floor) = $25 on top of $100.
      expect(order.fiatAmount).toBe("125.00");
      // ...and the recipe names the SAME $25 once, not $25 plus a 0.001 ETH floor. At the same price
      // it solves to 0.05 ETH = $125, so the two halves of the order still agree to the cent.
      expect(order.ethTarget).toEqual({ gasFloorEth: "0", fundingUsd: "125.00" });
    });

    /**
     * @rule POO-1573 R2 — the same rule seen from the other side (PR #875 review, F4).
     *
     * When the ETH floor is the winner the loser must not ride along either: a $25 choice that lost
     * to a $100 floor (0.001 ETH at $100,000/ETH) has already been dropped from `fiatAmount` by the
     * `max`, and leaving it in the recipe's USD half would charge for it anyway.
     */
    it("[F4] drops a losing gas choice from the recipe when the ETH floor outbids it", () => {
      const { order } = sizeOnRampOrder(
        standalone({
          requiredUsd: 100,
          baseNativeEth: 0,
          gasFloorEth: 0.001,
          ethUsd: 100_000,
          gasChoiceUsd: 25,
        }),
      );

      // max($25 choice, 0.001 ETH x $100,000 = $100) = $100 of gas on top of $100 of funding.
      expect(order.fiatAmount).toBe("200.00");
      // The recipe carries that same $100 as the ETH quantity it natively is, and nothing else.
      expect(order.ethTarget).toEqual({ gasFloorEth: "0.001", fundingUsd: "100.00" });
    });

    // @rule POO-1573 R3: the floor is env-configurable (`NEXT_PUBLIC_PAYBIS_GAS_FLOOR_ETH`), so the
    // recipe is a decimal STRING at full precision and never exponent notation, which is what
    // `Number(1e-7).toString()` would emit and no decimal parser upstream would accept.
    it("emits the ETH floor as a plain decimal string, never exponent notation", () => {
      const { order } = sizeOnRampOrder(
        standalone({ requiredUsd: 50, baseNativeEth: 0, gasFloorEth: 0.0000001 }),
      );
      expect(order.ethTarget?.gasFloorEth).toBe("0.0000001");
    });
  });
});
