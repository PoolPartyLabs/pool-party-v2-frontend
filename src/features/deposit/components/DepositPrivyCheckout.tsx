/**
 * @id PP-DEP-CMP-007 (POO-1807)
 * @name DepositPrivyCheckout
 * @implements-rules-version v1 (POO-1807 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * @analytics-events none, `/deposit`'s funnel is emitted by `DepositScreen` (`PP-DEP-SCR-001`),
 *   which owns the step machine and therefore knows which transition happened. This component
 *   reports outcomes through callbacks and counts nothing itself, so a purchase cannot be counted
 *   twice by two owners of the same funnel.
 *
 * The `/deposit` half of the Privy rail: it plugs into the `onramp` step the way
 * {@link StandaloneOnRampRail} does, owns the observation window and the opening screen, and hands
 * every outcome back to the host through one callback each.
 *
 * ## Why the checkout promise is a PROP, and not opened here
 *
 * The obvious shape is for this component to call `openCheckout` on mount. It cannot, and the reason
 * is the whole of POO-1803 [R3]: MoonPay, Coinbase and Meld open a top-level popup, and a browser
 * allows that only from inside the click's own synchronous turn. A mount effect runs after that turn
 * has closed, so the popup would be blocked and the buyer would see nothing at all.
 *
 * So the HOST calls `openCheckout` in its click handler and hands the resulting promise down. This
 * component owns everything after it. The same reasoning puts the baseline read in the host: it must
 * happen BEFORE the click, or the pre-purchase balance is read after the purchase.
 *
 * ## It STAYS MOUNTED after it reports settling, and that is load-bearing
 *
 * The host mounts this for `onramp` AND `onramp-settling`, exactly as it keeps
 * {@link StandaloneOnRampRail} mounted through `onramp-error` (that component's header, lines
 * 30-45, states the same contract for the same reason). The observation window lives in THIS
 * component's effect: unmounting it runs the cleanup, sets `live = false`, and drops the outcome the
 * window was opened to observe. So reporting `onSettling()` cannot unmount it, and this component
 * renders `null` from that point instead, leaving the settling copy to the host.
 *
 * ## The one path that may look like a failure ([R9], ADR-0006)
 *
 * A hard `no` is it. `confirmed` and `maybe` BOTH enter the settling window, because after 3.40.0 a
 * charged card and an abandonment are indistinguishable at the exit, and rendering `maybe` as a
 * failure is exactly the cancellation-over-a-charged-card this epic exists to stop.
 *
 * ## Provider-neutral copy
 *
 * The provider is never named on screen, and not in the KEY PATH either: the keys live under
 * `deposit.onramp.checkout.*` and say "secure checkout". A vendor in a key path is the same debt the
 * pre-prod copy gate already lists against the Paybis keys, and it outlives the vendor: which
 * provider is behind the rail is an implementation detail today and a second rail tomorrow.
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  type OnRampSettlementDeps,
  watchOnRampSettlementVisible,
} from "@/lib/onramp/awaitOnRampSettlement";
import { usdcDestination } from "@/lib/onramp/destinations";
import type { PrivyOnRampOutcome } from "@/lib/onramp/usePrivyOnRamp";
// Base, the only destination this rail buys onto in v1. Imported rather than redeclared: a second
// copy of the chain id is a second place to forget when a chain is added (POO-1807 review N8).
import { ONRAMP_CHAIN_ID } from "@/lib/provisioning/computeNeed";

/**
 * USDC's decimals on the destination chain. Used to read the observed delta here, and to record the
 * baseline on the intent from the host, which imports this rather than restating it: two copies of
 * an asset's decimals is how a delta ends up a million times its real size.
 *
 * Not a guess: `ChainMeta.usdc.decimals` is typed as the literal `6` in `src/lib/chains/config.ts`,
 * for every chain in the registry.
 */
export const ONRAMP_DESTINATION_DECIMALS = 6;

