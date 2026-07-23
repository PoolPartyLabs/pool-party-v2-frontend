/**
 * @id PP-CORE-CMP-062
 * @name MockBadge
 * @implements-rules-version v1 (POO-807 rules v1)
 *
 * The visible "MOCK" indicator of the transactional flows (POO-799 directive: mock must never pass
 * as real). A small amber dashed chip that renders ONLY in mock mode (R1); in real mode it renders
 * nothing — the `isMockMode` gate lives HERE, in one place, so no consumer can accidentally ship it
 * into production chrome (R2). Mounted once in each piece of shared phase chrome the transactional
 * modals compose — {@link TransactionModalHeader} (form/Review), TransactionStatus (success/error),
 * WalletSteps (pending), BuildingStep (building), ProvisioningPanel (provision plan) — plus the
 * hand-rolled ManagerActionModal header/success, so every phase of the whole family is covered
 * without further per-modal wiring (R3 pairs it with the PP-MOCK code tags).
 *
 * PP-I18N: the literal "MOCK" is deliberately untranslated — it is a technical marker that must be
 * identical and unmistakable in every locale (like token symbols), not user copy.
 */
"use client";

import { isMockMode } from "@/lib/services";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link MockBadge}. */
export interface MockBadgeProps {
  /** Extra classes on the chip (placement margins etc.). */
  className?: string;
}

/** The mock-mode-only "MOCK" chip. Renders nothing in real mode. */
export function MockBadge({ className }: MockBadgeProps) {
  // PP-MOCK: this component IS the visible mock signal; real mode renders nothing (R2).
  if (!isMockMode) return null;
  return (
    <span
      data-testid="mock-badge"
      className={cn(
        "inline-flex shrink-0 items-center rounded border border-warning border-dashed bg-warning/15 px-1.5 py-0.5 font-semibold text-[10px] text-warning uppercase tracking-wider",
        className,
      )}
    >
      MOCK
    </span>
  );
}
