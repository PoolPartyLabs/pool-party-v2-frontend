/**
 * @id PP-CORE-HOK-019 (POO-625)
 * @name useVirtualizeGate
 * @implements-rules-version v1
 *
 * The SINGLE source of truth for "should this list window?" — so no consuming surface can forget a
 * guard and virtualize when it shouldn't. Windowing engages only when ALL three hold (ADR-0001
 * rule 4): the `virtualize` feature flag is on, the list is past {@link THRESHOLD}, and there is a
 * real, measurable scroll container (`hasLayout`). Any leg false → the surface renders the plain
 * `.map()` baseline, byte-for-byte identical to today ([R1]).
 *
 * `hasLayout` is derived the same way {@link ImageCropModal} measures its viewport: attach the
 * returned `containerRef` to the scroll element, and a layout effect reads `clientHeight`. Under SSR
 * and bare jsdom (no layout engine) `clientHeight` is 0, so `hasLayout` stays false and the surface
 * falls back — virtualization must never be the reason content is missing.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";

/** The default windowing threshold used when no environment override is set (prod). */
export const DEFAULT_THRESHOLD = 500;

/**
 * Parse a `NEXT_PUBLIC_VIRTUALIZE_THRESHOLD` override into the effective threshold (POO-660 [R1]): a
 * non-negative integer wins; anything else (unset, empty, negative, float, non-numeric) falls back to
 * {@link DEFAULT_THRESHOLD}. A pure function so the parse is unit-tested without a virtualizer or env
 * plumbing, and so no surface can drift from this single definition.
 */
export function parseThreshold(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_THRESHOLD;
}

/**
 * Below this item count a plain `.map()` is cheaper than the virtualizer's measurement overhead and
 * avoids its edge cases, so we do not window (ADR-0001 rule 4). The gate is `count > THRESHOLD`, so
 * a list of exactly {@link THRESHOLD} items still renders plainly.
 *
 * Read once at module load from the STATIC `process.env.NEXT_PUBLIC_VIRTUALIZE_THRESHOLD` literal so
 * Next inlines it into the client bundle (the feature-flag env pattern). Prod leaves it unset →
 * {@link DEFAULT_THRESHOLD}; dev sets a low value (5) to exercise the windowed path on its small
 * dataset. A rendering-strategy tuning knob, NOT a launch gate (POO-660 [R3]).
 */
export const THRESHOLD = parseThreshold(process.env.NEXT_PUBLIC_VIRTUALIZE_THRESHOLD);

/** What {@link useVirtualizeGate} returns. */
export interface VirtualizeGate {
  /** `true` only when the flag is on, `rowCount > THRESHOLD`, and a measurable container exists. */
  enabled: boolean;
  /** Attach to the scroll container so the gate can measure `clientHeight` for `hasLayout`. */
  containerRef: (node: HTMLElement | null) => void;
}

/**
 * Resolve whether a list of `rowCount` items should render windowed vs. plain. Attach the returned
 * `containerRef` to the surface's scroll container; read `enabled` to branch the render.
 */
export function useVirtualizeGate(rowCount: number): VirtualizeGate {
  const { isEnabled } = useFeatureFlags();
  const flagOn = isEnabled("virtualize");
  const pastThreshold = rowCount > THRESHOLD;

  // The measured scroll element. A callback ref (not useRef) so attaching/detaching the node
  // re-runs the effect, and so the very first attach after mount is observed.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [hasLayout, setHasLayout] = useState(false);
  const containerRef = useCallback((next: HTMLElement | null) => setNode(next), []);

  // Measure the container height after paint (precedent: ImageCropModal viewport measure). A real
  // laid-out box reports clientHeight > 0; SSR and bare jsdom report 0 → hasLayout stays false.
  useEffect(() => {
    if (!node) {
      setHasLayout(false);
      return;
    }
    setHasLayout(node.clientHeight > 0);
  }, [node]);

  return { enabled: flagOn && pastThreshold && hasLayout, containerRef };
}
