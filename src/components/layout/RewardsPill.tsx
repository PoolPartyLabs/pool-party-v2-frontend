/**
 * @id PP-CORE-CMP-023
 * @name RewardsPill
 * @implements-rules-version v3
 *
 * Header pill showing the investor's Rubber Rush balance (Quacks), linking to the rewards area.
 * Rewards is a deferred (post-v1) area, so the destination route may not exist yet — the href
 * stays consistent with the Profile hub's "Rubber Rush" row (`/rewards/rubber-rush`).
 *
 * Styled with the Rewards accent (brand grape) per the design system: Rewards = Neon Grape.
 *
 * POO-712 (rules v2): on hover / keyboard focus the pill reveals a tooltip explaining how Quacks
 * are earned, mirroring the reference interface ("earn 1 Quack per $1 deposited"). The tooltip is a
 * desktop hover / focus affordance; tap still navigates to the rewards route. [R5]
 *
 * POO-762 (rules v3): the two key phrases are emphasized like the reference — "1 Quack" in gold
 * (`text-primary`) and the deposited "$1" in green (`text-success`), via `t.rich` markup tags so the
 * copy stays a single translatable string across all locales.
 */
"use client";

import { Sparkle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";

/** Public props for {@link RewardsPill}. */
export interface RewardsPillProps {
  /** The investor's current Quacks balance. */
  quacks: number;
  /** Extra classes merged onto the pill. */
  className?: string;
}

/** Rubber Rush rewards-balance pill (Quacks) shown in the app header. */
export function RewardsPill({ quacks, className }: RewardsPillProps) {
  const t = useTranslations("shell");

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/rewards/rubber-rush"
            aria-label={t("rewards.ariaLabel", { count: formatCount(quacks) })}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-brand-grape/60 px-3.5",
              "font-semibold text-brand-grape text-sm transition-colors hover:bg-brand-grape/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <Sparkle className="size-4 shrink-0" aria-hidden="true" />
            <span>{formatCount(quacks)}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {t.rich("rewards.tooltip", {
            quack: (chunks) => <span className="font-bold text-primary">{chunks}</span>,
            deposit: (chunks) => <span className="font-bold text-success">{chunks}</span>,
          })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
