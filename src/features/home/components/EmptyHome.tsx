/**
 * @id PP-DASH-CMP-006
 * @name EmptyHome
 * @implements-rules-version v2
 *
 * The Home empty / first-run state (PP-DASH-SCR-001). Two variants selected by `availableToInvest`:
 * the "zero" state (brand-new, no balance) leads with "Add funds to start" -> /deposit; the "funded"
 * state (holds a balance, no active strategy) leads with "Pick a strategy" -> /strategies. Both share
 * the three-step "path to earning" tracker (EarningSteps) and surface discoverable strategies below
 * as the path out. Responsive: a centered mobile stack (badge/available -> headline -> steps -> CTA)
 * and a two-column desktop hero (lead + CTA on the left, the steps card on the right). Deposit-first
 * first-run is the approved v2 design (Figma PP-DASH-SCR-001); /deposit is a launched core feature
 * (R4/R6). `availableToInvest` is prop-driven until a spendable-balance source is wired (R7).
 */
"use client";

import { DollarSign } from "lucide-react";
import { useTranslations } from "next-intl";
import { StrategyCard } from "@/features/strategies/components/StrategyCard";
import { Link } from "@/i18n/navigation";
import type { Strategy } from "@/lib/schemas";
import { formatUsd, formatUsdPrecise } from "@/lib/utils/format";
import { DiscoverCarousel } from "./DiscoverCarousel";
import { type EarningStep, EarningSteps } from "./EarningSteps";

/** Public props for {@link EmptyHome}. */
export interface EmptyHomeProps {
  /** Strategies to surface for discovery (the path out of the empty state). */
  discover: Strategy[];
  /**
   * Spendable balance the investor can put to work, in USD. A positive value renders the "funded"
   * variant; otherwise the brand-new "zero" variant. PP-INTEGRATION-POINT: sourced from a
   * spendable-balance service (POO-239); undefined for now, so production shows the zero state (R7).
   */
  availableToInvest?: number;
}

/** Available-to-invest readout. A bordered card on mobile; plain text in the desktop left column. */
function AvailableBlock({ amount, asCard }: { amount: number; asCard?: boolean }) {
  const t = useTranslations("home");
  return (
    <div
      className={asCard ? "w-full rounded-xl border border-border bg-surface p-4 text-left" : ""}
    >
      <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {t("empty.funded.available")}
      </p>
      <p className="mt-1 font-bold text-3xl text-foreground tabular-nums lg:text-4xl">
        {formatUsd(amount)}
      </p>
      <p className="mt-0.5 text-muted-foreground text-sm">{t("empty.funded.availableHint")}</p>
    </div>
  );
}

/** Primary gold CTA + secondary ghost link, shared by both layouts. */
function CtaGroup({
  ctaHref,
  ctaLabel,
  secondaryHref,
  secondaryLabel,
}: {
  ctaHref: string;
  ctaLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 lg:items-start">
      <Link
        href={ctaHref}
        className="w-full rounded-lg bg-primary px-6 py-3 text-center font-semibold text-primary-foreground transition-colors hover:bg-primary/90 lg:w-auto"
      >
        {ctaLabel}
      </Link>
      <Link
        href={secondaryHref}
        className="font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        {secondaryLabel}
      </Link>
    </div>
  );
}

/** Section heading with a "see all" link, local to the empty-state discover row. */
function DiscoverHeader({ title, seeAll }: { title: string; seeAll: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-semibold text-foreground text-lg">{title}</h2>
      <Link href="/strategies" className="text-muted-foreground text-sm hover:text-foreground">
        {seeAll}
      </Link>
    </div>
  );
}

