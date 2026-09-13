/**
 * @id PP-CORE-CMP-065
 * @name SigningDisclosure
 * @implements-rules-version v1 (POO-1088 rules v2)
 *
 * The "What am I signing?" disclosure of the step a wallet is currently asking about (UF-28 [R4],
 * clear-vs-blind signing): a collapsed link that expands into what THIS signature authorizes.
 *
 * Extracted from {@link WalletSteps} by POO-1088, which moves the provisioning execution surface off
 * that stepper and onto the plan card. It is extracted rather than reimplemented because it is a
 * security affordance, not chrome: it is where a user finds out whether they are granting an
 * ALLOWANCE (which moves nothing by itself, and keeps standing afterwards) or confirming a TRANSFER.
 * A second copy of that wording is a second thing that can drift out of step with the first.
 *
 * Presentational: the caller resolves the copy, so the i18n usage scan sees real keys.
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

/** Resolved, per-signature explanation shown when the disclosure is expanded. */
export interface SigningWhy {
  /** The signature's type name, e.g. "Token approval" / "Permit2 signature". */
  name: string;
  /** What this specific signature does (already token/op-interpolated by the caller). */
  body: string;
}

/** Public props for {@link SigningDisclosure}. */
export interface SigningDisclosureProps {
  /**
   * The explanation for this specific signature. Omitted, the panel falls back to the generic
   * "why are signatures required" copy, which is weaker but never wrong.
   */
  why?: SigningWhy;
  /** Extra classes for the trigger, so a host can match its own row rhythm. */
  className?: string;
}

/** The collapsible "What am I signing?" explanation for the active signing step. */
export function SigningDisclosure({ why, className }: SigningDisclosureProps) {
  const t = useTranslations("strategies");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={className ?? "mt-0.5 self-start text-primary text-xs hover:underline"}
      >
        {t("sign.whyTitle")}
      </button>
      {open ? (
        why ? (
          <div className="mt-1 text-xs">
            <span className="block font-medium text-foreground">{why.name}</span>
            <span className="mt-0.5 block text-muted-foreground">{why.body}</span>
          </div>
        ) : (
          <p className="mt-1 text-muted-foreground text-xs">{t("sign.whyBody")}</p>
        )
      ) : null}
    </>
  );
}
