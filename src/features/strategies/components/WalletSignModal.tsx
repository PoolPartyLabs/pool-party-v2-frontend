/**
 * @id PP-CORE-MOD-009 (POO-295)
 * @name WalletSignModal
 * @implements-rules-version v1
 *
 * Generic multistep wallet-signing modal. Any transaction that needs one or more wallet interactions
 * (an ERC-20 approve per token, an optional Permit2/message signature, then the confirm) opens this
 * with a declarative {@link WalletSignSpec}; it renders the title, an optional operation summary, and
 * the {@link WalletSteps} progress. While the wallet is signing there is NO in-modal CTA (POO-295 R3):
 * the action happens in the wallet, the modal only tracks progress. The host owns the outcome and
 * swaps this for its success/error view when the flow settles (a rejected step routes to the host's
 * error state, whose "Try again" returns to the failed step).
 *
 * Reusable across add-liquidity / remove-liquidity / collect / compound (and any future signing flow):
 * the step count adapts to the spec, so callers never hand-build the list.
 */
"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { type WalletSignStep, type WalletStepStatus, WalletSteps } from "./WalletSteps";
import {
  buildWalletSignSteps,
  type WalletConfirmKind,
  type WalletSignSpec,
} from "./walletSignSteps";

/** Confirm-kind → its i18n key under the `strategies` namespace. */
const CONFIRM_LABEL_KEY: Record<WalletConfirmKind, string> = {
  invest: "sign.steps.confirmInvest",
  addLiquidity: "sign.steps.confirmAddLiquidity",
  withdraw: "sign.steps.confirmWithdraw",
  removeLiquidity: "sign.steps.confirmRemoveLiquidity",
  collect: "sign.steps.confirmCollect",
  compound: "sign.steps.confirmCompound",
  moveRange: "sign.steps.confirmMoveRange",
  closePosition: "sign.steps.confirmClosePosition",
};

/** Minimal shape of the next-intl `strategies` translate fn used to label steps. */
type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

/**
 * Resolve a {@link WalletSignSpec} into i18n-labeled {@link WalletSignStep}s. Shared by this modal and
 * the host modals that render the stepper directly while driving it from {@link useWalletSignFlow}, so
 * the labels always match the runner's steps (same order + keys).
 */
export function resolveWalletSignSteps(spec: WalletSignSpec, t: TranslateFn): WalletSignStep[] {
  return buildWalletSignSteps(spec).map((descriptor) => {
    if (descriptor.kind === "approve") {
      const token = descriptor.token ?? "";
      return {
        key: descriptor.key,
        label: t("sign.steps.approve", { token }),
        why: {
          name: t("sign.explain.approve.name"),
          body: t("sign.explain.approve.body", { token }),
        },
      };
    }
    if (descriptor.kind === "permit") {
      return {
        key: descriptor.key,
        label: t("sign.steps.permit"),
        why: { name: t("sign.explain.permit.name"), body: t("sign.explain.permit.body") },
      };
    }
    if (descriptor.kind === "build") {
      return {
        key: descriptor.key,
        label: t("sign.steps.build"),
        why: { name: t("sign.explain.build.name"), body: t("sign.explain.build.body") },
      };
    }
    return {
      key: descriptor.key,
      label: t(CONFIRM_LABEL_KEY[descriptor.confirm ?? "invest"]),
      why: { name: t("sign.explain.confirm.name"), body: t("sign.explain.confirm.body") },
    };
  });
}

/** Public props for {@link WalletSignModal}. */
export interface WalletSignModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** Already-translated title, e.g. "Confirming your deposit". */
  title: string;
  /** Optional operation summary rendered above the steps (e.g. an amount or a from/to block). */
  summary?: ReactNode;
  /** Declarative signing requirements; resolved to the variable step list. */
  spec: WalletSignSpec;
  /**
   * Controlled active-step index (0-based), forwarded to {@link WalletSteps}. The host bumps it on
   * each real wallet signature/confirmation; omit it to let the stepper self-advance on `stepMs`.
   */
  activeStep?: number;
  /** Mock per-step duration in ms (forwarded to {@link WalletSteps}; uncontrolled mode only). */
  stepMs?: number;
  /** Per-step status, index-aligned with the spec's steps (forwarded to {@link WalletSteps}). */
  statuses?: WalletStepStatus[];
  /** Per-step mined tx hash, index-aligned (forwarded to {@link WalletSteps}). */
  txHashes?: (string | undefined)[];
}

/** Generic multistep wallet-signing modal (PP-CORE-MOD-009). */
export function WalletSignModal({
  open,
  onOpenChange,
  title,
  summary,
  spec,
  activeStep,
  stepMs,
  statuses,
  txHashes,
}: WalletSignModalProps) {
  const t = useTranslations("strategies");
  const steps = resolveWalletSignSteps(spec, t);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {summary ? <div className="mt-1">{summary}</div> : null}
        <WalletSteps
          steps={steps}
          activeStep={activeStep}
          stepMs={stepMs}
          statuses={statuses}
          txHashes={txHashes}
        />
      </DialogContent>
    </Dialog>
  );
}
