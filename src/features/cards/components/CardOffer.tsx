/**
 * @id PP-CARD-CMP-001
 * @name Card Offer
 * @implements-rules-version v1
 *
 * A partner card offer in the Explore marketplace (PP-CARD-SCR-001): a brand header (logo chip +
 * name + subtitle + status badge), the VirtualCard visual, the perk bullets, and a state-driven CTA.
 * `request` → "Request card" (primary; referral handoff to the partner), `activating` →
 * "Activating…" (disabled; already requested), `manage` → "Manage card" (owned → My cards). The
 * partner brand color is data (inline style on the chip + card face only); everything else is
 * token-driven.
 */
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import type { CardOffer as CardOfferData } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { VirtualCard } from "./VirtualCard";

/** Status pill tone per offer badge. */
const BADGE_CLASS: Record<NonNullable<CardOfferData["badge"]>, string> = {
  popular: "bg-primary/15 text-primary",
  requested: "bg-warning/15 text-warning",
  active: "bg-success/15 text-success",
};

/** Card border emphasis per offer badge (`popular` highlights, `active` greens, else neutral). */
const BORDER_CLASS: Record<"default" | NonNullable<CardOfferData["badge"]>, string> = {
  default: "border-border",
  popular: "border-primary",
  requested: "border-border",
  active: "border-success",
};

/** Public props for {@link CardOffer}. */
export interface CardOfferProps {
  /** The partner offer to render. */
  offer: CardOfferData;
  /** Called when the user requests this card (referral handoff). */
  onRequest: (partnerId: string) => void;
  /** Called when the user manages an owned card (→ My cards). */
  onManage: () => void;
}

/** A single partner card offer. */
export function CardOffer({ offer, onRequest, onManage }: CardOfferProps) {
  const t = useTranslations("cards");
  // Literal t() calls (not dynamic keys) so the i18n used-key scan resolves every label.
  const badgeLabels = {
    popular: t("explore.badge.popular"),
    requested: t("explore.badge.requested"),
    active: t("explore.badge.active"),
  } as const;

  return (
    <div
      className={cn(
        "flex h-full flex-col gap-4 rounded-xl border bg-surface p-4",
        BORDER_CLASS[offer.badge ?? "default"],
      )}
    >
      {/* Brand header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg font-semibold text-sm text-white"
            style={{ backgroundColor: offer.brandColor }}
          >
            {offer.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{offer.name}</p>
            <p className="truncate text-muted-foreground text-xs">{offer.subtitle}</p>
          </div>
        </div>
        {offer.badge ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-medium text-xs",
              BADGE_CLASS[offer.badge],
            )}
          >
            {badgeLabels[offer.badge]}
          </span>
        ) : null}
      </div>

      <VirtualCard brand={offer.name} network={offer.network} brandColor={offer.brandColor} />

      {/* Perks. Each `perk` is a `cards`-namespace i18n key carried in the offer data (e.g.
          `explore.perks.noAnnualFee`), resolved here so the bullets localize. The computed key is
          invisible to the i18n:check used-key scan (it binds only string-literal keys), same as
          SettingsLayout; the keys live under cards.explore.perks in every locale. */}
      <ul className="flex flex-col gap-2">
        {offer.perks.map((perk) => (
          <li key={perk} className="flex items-start gap-2 text-foreground text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span>{t(perk)}</span>
          </li>
        ))}
      </ul>

      {/* State-driven CTA (one per card; gold "Request" per the explore-list exception) */}
      <div className="mt-auto pt-1">
        {offer.ctaState === "manage" ? (
          <Button variant="secondary" className="w-full" onClick={onManage}>
            {t("explore.cta.manage")}
          </Button>
        ) : offer.ctaState === "activating" ? (
          <Button variant="secondary" className="w-full" disabled>
            {t("explore.cta.activating")}
          </Button>
        ) : (
          <Button className="w-full" onClick={() => onRequest(offer.partnerId)}>
            {t("explore.cta.request")}
          </Button>
        )}
      </div>
    </div>
  );
}
