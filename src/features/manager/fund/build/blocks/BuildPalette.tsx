/**
 * @id PP-MGR-CMP-056
 * @name BuildPalette
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a presentational palette. A drop is handed to the controller
 *   (`useBuildCanvas`), which applies the reducer and reports `blockAdded` (via "palette") or
 *   `flowInserted` through `onEvent`; the Build screen (PP-MGR-SCR-002, S7) owns every event.
 *
 * The left column of the Build step (handoff v1.2 AN8, I3, ST10; defaults D22, D25), drawn from a
 * {@link PaletteModel}:
 *
 * - FROM YOUR MANDATE: cards 220 x 57, radius 16, padding 8 x 12, gap 8, `surface`: a 20 px logo,
 *   the protocol name (Body/Medium) over the block type (Caption/Default, muted), a 16 px grip at 40%.
 * - FLOW BLOCKS: rows 220 x 39, outlined with no fill: a 16 px icon, the name (Body/Default, muted),
 *   the grip. Then the caption.
 * - COMING SOON: rows 220 x 39, outlined: logo and name at 60%, the "Soon" tag, no grip, not
 *   draggable, tooltip "Coming soon" on hover and focus.
 * - Gaps 20 between sections and 8 inside one; the column scrolls inside itself past 640 (D25).
 *
 * DRAG (I3, D22) is native pointer events, no library: a press that moves more than 4 px (the
 * canvas's own click threshold) starts it and calls `onDragStart`, so the controller can light the
 * valid targets; a preview of the card at 80% follows the pointer in a portal; on release the drop
 * is resolved with `document.elementFromPoint(x, y)?.closest('[data-graph-target]')` (the renderer,
 * S6, puts that attribute on every template, port, card and share label) and handed to `onDrop` with
 * that key, or null anywhere else. Whether the key is a valid target is the controller's call.
 * Escape and a cancelled pointer call `onDragCancel`.
 *
 * Accessibility: nothing here is a button. A drag is a pointer gesture with no keyboard equivalent
 * of its own: the keyboard path to every block is the canvas menus (Add protocol, the insert ports),
 * which offer the same slots (D22). A coming-soon row only explains itself, so it is a focusable
 * element with its tooltip as its description, not a control.
 */
"use client";

import { GripVertical } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";
import { exceedsPanThreshold } from "../canvas/viewportMath";
import { GRAPH_TARGET_ATTR } from "../layout/graphTypes";
import { Explained } from "../pieces/pieceParts";
import { BlockMark } from "./BlockMark";
import type { PaletteDragItem, PaletteItem, PaletteModel, PaletteSection } from "./blockRegistry";

/**
 * The attribute S6 renders on every drop target, holding `targetKey(target)`. It lives beside
 * `targetKey` (`layout/graphTypes.ts`), so the renderer and the palette read the one constant.
 */
export { GRAPH_TARGET_ATTR };

/** I3: the key of the graph target under a point, or null. */
export function resolveDropKey(x: number, y: number): string | null {
  if (typeof document.elementFromPoint !== "function") return null;
  const hit = document.elementFromPoint(x, y)?.closest(`[${GRAPH_TARGET_ATTR}]`);
  return hit?.getAttribute(GRAPH_TARGET_ATTR) ?? null;
}

/** Public props for {@link BuildPalette}. */
export interface BuildPaletteProps {
  model: PaletteModel;
  /** A drag started (the pointer moved more than 4 px): light the valid targets. */
  onDragStart(item: PaletteDragItem): void;
  /** Released: the key of the `data-graph-target` under the pointer, or null anywhere else. */
  onDrop(item: PaletteDragItem, targetKey: string | null): void;
  /** Escape, or the pointer was cancelled. */
  onDragCancel(): void;
}

const ROW = "flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2";

function Grip() {
  return (
    <GripVertical
      aria-hidden="true"
      data-palette-grip=""
      size={16}
      className="shrink-0 text-muted-foreground opacity-40"
    />
  );
}

