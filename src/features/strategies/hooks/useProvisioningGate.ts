/**
 * @id PP-CORE-HOK-017 (POO-419, POO-1042, POO-1048, POO-1564, POO-1749)
 * @name useProvisioningGate
 * @implements-rules-version v5 (POO-1749 rules v1) · v4 (POO-1564 rules v1) · v3 (POO-1048 rules v1) · v2 (POO-1042 rules v1)
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
import { PROVISIONING_OP_TO_FLOW } from "@/lib/analytics/events";
import { useProvisioningFunnel } from "@/lib/analytics/provisioningFunnel";
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
  /**
   * POO-1749 [R1]: the host's own directly-read USDC balance on the operation's chain, USD. Floors
   * the gate's view of that chain's token value so the gate can never contradict the balance the
   * host displays and gates its CTA on. See {@link ProvisioningInputContext.targetUsdcBalanceUsd}
   * for the incident that makes this load-bearing. Optional and additive: only the invest modal,
   * the one USDC-spending host, passes it today.
   */
  targetUsdcBalanceUsd?: number;
}

/**
 * Where the live context read has got to.
 *
 * POO-1109: the gate used to be a two-state affair from the outside, context or no context, which
 * makes "we have not asked yet" indistinguishable from "we asked and the wallet is unreadable".
 * `evaluate` treats both as no-gate, correctly, but a host that wants to WAIT for an answer, or a
 * test that wants to know one arrived, had nothing to read. Reporting only; `evaluate` is unchanged.
 */
export type ProvisioningGateStatus = "inert" | "loading" | "ready" | "unavailable";

/** What {@link useProvisioningGate} returns. */
export interface ProvisioningGate {
  /** The assembled gate input to feed the panel while in the provision phase; null otherwise. */
  input: ProvisioningNeedInput | null;
  /**
   * The live wallet context behind that decision: what can be spent, from where, and whether each
   * chain can pay its own gas. Null in mock mode, and until a read for THIS chain has succeeded.
   *
   * It survives a close and a failed refetch, so it can be the previous good read for the same chain
   * while {@link status} reports `loading` or `unavailable`. Read the two together: `context` is the
   * best answer available, `status` is how fresh that answer is.
   */
  context: ProvisioningGateContext | null;
  /**
   * How far the CURRENT context read has got: `inert` (mock mode, flag off, or no known chain, so no
   * read is made at all), `loading`, `ready`, or `unavailable` (the read resolved and gave us
   * nothing). It describes the read, never the context: `unavailable` alongside a retained
   * {@link context} means the refresh failed, not that the wallet is unknown.
   */
  status: ProvisioningGateStatus;
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
  const { op, network, enabled = true, slippagePct, targetUsdcBalanceUsd } = options;
  const { isEnabled } = useFeatureFlags();
  const [input, setInput] = useState<ProvisioningNeedInput | null>(null);
  const [context, setContext] = useState<ProvisioningGateContext | null>(null);
  const [status, setStatus] = useState<ProvisioningGateStatus>("inert");
  const [locked, setLocked] = useState(false);

  const flagOn = isEnabled("provisioning");
  const targetChainId = network ? networkToChainId(network) : undefined;
  // POO-1048 [R1]: the gate is the funnel's first step, and this hook is the only place all six
  // operations agree on. No `abandonExit`: this instance reports the gate firing and nothing else,
  // so its unmount (every modal close, gated or not) can never invent an abandoned route.
  const funnel = useProvisioningFunnel({
    // POO-1171: `ProvisioningOp` spells the same operation differently from the analytics
    // vocabulary ("move-range" vs "moveRange"). Convert at this boundary, never downstream.
    flow: PROVISIONING_OP_TO_FLOW[op],
    ...(targetChainId === undefined ? {} : { chainId: targetChainId }),
  });
  // `evaluate` runs inside a click handler, so it must read the CURRENT context without being
  // re-created (and re-bound by every caller) each time one lands.
  const contextRef = useRef(context);
  contextRef.current = context;
  /**
   * Which chain the mounted {@link context} was read for, or nothing when none is held.
   *
   * The context now OUTLIVES a close (see the read effect below), so "we hold a context" and "we
   * hold a context for THIS operation's chain" stopped being the same statement. [R2] is that the
   * gate decides against the operation's OWN chain and no other, so a held context is dropped the
   * moment the host asks about a different one rather than left for an `evaluate` that cannot tell.
   */
  const contextChainRef = useRef<number | undefined>(undefined);

