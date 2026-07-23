/**
 * @id PP-REW-SCR-001
 * @name RubberRushActions
 * @implements-rules-version v1
 *
 * The interactive Rubber Rush hero actions (POO-187): the daily Say Quack check-in
 * (idle → signing → quacked-today), the Claim roles button (→ claimed), and the Play Duck Shoot
 * entry that opens the Duck Shoot mini-game. Split out as a client component so the screen stays
 * server-rendered; the action handlers call `rewardsService` (mock today; PP-INTEGRATION-POINT).
 */
"use client";

import { Check, Loader2, MessageCircle, Target } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import type { RubberRush } from "@/lib/schemas";
import { formatCount } from "@/lib/utils/format";
import { useSayQuack } from "../hooks/useSayQuack";
import { DuckShootModal } from "./DuckShootModal";

/** Public props for {@link RubberRushActions}. */
export interface RubberRushActionsProps {
  /** The Rubber Rush dashboard data. */
  data: RubberRush;
  /**
   * POO-546 R1: refetch the Rubber Rush read after a check-in so the Quacks balance + `quackedToday`
   * reflect the backend credit without a manual reload. The real-mode data loader wires this to its
   * in-place refetch; omitted on the mock SSR path, where the router refresh below re-runs the read.
   */
  onRefresh?: () => void;
}

/** The Rubber Rush hero action cluster (Say Quack / Play Duck Shoot / Claim roles). */
export function RubberRushActions({ data, onRefresh }: RubberRushActionsProps) {
  const t = useTranslations("rewards");
  const router = useRouter();
  const { track } = useAnalytics();
  // POO-546 R2: `quackedToday` is the single source for the check-in gate; it derives from the
  // backend's `tier.hasSaidGM` (mapRubberRush) — there is NO local-only persistence, on purpose. The
  // optimistic `quacked` below only survives THIS session; whether the gate holds across a reload is a
  // backend guarantee (hasSaidGM stays true for the rest of the UTC day — POO-546 R3, @Rafael).
  const [quacked, setQuacked] = useState(data.quackedToday);
  const [signing, setSigning] = useState(false);
  const [shootOpen, setShootOpen] = useState(false);
  const { sayQuack } = useSayQuack();

  /** POO-546 R1: pull fresh Rubber Rush data (balance + gate) after a check-in credit. */
  function refresh() {
    if (onRefresh) onRefresh();
    else router.refresh();
  }

  async function handleSayQuack() {
    if (quacked || signing) return;
    setSigning(true);
    try {
      const outcome = await sayQuack();
      if (outcome.status === "awarded") {
        // The daily check-in is a Quacks claim — report the awarded amount as the value.
        track("reward_claimed", { value: outcome.quacksAwarded });
        setQuacked(true);
        // POO-546 R1: the backend credited the Quacks — refetch so the visible balance updates now,
        // instead of reading stale until a manual reload.
        refresh();
      } else if (outcome.status === "already_claimed") {
        // The backend already has today's check-in for this wallet — reflect it and refresh the
        // balance in case an earlier award never made it to the screen.
        setQuacked(true);
        refresh();
      }
      // invalid_signature / error: stay idle so the user can retry.
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 lg:items-end">
      <div className="flex flex-col gap-3 sm:flex-row">
        {quacked ? (
          <span className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised px-5 py-3 font-semibold text-muted-foreground text-sm">
            <Check className="size-4 text-brand-grape" aria-hidden="true" />
            {t("rubberRush.quackedToday")}
          </span>
        ) : (
          <button
            type="button"
            onClick={handleSayQuack}
            disabled={signing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-grape px-5 py-3 font-semibold text-brand-grape-foreground text-sm transition-opacity hover:opacity-90 disabled:opacity-70"
          >
            {signing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <MessageCircle className="size-4" aria-hidden="true" />
            )}
            {signing ? t("rubberRush.signing") : t("rubberRush.sayQuack")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShootOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground text-sm transition-opacity hover:opacity-90"
        >
          <Target className="size-4" aria-hidden="true" />
          {t("rubberRush.playDuckShoot")}
        </button>
      </div>

      <div className="flex items-center justify-center gap-4 text-sm lg:justify-end">
        <span className="font-medium text-brand-grape">
          {t("rubberRush.quacksEarnedToday", { count: formatCount(data.quacksToday) })}
        </span>
        {/* Claim Roles is the community quest board (Zealy), an external link — not an in-app action
            (the reference does the same). POO-765. */}
        <a
          href="https://zealy.io/cw/poolpartyxyz/questboard/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          {t("rubberRush.claimRoles")}
          <span aria-hidden="true">→</span>
        </a>
      </div>

      {/* POO-764 R4: a play refetches the dashboard (same refresh path as Say Quack). */}
      <DuckShootModal open={shootOpen} onOpenChange={setShootOpen} data={data} onPlayed={refresh} />
    </div>
  );
}
