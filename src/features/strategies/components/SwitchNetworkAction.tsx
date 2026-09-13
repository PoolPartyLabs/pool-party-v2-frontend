/**
 * @id PP-STR-CMP-026 (POO-1385)
 * @name SwitchNetworkAction
 * @implements-rules-version v2 (POO-1385 rules v2)
 * @analytics-events wallet_action_blocked
 *
 * The manual way out of a chain failure [R6]: a "Switch to <Network>" button rendered inside the
 * transaction error block, for the two kinds where the network is the whole problem.
 *
 * The automatic ladder (PP-CORE-LIB-089) runs before every signature and is right nearly always. It
 * is not right when the wallet needs the user to do something first: a Ledger Live session carries
 * only the networks selected at pairing, so the fix is to enable the network in the wallet app and
 * then switch, and there was no affordance for the second half of that sentence. Retrying the whole
 * operation would re-run the build and the quote to get back to a switch the user could have made
 * directly.
 *
 * Renders for `wrongChain` AND `chainUnavailable`, deliberately. They differ in what the BODY copy
 * tells the user to do first (move your wallet, versus enable the network in it), and converge on the
 * same next action. Renders nothing when the target chain does not resolve to a supported chain, so
 * it can never say "Switch to undefined" (POO-1026 [R4], inherited).
 *
 * REAL MODE ONLY: it reaches wagmi and Privy through the ladder's hook, and mock mode mounts
 * neither. `isMockMode` is a build-time constant, so the whole component is dropped from a mock build
 * rather than merely returning early at runtime.
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { chainDisplayName } from "@/lib/chains/config";
import { isMockMode } from "@/lib/services";
import type { TxError } from "@/lib/tx/diagnostics";
import { findWalletForAddress } from "@/lib/tx/sendTransaction";
import { useEnsureWalletChain } from "@/lib/tx/useEnsureWalletChain";

/** The kinds this offers a remedy for. Anything else renders nothing. */
const CHAIN_KINDS = new Set<TxError["kind"]>(["wrongChain", "chainUnavailable"]);

/**
 * Whether a failure's remedy is the network itself, and this component should therefore be MOUNTED.
 *
 * The caller runs this rather than the component returning null, and that placement is the point.
 * This component reads the connected wallet, so mounting it makes the shared error block depend on
 * the wagmi and Privy providers. That block renders for EVERY failed transaction in the app, across
 * surfaces (the fiat on-ramp panel, the manager modals) that have nothing to do with wallets. Gating
 * the MOUNT keeps that dependency on the one path that actually needs it, instead of making a chain
 * concern a precondition for rendering a slippage error.
 */
export function isChainFailure(error: TxError | null | undefined): boolean {
  return CHAIN_KINDS.has(error?.kind);
}

export interface SwitchNetworkActionProps {
  /** The failure being rendered. Non-chain kinds and unknown chains render nothing. */
  error?: TxError;
  /** Re-run the failed step. Called only after the wallet is PROVEN to be on the target chain. */
  onSwitched: () => void;
}

/** "Switch to <Network>" for a failure whose remedy is the network itself (POO-1385 [R6]). */
export function SwitchNetworkAction({ error, onSwitched }: SwitchNetworkActionProps) {
  if (isMockMode) return null;

  // POO-1449: the switch copy moved to `common`, because a second surface (the SIWE failure notice,
  // PP-AUTH-CMP-005) now offers the same action and one fact gets one wording.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const t = useTranslations("common");
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { wallets } = useWallets();
  // The ACTIVE address, read straight off wagmi the way `WalletSwitchGuard` does. Deliberately not
  // `useAuth`, which pulls in `useLogin`, `useLogout`, `usePrivy`, `useDisconnect` and a service
  // import to answer one question: this component sits in the error block of EVERY failed
  // transaction, and it should not put a login surface on that path.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { address } = useAccount();
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const ensureChain = useEnsureWalletChain();
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { track } = useAnalytics();
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const [status, setStatus] = useState<"idle" | "switching" | "failed">("idle");

  const kind = error?.kind;
  const network = CHAIN_KINDS.has(kind) ? chainDisplayName(error?.targetChainId) : undefined;

  /**
   * [R8] The blocked intent: the user wanted to run an operation and their wallet does not carry the
   * network it runs on. Reported once per mounted failure, guarded by a ref the way `useTrackView`
   * does, so React's development double-invoke and any re-render do not inflate the count.
   *
   * `wallet_action_blocked` was declared in LANE-6 and never emitted (POO-1186). This is its first
   * real emitter rather than a new name, which is the difference between measuring the thing and
   * adding a second word for it.
   */
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const reported = useRef(false);
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  useEffect(() => {
    if (kind !== "chainUnavailable" || reported.current) return;
    reported.current = true;
    track("wallet_action_blocked", { block_reason: "chain_unavailable" });
  }, [kind, track]);

  // [R6] No network name, no button. A "Switch to undefined" is worse than the generic error alone.
  if (!network) return null;

  async function switchNow() {
    const wallet = findWalletForAddress(wallets, address);
    const chainId = error?.targetChainId;
    if (!wallet || chainId == null) {
      setStatus("failed");
      return;
    }
    setStatus("switching");
    try {
      // The same ladder the operation uses, so a manual switch that reports success means exactly
      // what an automatic one does: the wallet has been re-read and is on the chain.
      await ensureChain(wallet, chainId);
      setStatus("idle");
      onSwitched();
    } catch {
      // The failure detail is already on screen in the error box above; repeating it here would say
      // the same thing twice. What this adds is that the BUTTON did not work, which the box cannot.
      setStatus("failed");
    }
  }

  return (
    <>
      <Button
        className="w-full"
        size="lg"
        disabled={status === "switching"}
        onClick={() => void switchNow()}
      >
        {status === "switching"
          ? t("chainSwitch.pending", { network })
          : t("chainSwitch.to", { network })}
      </Button>
      {/* PP-A11Y: a live region, because the outcome of pressing this is a label change on a button
          the user may have moved focus away from while the wallet prompt was open. */}
      <p role="status" aria-live="polite" className="text-center text-muted-foreground text-xs">
        {status === "failed" ? t("chainSwitch.failed", { network }) : ""}
      </p>
    </>
  );
}