/** What a draggable row draws: in the column, and as the drag preview. */
function RowFace({ item, section }: { item: PaletteItem; section: PaletteSection["id"] }) {
  if (section === "mandate") {
    return (
      <>
        <BlockMark logo="protocol" markId={item.id} name={item.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-foreground text-sm leading-normal">
            {item.name}
          </span>
          {item.caption ? (
            <span className="truncate text-muted-foreground text-xs leading-normal">
              {item.caption}
            </span>
          ) : null}
        </span>
        <Grip />
      </>
    );
  }
  return (
    <>
      <BlockMark logo="flow" markId={item.id} name={item.name} size={16} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm leading-normal">
        {item.name}
      </span>
      <Grip />
    </>
  );
}

function rowBox(section: PaletteSection["id"]): string {
  return section === "mandate" ? cn(ROW, "h-[57px] bg-surface") : cn(ROW, "h-[39px]");
}

interface Pending {
  item: PaletteItem;
  section: PaletteSection["id"];
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
}

/** The palette of the Build step. */
export function BuildPalette({ model, onDragStart, onDrop, onDragCancel }: BuildPaletteProps) {
  const [preview, setPreview] = useState<{
    item: PaletteItem;
    section: PaletteSection["id"];
    x: number;
    y: number;
  } | null>(null);
  const pending = useRef<Pending | null>(null);
  const detach = useRef<() => void>(() => {});
  const callbacks = useRef({ onDragStart, onDrop, onDragCancel });
  callbacks.current = { onDragStart, onDrop, onDragCancel };

  useEffect(() => () => detach.current(), []);

  const end = () => {
    detach.current();
    detach.current = () => {};
    pending.current = null;
    setPreview(null);
  };

  const begin = (
    event: ReactPointerEvent<HTMLElement>,
    item: PaletteItem,
    section: PaletteSection["id"],
  ) => {
    if (event.button !== 0 || !item.drag) return;
    detach.current();
    pending.current = {
      item,
      section,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    };
    const drag = item.drag;
    const onMove = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!p.started) {
        if (!exceedsPanThreshold(e.clientX - p.startX, e.clientY - p.startY)) return;
        p.started = true;
        callbacks.current.onDragStart(drag);
      }
      setPreview({ item: p.item, section: p.section, x: e.clientX, y: e.clientY });
    };
    const onUp = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      const started = p.started;
      end();
      if (started) callbacks.current.onDrop(drag, resolveDropKey(e.clientX, e.clientY));
    };
    const onCancel = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      const started = p.started;
      end();
      if (started) callbacks.current.onDragCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !pending.current) return;
      const started = pending.current.started;
      end();
      if (started) callbacks.current.onDragCancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    detach.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  };

  const captionAfter = model.sections.findLast((s) => s.id !== "comingSoon")?.id ?? null;

  return (
    <div
      data-testid="build-palette"
      data-build-palette=""
      className="flex max-h-[640px] w-full flex-col gap-5 overflow-y-auto"
    >
      {model.sections.map((section) => (
        <PaletteGroup
          key={section.id}
          section={section}
          soonTag={model.soonTag}
          soonTooltip={model.soonTooltip}
          onPointerDown={begin}
          caption={section.id === captionAfter ? model.caption : null}
        />
      ))}
      {preview
        ? createPortal(
            <div
              data-palette-preview=""
              aria-hidden="true"
              style={{
                position: "fixed",
                left: preview.x,
                top: preview.y,
                opacity: 0.8,
                pointerEvents: "none",
                transform: "translate(-12px, -50%)",
              }}
              className={cn(rowBox(preview.section), "z-[60] w-[220px] cursor-grabbing")}
            >
              <RowFace item={preview.item} section={preview.section} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function PaletteGroup({
  section,
  soonTag,
  soonTooltip,
  caption,
  onPointerDown,
}: {
  section: PaletteSection;
  soonTag: string;
  soonTooltip: string;
  caption: string | null;
  onPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    item: PaletteItem,
    section: PaletteSection["id"],
  ): void;
}) {
  const labelId = useId();
  return (
    <>
      <div className="flex flex-col gap-2">
        <p
          id={labelId}
          className="font-medium text-[11px] text-muted-foreground uppercase leading-normal tracking-wide"
        >
          {section.label}
        </p>
        <ul aria-labelledby={labelId} className="flex flex-col gap-2">
          {section.items.map((item) =>
            section.id === "comingSoon" ? (
              <li key={item.id} data-palette-item={item.id} data-draggable="false">
                <Explained tooltip={soonTooltip} className={cn(ROW, "h-[39px]")}>
                  <span className="flex min-w-0 flex-1 items-center gap-2 opacity-60">
                    <BlockMark logo="protocol" markId={item.id} name={item.name} />
                    <span className="truncate text-muted-foreground text-sm leading-normal">
                      {item.name}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground leading-none">
                    {soonTag}
                  </span>
                </Explained>
              </li>
            ) : (
              // A pointer drag source, not a control: the keyboard path to the same slots is the
              // canvas menus (D22).
              <li
                key={item.id}
                data-palette-item={item.id}
                data-draggable="true"
                onPointerDown={(event) => onPointerDown(event, item, section.id)}
                className={cn(rowBox(section.id), "cursor-grab touch-none select-none")}
              >
                <RowFace item={item} section={section.id} />
              </li>
            ),
          )}
        </ul>
      </div>
      {caption ? <p className="text-muted-foreground text-xs leading-normal">{caption}</p> : null}
    </>
  );
}