/** The Home empty / first-run state. */
export function EmptyHome({ discover, availableToInvest }: EmptyHomeProps) {
  const t = useTranslations("home");
  const funded = typeof availableToInvest === "number" && availableToInvest > 0;
  const amount = availableToInvest ?? 0;

  // Step 1 (Add funds) is done once the wallet is funded; the next actionable step is gold (active),
  // later steps are outline (upcoming) [R9].
  const steps: EarningStep[] = [
    {
      number: 1,
      state: funded ? "done" : "active",
      title: t("empty.path.step1.title"),
      body: funded
        ? t("empty.funded.stepDone", { amount: formatUsdPrecise(amount, 0) })
        : t("empty.path.step1.body"),
    },
    {
      number: 2,
      state: funded ? "active" : "upcoming",
      title: t("empty.path.step2.title"),
      body: t("empty.path.step2.body"),
    },
    {
      number: 3,
      state: "upcoming",
      title: t("empty.path.step3.title"),
      body: t("empty.path.step3.body"),
    },
  ];

  const headline = funded ? t("empty.funded.title") : t("empty.zero.title");
  const subtitle = funded ? t("empty.funded.subtitle") : t("empty.zero.subtitle");
  const ctaLabel = funded ? t("empty.funded.cta") : t("empty.zero.cta");
  // Zero leads to the deposit onramp (add funds first); funded sends straight to strategies.
  const ctaHref = funded ? "/strategies" : "/deposit";
  const secondaryLabel = funded ? t("empty.funded.secondary") : t("empty.zero.secondary");
  // Funded "See how it works" -> Help (FAQ); zero "Explore strategies first" -> browse.
  const secondaryHref = funded ? "/profile/help" : "/strategies";

  const ctaProps = { ctaHref, ctaLabel, secondaryHref, secondaryLabel };

  return (
    <div className="flex flex-col gap-8 lg:gap-10">
      {/* Hero. Mobile and desktop render distinct layouts (the steps card sits between the lead and
          the CTA on mobile, but beside them on desktop), so each is rendered for its breakpoint. */}

      {/* Mobile: centered vertical stack. */}
      <section className="flex flex-col items-center gap-6 text-center lg:hidden">
        {funded ? (
          <AvailableBlock amount={amount} asCard />
        ) : (
          <span className="relative inline-flex" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
            <span className="relative flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <DollarSign className="size-7" strokeWidth={2.5} />
            </span>
          </span>
        )}
        <div>
          <h2 className="font-bold text-2xl text-foreground sm:text-3xl">{headline}</h2>
          <p className="mt-2 text-muted-foreground text-sm">{subtitle}</p>
        </div>
        <EarningSteps steps={steps} className="w-full" />
        <div className="w-full">
          <CtaGroup {...ctaProps} />
        </div>
      </section>

      {/* Desktop: two-column hero (lead + CTA on the left, steps card on the right). */}
      <section className="hidden lg:grid lg:grid-cols-2 lg:items-center lg:gap-10">
        <div className="flex flex-col items-start gap-5 text-left">
          {funded ? (
            <AvailableBlock amount={amount} />
          ) : (
            <p className="font-semibold text-primary text-xs uppercase tracking-wide">
              {t("empty.zero.eyebrow")}
            </p>
          )}
          <div>
            <h2 className="font-bold text-4xl text-foreground">{headline}</h2>
            <p className="mt-2 max-w-md text-base text-muted-foreground">{subtitle}</p>
          </div>
          <CtaGroup {...ctaProps} />
        </div>
        <EarningSteps steps={steps} heading={t("empty.path.heading")} />
      </section>

      {/* Discover strategies — somewhere to put funds to work. */}
      <section>
        <DiscoverHeader title={t("discover")} seeAll={t("seeAll")} />
        {/* Mobile: auto-advancing carousel. */}
        <div className="lg:hidden">
          <DiscoverCarousel strategies={discover} exploreLabel={t("exploreMore")} />
        </div>
        {/* Desktop: a 3-up card grid. */}
        <div className="hidden gap-4 lg:grid lg:grid-cols-3">
          {discover.slice(0, 3).map((strategy) => (
            <StrategyCard key={strategy.id} strategy={strategy} />
          ))}
        </div>
      </section>
    </div>
  );
}