  // PP-INTEGRATION-POINT: the live wallet read (PP-CORE-LIB-057, through the `"use server"`
  // boundary). Mock mode never reaches it: it has no wallet, no session and no API key, and its
  // scenarios are the whole point of the demo.
  useEffect(() => {
    // Nothing to read and nothing worth keeping: no wallet behind the seam (mock mode), no gate at
    // all (flag off), or no known chain to read for.
    if (isMockMode || !flagOn || targetChainId === undefined) {
      contextChainRef.current = undefined;
      setContext(null);
      setStatus("inert");
      return;
    }
    // [R2] A different operation's chain invalidates what we hold: it describes another wallet
    // slice, and gating one chain on another's balances is exactly what R2 forbids.
    if (contextChainRef.current !== undefined && contextChainRef.current !== targetChainId) {
      contextChainRef.current = undefined;
      setContext(null);
    }
    /**
     * The host surface closed. STOP READING, but KEEP the answer already in hand.
     *
     * Nulling it here is what made the SECOND open of a modal behave differently from the first.
     * `evaluate` cannot distinguish "no context" from "nothing to provision" — both are `false`,
     * and for a short wallet `false` means `router.push("/deposit")` — so every reopen reintroduced
     * a window in which a user holding funds on another chain was sent to buy fiat instead. It is a
     * WINDOW rather than a race in practice: a closed-midway funding run has just spent the shared
     * per-API-key throttle bucket, so the refetch is the one most likely to come back `unavailable`.
     *
     * A retained context is stale, and stale is the safe direction here. It only ever decides
     * WHETHER to provision; the panel then re-derives the whole plan from a fresh server-side read,
     * so a context that has since gone out of date resolves to a plan with nothing left to do rather
     * than to a wrong route. The read below still re-runs on every open, so the staleness is bounded
     * by one round trip and only ever covers it.
     */
    if (!enabled) {
      // Never leave a superseded `loading` behind: the read this cancels can no longer land.
      setStatus((previous) =>
        previous !== "loading" ? previous : contextRef.current ? "ready" : "inert",
      );
      return;
    }
    let live = true;
    setStatus("loading");
    getProvisioningContextAction(targetChainId)
      .then((result) => {
        if (!live) return;
        /**
         * [R6] A typed failure is "we could not read the wallet", which resolves to no gate at all.
         *
         * It no longer DISCARDS a context read successfully for this same chain a moment ago. The
         * failure says the read failed, not that the wallet emptied, and throwing the last good
         * answer away on a transient upstream is what turns a throttled refetch into a deposit
         * redirect. `status` still reports the failure honestly, so a host that wants to treat an
         * unreadable wallet differently can.
         */
        if (result.ok) {
          contextChainRef.current = targetChainId;
          setContext(result.context);
        }
        setStatus(result.ok ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!live) return;
        setStatus("unavailable");
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
      // POO-1749 [R1]: the host's direct on-target USDC read, so the gate's view of that chain can
      // never fall below the balance the host itself displays and gates on.
      targetUsdcBalanceUsd,
      // POO-1549 [R1]: the operation's OWN chain, which this hook has already resolved for the live
      // read above. Mock mode had no other way to learn it, so its demo scenarios ran on the chain
      // their fixture happened to name: every invest bridged to Arbitrum and the five non-spending
      // operations wanted gas on Base, whatever the strategy was on. Real mode keeps reading
      // `context.targetChainId` for the decision itself, but since POO-1749 it also uses this value
      // as the floor's consistency check: the host's USDC read only floors the chain it was read on.
      ...(targetChainId === undefined ? {} : { targetChainId }),
    });
    const need = computeProvisioningNeed(next);
    if (!need.needed) return false;
    // [R1] Reported here rather than in the panel: this is the moment the decision is MADE, and it
    // is the only one that also covers an operation whose panel the user never sees.
    funnel.gateTriggered(need.usdcShortfallUsd + need.gasShortfallUsd);
    setInput(next);
    return true;
  }

  function reset() {
    setInput(null);
    setLocked(false);
  }

  return { input, context, status, locked, setLocked, evaluate, reset };
}
