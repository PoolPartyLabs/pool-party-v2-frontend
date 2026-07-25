/**
 * @id PP-CORE-HOK-017 (POO-419, POO-1042)
 * @name useProvisioningGate
 * @implements-rules-version v2 (POO-1042 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The host side of the pre-flight provisioning gate (epic POO-411, POO-419). Every op modal calls
 * this at its confirm/review CTA. It reads the dark-launched `provisioning` feature flag, assembles
 * the op's {@link ProvisioningNeedInput} via {@link buildProvisioningInput}, and decides whether the
 * op must provision before it signs. Centralizing the flag read, the build, the need check and the
 * in-flight lock here keeps all six modals identical and prevents per-modal drift.
 *
 * ## POO-1042: the op tells the gate what it is
 *
 * The hook is configured with the operation and its NETWORK, so the gate knows which chain the
 * operation runs on ([R2]). That context used to be optional and, for move-range and close, was
 * never passed at all — their gate ran against a chain nobody chose. It is now the hook's first
 * argument, so there is no way to mount the gate without saying what it is gating.
 *
 * ## Why the live read is a prefetch, not part of `evaluate`
 *
 * The wallet is read server-side, so it is asynchronous, while `evaluate` is called synchronously
 * inside a confirm handler that must decide immediately whether to sign or to provision. Making it
 * async would put an await between the user's click and the branch, which is a double-submit window
 * on a money-moving CTA. So the context is fetched while the modal is open and the user is still
 * filling the form, and `evaluate` reads whatever has landed.
 *
 * That also gives [R6] for free and by construction: no context means no gate, so a degraded balance
 * read leaves the operation behaving exactly as it does today. The gate can only ever ADD a step to
 * an operation when it is certain the wallet is short; it can never block one on missing information.
 *
 * ## No wallet here
 *
 * This hook mounts in all six op modals, always, and it is a DECISION: it reads a flag, a balance
 * snapshot and some arithmetic. It deliberately binds no wallet, so an op modal does not need Privy
 * or wagmi context to decide whether to gate. The execution rail is bound by `ProvisioningPanel`
 * ([R10]), which mounts only when provisioning actually runs and is the only thing that signs.
 *
 * Usage in a modal:
 *   const gate = useProvisioningGate({ op: "invest", network: strategy.network, enabled: open });
 *   // at the confirm CTA:
 *   if (gate.evaluate(amount)) { setPhase("provision"); return; }
 *   setPhase("pending"); void flow.run();
 *   // in the provision phase:
 *   <ProvisioningPanel input={gate.input} context={gate.context} onLockChange={gate.setLocked}
 *     onDone={() => { gate.setLocked(false); setPhase("pending"); void flow.run(); }}
 *     onCancel={() => setPhase("confirm")} ... />
 *   // guard dismissal while executing: if (!open && gate.locked) return; and gate.reset() on close.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { networkToChainId } from "@/lib/chains/config";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import type { ProvisioningNeedInput } from "@/lib/provisioning";
import { computeProvisioningNeed } from "@/lib/provisioning";
// Type-only, therefore erased: `gateContext.ts` is `server-only` and this is a client hook. The
// value crosses the boundary as data through `getProvisioningContextAction` (ADR 0003).
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { getProvisioningContextAction } from "@/lib/provisioning/planActions";
import { isMockMode } from "@/lib/services";
import { buildProvisioningInput, type ProvisioningOp } from "../lib/buildProvisioningInput";

/** How a modal configures its gate. */
export interface ProvisioningGateOptions {
  /** Which operation this modal performs. Fixed per modal. */
  op: ProvisioningOp;
  /**
   * API network slug of the chain the operation runs on, from the strategy or pool ([R2]). An
   * unknown or absent network means we do not know where the operation lives, and the gate stays
   * inert rather than guessing a chain.
   */
  network?: string | null;
  /** Prefetch the live context only while the host surface is open. */
  enabled?: boolean;
  /** Max slippage from the settings gear, percent (POO-523 R2). Rides through to the planner. */
  slippagePct?: number;
}

/** What {@link useProvisioningGate} returns. */
export interface ProvisioningGate {
  /** The assembled gate input to feed the panel while in the provision phase; null otherwise. */
  input: ProvisioningNeedInput | null;
  /**
   * The live wallet context behind that decision: what can be spent, from where, and whether each
   * chain can pay its own gas. Null in mock mode and whenever the read degraded ([R6]).
   */
  context: ProvisioningGateContext | null;
  /** Whether provisioning is executing — the host locks dismissal while true (POO-419 R3). */
  locked: boolean;
  /** Reported by the panel via `onLockChange`. */
  setLocked: (locked: boolean) => void;
  /**
   * Decide whether the operation must provision before signing. Returns true (and stores
   * {@link input} for the provision phase) when the flag is on AND the wallet is short; false → sign
   * directly. Flag off, no live context, or nothing missing → always false, so the op's existing
   * flow is untouched.
   *
   * `amount` is the USD figure the user entered. Only a USDC-spending operation turns it into a
   * requirement ([R3]).
   */
  evaluate: (amount?: number) => boolean;
  /** Clear the gate (call on modal close). */
  reset: () => void;
}

/** Host-side pre-flight gate state + decision for an op modal. */
export function useProvisioningGate(options: ProvisioningGateOptions): ProvisioningGate {
  const { op, network, enabled = true, slippagePct } = options;
  const { isEnabled } = useFeatureFlags();
  const [input, setInput] = useState<ProvisioningNeedInput | null>(null);
  const [context, setContext] = useState<ProvisioningGateContext | null>(null);
  const [locked, setLocked] = useState(false);

  const flagOn = isEnabled("provisioning");
  const targetChainId = network ? networkToChainId(network) : undefined;
  // `evaluate` runs inside a click handler, so it must read the CURRENT context without being
  // re-created (and re-bound by every caller) each time one lands.
  const contextRef = useRef(context);
  contextRef.current = context;

  // PP-INTEGRATION-POINT: the live wallet read (PP-CORE-LIB-057, through the `"use server"`
  // boundary). Mock mode never reaches it: it has no wallet, no session and no API key, and its
  // scenarios are the whole point of the demo.
  useEffect(() => {
    if (isMockMode || !flagOn || !enabled || targetChainId === undefined) {
      setContext(null);
      return;
    }
    let live = true;
    getProvisioningContextAction(targetChainId)
      .then((result) => {
        if (!live) return;
        // [R6] A typed failure is "we could not read the wallet", which resolves to no gate at all.
        setContext(result.ok ? result.context : null);
      })
      .catch(() => {
        if (live) setContext(null);
      });
    return () => {
      live = false;
    };
  }, [flagOn, enabled, targetChainId]);

  function evaluate(amount?: number): boolean {
    if (!flagOn) return false;
    // [R2]/[R6] Real mode gates only on a live context for a known chain. Both absences mean the
    // same thing: we do not know enough to stand between the user and their transaction.
    if (!isMockMode && (targetChainId === undefined || contextRef.current === null)) return false;

    const next = buildProvisioningInput(op, {
      context: contextRef.current,
      amount,
      slippagePct,
    });
    if (!computeProvisioningNeed(next).needed) return false;
    setInput(next);
    return true;
  }

  function reset() {
    setInput(null);
    setLocked(false);
  }

  return { input, context, locked, setLocked, evaluate, reset };
}
