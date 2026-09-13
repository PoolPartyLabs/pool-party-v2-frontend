/**
 * @id PP-STR-HOK-022
 * @name useStickyFooterShadow
 * @implements-rules-version v1 (POO-1525 rules v1)
 *
 * POO-1525 [M3.5]: whether a pinned footer's elevation shadow should show, i.e. whether its own
 * scrolling ancestor still has content below the visible viewport. The footer itself never scrolls
 * (`Sheet.tsx` / `Dialog.tsx` already own `overflow-y-auto` on the element it sits inside, per
 * `StickyActionFooter`), so this walks up to that real scroll container rather than assuming one.
 *
 * Degrades to `false` (no shadow) whenever nothing is measurable: no scroll ancestor found, or bare
 * jsdom's `scrollHeight`/`clientHeight` both `0`. Same posture as `useVirtualizeGate`'s `hasLayout` —
 * an unmeasurable state falls back to the visually inert default, never a guess.
 */
"use client";

import { type RefObject, useEffect, useState } from "react";

/** The nearest ancestor whose computed style actually scrolls, or `null` short of the document. */
function findScrollAncestor(node: HTMLElement): HTMLElement | null {
  let el = node.parentElement;
  while (el && el !== document.documentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

/** `true` while `node`'s scrolling ancestor has content below the visible viewport. */
export function useStickyFooterShadow(node: RefObject<HTMLElement | null>): boolean {
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const scrollEl = findScrollAncestor(el);
    if (!scrollEl) return;

    const update = () => {
      const remaining = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      setIsStuck(remaining > 1);
    };

    let frame = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    update();
    scrollEl.addEventListener("scroll", update, { passive: true });
    // Two sources move the metrics without a scroll event ever firing: the VIEWPORT resizing
    // (rotation, the URL bar collapsing) and the CONTENT growing or shrinking underneath the same
    // scroll box (a quote resolving, a step collapsing) — ResizeObserver on the container catches
    // the first, MutationObserver on its subtree catches the second. Both are optional: bare jsdom
    // has no ResizeObserver, and the scroll listener alone still covers the rule's own wording
    // ("while content is scrolled"), so their absence degrades rather than breaks.
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(scrollEl);
    const mutationObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleUpdate);
    mutationObserver?.observe(scrollEl, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      scrollEl.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [node]);

  return isStuck;
}
