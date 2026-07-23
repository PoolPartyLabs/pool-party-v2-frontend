/**
 * @id PP-CORE-CMP-061
 * @name HoldToConfirmButton
 * @implements-rules-version v1
 *
 * A deliberate press-and-hold confirmation control. The user must hold (pointer or keyboard) for the
 * full `durationMs`; a progress fill grows from empty to full, and releasing early instantly resets
 * it to empty. `onComplete` fires exactly once, only when a hold reaches full duration. Use it to gate
 * a high-consequence, hard-to-undo action (e.g. revealing a private key) behind sustained, intentional
 * input so it can never be triggered by a single stray tap.
 *
 * A11y: it is a native <button>, so it is focusable and its text is the accessible name. Keyboard users
 * hold Space or Enter (key-repeat is ignored so the countdown is not restarted); releasing the key
 * resets. The fill is aria-hidden decoration. PP-A11Y: press-and-hold has no instantaneous keyboard
 * equivalent by design (the friction is the point); the Space/Enter hold is the accessible path.
 */
"use client";

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link HoldToConfirmButton}. */
export interface HoldToConfirmButtonProps {
  /** Visible text and accessible name (e.g. "Hold to reveal"). */
  label: string;
  /** Fired once when a hold reaches the full duration. */
  onComplete: () => void;
  /** How long the user must hold, in milliseconds. Defaults to 3000. */
  durationMs?: number;
  /** When true the control is inert and cannot be held. */
  disabled?: boolean;
  /** Extra classes for the button. */
  className?: string;
}

/** Press-and-hold confirmation button. */
export function HoldToConfirmButton({
  label,
  onComplete,
  durationMs = 3000,
  disabled = false,
  className,
}: HoldToConfirmButtonProps) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirror of the holding state so pointer/key handlers read the latest value synchronously
  // (and so a key-repeat keydown can be ignored without a re-render race).
  const holdingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    clearTimer();
  }, [clearTimer]);

  const start = useCallback(() => {
    if (disabled || holdingRef.current) return;
    holdingRef.current = true;
    setHolding(true);
    timerRef.current = setTimeout(() => {
      holdingRef.current = false;
      timerRef.current = null;
      setHolding(false);
      onComplete();
    }, durationMs);
  }, [disabled, durationMs, onComplete]);

  // Never leave a timer running if the button unmounts mid-hold (e.g. the dialog closes).
  useEffect(() => clearTimer, [clearTimer]);

  // Cancel an in-flight hold if the control becomes disabled mid-press: `disabled` is only checked at
  // press time, so without this a hold that began while enabled would still complete. Keeps the
  // contract ("disabled is inert and cannot be held") true even for a consumer that toggles it live.
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault(); // stop Space from scrolling / firing a native click on keyup
      if (event.repeat) return; // ignore auto-repeat so the countdown is not restarted
      start();
    },
    [start],
  );

  const onKeyUp = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== " " && event.key !== "Enter") return;
      stop();
    },
    [stop],
  );

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={stop}
      className={cn(
        "relative inline-flex h-12 w-full select-none items-center justify-center overflow-hidden",
        "rounded-md border border-destructive/40 bg-surface-raised font-medium text-base",
        "text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {/* Progress fill: grows left-to-right over `durationMs` while holding, snaps back on release.
          Transform + transition are set inline (not via Tailwind scale utilities) so the animated
          property matches the transition and the fill actually moves across renderers. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-full bg-destructive/35"
        style={{
          transformOrigin: "left",
          transform: holding ? "scaleX(1)" : "scaleX(0)",
          transition: `transform ${holding ? durationMs : 180}ms linear`,
        }}
      />
      <span className="relative z-10">{label}</span>
    </button>
  );
}
