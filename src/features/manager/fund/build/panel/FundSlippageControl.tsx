/**
 * @id PP-MGR-CMP-067
 * @name FundSlippageControl
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational control; a slippage change reaches analytics only as a
 *   field of `builder_block_applied`, which the Build screen (PP-MGR-SCR-002) emits on Apply.
 *
 * The Max slippage field of the configuration panels (handoff P12, with the product owner's decision
 * D-D on open point 16), on top of PB's rule module (`fundSlippage.ts`, PP-MGR-LIB-030):
 *
 * - Three presets, 0.5%, 1% and 2%, as FIXED-WIDTH buttons (64 x 36, radius 16), so the `Custom`
 *   placeholder of the field beside them is never clipped; then the custom field, which takes the
 *   rest of the row: right aligned, placeholder `Custom` (muted at 70%), suffix `%`.
 * - A selected preset: `primary` stroke, `primary` at 10%, `primary` text. The custom field
 *   active: `primary` stroke, the typed value in `foreground`, no preset selected (a typed value
 *   equal to a preset stays custom).
 * - Each keystroke goes through `sanitizeFundSlippageInput`, which does NOT pass a `max` of 5 to the
 *   app's sanitiser (finding 27): an in-progress "8" stays visible until the blur.
 * - On blur, `commitFundSlippageInput`: an empty field keeps a selected chip, or goes back to 2%; a
 *   value under 0.1 becomes 0.1; a value above 5 becomes 5 and the sentence "5% is the maximum."
 *   shows under the row (D-D) until the next edit. There is no High or Very high warning: nothing
 *   above 5 can be produced (D-D, P4).
 * - A value changed from outside (Discard, another block) re-seeds the control.
 *
 * Props only: the strings arrive translated, the value is the caller's draft.
 */
"use client";

import { type ChangeEvent, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  commitFundSlippageInput,
  FUND_SLIPPAGE_MAX_PCT,
  FUND_SLIPPAGE_PRESETS,
  type FundSlippagePreset,
  fundSlippageFromPct,
  sanitizeFundSlippageInput,
} from "./fundSlippage";
import { PanelFieldLabel } from "./PanelFieldLabel";
import { PANEL_FOCUS_RING } from "./panelStyles";

/** Public props for {@link FundSlippageControl}. */
export interface FundSlippageControlProps {
  /** The tolerance the draft holds, in percent, 0.1 to 5. */
  value: number;
  /** A preset was chosen, or the custom field committed on blur. */
  onChange(pct: number): void;
  copy: {
    /** "Max slippage". */
    label: string;
    /** The (i) tooltip. */
    help: string;
    /** "More about Max slippage". */
    helpLabel: string;
    /** "Custom". */
    custom: string;
    /** The custom field's name: "Custom max slippage, in percent". */
    customLabel: string;
    /** "5% is the maximum.", for a percent. */
    max(pct: string): string;
  };
}

/** A tolerance as the field prints it: at most one decimal, "0.5", "3". */
function fieldText(pct: number): string {
  return String(Math.round(pct * 10) / 10);
}

/** The Max slippage field (P12, D-D). */
export function FundSlippageControl({ value, onChange, copy }: FundSlippageControlProps) {
  const labelId = useId();
  const seeded = fundSlippageFromPct(value);

  // `custom` is the mode, not the value: a typed 2 stays custom although it equals a chip.
  const [custom, setCustom] = useState(seeded.preset === null);
  const [text, setText] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);
  // The last value this control sent, to tell its own changes from a change made outside.
  const sent = useRef(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== sent.current) {
      // Discard, another block: start again from the value.
      sent.current = value;
      setCustom(fundSlippageFromPct(value).preset === null);
      setText(null);
      setCapped(false);
    }
  }

  const send = (pct: number) => {
    sent.current = pct;
    if (pct !== value) onChange(pct);
  };

  const choosePreset = (preset: FundSlippagePreset) => {
    setCustom(false);
    setText(null);
    setCapped(false);
    send(preset);
  };

  const onType = (event: ChangeEvent<HTMLInputElement>) => {
    setCapped(false);
    setText(sanitizeFundSlippageInput(event.target.value));
  };

  const onBlur = () => {
    if (text === null) return;
    const committed = commitFundSlippageInput(text, custom ? undefined : seeded);
    setText(null);
    setCustom(committed.preset === null);
    setCapped(committed.capped);
    send(committed.pct);
  };

  const shown = text ?? (custom ? fieldText(seeded.pct) : "");
  const selectedPreset = custom ? null : seeded.preset;

  return (
    <div data-fund-slippage="" className="flex flex-col gap-2">
      <PanelFieldLabel
        label={copy.label}
        help={copy.help}
        helpLabel={copy.helpLabel}
        labelId={labelId}
      />
      <fieldset aria-labelledby={labelId} className="m-0 flex min-w-0 gap-2 border-0 p-0">
        {FUND_SLIPPAGE_PRESETS.map((preset) => {
          const selected = selectedPreset === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={selected}
              onClick={() => choosePreset(preset)}
              className={cn(
                "flex h-9 w-16 shrink-0 items-center justify-center rounded-2xl border font-medium text-sm lining-nums tabular-nums transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-foreground hover:bg-surface-raised",
                PANEL_FOCUS_RING,
              )}
            >
              {`${preset}%`}
            </button>
          );
        })}
        <label
          className={cn(
            "flex h-9 min-w-0 flex-1 items-center justify-end gap-0.5 rounded-2xl border px-3 focus-within:ring-2 focus-within:ring-ring",
            custom ? "border-primary" : "border-border",
          )}
        >
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={copy.customLabel}
            placeholder={copy.custom}
            value={shown}
            onFocus={() => setText(shown)}
            onChange={onType}
            onBlur={onBlur}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="w-full min-w-0 bg-transparent text-right text-foreground text-sm lining-nums tabular-nums outline-none placeholder:text-muted-foreground/70"
          />
          <span aria-hidden="true" className="text-muted-foreground text-sm">
            %
          </span>
        </label>
      </fieldset>
      {capped ? (
        <p role="status" className="text-muted-foreground text-xs">
          {copy.max(String(FUND_SLIPPAGE_MAX_PCT))}
        </p>
      ) : null}
    </div>
  );
}
