/**
 * @id PP-STR-CMP-006
 * @name YieldReceiptCard
 * @implements-rules-version v2 (POO-906 rules v1)
 *
 * The "Yield Receipt" share card (POO-275): a square, ticket-styled social artifact that flexes
 * the dollar amount a position earned (fees + yield) over one period. Privacy rule [R1]: the card
 * shows ONLY the earned amount for the period, never a percentage and never invested / current
 * values (a percent next to a dollar amount would let viewers compute the principal). A negative
 * amount renders the LOSS treatment: same layout, red number [R6].
 *
 * POO-906 [R1]: the referral link renders in a SHORTENED display form ({@link truncateDisplayLink}:
 * long path segments middle-truncated, host and the full `?ref=` kept), on a single line, no wrap.
 * Only the rendered text is shortened — copy and every share target carry the full url [R2]
 * (the shortening lives here and in the PNG painter, never in the share payload builders).
 *
 * This DOM render is the in-app preview; the shareable 1080x1080 PNG is drawn by
 * `yieldReceiptPng.ts` with the same data. Ticket chrome colors are locked brand values from the
 * Figma component (5888:522), intentionally independent of the app theme; the amount uses the
 * success / destructive tokens (same hexes as the Figma accent/green / accent/red variables).
 */
import { useTranslations } from "next-intl";
import type { SharePeriod } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { formatSignedUsd } from "@/lib/utils/format";

/** Public props for {@link YieldReceiptCard}. */
export interface YieldReceiptCardProps {
  /** Strategy display name (STRATEGY row + headline). */
  strategyName: string;
  /** Localized risk label shown under the strategy name (e.g. "Conservative"). */
  riskLabel: string;
  /** Net earned amount for the period, in USD. Negative renders the loss treatment. */
  amountUsd: number;
  /** The selected earnings window (drives the PERIOD row). */
  period: SharePeriod;
  /** The user's referral link, e.g. `app.pool-party.xyz?ref=MARIA2026` [R3]. */
  referralLink: string;
}

/** Deterministic barcode bar widths (decorative, mirrors the Figma vector strip). */
export const BARCODE_PATTERN = [
  3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 3, 1, 4, 2, 3, 1, 2, 1, 3, 2, 1, 4, 1, 2, 3, 1,
] as const;

/** Path segments longer than this are shortened on the DISPLAYED link (POO-906 [R1]). */
const MAX_SEGMENT_CHARS = 10;
/** How much of a long path segment's head survives before the ellipsis. */
const SEGMENT_HEAD_CHARS = 6;

/**
 * The SHORTENED display form of a share link (POO-906 [R1]): scheme stripped, host kept, each long
 * path segment middle-truncated to its head + `...` (a 42-char strategy address becomes `0x357d...`),
 * and the query — the `?ref=<code>` attribution — kept in full. Display-only: copy and every share
 * target always carry the full url [R2]. Shared by this DOM preview and the PNG painter so both
 * render the identical string; an unparseable input returns verbatim (render something, never throw).
 */
export function truncateDisplayLink(link: string): string {
  const absolute = /^https?:\/\//.test(link) ? link : `https://${link}`;
  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return link;
  }
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.length > MAX_SEGMENT_CHARS ? `${segment.slice(0, SEGMENT_HEAD_CHARS)}...` : segment,
    );
  const path = segments.length > 0 ? `/${segments.join("/")}` : "";
  return `${url.host}${path}${url.search}`;
}

/** A dashed ticket divider with the side perforation notches. */
function TicketDivider() {
  return (
    <div className="relative -mx-7 flex items-center" aria-hidden="true">
      <span className="-left-2 absolute size-4 rounded-full bg-[#0c0c0e]" />
      <span className="mx-4 w-full border-[#3a3a3a] border-t border-dashed" />
      <span className="-right-2 absolute size-4 rounded-full bg-[#0c0c0e]" />
    </div>
  );
}

/** The Yield Receipt share card preview. See {@link YieldReceiptCardProps}. */
export function YieldReceiptCard({
  strategyName,
  riskLabel,
  amountUsd,
  period,
  referralLink,
}: YieldReceiptCardProps) {
  const t = useTranslations("strategies");
  const isGain = amountUsd >= 0;
  const periodLabels: Record<SharePeriod, string> = {
    "24h": t("share.card.period24h"),
    "7d": t("share.card.period7d"),
    "30d": t("share.card.period30d"),
  };

  return (
    <div
      data-testid="yield-receipt-card"
      className="flex aspect-square w-full flex-col items-center justify-center rounded-2xl bg-[#0c0c0e] p-5"
    >
      <div className="flex w-full max-w-[19rem] flex-col gap-2.5 rounded-xl bg-[#1f1f1f] px-7 py-5">
        {/* Brand lockup + kicker */}
        <div className="flex items-center justify-center gap-1.5">
          {/* biome-ignore lint/performance/noImgElement: tiny decorative brand mark (same asset + pattern as AppShell) */}
          <img
            src="/brand/duck-head.png"
            alt=""
            aria-hidden="true"
            className="size-6 object-contain"
          />
          <span className="font-semibold text-[#efefef] text-sm">Pool Party</span>
        </div>
        <p className="text-center text-[9px] text-[#a3a3a3] uppercase tracking-[0.3em]">
          {t("share.card.kicker")}
        </p>

        <TicketDivider />

        {/* Strategy identity */}
        <div className="text-center">
          <p className="font-semibold text-base text-white">{strategyName}</p>
          <p className="text-[#a3a3a3] text-xs">{riskLabel}</p>
        </div>

        {/* Hero amount: the ONLY figure on the card [R1] */}
        <p
          className={cn(
            "text-center font-bold text-4xl tracking-tight",
            isGain ? "text-success" : "text-destructive",
          )}
        >
          {formatSignedUsd(amountUsd)}
        </p>
        <p className="text-center text-[#a3a3a3] text-xs">{t("share.card.earnedIn")}</p>

        {/* STRATEGY / PERIOD rows */}
        <div className="flex items-start justify-between gap-3 text-left">
          <div className="min-w-0">
            <p className="text-[8px] text-[#a3a3a3] uppercase tracking-[0.2em]">
              {t("share.card.strategyLabel")}
            </p>
            <p className="truncate font-semibold text-white text-xs">{strategyName}</p>
          </div>
          <div className="text-right">
            <p className="text-[8px] text-[#a3a3a3] uppercase tracking-[0.2em]">
              {t("share.card.periodLabel")}
            </p>
            <p className="font-semibold text-white text-xs">{periodLabels[period]}</p>
          </div>
        </div>

        <TicketDivider />

        {/* Referral call + link [R3]: always "Invest with me", never advice phrasing.
            POO-906 [R1]: shortened display form, single line, no wrap — full-bleed like the ticket
            dividers so the longest realistic host + code still fits; overflow-hidden guards the
            pathological case without ever wrapping. */}
        <p className="text-center font-semibold text-[9px] text-primary uppercase tracking-[0.25em]">
          {t("share.card.invite")}
        </p>
        <p className="-mx-4 overflow-hidden whitespace-nowrap text-center font-bold text-[9px] text-white tracking-tight">
          {truncateDisplayLink(referralLink)}
        </p>

        {/* Decorative barcode stub */}
        <div className="mt-0.5 flex h-6 items-stretch justify-center gap-px" aria-hidden="true">
          {BARCODE_PATTERN.map((width, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: static decorative pattern
              key={index}
              className="bg-primary/85"
              style={{ width: `${width}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
