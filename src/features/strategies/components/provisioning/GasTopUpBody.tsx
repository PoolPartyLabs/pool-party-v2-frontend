/**
 * @id PP-CORE-CMP-070 (POO-1509, POO-1525, POO-1526)
 * @name GasTopUpBody
 * @implements-rules-version v3 (POO-1526 rules v1) · v2 (POO-1525 rules v1) · v1 (POO-1509 rules v1)
 * @analytics-events none, and deliberately. The session this body belongs to is reported by
 *   `PP-CORE-LIB-058` from whichever host mounts it (the gate firing, the plan quoted, the route
 *   started, each leg settled, one terminal outcome, the abandonment on the way out). A second
 *   emitter on a presentational body would double-count the same run.
 * @hackathon POO-1022 (Universal Funding)
 *
 * The body of `Not enough gas` (Figma `6550:569`), shared by its two hosts.
 *
 * POO-1509 [R4] makes this surface **auxiliary, not a step**: it is reached when network gas is the
 * ONE thing missing, from any operation on any surface, and it hands the user back to whatever they
 * were doing. That is why it is a BODY and not a modal. The chrome belongs to the host, which is a
 * `Sheet` in {@link BuyGasModal} (PP-CORE-MOD-010) and the operation modal's own dialog when
 * `ProvisioningPanel` (PP-CORE-CMP-046) renders it for a gas-only requirement.
 *
 * ## Why it was extracted rather than reimplemented
 *
 * Both halves already existed and neither was in the right place. `BuyGasModal` had the designed
 * screen and **zero production consumers** (`docs/INTEGRATION_POINTS.md`), while the live gas-only
 * path rendered a plan CARD with an inline gas picker inside `Fund this transaction`, precisely what
 * [R34] forbids. Copying the screen into the panel would have left two spellings of one disclosure,
 * and this one names what the money does ([R36]), so a drifted copy is a drifted disclosure.
 *
 * ## [R35] The presets are a property of the source, and so are the bounds
 *
 * `source` is the ONE input: it decides the presets, the custom floor and the ceiling, all derived
 * through {@link gasPresets} / {@link gasMinUsd} / {@link gasMaxUsd}. It replaced three independent
 * props on {@link GasAmountSelector} because they could disagree, and did: the selector was handed
 * the source's floor for its ERROR TEXT while `validateGas` defaulted to the card floor, so on the
 * on-chain path a $7 custom amount was refused under a message that said the minimum was $5.
 *
 * The bar the host still owns is the money-safety one: `confirmDisabled` is how the POO-1047
 * price-impact gate keeps blocking this CTA. Auxiliary does not mean ungated. This screen signs a
 * real swap.
 *
 * POO-1525 (epic POO-1498, rules v1): the CTA + dismiss pair moved into `StickyActionFooter`
 * (`PP-STR-CMP-027`), pinning state `8`'s terminal action to both hosts at once.
 *
 * ## Provisioning v3 mobile [M5.2], POO-1526
 *
 * `Not now` is its own full-width row inside that footer, so it carries an EXPLICIT `min-h-11`
 * rather than an invisible hit area.
 */
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { GasChoice } from "@/lib/provisioning";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/format";
import { GasAmountSelector } from "./GasAmountSelector";
import { type GasFundingSource, validateGas } from "./gasSelection";
import { StickyActionFooter } from "./StickyActionFooter";

/** Public props for {@link GasTopUpBody}. */
export interface GasTopUpBodyProps {
  /** The amount being edited, or `null` before anything is picked. */
  value: GasChoice | null;
  /** Called with the next choice on every preset tap / custom keystroke. */
  onChange: (value: GasChoice) => void;
  /**
   * Spendable USD the top-up converts out of. Over it the rail on-ramps the shortfall, so it is
   * informational and never blocking (POO-331 R4).
   */
  balanceUsd: number;
  /** Where the gas is paid from, which decides the presets AND the bounds ([R35]). */
  source?: GasFundingSource;
  /** Start the top-up. Fired only for an amount the source can actually execute. */
  onConfirm: () => void;
  /** Leave without topping up, back to wherever the user came from ([R4]). */
  onDismiss: () => void;
  /**
   * A host-owned reason the CTA must stay shut, ORed with the amount's own validity. Today that is
   * the POO-1047 price-impact acknowledgement, which gates every AMM leg including this swap.
   */
  confirmDisabled?: boolean;
  /**
   * The USD figure the CTA prints, for a host whose EXECUTED amount is not the edited value.
   *
   * `ProvisioningPanel` passes the quoted plan's own sized top-up (`plan.gas.amountUsd`): there,
   * only an explicit valid choice resizes the plan, so the untouched $10 default preset renders
   * pressed while the rail converts the classifier's figure, often cents. Printing the edited value
   * on that host made the CTA state an amount ("Add $10.00 gas") that was not the amount about to
   * execute ("$0.08"). `BuyGasModal` omits it, because that host runs exactly the edited choice.
   *
   * Display only: validity, and with it whether the CTA is enabled, still follows `value`.
   */
  ctaAmountUsd?: number;
  /** Rendered between the conversion note and the CTA: the host's own gates. */
  children?: ReactNode;
  className?: string;
}

/** The `Not enough gas` body: how much, what it converts, and the two ways out. */
export function GasTopUpBody({
  value,
  onChange,
  balanceUsd,
  source = "card",
  onConfirm,
  onDismiss,
  confirmDisabled = false,
  ctaAmountUsd,
  children,
  className,
}: GasTopUpBodyProps) {
  const t = useTranslations("strategies");
  const validity = validateGas(value, balanceUsd, source);
  // The CTA states what will actually happen: the host's executed figure when it differs from the
  // edited value, the edited value otherwise. Guard the result: an empty Custom field parses to
  // NaN, which would render "$NaN" on the CTA. Zero is honest there, and the CTA is disabled anyway.
  const preferredUsd = ctaAmountUsd ?? (value ? value.amountUsd : Number.NaN);
  const amountUsd = Number.isFinite(preferredUsd) ? preferredUsd : 0;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <p className="text-muted-foreground text-sm">{t("provisioning.gas.subtitle")}</p>
      <GasAmountSelector
        value={value}
        onChange={onChange}
        balanceUsd={balanceUsd}
        source={source}
      />
      {/* [R36] Where the money comes from, in the same breath as the amount. The fees stay abstracted
          into this sentence (decided 2026-06-30) rather than itemised: a few cents of gas does not
          earn a breakdown, and the leg re-quotes at execution time regardless. */}
      <p className="text-muted-foreground text-xs">{t("provisioning.gas.conversionNote")}</p>
      {children}
      {/* POO-1525 [M3.3]: state `8`'s terminal CTA, shared by both hosts (`BuyGasModal` and this
          panel's own gas-only branch), so both get the pin from the one place they both render
          through. */}
      <StickyActionFooter>
        <Button
          data-testid="gas-topup-confirm"
          className="w-full"
          size="lg"
          disabled={!validity.ok || confirmDisabled}
          onClick={onConfirm}
        >
          {t("provisioning.gas.cta", { amount: formatUsd(amountUsd) })}
        </Button>
        <Button variant="ghost" className="min-h-11 w-full" onClick={onDismiss}>
          {t("provisioning.gas.dismiss")}
        </Button>
      </StickyActionFooter>
    </div>
  );
}
