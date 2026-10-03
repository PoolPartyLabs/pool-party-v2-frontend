/**
 * @id PP-MGR-CMP-057
 * @name AnchoredPopover
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a layout primitive; the Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The one popover the canvas menus are built on (handoff v1.2 BB9). The app has no popover primitive
 * and this slice adds no dependency (coordinator default D21 was not approved), so it is written here,
 * small, behind a NARROW interface: an anchor element, a close callback, children, and the ARIA
 * attributes of its root. Swapping it for a library later touches this file and no caller.
 *
 * What it does, and nothing else:
 * - PORTAL: rendered into `document.body`, `position: fixed`, above the canvas, so the canvas (which
 *   clips its content, AN5) never clips it, and its zoom never scales it.
 * - PLACEMENT ({@link placePopover}): 12 px to the right of the anchor, top aligned; moved up when it
 *   would pass the bottom of the viewport; opened to the left when there is no room on the right;
 *   always inside an 8 px viewport margin. It follows the anchor on resize, scroll and wheel (the
 *   canvas pans and zooms under it).
 * - DISMISS: Escape, Tab and a press outside it (outside the anchor too, so the anchor's own click
 *   toggles) call `onClose`.
 * - FOCUS: on open, the first enabled item (`[data-popover-item]` without `aria-disabled="true"`),
 *   else the first item; Arrow Up and Down move between items, wrapping, Home and End jump; on close,
 *   focus returns to the anchor when it was inside the popover.
 */
"use client";

import {
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

/** Gap between the anchor and the popover (BB9). */
export const POPOVER_GAP = 12;
/** The popover never comes closer than this to a viewport edge. */
export const VIEWPORT_MARGIN = 8;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * BB9: where the popover goes. Right of the anchor, top aligned; moved up at the viewport bottom;
 * left of the anchor without room on the right; clamped into the viewport margin as a last resort.
 */
export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number; side: "right" | "left" } {
  const maxLeft = viewport.width - VIEWPORT_MARGIN - size.width;
  let left = anchor.right + POPOVER_GAP;
  let side: "right" | "left" = "right";
  if (left > maxLeft) {
    const leftSide = anchor.left - POPOVER_GAP - size.width;
    if (leftSide >= VIEWPORT_MARGIN) {
      left = leftSide;
      side = "left";
    } else {
      left = Math.max(VIEWPORT_MARGIN, maxLeft);
    }
  }
  const maxTop = viewport.height - VIEWPORT_MARGIN - size.height;
  const top = Math.max(VIEWPORT_MARGIN, Math.min(anchor.top, maxTop));
  return { left, top, side };
}

/** Public props for {@link AnchoredPopover}. */
export interface AnchoredPopoverProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "onKeyDown" | "children"> {
  /** The element the popover opens beside, and gives focus back to. */
  anchor: HTMLElement;
  /** Escape, Tab, or a press outside. */
  onClose(): void;
  children: ReactNode;
}

const ITEM_SELECTOR = "[data-popover-item]";

function itemsOf(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
}

/** A popover anchored to an element, in a portal, dismissable, keyboard navigable. */
export function AnchoredPopover({
  anchor,
  onClose,
  children,
  className,
  ...rest
}: AnchoredPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const reposition = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const box = anchor.getBoundingClientRect();
    const own = root.getBoundingClientRect();
    const next = placePopover(
      box,
      { width: own.width || root.offsetWidth, height: own.height || root.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPlace((previous) =>
      previous && previous.left === next.left && previous.top === next.top
        ? previous
        : { left: next.left, top: next.top },
    );
  }, [anchor]);

  // Place before paint, then follow the anchor while the page or the canvas moves.
  useLayoutEffect(() => {
    reposition();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reposition);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("wheel", schedule, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("wheel", schedule, { capture: true });
    };
  }, [reposition]);

  // Focus in on open; focus back to the anchor on close, when focus was ours.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const items = itemsOf(root);
    const first = items.find((item) => item.getAttribute("aria-disabled") !== "true") ?? items[0];
    (first ?? root)?.focus();
    return () => {
      const active = document.activeElement;
      const ours = !active || active === document.body || (root?.contains(active) ?? false);
      if (ours && anchor.isConnected) anchor.focus();
    };
  }, [anchor]);

  // A press outside the popover and its anchor closes it.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || anchor.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [anchor]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    const items = itemsOf(rootRef.current);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
    if (event.key === "ArrowUp") next = index <= 0 ? items.length - 1 : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the root takes the role its caller passes (a menu); the keys it handles are that role's own navigation.
    <div
      ref={rootRef}
      tabIndex={-1}
      data-anchored-popover=""
      onKeyDown={onKeyDown}
      // Unplaced for one layout pass only: transparent rather than `visibility: hidden`, because a
      // hidden element cannot take the focus the open effect gives its first item.
      style={{
        position: "fixed",
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        opacity: place ? 1 : 0,
      }}
      className={cn("z-[60] outline-none", className)}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}
