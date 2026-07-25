/**
 * @id PP-CORE-CMP-040
 * @name PoweredByPaybis
 * @implements-rules-version v1
 *
 * The "Powered by Paybis" attribution shown on a FIAT ON-RAMP surface. `footnote` centers it under a
 * CTA; `inline` is the muted caption used inside a plan step. "Paybis" is a brand name and stays
 * untranslated across locales.
 *
 * POO-1044 [R5] removed it from the buy-gas modal. A gas top-up is an on-chain swap of what the
 * wallet already holds (`swap-gas`), so the attribution named a provider with no part in the step.
 * The remaining on-ramp surfaces are the plan card's `buy-usdc` caption, which renders the same key
 * inline, and the deposit screen, which has its own.
 *
 * PP-INTEGRATION-POINT: the real Paybis ramp (CSP-ready stub, POO-87/POO-213) is wired with the rail
 * (POO-414); this is only the brand attribution.
 */
"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link PoweredByPaybis}. */
export interface PoweredByPaybisProps {
  /** `footnote` centers under a CTA; `inline` is a left-aligned caption inside a step. */
  variant?: "footnote" | "inline";
  className?: string;
}

/** Brand attribution for the Paybis on-ramp. */
export function PoweredByPaybis({ variant = "footnote", className }: PoweredByPaybisProps) {
  const t = useTranslations("strategies");
  return (
    <p
      className={cn(
        "text-muted-foreground/80 text-xs",
        variant === "footnote" && "text-center",
        className,
      )}
    >
      {t("provisioning.poweredByPaybis")}
    </p>
  );
}
