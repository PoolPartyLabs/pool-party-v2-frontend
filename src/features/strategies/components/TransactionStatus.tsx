/**
 * @id PP-CORE-MOD-002
 * @name TransactionStatus
 * @implements-rules-version v2 (POO-807 rules v1)
 *
 * The shared pending / success / error body used inside the invest, collect, compound and withdraw
 * flows. Keeps the confirm → pending → success|error sequence visually consistent across every
 * transactional modal: a gold spinner while the (mock) transaction settles, a green check on
 * success, or a red alert on failure. The caller passes follow-up actions as children (e.g. View
 * position / Done on success; Try again / Copy error / Discord on error).
 *
 * POO-807 (rules v1): the shared {@link MockBadge} renders above the headline, so the modals'
 * success/error phases (the ones mounting this body; pending renders WalletSteps, which carries its
 * own badge) show the visible mock-mode indicator from this single mount point; the badge
 * self-gates on `isMockMode` (nothing renders in real mode, R2).
 */
"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { MockBadge } from "@/components/ui/MockBadge";

/** Which phase of the transaction to render. */
export type TransactionPhase = "pending" | "success" | "error";

/** Public props for {@link TransactionStatus}. */
export interface TransactionStatusProps {
  /** `pending` shows a spinner; `success` a green check; `error` a red alert. */
  phase: TransactionPhase;
  /** Headline (e.g. "Processing…", "Investment confirmed", "Something went wrong"). */
  title: string;
  /** Supporting line under the title. */
  body?: ReactNode;
  /** Footer actions (e.g. View position / Done on success; Try again / Copy error on error). */
  children?: ReactNode;
}

/** Phase → icon badge. Kept as a lookup to avoid a nested ternary in the JSX. */
function StatusIcon({ phase }: { phase: TransactionPhase }) {
  if (phase === "pending") {
    return (
      <span className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Loader2 className="size-7 animate-spin" aria-hidden="true" />
      </span>
    );
  }
  if (phase === "error") {
    return (
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <CircleAlert className="size-7" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
      <Check className="size-7" aria-hidden="true" />
    </span>
  );
}

/** Centered status block for the transactional flows. */
export function TransactionStatus({ phase, title, body, children }: TransactionStatusProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <StatusIcon phase={phase} />
      <div>
        {/* POO-807 R1: the mock-mode indicator (self-gated; nothing renders in real mode). */}
        <MockBadge className="mb-1" />
        <h3 className="font-semibold text-foreground text-lg">{title}</h3>
        {/* POO-839 R6: success/error bodies interpolate strategy names — wrap, never overflow. */}
        {body ? <p className="mt-1 break-words text-muted-foreground text-sm">{body}</p> : null}
      </div>
      {children ? <div className="flex w-full flex-col gap-2">{children}</div> : null}
    </div>
  );
}
