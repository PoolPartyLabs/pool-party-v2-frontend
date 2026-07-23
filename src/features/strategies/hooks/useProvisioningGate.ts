/**
 * @id PP-CORE-HOK-017
 * @name useProvisioningGate
 * @implements-rules-version v1
 *
 * The host side of the pre-flight provisioning gate (epic POO-411, POO-419). Every op modal calls
 * this at its confirm/review CTA. It reads the dark-launched `provisioning` feature flag (ON in local
 * dev to demo, OFF in prod/test), assembles the op's {@link ProvisioningNeedInput} via
 * {@link buildProvisioningInput}, and decides whether the op must provision before it signs.
 * Centralizing the flag read + build + need check + in-flight lock here keeps all six modals identical
 * and prevents per-modal drift.
 *
 * Usage in a modal:
 *   const gate = useProvisioningGate();
 *   // at the confirm CTA:
 *   if (gate.evaluate("invest", strategy, amount)) { setPhase("provision"); return; }
 *   setPhase("pending"); void flow.run();
 *   // in the provision phase:
 *   <ProvisioningPanel input={gate.input} onLockChange={gate.setLocked}
 *     onDone={() => { gate.setLocked(false); setPhase("pending"); void flow.run(); }}
 *     onCancel={() => setPhase("confirm")} ... />
 *   // guard dismissal while executing: if (!open && gate.locked) return; and gate.reset() on close.
 */
"use client";

import { useState } from "react";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import type { ProvisioningNeedInput } from "@/lib/provisioning";
import { computeProvisioningNeed } from "@/lib/provisioning";
import type { Strategy } from "@/lib/schemas";
import { buildProvisioningInput, type ProvisioningOp } from "../lib/buildProvisioningInput";

/** What {@link useProvisioningGate} returns. */
export interface ProvisioningGate {
  /** The assembled gate input to feed the panel while in the provision phase; null otherwise. */
  input: ProvisioningNeedInput | null;
  /** Whether provisioning is executing — the host locks dismissal while true (POO-419 R3). */
  locked: boolean;
  /** Reported by the panel via `onLockChange`. */
  setLocked: (locked: boolean) => void;
  /**
   * Decide whether `op` must provision before signing. Returns true (and stores {@link input} for the
   * provision phase) when the flag is on AND the wallet is short; false → sign directly. Flag off or
   * nothing missing → always false, so the op's existing flow is untouched.
   */
  evaluate: (op: ProvisioningOp, strategy?: Strategy, amount?: number) => boolean;
  /** Clear the gate (call on modal close). */
  reset: () => void;
}

/** Host-side pre-flight gate state + decision for an op modal. */
export function useProvisioningGate(): ProvisioningGate {
  const { isEnabled } = useFeatureFlags();
  const [input, setInput] = useState<ProvisioningNeedInput | null>(null);
  const [locked, setLocked] = useState(false);

  function evaluate(op: ProvisioningOp, strategy?: Strategy, amount?: number): boolean {
    if (!isEnabled("provisioning")) return false;
    const next = buildProvisioningInput(op, strategy, amount);
    if (!computeProvisioningNeed(next).needed) return false;
    setInput(next);
    return true;
  }

  function reset() {
    setInput(null);
    setLocked(false);
  }

  return { input, locked, setLocked, evaluate, reset };
}
