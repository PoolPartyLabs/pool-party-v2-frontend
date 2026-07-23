/**
 * @id PP-CORE-MOD-006
 * @name WalletSteps
 * @implements-rules-version v2 (POO-807 rules v1)
 *
 * The multistep wallet-signing body (POO-295, Figma drafts 5916:330). One transaction can take N
 * wallet interactions — permit, an ERC-20 approve per token, then the confirm (swap / deposit /
 * withdraw…) — so the wallet handoff renders them as a vertical stepper instead of a single opaque
 * spinner:
 *   done    → green check, solid connector
 *   active  → gold spinner, "Step X of Y" + a "What am I signing?" helper
 *   pending → muted dot, dotted connector
 * While the action is in the wallet there is NO in-modal CTA — "Continue in your wallet" (R3).
 *
 * POO-807 (rules v1): the shared {@link MockBadge} renders in the handoff heading, so every
 * transactional modal's PENDING phase (which composes this body under an sr-only DialogHeader)
 * carries the visible mock-mode indicator; the badge self-gates on `isMockMode` (nothing in real).
 *
 * Drop-in body for the transactional flows' pending phase (invest / collect / compound / withdraw):
 * the host modal keeps owning the outcome (its settle timer flips to success/error and unmounts
 * this), so this component is presentational — it only animates the active step forward for the
 * wallet handoff. PP-INTEGRATION-POINT: the real flow advances `activeStep` on each wallet
 * signature/confirmation (and a rejected step routes to the error state, whose "Try again" returns
 * to the failed step).
 */
"use client";

