/**
 * @id PP-CORE-CMP-021 (POO-465)
 * @name LocaleSwitcher
 * @implements-rules-version v1
 * Labelled select that switches the active locale, keeping the current path, search and hash.
 * Inert (disabled) until hydration completes; a change hard-navigates to the locale-prefixed URL.
 * Emits `locale_changed` (previous → next) before navigating. The endonym list and the switch
 * itself live in the shared {@link useLocaleSwitch} seam (POO-904 [R4]), also consumed by the
 * mobile MobileLocaleSheet picker.
 *
 * PP-NOTE(POO-465): deliberate deviation from the upstream next-intl soft `router.replace`
 * pattern. The native select is interactive from first paint while hydration takes seconds
 * (Privy + wagmi providers mount on every page), so a pre-hydration change fired no onChange and
 * the controlled value snapped back, and a mid-hydration `router.replace` was silently dropped by
 * Next 15.5.18 after next-intl wrote the NEXT_LOCALE cookie (no RSC request). `router.replace` +
 * `router.refresh` was evaluated and refuted (dropped in the same window). The hard navigation
 * guarantees a fresh document in the chosen locale and a correct `html lang`.
 */
"use client";

import {
  type ChangeEvent,
  forwardRef,
  type SelectHTMLAttributes,
  useEffect,
  useId,
  useState,
} from "react";
import { LOCALE_OPTIONS, type LocaleValue, useLocaleSwitch } from "@/hooks/useLocaleSwitch";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link LocaleSwitcher}. */
export interface LocaleSwitcherProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "defaultValue" | "onChange"> {
  /**
   * Accessible label for the control. Rendered as a visually-hidden `<label>` tied to the select
   * and mirrored onto `aria-label`. Defaults to `"Language"`.
   */
  label?: string;
}

/**
 * LocaleSwitcher primitive. Shows the current locale (from `useLocaleSwitch()`) as the selected
 * option and, on change, hard-navigates to the locale-prefixed equivalent of the current URL so
 * the user stays on the same page [R2]. Disabled until hydration completes [R1]; an externally
 * passed `disabled` prop is still honored afterwards [R5]. Forwards other native `<select>` props.
 */
export const LocaleSwitcher = forwardRef<HTMLSelectElement, LocaleSwitcherProps>(
  ({ className, label = "Language", id, disabled, ...props }, ref) => {
    const { locale, switchLocale } = useLocaleSwitch();
    const generatedId = useId();
    const selectId = id ?? generatedId;
    // [R1] Hydration gate: server markup and first client render are disabled (no mismatch);
    // the select only becomes interactive once React has attached its listeners.
    const [isHydrated, setIsHydrated] = useState(false);
    useEffect(() => {
      setIsHydrated(true);
    }, []);

    const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
      // The select only renders LOCALE_OPTIONS, so the value is always a known locale code.
      // [R2][R3] Analytics + hard navigation live in the shared switch (useLocaleSwitch).
      switchLocale(event.target.value as LocaleValue);
    };

    return (
      <div className={cn("inline-flex flex-col gap-1", className)}>
        <label htmlFor={selectId} className="sr-only">
          {label}
        </label>
        <select
          ref={ref}
          id={selectId}
          aria-label={label}
          // Intentionally controlled: the hard navigation discards this React tree, so there is no
          // controlled snap-back after hydration; the fresh document renders with the new locale.
          value={locale}
          onChange={handleChange}
          className={cn(
            "inline-flex h-10 cursor-pointer appearance-none rounded-md border border-border",
            "bg-surface px-3 text-sm text-foreground transition-colors",
            "hover:bg-surface-raised",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
          {...props}
          // [R1][R5] After the props spread so the computed gate always wins.
          disabled={!isHydrated || disabled}
        >
          {LOCALE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  },
);

LocaleSwitcher.displayName = "LocaleSwitcher";
