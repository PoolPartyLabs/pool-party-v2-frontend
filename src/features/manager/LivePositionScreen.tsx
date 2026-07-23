/**
 * @id PP-MGR-SCR-004
 * @state live-operate (2026-06-11: re-IDed from SCR-005, which now = the public manager profile)
 * @name LivePositionScreen
 *
 * Manager "operate" screen for a strategy's live Uniswap v3 position: a back link to the console, the
 * strategy name + heading, and the {@link LivePositionCard}. When the strategy has no live position
 * yet, an empty note is shown instead of the card.
 *
 * PP-DEBT(SEV:LOW): route-orphaned by POO-519 (/manager/strategies/[id] now redirects to the console
 * manage view, /manager?manage=<id>); kept, with its tests, pending a cleanup sweep.
 */
"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ManagerPosition } from "@/lib/schemas";
import { LivePositionCard } from "./components/LivePositionCard";

/** Public props for {@link LivePositionScreen}. */
export interface LivePositionScreenProps {
  /** The strategy's live position, or `null` when there is none yet. */
  position: ManagerPosition | null;
  /** The strategy's display name (for the heading). */
  strategyName: string;
}

/** Manager operate screen (PP-MGR-SCR-005). */
export function LivePositionScreen({ position, strategyName }: LivePositionScreenProps) {
  const t = useTranslations("manager");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/manager"
          className="inline-flex items-center gap-1 self-start text-muted-foreground text-sm hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("operate.back")}
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-foreground">{strategyName}</h1>
          <p className="text-muted-foreground text-sm">{t("operate.title")}</p>
        </div>
      </div>

      {position ? (
        <LivePositionCard position={position} />
      ) : (
        <p className="rounded-xl border border-border bg-surface p-4 text-muted-foreground text-sm">
          {t("operate.empty")}
        </p>
      )}
    </div>
  );
}
