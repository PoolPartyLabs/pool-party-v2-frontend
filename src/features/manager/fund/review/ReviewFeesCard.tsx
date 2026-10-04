/**
 * @id PP-MGR-CMP-074 (POO-2188)
 * @name ReviewFeesCard
 * @implements-rules-version v1
 * @analytics-events none: the Review page emits field events.
 * @i18n-namespace manager
 * Bounded management and performance fees, committed only after clamping.
 */
"use client";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils/cn";
import {
  bpsToPercentText,
  canStepFee,
  commitFeeInput,
  type FeeField,
  sanitizeFeeInput,
  stepFee,
} from "./reviewForm";

export interface FeeStepperProps {
  /** Contract fee field. */ field: FeeField;
  /** Stored basis points. */ value: number;
  /** Accessible translated label. */ label: string;
  /** Already translated field error. */ error?: string;
  /** Receives bounded percent text accepted by setFeePercent. */ onChange: (
    field: FeeField,
    value: string,
  ) => void;
}
export function FeeStepper({ field, value, label, error, onChange }: FeeStepperProps) {
  const t = useTranslations("manager.fundBuilder.review");
  const [text, setText] = useState(bpsToPercentText(value));
  useEffect(() => setText(bpsToPercentText(value)), [value]);
  const commit = () => {
    const next = commitFeeInput(field, text);
    setText(next ?? bpsToPercentText(value));
    if (next !== null) onChange(field, next);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-11 w-36 items-center rounded-xl border border-border bg-input">
        <button
          type="button"
          className="h-full w-9 shrink-0 rounded-l-xl focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"
          aria-label={t("decrease", { field: label })}
          disabled={!canStepFee(field, value, -1)}
          onClick={() => {
            const next = stepFee(field, value, -1);
            setText(next);
            onChange(field, next);
          }}
        >
          <Minus className="mx-auto size-4" aria-hidden="true" />
        </button>
        <input
          id={`review-${field}`}
          aria-label={label}
          aria-invalid={!!error}
          aria-describedby={error ? `review-${field}-error` : undefined}
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(sanitizeFeeInput(event.target.value))}
          onBlur={commit}
          className="w-full min-w-0 bg-transparent text-center font-mono text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-sm" aria-hidden="true">
          %
        </span>
        <button
          type="button"
          className="h-full w-9 shrink-0 rounded-r-xl focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"
          aria-label={t("increase", { field: label })}
          disabled={!canStepFee(field, value, 1)}
          onClick={() => {
            const next = stepFee(field, value, 1);
            setText(next);
            onChange(field, next);
          }}
        >
          <Plus className="mx-auto size-4" aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p id={`review-${field}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export interface ReviewFeesCardProps {
  /** Stored performance fee. */ performanceFeeBps: number;
  /** Stored annual management fee. */ managementFeeBps: number;
  /** Bounded percent text for the parent hook. */ onFeePercentChange: FeeStepperProps["onChange"];
  /** Field-specific translated validation errors. */ errors?: Partial<Record<FeeField, string>>;
  /** Additional layout classes. */ className?: string;
}
export function ReviewFeesCard({
  performanceFeeBps,
  managementFeeBps,
  onFeePercentChange,
  errors,
  className,
}: ReviewFeesCardProps) {
  const t = useTranslations("manager.fundBuilder.review");
  return (
    <Card className={cn("flex flex-col gap-4 rounded-[20px] p-4", className)}>
      <div>
        <h3 className="text-sm font-medium">{t("feesTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("feesCaption")}</p>
      </div>
      {(
        [
          {
            field: "performanceFeeBps",
            value: performanceFeeBps,
            label: "performanceLabel",
            help: "performanceHelp",
          },
          {
            field: "managementFeeBps",
            value: managementFeeBps,
            label: "managementLabel",
            help: "managementHelp",
          },
        ] as const
      ).map((row, index) => (
        <div
          key={row.field}
          className={cn(
            "flex items-start justify-between gap-4",
            index > 0 && "border-t border-border pt-4",
          )}
        >
          <div className="min-w-0">
            <label htmlFor={`review-${row.field}`} className="text-sm font-medium">
              {t(row.label)}
            </label>
            <p className="mt-1 text-xs text-muted-foreground">{t(row.help)}</p>
          </div>
          <FeeStepper
            field={row.field}
            value={row.value}
            label={t(row.label)}
            onChange={onFeePercentChange}
            error={errors?.[row.field]}
          />
        </div>
      ))}
    </Card>
  );
}
