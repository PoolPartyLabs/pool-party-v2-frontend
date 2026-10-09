/**
 * @id PP-MGR-CMP-076 (POO-2188)
 * @name ReviewFirstDepositCard
 * @implements-rules-version v1
 * @implements-rules-version v1 (POO-2301 local intent presentation)
 * @analytics-events none: the Review page emits field events.
 * @i18n-namespace manager
 * Precise USDC seed input, field reasons and pre-signing whole-share estimates.
 */
"use client";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils/cn";
import {
  formatShares,
  formatUsdc,
  normalizeUsdcInput,
  parseUsdc,
  REVIEW_REASON_KEYS,
  type SeedPreview,
  sanitizeUsdcInput,
  seedReason,
} from "./reviewForm";
export interface ReviewFirstDepositCardProps {
  /** Editable seed intention without wallet reads, signing or an initial share price. */ localVisual?: boolean;
  /** Reports an attempt to use unavailable Max. */ onMaxBlocked?: () => void;
  /** Typed decimal USDC amount. */ seed: string;
  /** Decimal minimum first deposit. */ minimum: string;
  /** Raw wallet USDC, null until read. */ balance: bigint | null;
  /** Estimate from the headless hook; never a confirmed receipt. */ preview: SeedPreview | null;
  /** Sanitized seed edits. */ onSeedChange: (value: string) => void;
  /** Parent fills the verified wallet balance. */ onMax: () => void;
  /** Optional parent-supplied translated reason. */ error?: string;
  /** Additional classes. */ className?: string;
}
export function ReviewFirstDepositCard({
  seed,
  minimum,
  balance,
  preview,
  onSeedChange,
  onMax,
  error,
  className,
  localVisual = false,
  onMaxBlocked,
}: ReviewFirstDepositCardProps) {
  const t = useTranslations("manager.fundBuilder.review");
  const all = useTranslations("manager");
  const locale = useLocale();
  const unavailable = all("solanaPreview.marketUnavailable");
  const reason = seedReason({
    seed,
    minimum,
    balance: localVisual ? null : balance,
    preview: localVisual ? null : preview,
  });
  const message =
    error ??
    (reason && !(localVisual && reason === "balanceUnread")
      ? all(REVIEW_REASON_KEYS[reason])
      : undefined);
  const min = parseUsdc(minimum);
  return (
    <Card className={cn("flex flex-col gap-4 rounded-[20px] p-4", className)}>
      <div>
        <h3 className="text-sm font-medium">{t("firstDepositTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {localVisual ? unavailable : t("firstDepositCaption")}
        </p>
      </div>
      <div aria-live="polite" className="flex items-center justify-end gap-2 text-xs">
        <span className="text-muted-foreground">{t("balance")}</span>
        <span className="font-mono tabular-nums">
          {localVisual
            ? unavailable
            : balance === null
              ? t("unavailable")
              : `${formatUsdc(balance, locale)} USDC`}
        </span>
        {localVisual ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 font-medium text-primary"
            blocked
            onBlockedClick={onMaxBlocked}
          >
            {t("max")}
          </Button>
        ) : (
          <button
            type="button"
            className="font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
            onClick={onMax}
            disabled={balance === null}
          >
            {t("max")}
          </button>
        )}
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2">
          <Image src="/tokens/usdc.png" alt="" width={24} height={24} className="size-6" />
          <span className="text-sm">USDC</span>
        </div>
        <Input
          id="review-seed"
          aria-label={t("seedLabel")}
          inputMode="decimal"
          value={seed}
          size="lg"
          className="h-14 rounded-xl pl-28 text-right font-mono text-xl tabular-nums"
          error={message}
          onChange={(event) => onSeedChange(sanitizeUsdcInput(event.target.value))}
          onBlur={() => onSeedChange(normalizeUsdcInput(seed))}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {localVisual
          ? unavailable
          : t("seedHelp", { minimum: min === null ? t("unavailable") : formatUsdc(min, locale) })}
      </p>
      {!localVisual && preview && (
        <div aria-live="polite" className="rounded-xl bg-surface-raised p-3">
          <h4 className="mb-2 text-xs font-medium">{t("previewTitle")}</h4>
          <dl className="space-y-2 text-xs">
            {(
              [
                { key: "previewFee", value: `${formatUsdc(preview.fee, locale)} USDC` },
                { key: "previewShares", value: formatShares(preview.shares, locale) },
                { key: "previewCharged", value: `${formatUsdc(preview.charged, locale)} USDC` },
                { key: "previewRemainder", value: `${formatUsdc(preview.remainder, locale)} USDC` },
              ] as const
            ).map((row) => (
              <div key={row.key} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t(row.key)}</dt>
                <dd className="text-right font-mono tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t("previewHelp")}</p>
        </div>
      )}
    </Card>
  );
}
