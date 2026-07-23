/**
 * @id PP-PROF-CMP-006
 * @name PhoneField
 * @implements-rules-version v2
 * @i18n-namespace profile.personal
 *
 * Optional phone entry with country-code selection (POO-699 [R4]). `react-international-phone`'s
 * headless `usePhoneInput` drives formatting-as-you-type + country guessing and feeds the shared
 * {@link Input} primitive. Error STYLING is driven through Input's `variant` / `aria-invalid` /
 * `aria-describedby` props (NOT Input's `error` prop, which would remount the input mid-typing — see
 * the inline note at the `<Input>` call site). A native country `<select>` (built from the lib's country data, which
 * carries the dial codes `src/lib/data/countries.ts` lacks) sits beside the number. Validity +
 * canonical E.164 come from `libphonenumber-js` via {@link toE164} / {@link isAcceptablePhone}.
 *
 * v2 (POO-730): the dial code (DDI) lives ONLY in the selector, never inside the number input
 * (`disableDialCodeAndPrefix`, R1) — the input shows the masked national number for the selected
 * country (R2). Picking a country hands focus to the number input (R3). The invalid-phone error is
 * blur-gated: hidden while the user is editing (focus/typing), shown only after blur (R4) — Save is
 * still gated on validity in the parent regardless, so an invalid number never persists.
 *
 * Contract to the parent: `initialValue` seeds the field once; `onChange(next, isValid)` lifts the
 * value to persist — "" when the national part is empty (clears the field, R6), else canonical E.164
 * for a valid number or the raw input while still invalid — and whether it is acceptable to save. The
 * field is uncontrolled after mount (the hook owns the live value), so lifting never feeds back and
 * loops. The parent supplies the inline error text and gates Save on `isValid`; this component decides
 * WHEN to surface that error (on blur).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { defaultCountries, parseCountry, usePhoneInput } from "react-international-phone";
import { Input } from "@/components/ui/Input";
import { isAcceptablePhone, toE164 } from "@/lib/utils/phone";

/** Country options (iso2 + name + dial code), parsed once from the lib's bundled country data. */
const COUNTRY_OPTIONS = defaultCountries.map(parseCountry);

/** Public props for {@link PhoneField}. */
export interface PhoneFieldProps {
  /** Visible label for the number input (e.g. "Phone (optional)"). */
  label: string;
  /** Accessible label for the country-code selector (not visible; the flag/dial code is the affordance). */
  countryLabel: string;
  /** The stored phone (E.164 or "") used to seed the field once on mount. */
  initialValue: string;
  /** Inline error text; forwarded to the {@link Input} (destructive border + aria-invalid + linked text). */
  error?: string;
  /**
   * Lifts the value to persist and whether it is acceptable to save. `next` is "" (national part empty),
   * a canonical E.164 (valid), or the raw input (still invalid, so `isValid` is false and Save is gated).
   */
  onChange: (next: string, isValid: boolean) => void;
}

/** Optional phone field with country-code selection, driving the shared Input primitive. */
export function PhoneField({
  label,
  countryLabel,
  initialValue,
  error,
  onChange,
}: PhoneFieldProps) {
  // Seed once; the hook owns the live value afterwards (uncontrolled), so lifting never loops.
  const [seed] = useState(initialValue);
  const { inputValue, phone, country, setCountry, handlePhoneValueChange, inputRef } =
    usePhoneInput({
      defaultCountry: "us",
      value: seed,
      // R1: keep the dial code (and its "+" prefix) OUT of the input — it lives in the selector. The
      // input then shows only the masked national number (R2); `phone` still carries the full E.164.
      disableDialCodeAndPrefix: true,
    });

  // Keep the latest onChange in a ref so the lift effect can depend ONLY on the phone/country (an inline
  // parent callback changes identity every render; depending on it would re-fire and loop).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Lift on genuine changes only (typing or country switch), not on mount — the parent already seeds its
  // own state from the same stored value, and a mount lift would clobber `saved`/dirty state.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const phoneDigits = phone.replace(/\D/g, "");
    const dialDigits = country.dialCode.replace(/\D/g, "");
    // National part empty (only the dial code remains) => the field is cleared (R6).
    const nationalEmpty = phoneDigits.length <= dialDigits.length;
    onChangeRef.current(
      nationalEmpty ? "" : toE164(phone),
      nationalEmpty ? true : isAcceptablePhone(phone),
    );
  }, [phone, country.dialCode]);

  // R4: the invalid-phone error is blur-gated — hidden while editing (focus/typing), shown on blur.
  const [touched, setTouched] = useState(false);
  const showError = touched && error != null;

  const inputId = "profile-phone";
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="font-medium text-foreground text-sm">
        {label}
      </label>
      <div className="flex items-start gap-2">
        <select
          aria-label={countryLabel}
          value={country.iso2}
          onChange={(event) => {
            // R3: hand focus to the number input so the user types the number straight away.
            setCountry(event.target.value, { focusOnInput: true });
          }}
          className="h-10 w-40 shrink-0 rounded-md border border-border bg-surface px-2 text-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {COUNTRY_OPTIONS.map(({ iso2, name, dialCode }) => (
            <option key={iso2} value={iso2}>
              {name} (+{dialCode})
            </option>
          ))}
        </select>
        <div className="flex-1">
          {/*
            The error text is rendered as a sibling below (not via Input's `error` prop) so toggling it
            never changes Input's DOM structure — otherwise the `<input>` would remount and lose focus /
            cursor mid-typing. Input's `error` STYLING (destructive border + aria-invalid) still comes
            through via `variant` + aria props, keeping the accessibility contract intact.
          */}
          <Input
            id={inputId}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            ref={inputRef}
            value={inputValue}
            onChange={(event) => {
              // Editing hides any prior error until the field is left again (R4).
              setTouched(false);
              handlePhoneValueChange(event);
            }}
            onFocus={() => setTouched(false)}
            onBlur={() => setTouched(true)}
            variant={showError ? "error" : "default"}
            aria-invalid={showError ? true : undefined}
            aria-describedby={showError ? errorId : undefined}
          />
          {showError ? (
            <p id={errorId} className="mt-1.5 text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
