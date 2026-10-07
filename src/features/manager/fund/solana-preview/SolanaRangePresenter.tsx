/**
 * @id PP-MGR-CMP-095
 * @name SolanaRangePresenter
 * @implements-rules-version v1 (POO-2291)
 * @i18n-namespace manager.solanaPreview, manager.fundBuilder.canvas.panel
 * @analytics-events none, host owns edit/blocked intents; this presenter cannot execute
 * Canonical protocol ticks remain separate from the position's current range and display orientation.
 * PP-INTEGRATION-POINT: POO-2240/2261 supply verified pool, mint, grid, fees and Q64 snapshot;
 * missing production context remains unavailable. Composition requires its own verified quote.
 */
"use client";
import Decimal from "decimal.js";
import { ArrowLeftRight, Minus, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { sanitizeNumericInput } from "@/lib/utils/numericInput";
import { PANEL_FOCUS_RING } from "../build/panel/panelStyles";
import {
  currentSolanaPrice,
  displaySolanaRange,
  inspectSolanaRangeContext,
  presetSolanaRange,
  SOLANA_RANGE_INPUT_MAX_LENGTH,
  type SolanaRangeContext,
  type SolanaRangeDraft,
  snapSolanaRangePrice,
  solanaRangeStatus,
  stepSolanaRange,
  validateSolanaRange,
} from "./solanaRangeModel";

export interface SolanaRangePresenterProps {
  /** Verified same-snapshot protocol context, or null when the live integration is absent. */
  context: SolanaRangeContext | null;
  /** Canonical local draft ticks, independent of the current position. Null has no seeded fallback. */
  range: SolanaRangeDraft | null;
  /** Reports local draft edits; no signing or RPC operation is exposed. */
  onChange(range: SolanaRangeDraft): void;
  /** Optional bounded invalid-input intent for the host's existing analytics taxonomy. */
  onInvalid?(reason: string): void;
  /** A host without a draft change handler can display verified values without silent edits. */
  readOnly?: boolean;
  className?: string;
}
export function SolanaRangePresenter({
  context: input,
  range,
  onChange,
  onInvalid,
  readOnly = false,
  className,
}: SolanaRangePresenterProps) {
  const t = useTranslations("manager.solanaPreview");
  const inspected = inspectSolanaRangeContext(input);
  if (!inspected.context || !range)
    return (
      <div
        className={cn("text-muted-foreground text-sm", className)}
        data-solana-range="unavailable"
      >
        <p role="status">{t("marketUnavailable")}</p>
      </div>
    );
  // Any changed canonical context discards field-only text/error. The controlled draft stays with its host.
  return (
    <RangeFields
      key={`${JSON.stringify(inspected.context)}:${readOnly}`}
      context={inspected.context}
      range={range}
      onChange={onChange}
      onInvalid={onInvalid}
      readOnly={readOnly}
      className={className}
    />
  );
}
function RangeFields({
  context,
  range,
  onChange,
  onInvalid,
  readOnly = false,
  className,
}: Omit<SolanaRangePresenterProps, "context" | "range"> & {
  context: SolanaRangeContext;
  range: SolanaRangeDraft;
}) {
  const t = useTranslations("manager.solanaPreview");
  const field = useTranslations("manager.fundBuilder.canvas.panel");
  const locale = useLocale();
  const id = useId();
  const [editing, setEditing] = useState<{
    bound: "min" | "max";
    text: string;
    identity: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  const fullOnly = context.protocol === "orca" && context.tickSpacing >= 32768;
  const editable = context.status === "available" && !fullOnly && !readOnly;
  const bounds = displaySolanaRange(context, range);
  const draftInvalid = validateSolanaRange(context, range) !== "valid";
  const identity = `${context.protocol}:${context.cluster}:${context.pool}:${context.position?.positionId ?? "draft"}`;
  const base = range.displayInverted ? context.tokenB : context.tokenA;
  const quote = range.displayInverted ? context.tokenA : context.tokenB;
  const current = currentSolanaPrice(context);
  const priceText = (value: string) => {
    // Decimal rounding is display-only, retained text never feeds the canonical payload on focus.
    const decimal = new Decimal(value);
    return decimal.toSignificantDigits(8).toFixed().replace(".", separator);
  };
  const announceInvalid = (reason: string) => {
    setError(reason);
    onInvalid?.(reason);
  };
  const send = (next: SolanaRangeDraft | null) => {
    if (!next) {
      announceInvalid("invalid-price");
      return;
    }
    const validation = validateSolanaRange(context, next);
    if (validation !== "valid") {
      announceInvalid(validation);
      return;
    }
    setError(null);
    setEditing(null);
    onChange(next);
  };
  const currentRange = context.position
    ? displaySolanaRange(context, { ...context.position, displayInverted: range.displayInverted })
    : null;
  const status = solanaRangeStatus(context, context.position);
  return (
    <div data-solana-range="" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{field("range.label")}</span>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => {
            setEditing(null);
            onChange({ ...range, displayInverted: !range.displayInverted });
          }}
          className={cn(
            "flex min-h-11 items-center gap-1 rounded-full border border-border px-2.5 text-xs",
            PANEL_FOCUS_RING,
          )}
        >
          <ArrowLeftRight aria-hidden="true" className="size-3" />
          {field("range.quote", { base: base.symbol, quote: quote.symbol })}
        </button>
      </div>
      {context.status === "stale" ? (
        <p role="status" className="text-warning text-xs">
          {t("protocolRange.stale")}
        </p>
      ) : null}
      {fullOnly ? (
        <p role="status" className="text-muted-foreground text-xs">
          {t("protocolRange.fullOnly")}
        </p>
      ) : null}
      <fieldset
        className="m-0 grid grid-cols-4 gap-1.5 border-0 p-0"
        aria-label={field("range.label")}
      >
        {([5, 10, 20, "full"] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={readOnly || context.status !== "available" || (fullOnly && preset !== "full")}
            onClick={() => send(presetSolanaRange(context, preset, range.displayInverted))}
            className={cn(
              "min-h-11 rounded-full border border-border text-xs tabular-nums disabled:opacity-40",
              PANEL_FOCUS_RING,
            )}
          >
            {preset === "full" ? field("range.full") : t(`protocolRange.presets.${preset}`)}
          </button>
        ))}
      </fieldset>
      <div
        data-solana-draft-range=""
        data-tick-lower={range.tickLower}
        data-tick-upper={range.tickUpper}
        className="flex min-w-0 flex-col gap-2"
      >
        <span className="text-muted-foreground text-xs">{t("protocolRange.draftRange")}</span>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] gap-2">
          {(["min", "max"] as const).map((bound) => {
            const label = field(bound === "min" ? "range.min" : "range.max");
            const canonical = bounds?.[bound];
            const active = editing?.bound === bound && editing.identity === identity;
            return (
              <div
                key={bound}
                className="min-w-0 rounded-xl border border-border bg-input px-3 py-2"
              >
                <label htmlFor={`${id}-${bound}`} className="block text-muted-foreground text-xs">
                  {label}
                </label>
                <div className="relative mt-1 min-w-0">
                  {/* A wrapping mirror displays complete values at rest; focus retains the native editor. */}
                  <span
                    data-solana-price-mirror=""
                    aria-hidden="true"
                    className={cn(
                      "block min-h-11 break-all py-2.5 text-right font-semibold text-foreground text-sm tabular-nums",
                      active && "invisible",
                    )}
                  >
                    {active ? editing.text : canonical ? priceText(canonical) : ""}
                  </span>
                  <input
                    id={`${id}-${bound}`}
                    inputMode="decimal"
                    type="text"
                    autoComplete="off"
                    maxLength={SOLANA_RANGE_INPUT_MAX_LENGTH}
                    readOnly={!editable}
                    value={active ? editing.text : canonical ? priceText(canonical) : ""}
                    title={canonical ?? t("marketUnavailable")}
                    aria-invalid={!!error || draftInvalid}
                    onFocus={() => {
                      if (editable && canonical)
                        setEditing({ bound, text: canonical.replace(".", separator), identity });
                    }}
                    onChange={(event) =>
                      setEditing({
                        bound,
                        text: sanitizeNumericInput(event.target.value, {
                          decimalSeparator: separator,
                        })
                          .slice(0, SOLANA_RANGE_INPUT_MAX_LENGTH)
                          .replace(".", separator),
                        identity,
                      })
                    }
                    onBlur={() => {
                      if (editable && active && editing) {
                        const next = snapSolanaRangePrice(
                          context,
                          range,
                          bound,
                          sanitizeNumericInput(editing.text, {
                            decimalSeparator: separator,
                          }),
                        );
                        send(next);
                        setEditing(null);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    className={cn(
                      "absolute inset-0 min-h-11 w-full min-w-0 bg-transparent py-2.5 text-right font-semibold text-sm tabular-nums",
                      active ? "text-foreground" : "text-transparent caret-transparent",
                      PANEL_FOCUS_RING,
                    )}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  {([-1, 1] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      disabled={!editable || !stepSolanaRange(context, range, bound, direction)}
                      aria-label={field(direction === -1 ? "range.decrease" : "range.increase", {
                        label,
                      })}
                      onClick={() => send(stepSolanaRange(context, range, bound, direction))}
                      className={cn(
                        "flex min-h-11 min-w-11 items-center justify-center rounded-md disabled:opacity-40",
                        PANEL_FOCUS_RING,
                      )}
                    >
                      {direction === -1 ? (
                        <Minus aria-hidden="true" className="size-3.5" />
                      ) : (
                        <Plus aria-hidden="true" className="size-3.5" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {error || draftInvalid ? (
          <p role="alert" className="text-warning text-xs">
            {t("protocolRange.invalidRange")}
          </p>
        ) : null}
      </div>
      <dl data-solana-current-range="" className="grid grid-cols-1 gap-1 text-xs">
        <dt className="text-muted-foreground">{t("protocolRange.currentRange")}</dt>
        <dd className="break-all text-right tabular-nums">
          {currentRange
            ? `${priceText(currentRange.min)} / ${priceText(currentRange.max)}`
            : t("marketUnavailable")}
        </dd>
      </dl>
      <p role="status" aria-live="polite" className="break-all text-xs tabular-nums">
        {current
          ? field("range.current", {
              price: priceText(
                range.displayInverted ? new Decimal(1).div(current).toFixed() : current,
              ),
              status:
                status === "zero-liquidity"
                  ? t("protocolRange.zeroLiquidity")
                  : status === "unavailable"
                    ? t("marketUnavailable")
                    : field(
                        status === "in"
                          ? "range.in"
                          : (status === "below") !== range.displayInverted
                            ? "range.below"
                            : "range.above",
                      ),
            })
          : t("marketUnavailable")}
      </p>
      <dl className="grid min-w-0 grid-cols-1 gap-1 text-xs" data-solana-range-provenance="">
        <dt className="text-muted-foreground">{t("protocolRange.source")}</dt>
        <dd className="break-all">
          {context.source.kind === "fixture" ? (
            <>
              <span>{t("protocolRange.fixture")}</span>: <span>{context.source.fixtureId}</span>
            </>
          ) : (
            context.source.source
          )}
        </dd>
        <dt className="text-muted-foreground">{t("protocolRange.asOf")}</dt>
        <dd className="break-all tabular-nums">{context.source.sourceAsOf}</dd>
        {context.source.kind === "observed" ? (
          <>
            <dt className="text-muted-foreground">{t("protocolRange.slot")}</dt>
            <dd className="break-all tabular-nums">{context.source.slot}</dd>
            <dt className="text-muted-foreground">{t("protocolRange.commitment")}</dt>
            <dd>{context.source.commitment}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t("protocolRange.program")}</dt>
        <dd className="break-all">{context.program}</dd>
        <dt className="text-muted-foreground">{t("protocolRange.network")}</dt>
        <dd>{context.cluster}</dd>
      </dl>
      <dl className="grid grid-cols-1 gap-1 text-xs">
        <dt className="text-muted-foreground">{t("composition")}</dt>
        <dd className="text-right">{t("marketUnavailable")}</dd>
      </dl>
    </div>
  );
}
