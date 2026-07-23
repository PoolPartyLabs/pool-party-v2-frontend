/**
 * @id PP-STR-MOD-009
 * @name ShareYieldModal
 * @implements-rules-version v2 (POO-906 rules v1)
 *
 * The share-yield modal (POO-275): opens from Share on the Owned strategy detail and lets the
 * investor flex the dollar amount earned (fees + yield) over a selectable window. Renders a
 * bottom-sheet on mobile and a centered dialog on desktop (same Radix composition as the wallet
 * modal, PP-CORE-MOD-005). Anatomy per Figma 5835:131 / 5837:183: title + close, 24H / 7D / 30D
 * segmented selector (default 30d [R2]), live Yield Receipt preview, share targets
 * (X / Telegram / WhatsApp / Instagram / Save) and the single gold "Copy referral link" CTA.
 *
 * Business rules: POO-275 [R1-R6]. Switching the period re-binds the earned amount and the PERIOD
 * row [R2]; the link everywhere is the user's referral link [R3]; Save exports the 1080x1080 PNG
 * [R5]; a negative window renders the LOSS card [R6]. Share targets use the official brand marks
 * (the Figma frames carry Lucide placeholders to be swapped at build time).
 *
 * POO-906: copy and every share target carry the FULL untruncated url ([R2]; only the card's
 * rendered text is shortened). On a file-capable Web Share platform (feature-detected via
 * `navigator.canShare({ files })`, [R4]) the social buttons attach the generated PNG + message +
 * full url to the native sheet; desktop keeps the text intent urls — X/Telegram/WhatsApp intents
 * accept no file, a documented platform limitation. Export failures surface as inline feedback +
 * a `strategy_share_export_failed` event, never a silent no-op [R5].
 */
"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy, Download, X as XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import type { PositionEarnings, SharePeriod } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { formatSignedUsd } from "@/lib/utils/format";
import { exportYieldReceiptPng } from "../lib/yieldReceiptPng";
import { YieldReceiptCard } from "./YieldReceiptCard";

/** Download / share filename of the exported receipt. */
const SHARE_FILE_NAME = "pool-party-yield-receipt.png";

/**
 * Whether the platform can attach FILES to the native share sheet (POO-906 [R4]), probed with a
 * tiny empty file — never the real export, since this answer gates whether the PNG is generated
 * at all. Desktop browsers without file support fall back to the text intent urls.
 */
function canShareFiles(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
    return false;
  }
  const probe = new File([""], SHARE_FILE_NAME, { type: "image/png" });
  return navigator.canShare({ files: [probe] });
}

/** A dismissed native share sheet: the user's choice, neither an error nor a share. */
function isShareDismissal(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** The selectable windows, in display order (Figma: 24H | 7D | 30D). */
const PERIODS: SharePeriod[] = ["24h", "7d", "30d"];

/** External share destinations (Save is handled separately). */
type ShareTarget = "x" | "telegram" | "whatsapp" | "instagram";

/** Public props for {@link ShareYieldModal}. Presentational; data is injected. */
export interface ShareYieldModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Open-state change handler (scrim, Esc, close button). */
  onOpenChange: (open: boolean) => void;
  /** Strategy id (analytics dimension). */
  strategyId: string;
  /** Strategy display name. */
  strategyName: string;
  /** Localized risk label for the card (e.g. "Conservative"). */
  riskLabel: string;
  /** Net earned amounts per period, in USD (negative = loss). */
  earnings: PositionEarnings;
  /** The user's referral link, e.g. `app.pool-party.xyz?ref=maria2026` [R3]. */
  referralLink: string;
}

