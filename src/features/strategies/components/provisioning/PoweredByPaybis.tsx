/**
 * @id PP-CORE-CMP-040
 * @name PoweredByPaybis
 * @implements-rules-version v1
 *
 * The "Powered by Paybis" attribution shown on a fiat on-ramp surface (the buy-gas modal footnote,
 * and the wizard's buy-USDC step caption). `footnote` centers it under the CTA; `inline` is the muted
 * caption used inside a plan step. "Paybis" is a brand name and stays untranslated across locales.
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
