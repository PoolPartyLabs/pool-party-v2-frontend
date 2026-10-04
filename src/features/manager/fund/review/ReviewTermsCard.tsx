/**
 * @id PP-MGR-CMP-075 (POO-2188)
 * @name ReviewTermsCard
 * @implements-rules-version v1
 * @analytics-events none: the Review page emits field events.
 * @i18n-namespace manager
 * Immutable investor terms and the separately sourced protocol flow fee.
 */
"use client";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils/cn";
import { FeeStepper, type FeeStepperProps } from "./ReviewFeesCard";
import { bpsToPercentText, normalizeUsdcInput, sanitizeUsdcInput } from "./reviewForm";
export interface ReviewTermsCardProps {
  /** Decimal USDC minimum. */ minimum: string;
  /** Instant withdrawal fee in basis points. */ payoutFeeBps: number;
  /** Flow rate provenance from the headless Review hook. */ feeConfiguration: {
    flowFeeBps: number;
    flowSource: "fallback" | "fund-detail";
  };
  /** Receives sanitized USDC text. */ onMinimumChange: (value: string) => void;
  /** Receives bounded percent text. */ onFeePercentChange: FeeStepperProps["onChange"];
  /** Translated minimum reason. */ minimumError?: string;
  /** Translated instant-fee reason. */ payoutError?: string;
  /** Additional classes. */ className?: string;
}
export function ReviewTermsCard({
  minimum,
  payoutFeeBps,
  feeConfiguration,
  onMinimumChange,
  onFeePercentChange,
  minimumError,
  payoutError,
  className,
}: ReviewTermsCardProps) {
  const t = useTranslations("manager.fundBuilder.review");
  const locale = useLocale();
  const [text, setText] = useState(minimum);
  useEffect(() => setText(minimum), [minimum]);
  const fee = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    Number(bpsToPercentText(feeConfiguration.flowFeeBps)),
  );
  return (
    <Card className={cn("flex flex-col gap-4 rounded-[20px] p-4", className)}>
      <div>
        <h3 className="text-sm font-medium">{t("termsTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("termsCaption")}</p>
      </div>
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label htmlFor="review-minimum" className="text-sm font-medium">
              {t("minimumLabel")}
            </label>
            <p className="mt-1 text-xs text-muted-foreground">{t("minimumHelp")}</p>
          </div>
          <div className="relative w-44 shrink-0">
            <Input
              id="review-minimum"
              aria-label={t("minimumLabel")}
              inputMode="decimal"
              value={text}
              className="rounded-xl pr-14 text-right font-mono tabular-nums"
              error={minimumError}
              onChange={(event) => {
                const next = sanitizeUsdcInput(event.target.value);
                setText(next);
                onMinimumChange(next);
              }}
              onBlur={() => {
                const next = normalizeUsdcInput(text);
                setText(next);
                onMinimumChange(next);
              }}
            />
            <span className="pointer-events-none absolute right-3 top-3 text-xs text-muted-foreground">
              USDC
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <label htmlFor="review-payoutFeeBps" className="text-sm font-medium">
            {t("instantLabel")}
          </label>
          <p className="mt-1 text-xs text-muted-foreground">{t("instantHelp")}</p>
        </div>
        <FeeStepper
          field="payoutFeeBps"
          value={payoutFeeBps}
          label={t("instantLabel")}
          onChange={onFeePercentChange}
          error={payoutError}
        />
      </div>
      <div className="flex justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium">{t("accessLabel")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("accessHelp")}</p>
        </div>
        <span className="text-sm">{t("public")}</span>
      </div>
      <div className="border-t border-border pt-4 text-xs text-muted-foreground">
        <p>{t("flowFee", { fee })}</p>
        {feeConfiguration.flowSource === "fallback" && (
          <p className="mt-1 font-medium">{t("estimatedRate")}</p>
        )}
      </div>
    </Card>
  );
}