import { Check, Loader2, Wallet, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { MockBadge } from "@/components/ui/MockBadge";
import { cn } from "@/lib/utils/cn";

/**
 * Per-step status when the host drives the flow off real wallet/tx events. When `statuses` is omitted
 * the status is derived positionally from `activeStep` (done / active / pending), preserving the
 * original timer-driven behavior. `idle` renders the same as a pending step.
 */
export type WalletStepStatus = "idle" | "active" | "done" | "error" | "skipped";

/** Truncate a tx hash for an inline, network-agnostic display (no explorer link here). */
function truncateHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

/** Resolved, per-signature explanation shown in the active step's "Why?" disclosure. */
export interface WalletStepWhy {
  /** The signature's type name, e.g. "Token approval" / "Permit2 signature". */
  name: string;
  /** What this specific signature does (already token/op-interpolated by the caller). */
  body: string;
}

/** One signing step in a transaction (its label is resolved by the caller for the i18n usage scan). */
export interface WalletSignStep {
  /** Stable key (for React + the integration to map to the real wallet action). */
  key: string;
  /** Resolved, human-readable label, e.g. "Approve USDC" / "Confirm deposit". */
  label: string;
  /**
   * Optional per-signature explanation (name + body) for the active step's disclosure. When omitted
   * the disclosure falls back to the generic "why are signatures required" copy.
   */
  why?: WalletStepWhy;
}

/** Public props for {@link WalletSteps}. */
export interface WalletStepsProps {
  /** The ordered signing steps (1 or more). */
  steps: WalletSignStep[];
  /**
   * Controlled active-step index (0-based). When provided, the host owns progress. The real flow
   * bumps it on each wallet signature/confirmation (PP-INTEGRATION-POINT) and the internal mock timer
   * is disabled. When omitted, the stepper self-advances on `stepMs` for previews/Storybook/tests.
   * Out-of-range values are clamped to `[0, steps.length - 1]`.
   */
  activeStep?: number;
  /** Mock per-step duration in ms, uncontrolled mode only; the real flow advances on the wallet event. */
  stepMs?: number;
  /**
   * Optional per-step status (index-aligned with `steps`), set by the host as real wallet/tx events
   * settle. When provided it drives the markers (incl. error / skipped); when omitted the status is
   * derived positionally from `activeStep` (the original behavior).
   */
  statuses?: WalletStepStatus[];
  /** Optional per-step mined tx hash (index-aligned); a `done` step with a hash shows it truncated. */
  txHashes?: (string | undefined)[];
}

/** Multistep wallet-signing stepper. */
export function WalletSteps({
  steps,
  activeStep,
  stepMs = 650,
  statuses,
  txHashes,
}: WalletStepsProps) {
  const t = useTranslations("strategies");
  const total = steps.length;
  const headingId = useId();
  const isControlled = activeStep !== undefined;
  const [internalActive, setInternalActive] = useState(0);

  // PP-INTEGRATION-POINT: uncontrolled → walk the active step forward on a mock timer and rest on the
  // last one (the host settles + unmounts us). Controlled (`activeStep` set) → the host drives progress
  // off real wallet events, so the timer stays off.
  useEffect(() => {
    if (isControlled) return;
    if (internalActive >= total - 1) return;
    const timer = setTimeout(() => setInternalActive((value) => value + 1), stepMs);
    return () => clearTimeout(timer);
  }, [isControlled, internalActive, total, stepMs]);

  const active = Math.min(
    Math.max(isControlled ? (activeStep ?? 0) : internalActive, 0),
    Math.max(total - 1, 0),
  );

  // Resolve a step's status: host-provided `statuses` win (idle reads as pending); otherwise derive it
  // positionally from the active index, exactly as before.
  function statusAt(index: number): "done" | "active" | "pending" | "error" | "skipped" {
    if (statuses) {
      const status = statuses[index] ?? "idle";
      return status === "idle" ? "pending" : status;
    }
    return index < active ? "done" : index === active ? "active" : "pending";
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <div
        id={headingId}
        className="flex items-center justify-center gap-2 text-muted-foreground text-sm"
      >
        <Wallet className="size-4" aria-hidden="true" />
        {t("sign.continueInWallet")}
        {/* POO-807 R1: the mock-mode indicator on the pending phase (nothing in real mode). */}
        <MockBadge />
      </div>

      <ol aria-labelledby={headingId} className="flex flex-col">
        {steps.map((step, index) => {
          const status = statusAt(index);
          const isActive = status === "active";
          const isSettled = status === "done" || status === "skipped";
          const isLast = index === total - 1;
          const hash = txHashes?.[index];
          return (
            <li key={step.key} aria-current={isActive ? "step" : undefined} className="flex gap-3">
              {/* Marker + connector rail */}
              <div className="flex flex-col items-center">
                {status === "done" ? (
                  <span className="flex size-7 items-center justify-center rounded-full bg-success/15 text-success">
                    <Check className="size-4" aria-hidden="true" />
                  </span>
                ) : status === "skipped" ? (
                  <span className="flex size-7 items-center justify-center rounded-full bg-surface-raised text-muted-foreground">
                    <Check className="size-4" aria-hidden="true" />
                  </span>
                ) : status === "error" ? (
                  <span className="flex size-7 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                    <X className="size-4" aria-hidden="true" />
                  </span>
                ) : isActive ? (
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  </span>
                ) : (
                  <span className="flex size-7 items-center justify-center">
                    <span
                      className="size-2 rounded-full bg-muted-foreground/40"
                      aria-hidden="true"
                    />
                  </span>
                )}
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "my-1 w-px flex-1 border-l",
                      isSettled ? "border-success/40" : "border-dashed border-border",
                    )}
                  />
                ) : null}
              </div>

              {/* Label + (active) status line */}
              <div className={cn("flex flex-col", isLast ? "pb-0" : "pb-5")}>
                <span
                  className={cn(
                    "font-medium text-sm",
                    isActive
                      ? "text-foreground"
                      : status === "error"
                        ? "text-destructive"
                        : isSettled
                          ? "text-muted-foreground"
                          : "text-muted-foreground/60",
                  )}
                >
                  {step.label}
                </span>
                {status === "skipped" ? (
                  <span className="text-muted-foreground/70 text-xs">
                    {t("sign.steps.skipped")}
                  </span>
                ) : null}
                {isSettled && hash ? (
                  <span className="font-mono text-muted-foreground/70 text-xs">
                    {truncateHash(hash)}
                  </span>
                ) : null}
                {isActive ? (
                  <>
                    <span className="text-muted-foreground text-xs">
                      {t("sign.stepOf", { current: index + 1, total })}
                    </span>
                    <WhyLink why={step.why} />
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * The "What am I signing?" disclosure on the active step. When the step carries a
 * per-signature `why` (name + body), the expanded panel names this specific signature and explains
 * it; otherwise it falls back to the generic explanation.
 */
function WhyLink({ why }: { why?: WalletStepWhy }) {
  const t = useTranslations("strategies");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mt-0.5 self-start text-primary text-xs hover:underline"
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
