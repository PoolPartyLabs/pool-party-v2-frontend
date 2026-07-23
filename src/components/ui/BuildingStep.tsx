/**
 * @id PP-CORE-CMP-052 (POO-595)
 * @name BuildingStep
 * @implements-rules-version v2 (POO-807 rules v1)
 *
 * The shared "building the transaction" spinner shown during a transactional modal's `building` phase
 * (POO-595, extracted from the POO-574 WithdrawModal glue): while the server builds the tx and the flow
 * pauses (`useWalletSignFlow` `pauseAfterKey`), the modal renders this centered spinner + label before
 * advancing to the built-figures Review. Purely presentational and i18n-agnostic — the caller passes
 * the already-translated `label` (and optional `body`), so both the investor (`strategies`) and manager
 * modals reuse it without importing each other's namespaces. `role="status"` announces it to AT.
 *
 * POO-807 (rules v1): carries the shared {@link MockBadge} so the `building` phase keeps the visible
 * mock-mode indicator too (self-gated; nothing renders in real mode — the i18n-agnostic claim holds,
 * the badge's "MOCK" is deliberately untranslated).
 */
"use client";

import { Loader2 } from "lucide-react";
import { MockBadge } from "@/components/ui/MockBadge";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link BuildingStep}. */
export interface BuildingStepProps {
  /** The translated status line (e.g. "Processing…"). */
  label: string;
  /** Optional translated sub-line (e.g. "This usually takes a few seconds."). */
  body?: string;
  /** Optional class merge for layout tweaks at the call site. */
  className?: string;
}

/** Centered build-in-progress spinner for the modal `building` phase. */
export function BuildingStep({ label, body, className }: BuildingStepProps) {
  return (
    <div
      role="status"
      className={cn("mt-2 flex flex-col items-center gap-3 py-8 text-center", className)}
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      {/* POO-807 R1: the mock-mode indicator on the building phase (nothing in real mode). */}
      <MockBadge />
      <p className="font-medium text-foreground text-sm">{label}</p>
      {body ? <p className="text-muted-foreground text-xs">{body}</p> : null}
    </div>
  );
}
