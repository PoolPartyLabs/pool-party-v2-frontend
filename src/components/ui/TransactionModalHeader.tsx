/**
 * @id PP-CORE-CMP-047
 * @name TransactionModalHeader
 * @implements-rules-version v2 (POO-807 rules v1)
 *
 * The single shared header for every transactional modal (invest / compound / collect / withdraw /
 * move range / close). It renders an optional back (←) button, the title, and an optional settings
 * (⚙) button in ONE consistent place: the settings gear always sits at the top-right, immediately
 * left of the Dialog's absolute X close (the `pr-9` reserves that space). Centralising this here is
 * the fix for POO-445 R1 — the gear used to be hand-rolled per modal with divergent padding
 * (`pr-6` vs `pr-9`) and missing on some steps, so a change to one never reached the others.
 *
 * The settings sheet itself is {@link TransactionSettingsDialog} (slippage / deadline / receive-as);
 * this component only owns the trigger. Must render inside a `Dialog` > `DialogContent` (the title
 * is a Radix `DialogTitle`).
 *
 * POO-807 (rules v1): the shared {@link MockBadge} renders next to the title, so every
 * transactional modal's form/Review steps carry the visible mock-mode indicator from this single
 * mount point; the badge self-gates on `isMockMode` and renders nothing in real mode (R2).
 */
"use client";

import { ArrowLeft, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { MockBadge } from "@/components/ui/MockBadge";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link TransactionModalHeader}. */
export interface TransactionModalHeaderProps {
  /** The dialog title (usually a translated string). */
  title: ReactNode;
  /** When set, a back (←) button renders left of the title. */
  onBack?: () => void;
  /** Accessible name for the back button (required when `onBack` is set). */
  backLabel?: string;
  /** When set, a settings (⚙) button renders at the top-right, left of the Dialog X. */
  onSettings?: () => void;
  /** Accessible name for the settings button (required when `onSettings` is set). */
  settingsLabel?: string;
  /** Extra classes on the underlying DialogHeader. */
  className?: string;
}

/** Shared back + title + settings-gear header. See {@link TransactionModalHeaderProps}. */
export function TransactionModalHeader({
  title,
  onBack,
  backLabel,
  onSettings,
  settingsLabel,
  className,
}: TransactionModalHeaderProps) {
  return (
    <DialogHeader className={className}>
      {/* pr-9 keeps the gear clear of the Dialog's absolute top-right X close. */}
      <div className="flex items-center justify-between gap-2 pr-9">
        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label={backLabel}
              // POO-840 R2: ::after hit-area takes the 16px arrow to a ~44px touch target
              // (visual size and header layout unchanged).
              className="relative text-muted-foreground transition-colors after:absolute after:-inset-3.5 after:content-[''] hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          <DialogTitle>{title}</DialogTitle>
          {/* POO-807 R1: the mock-mode indicator (self-gated; nothing renders in real mode). */}
          <MockBadge />
        </div>
        {onSettings ? (
          <button
            type="button"
            onClick={onSettings}
            aria-label={settingsLabel}
            className={cn(
              "text-muted-foreground transition-colors hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
              // POO-840 R2: ::after hit-area takes the 16px gear toward a 44px touch target, but
              // the RIGHT expansion is capped at 8px (after:-right-2 overrides the inset): the
              // Dialog/Sheet X sits ~24-28px to the right with its own expanded box, and a gear
              // hit-area bleeding into it would turn a missed gear tap into closing the whole
              // flow (discarding the typed amount) — the exact failure this rule fixes.
              "relative after:absolute after:-inset-3.5 after:-right-2 after:content-['']",
            )}
          >
            <Settings2 className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </DialogHeader>
  );
}
