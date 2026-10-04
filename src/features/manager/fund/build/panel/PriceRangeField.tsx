/**
 * @id PP-MGR-CMP-070
 * @name PriceRangeField
 * @implements-rules-version v1 (POO-2189)
 * @analytics-events none (the panel shell emits)
 * The pool's price range in the manager's quote orientation; all stored bounds stay canonical.
 */
"use client";
import { ArrowLeftRight, Minus, Plus } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { isStableSymbol } from "@/lib/chains/config";
import { cn } from "@/lib/utils/cn";
import { PanelFieldLabel } from "./PanelFieldLabel";
import { type PanelPoolView, toLivePoolGrid } from "./panelCatalogView";
import { PANEL_FOCUS_RING } from "./panelStyles";
import {
  commitBoundInput,
  type DisplayBound,
  displayBounds,
  invertRange,
  type PoolRange,
  presetRange,
  type RangePreset,
  rangeMarker,
  rangeSplit,
  rangeStatus,
  rangeSteppers,
  type StepDirection,
  sanitizeBoundInput,
  stepBound,
} from "./poolRangeMath";
import { RangeSplitBar } from "./RangeSplitBar";

export interface PriceRangeFieldProps {
  pool: PanelPoolView;
  range: PoolRange;
  onChange(next: PoolRange): void;
}
export function PriceRangeField({ pool, range, onChange }: PriceRangeFieldProps) {
  const t = useTranslations("manager.fundBuilder.canvas.panel");
  const fmt = useFormatter();
  const locale = useLocale();
  const labelId = useId();
  const grid = toLivePoolGrid(pool);
  const bounds = displayBounds(range, grid);
  const base = range.displayInverted ? pool.token1 : pool.token0;
  const quote = range.displayInverted ? pool.token0 : pool.token1;
  const symbol = isStableSymbol(quote.symbol) ? "$" : "";
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  const priceText = (value: number) =>
    fmt.number(value, { maximumSignificantDigits: 6, maximumFractionDigits: 20 });
  const initialPreset = (): RangePreset | null => {
    if (range.fullRange) return "full";
    return (
      ([5, 10, 20] as const).find((preset) => {
        const candidate = presetRange(grid, preset, range.displayInverted);
        return candidate?.tickLower === range.tickLower && candidate.tickUpper === range.tickUpper;
      }) ?? null
    );
  };
  const [preset, setPreset] = useState<RangePreset | null>(initialPreset);
  const [editing, setEditing] = useState<{
    bound: DisplayBound;
    text: string;
    shown: string;
  } | null>(null);
  const key = `${range.tickLower}:${range.tickUpper}:${range.fullRange}:${range.displayInverted}`;
  const [seen, setSeen] = useState(key);
  const sent = useRef(key);
  if (seen !== key) {
    setSeen(key);
    if (sent.current !== key) {
      setPreset(initialPreset());
      setEditing(null);
      sent.current = key;
    }
  }
  const send = (next: PoolRange) => {
    sent.current = `${next.tickLower}:${next.tickUpper}:${next.fullRange}:${next.displayInverted}`;
    if (next !== range) onChange(next);
  };
  const steppers = rangeSteppers(range, grid);
  const status = rangeStatus(range, grid);
  const split = rangeSplit(range, grid);
  const marker = rangeMarker(range, grid);
  const current = range.displayInverted ? 1 / pool.price : pool.price;
  const choose = (next: RangePreset) => {
    const selected = presetRange(grid, next, range.displayInverted);
    if (selected) {
      setPreset(next);
      setEditing(null);
      send(selected);
    }
  };
  const step = (bound: DisplayBound, direction: StepDirection) => {
    setPreset(null);
    setEditing(null);
    send(stepBound(range, grid, bound, direction));
  };
  return (
    <div className="flex flex-col gap-2" data-price-range="">
      <PanelFieldLabel
        label={t("range.label")}
        help={t("range.help")}
        helpLabel={t("moreAbout", { label: t("range.label") })}
        labelId={labelId}
        value={
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              send(invertRange(range));
            }}
            className={cn(
              "flex h-[26px] items-center gap-1 rounded-full border border-border px-2.5 text-xs",
              PANEL_FOCUS_RING,
            )}
          >
            <ArrowLeftRight aria-hidden="true" className="size-3" />
            {t("range.quote", { quote: quote.symbol, base: base.symbol })}
          </button>
        }
      />
      <fieldset aria-labelledby={labelId} className="m-0 grid grid-cols-4 gap-1.5 border-0 p-0">
        {([5, 10, 20, "full"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={preset === item}
            onClick={() => choose(item)}
            className={cn(
              "h-[29px] rounded-full border text-xs lining-nums tabular-nums",
              preset === item
                ? "border-foreground bg-surface-raised text-foreground"
                : "border-border text-muted-foreground",
              PANEL_FOCUS_RING,
            )}
          >
            {item === "full" ? t("range.full") : `±${item}%`}
          </button>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        {(["min", "max"] as const).map((bound) => {
          const label = t(bound === "min" ? "range.min" : "range.max");
          const shown = range.fullRange ? (bound === "min" ? "0" : "∞") : priceText(bounds[bound]);
          const down = bound === "min" ? steppers.minDown : steppers.maxDown;
          const up = bound === "min" ? steppers.minUp : steppers.maxUp;
          return (
            <div key={bound} className="rounded-xl border border-border bg-input px-3 py-2">
              <label
                className="block text-muted-foreground text-xs"
                htmlFor={`${labelId}-${bound}`}
              >
                {label}
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t("range.decrease", { label })}
                  disabled={!down}
                  onClick={() => step(bound, -1)}
                  className={cn("shrink-0 disabled:opacity-40", PANEL_FOCUS_RING)}
                >
                  <Minus aria-hidden="true" className="size-3.5" />
                </button>
                <span aria-hidden="true" className="text-sm">
                  {range.fullRange ? "" : symbol}
                </span>
                <input
                  id={`${labelId}-${bound}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  readOnly={range.fullRange}
                  value={editing?.bound === bound ? editing.text : shown}
                  onFocus={() => {
                    if (!range.fullRange) setEditing({ bound, text: shown, shown });
                  }}
                  onChange={(event) => {
                    setPreset(null);
                    setEditing({
                      bound,
                      text: sanitizeBoundInput(event.target.value, separator),
                      shown: editing?.shown ?? shown,
                    });
                  }}
                  onBlur={() => {
                    if (editing?.bound === bound) {
                      send(commitBoundInput(range, grid, bound, editing.text, editing.shown));
                      setEditing(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="min-w-0 flex-1 bg-transparent text-center text-foreground text-sm lining-nums tabular-nums outline-none"
                />
                <button
                  type="button"
                  aria-label={t("range.increase", { label })}
                  disabled={!up}
                  onClick={() => step(bound, 1)}
                  className={cn("shrink-0 disabled:opacity-40", PANEL_FOCUS_RING)}
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p
        role="status"
        className={cn(
          "flex items-center gap-1 text-xs lining-nums tabular-nums",
          status === "in" ? "text-muted-foreground" : "text-warning",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-2 rounded-full", status === "in" ? "bg-success" : "bg-warning")}
        />
        {t("range.current", {
          price: `${symbol}${priceText(current)}`,
          status: t(
            range.fullRange
              ? "range.always"
              : status === "below"
                ? "range.below"
                : status === "above"
                  ? "range.above"
                  : "range.in",
          ),
        })}
      </p>
      {split && marker ? (
        <RangeSplitBar
          base={base}
          quote={quote}
          split={split}
          marker={marker}
          fullRange={range.fullRange}
        />
      ) : null}
      {status && status !== "in" && split ? (
        <p className="text-muted-foreground text-xs">
          {t("range.oneToken", {
            token: split.pct0 === 100 ? pool.token0.symbol : pool.token1.symbol,
          })}
        </p>
      ) : null}
    </div>
  );
}