/** Official brand marks (filled, currentColor) for the share targets. */
function BrandIcon({ path, viewBox = "0 0 24 24" }: { path: string; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} className="size-5 fill-current" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

/**
 * One share-target button (icon circle + label). Module-level on purpose: defining it inside the
 * modal's render would mint a new component type per render, remounting all five targets (and
 * dropping keyboard focus) on every state change — the wallet-modal helpers follow this pattern.
 */
function Target({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-surface-raised">
        {children}
      </span>
      <span className="text-xs">{label}</span>
    </button>
  );
}

const BRAND_PATHS: Record<ShareTarget, string> = {
  x: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  telegram:
    "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  whatsapp:
    "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z",
  instagram:
    "M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06zm0 3.678a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 1 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z",
};

/** Build the destination intent URL for an external target. */
export function shareIntentUrl(
  target: Exclude<ShareTarget, "instagram">,
  message: string,
  url: string,
): string {
  switch (target) {
    case "x":
      return `https://x.com/intent/post?text=${encodeURIComponent(`${message} ${url}`)}`;
    case "telegram":
      return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`;
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`;
  }
}

/** The share-yield modal. See {@link ShareYieldModalProps}. */
export function ShareYieldModal({
  open,
  onOpenChange,
  strategyId,
  strategyName,
  riskLabel,
  earnings,
  referralLink,
}: ShareYieldModalProps) {
  const t = useTranslations("strategies");
  const { track } = useAnalytics();
  const [period, setPeriod] = useState<SharePeriod>("30d");
  const [copied, setCopied] = useState(false);
  // POO-906 [R5]: a failed PNG export / share surfaces inline, never a silent no-op.
  const [shareError, setShareError] = useState(false);

  const amount = earnings[period];
  const shareUrl = referralLink.startsWith("http") ? referralLink : `https://${referralLink}`;
  const message = t("share.message", { amount: formatSignedUsd(amount), strategy: strategyName });
  const periodTexts: Record<SharePeriod, string> = {
    "24h": t("share.card.period24h"),
    "7d": t("share.card.period7d"),
    "30d": t("share.card.period30d"),
  };
  const periodTabLabels: Record<SharePeriod, string> = {
    "24h": t("share.periods.24h"),
    "7d": t("share.periods.7d"),
    "30d": t("share.periods.30d"),
  };

  // Reset transient state so the modal reopens on the defaults (period 30d [R2]).
  function handleOpenChange(next: boolean) {
    if (!next) {
      setPeriod("30d");
      setCopied(false);
      setShareError(false);
    }
    onOpenChange(next);
  }

  function selectPeriod(next: SharePeriod) {
    if (next === period) return;
    setPeriod(next);
    track("strategy_share_period_changed", { strategy_id: strategyId, share_period: next });
  }

  /** Export the receipt PNG for the CURRENT period (throws on failure, POO-906 [R5]). */
  async function exportPng(): Promise<Blob> {
    return exportYieldReceiptPng({
      strategyName,
      riskLabel,
      amountText: formatSignedUsd(amount),
      isGain: amount >= 0,
      periodText: periodTexts[period],
      kicker: t("share.card.kicker"),
      earnedIn: t("share.card.earnedIn"),
      strategyLabel: t("share.card.strategyLabel"),
      periodLabel: t("share.card.periodLabel"),
      invite: t("share.card.invite"),
      referralLink,
    });
  }

  /**
   * The native-sheet payload: message + FULL url ([R2]), plus the PNG when the platform attaches
   * files ([R4]). A failed export is tracked and degrades to the file-less payload — the share
   * still carries the text and full link, never a dead click.
   */
  async function nativeSharePayload(target: ShareTarget): Promise<ShareData> {
    const base: ShareData = { text: message, url: shareUrl };
    if (!canShareFiles()) return base;
    try {
      const file = new File([await exportPng()], SHARE_FILE_NAME, { type: "image/png" });
      return { ...base, files: [file] };
    } catch {
      track("strategy_share_export_failed", {
        strategy_id: strategyId,
        share_target: target,
        share_period: period,
      });
      return base;
    }
  }

  async function openTarget(target: Exclude<ShareTarget, "instagram">) {
    setShareError(false);
    // POO-906 [R4]: a file-capable platform (mobile) gets the native sheet with the PNG attached.
    // The PNG must be exported BEFORE navigator.share, so on platforms that drop the user
    // activation across that await the call rejects — caught below, falling through to the text
    // intent with the full link (the documented desktop path: intents accept no file).
    if (canShareFiles()) {
      try {
        await navigator.share(await nativeSharePayload(target));
        track("strategy_share_target_clicked", {
          strategy_id: strategyId,
          share_target: target,
          share_period: period,
        });
        return;
      } catch (error) {
        if (isShareDismissal(error)) return;
        // Hard share failure: fall through to the intent url (text + FULL link [R2]).
      }
    }
    window.open(shareIntentUrl(target, message, shareUrl), "_blank", "noopener,noreferrer");
    track("strategy_share_target_clicked", {
      strategy_id: strategyId,
      share_target: target,
      share_period: period,
    });
  }

  async function shareInstagram() {
    setShareError(false);
    // Instagram has no web share intent: prefer the native share sheet (with the PNG attached on
    // a file-capable platform [R4]), else copy the message + full link.
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share(await nativeSharePayload("instagram"));
      } else {
        await navigator.clipboard.writeText(`${message} ${shareUrl}`);
      }
      track("strategy_share_target_clicked", {
        strategy_id: strategyId,
        share_target: "instagram",
        share_period: period,
      });
    } catch (error) {
      if (isShareDismissal(error)) return;
      // No intent fallback exists for Instagram: surface the failure inline [R5].
      setShareError(true);
    }
  }

  async function saveCard() {
    setShareError(false);
    try {
      const blob = await exportPng();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = SHARE_FILE_NAME;
      anchor.click();
      URL.revokeObjectURL(url);
      track("strategy_share_card_saved", {
        strategy_id: strategyId,
        share_target: "save",
        share_period: period,
      });
    } catch {
      // POO-906 [R5]: never a silent no-op — inline feedback + analytics.
      setShareError(true);
      track("strategy_share_export_failed", {
        strategy_id: strategyId,
        share_target: "save",
        share_period: period,
      });
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      track("strategy_share_link_copied", { strategy_id: strategyId, share_period: period });
    } catch {
      // clipboard unavailable (insecure context / unsupported)
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col gap-4 overflow-y-auto",
            "rounded-t-3xl border-border border-t bg-surface p-5 pb-7 text-foreground",
            "focus-visible:outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[26rem]",
            "sm:max-h-[85vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border sm:p-6",
          )}
        >
          {/* Sheet grabber (mobile only) */}
          <div
            aria-hidden="true"
            className="mx-auto h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40 sm:hidden"
          />

          <div className="flex items-center justify-between">
            <DialogPrimitive.Title className="font-semibold text-foreground text-xl">
              {t("share.title")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t("share.close")}
              className="flex size-8 items-center justify-center rounded-full bg-surface-raised text-muted-foreground transition-colors hover:text-foreground"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          {/* Period selector [R2]: 24H / 7D / 30D, default 30d, gold active segment */}
          <fieldset className="flex rounded-xl bg-surface-raised p-[3px]">
            <legend className="sr-only">{t("share.periodGroup")}</legend>
            {PERIODS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => selectPeriod(value)}
                className={cn(
                  "h-9 flex-1 rounded-[10px] font-medium text-sm transition-colors",
                  period === value
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {periodTabLabels[value]}
              </button>
            ))}
          </fieldset>

          {/* Live card preview: amount + PERIOD row re-bind on selection [R2] */}
          <YieldReceiptCard
            strategyName={strategyName}
            riskLabel={riskLabel}
            amountUsd={amount}
            period={period}
            referralLink={referralLink}
          />

          {/* Share targets */}
          <div className="flex items-start justify-center gap-4">
            <Target label="X" onClick={() => openTarget("x")}>
              <BrandIcon path={BRAND_PATHS.x} />
            </Target>
            <Target label="Telegram" onClick={() => openTarget("telegram")}>
              <BrandIcon path={BRAND_PATHS.telegram} />
            </Target>
            <Target label="WhatsApp" onClick={() => openTarget("whatsapp")}>
              <BrandIcon path={BRAND_PATHS.whatsapp} />
            </Target>
            <Target label="Instagram" onClick={shareInstagram}>
              <BrandIcon path={BRAND_PATHS.instagram} />
            </Target>
            <Target label={t("share.save")} onClick={saveCard}>
              <Download className="size-5" aria-hidden="true" />
            </Target>
          </div>

          {/* POO-906 [R5]: a failed export / share is surfaced, never a silent no-op */}
          {shareError ? (
            <p role="alert" className="text-center text-destructive text-xs">
              {t("share.exportError")}
            </p>
          ) : null}

          {/* The single gold CTA (policy P1): copy the referral link [R3] */}
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground text-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? t("share.copied") : t("share.copyCta")}
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