export interface DepositPrivyCheckoutProps {
  /**
   * The checkout, already opened by the host's click handler. A promise rather than a callback
   * because the OPENING has to happen in the gesture's turn; see the header.
   */
  pending: Promise<PrivyOnRampOutcome>;
  /** The destination balance read BEFORE the checkout opened, base units. Never read here. */
  baseline: bigint;
  /** The wallet the funds are expected on. */
  address: string;
  /** The same balance read the host used for the baseline, so the watcher polls one scope ([R5]). */
  readBalance: OnRampSettlementDeps["readBalance"];
  /**
   * The delta actually observed, in USDC. ADR-0004: the only figure the receipt may print.
   *
   * POO-1813 [R4]: it also carries OUR attempt id, so the host can join `funding_buy_settled` to the
   * three rows the adapter already emitted for the same purchase. Passed UP rather than emitted
   * here, because this component deliberately counts nothing: one owner per funnel. Non-nullable,
   * because a settlement can only be reached past the guard that refuses a null attempt id.
   */
  onSettled: (deliveredUsd: number, attemptId: string) => void;
  /** The checkout closed with money possibly moving: the visible window is open. */
  onSettling: () => void;
  /** The window closed with no claim and no delta. Honest, and not a cancellation. */
  onUnverified: () => void;
  /** The only failure path: a hard `no`, carrying the classifier's reason. */
  onFailed: (reason: string) => void;
}

export function DepositPrivyCheckout({
  pending,
  baseline,
  address,
  readBalance,
  onSettled,
  onSettling,
  onUnverified,
  onFailed,
}: DepositPrivyCheckoutProps) {
  const t = useTranslations("deposit.onramp.checkout");
  /**
   * POO-1807 review (F1): has this component already told the host the window is open?
   *
   * It exists to make this component render NOTHING from that point on, which is what lets it stay
   * mounted through `onramp-settling` while the host swaps to its own settling copy. Before the fix
   * the host unmounted it on `onSettling()`, the effect's cleanup set `live = false`, and
   * `onSettled` / `onUnverified` could never fire: the observation window was killed by the first
   * thing it reported, so no Privy purchase could ever complete.
   */
  const [reportedSettling, setReportedSettling] = useState(false);
  /** One run per mount. A re-render must never open a second observation of the same purchase. */
  const startedRef = useRef(false);
  /** The live callbacks, so the effect can depend on nothing that changes every render. */
  const handlers = useRef({ onSettled, onSettling, onUnverified, onFailed });
  handlers.current = { onSettled, onSettling, onUnverified, onFailed };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let live = true;

    void (async () => {
      const outcome = await pending;
      if (!live) return;

      // A hard no, or a refusal that minted no intent: there is nothing to observe, and this is the
      // only path allowed to read like a failure ([R9]).
      if (outcome.moved === "no" || outcome.attemptId === null) {
        handlers.current.onFailed(outcome.reason);
        return;
      }

      // [R9]: `confirmed` AND `maybe` both land here. The window is what tells them apart, and only
      // the chain can. This component STAYS MOUNTED across that report (the host mounts it for
      // `onramp` and `onramp-settling` alike) and simply stops rendering, so the await below keeps
      // running: it is the same stay-mounted contract `StandaloneOnRampRail.tsx:30-45` documents.
      setReportedSettling(true);
      handlers.current.onSettling();

      const destination = usdcDestination(ONRAMP_CHAIN_ID);
      if (!destination) {
        // Unreachable while Base ships, and a silent no-op would strand the buyer on a settling
        // screen forever, so it is reported rather than swallowed.
        handlers.current.onFailed("destination_unavailable");
        return;
      }

      const result = await watchOnRampSettlementVisible(
        {
          attemptId: outcome.attemptId,
          destination,
          address,
          baseline,
          decimals: ONRAMP_DESTINATION_DECIMALS,
          moved: outcome.moved,
        },
        {
          readBalance,
          sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        },
      );
      if (!live) return;

      if (result.outcome === "settled") {
        handlers.current.onSettled(Number(result.delivered.amount), outcome.attemptId);
        return;
      }
      if (result.outcome === "unverified") {
        handlers.current.onUnverified();
        return;
      }
      // `settling` at the ceiling: the host is already showing the settling copy and there is
      // nothing to correct. The passive window carries the intent from here, for the rest of this
      // SESSION (ADR-0006); it does not yet survive a reload, which is POO-1833's.
    })();

    return () => {
      live = false;
    };
  }, [pending, baseline, address, readBalance]);

  // Reported settling: the host owns the screen from here and this component is only a live watcher.
  // Rendering its own opening copy underneath the host's settling copy would show both at once.
  if (reportedSettling) return null;

  return (
    <div className="flex flex-col items-center gap-5 py-10 text-center">
      {/* The same inline spinner `StandaloneOnRampRail` uses, so the two rails' waiting states are
          visually identical and a rail switch is invisible to the buyer. */}
      <div
        className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
        aria-hidden="true"
      />
      <div>
        <h1 className="font-bold text-foreground text-xl">{t("openingTitle")}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("openingBody")}</p>
      </div>
    </div>
  );
}
