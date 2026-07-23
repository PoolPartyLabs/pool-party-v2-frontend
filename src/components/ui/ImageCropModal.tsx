/**
 * @id PP-CORE-MOD-007
 * @name ImageCropModal
 * @implements-rules-version v3 (POO-571 rules-v1: restore drag + zoom after the POO-545 onLoad race)
 *
 * Image crop dialog shared by the avatar (1:1) and banner (16:9) uploads: drag to reposition,
 * zoom slider, optional dashed safe-area overlay (the YouTube channel-art rule: edge content
 * crops on smaller screens). Purely presentational and props-based: the consumer passes
 * already-translated strings (no i18n inside, mirroring EmptyState). Apply renders the visible
 * crop to a canvas and returns a data URL; where canvas/image decoding is unavailable (jsdom),
 * it falls back to the original source so flows stay testable.
 *
 * POO-545 (rules v1): the preview <img> and the export canvas share ONE geometry function
 * ({@link coverRect}) so they can never diverge. The preview used to be `object-cover size-full`
 * (which center-crops the bitmap to the frame BEFORE the pan/zoom transform, so an off-aspect image
 * could never be dragged to reveal its clipped edges) while the canvas drew the FULL natural bitmap
 * positioned by the pan — preview and result disagreed. Now the preview is sized to the exact
 * cover-fit rectangle [R1]. Pan is clamped so a cover-or-larger image never opens a gap at the frame
 * edge [R2]; `minZoom < 1` (POO-360) still lets the image sit smaller than the frame, centered.
 *
 * POO-571 (rules v1): drag + zoom were dead after POO-545 because `previewRect` needs both the
 * natural bitmap size AND a measured viewport, and neither was reliably set. Consumers pass
 * `URL.createObjectURL(file)` blob: URLs that can be `complete` before React attaches `onLoad`, so
 * `onLoad` never fired and `natural` stayed null → the <img> was stuck in the object-cover fallback
 * with no transform. Fix (additive, geometry unchanged): capture the natural size from a ref callback
 * whenever the image is already `complete` [R1] (keep `onLoad` for the not-yet-decoded case), and
 * re-measure the viewport on open (via rAF, after layout) and from the image load path [R2]. [R5]
 * widens {@link clampPan} by `PAN_SLACK` so there is always some drag affordance even at zoom 1.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { cn } from "@/lib/utils/cn";

/**
 * POO-545: the cover-fit base scale — the smallest scale at which the natural image fully covers the
 * viewport (so at zoom 1 there is never a gap). Guards degenerate sizes (jsdom / not-yet-loaded).
 */
export function coverBaseScale(vw: number, vh: number, nw: number, nh: number): number {
  if (vw <= 0 || vh <= 0 || nw <= 0 || nh <= 0) return 1;
  return Math.max(vw / nw, vh / nh);
}

/** The displayed image rectangle, in viewport pixels. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * POO-545 [R1]: the displayed image rectangle (viewport px) for a zoom + pan. The SINGLE source of
 * truth shared by the preview <img> styling and the export canvas draw, so what the frame shows and
 * what gets rasterized are the same rect by construction. Cover-fit at zoom 1, scaled by the user
 * zoom, centered in the viewport, then offset by the pan.
 */
export function coverRect(
  vw: number,
  vh: number,
  nw: number,
  nh: number,
  zoom: number,
  panX: number,
  panY: number,
): CropRect {
  const scale = coverBaseScale(vw, vh, nw, nh) * zoom;
  const width = nw * scale;
  const height = nh * scale;
  return { width, height, left: (vw - width) / 2 + panX, top: (vh - height) / 2 + panY };
}

/**
 * POO-571 [R5]: extra drag range, as a fraction of the viewport dimension, granted on EVERY axis so
 * the user always has some pan affordance, even for an aspect-matched image at zoom 1 (which the
 * pure no-gap clamp pinned to 0). Over-panning past the no-gap bound may expose a small edge gap in
 * the preview, and because coverRect is unchanged the export rasterizes with that exact same gap.
 * Approved by Murilo (2026-07-05).
 */
export const PAN_SLACK = 0.5;

/**
 * POO-545 [R2] + POO-571 [R5]: clamp the pan. The base bound per axis is the no-gap bound (the overlap
 * a cover-or-larger image has beyond the frame). POO-571 [R5] widens each axis to at least
 * `PAN_SLACK * viewportDim`, so an aspect-matched / zoom-1 / below-cover image still has a bounded
 * drag range instead of being pinned. For a naturally-overflowing image the no-gap bound dominates,
 * so today's gap-free feel is preserved; only when the slack exceeds the overlap can a small edge gap
 * appear (accepted, and it rasterizes identically since coverRect is unchanged).
 */
export function clampPan(
  vw: number,
  vh: number,
  nw: number,
  nh: number,
  zoom: number,
  panX: number,
  panY: number,
): { x: number; y: number } {
  const scale = coverBaseScale(vw, vh, nw, nh) * zoom;
  const noGapX = Math.max(0, (nw * scale - vw) / 2);
  const noGapY = Math.max(0, (nh * scale - vh) / 2);
  const maxX = Math.max(noGapX, PAN_SLACK * vw);
  const maxY = Math.max(noGapY, PAN_SLACK * vh);
  return {
    x: Math.min(maxX, Math.max(-maxX, panX)),
    y: Math.min(maxY, Math.max(-maxY, panY)),
  };
}

/** Public props for {@link ImageCropModal}. */
export interface ImageCropModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The image to crop (object/data/remote URL). */
  src: string;
  /** Crop aspect ratio (width / height), e.g. `1` for avatars, `16 / 9` for banners. */
  aspect: number;
  /** Already-translated dialog title. */
  title: string;
  /** Optional already-translated helper copy under the title. */
  description?: string;
  /** Show the dashed center safe-area overlay (banners). */
  showSafeArea?: boolean;
  /** Already-translated label for the safe-area overlay. */
  safeAreaLabel?: string;
  /** Already-translated accessible label for the zoom slider. */
  zoomLabel: string;
  /** Already-translated apply button label. */
  applyLabel: string;
  /** Already-translated cancel button label. */
  cancelLabel: string;
  /** Receives the cropped image as a data URL (or the original src when canvas is unavailable). */
  onApply: (dataUrl: string) => void;
  /** Output width in pixels; height follows the aspect. Defaults to 1280 (banner) / 512 (square). */
  outputWidth?: number;
  /**
   * Render the crop frame as a circle (logos / avatars shown round). The rasterized output stays a
   * square PNG; the round shape is applied where the image is displayed (`rounded-full`).
   */
  round?: boolean;
  /**
   * Minimum zoom. Defaults to 1 (the image always at least covers the frame). Pass a value < 1 to
   * allow zooming OUT below the cover fit, so the image can sit smaller than the frame with
   * transparent padding around it.
   */
  minZoom?: number;
}

/** Drag + zoom state for the image inside the viewport. */
interface Transform {
  /** Zoom multiplier on top of the cover fit (1 = exactly covers the viewport). */
  zoom: number;
  /** Pan offsets in viewport pixels, applied from the centered position. */
  x: number;
  y: number;
}

/** An image crop dialog (drag + zoom + optional safe area). */
export function ImageCropModal({
  open,
  onOpenChange,
  src,
  aspect,
  title,
  description,
  showSafeArea = false,
  safeAreaLabel,
  zoomLabel,
  applyLabel,
  cancelLabel,
  onApply,
  outputWidth,
  round = false,
  minZoom = 1,
}: ImageCropModalProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );
  const [t, setT] = useState<Transform>({ zoom: 1, x: 0, y: 0 });
  // POO-545: the natural bitmap size and the live viewport size drive the shared cover-fit geometry.
  // Both are 0/null until measured (jsdom, pre-decode) → the preview falls back to object-cover and
  // handleApply ships the uncropped source. POO-571: `natural` is now captured whenever the <img> is
  // `complete`, not only via onLoad, so a fast-decoding blob: URL still activates the preview.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // POO-571 [R1]: read the decoded bitmap size from any image element that already reports it. Only
  // sets state when the value actually changes, so a ref callback / onLoad / effect can all call this
  // without churn or a render loop.
  const captureNatural = useCallback((img: HTMLImageElement | null) => {
    if (!img?.complete) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w <= 0 || h <= 0) return;
    setNatural((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  // POO-571 [R2]: measure the viewport box. Only sets state when it changes (guards render loops).
  const measureViewport = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setViewport((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  // POO-571 [R1]: ref callback that both stores the node (handleApply reads imgRef) and captures the
  // natural size the moment React attaches an already-decoded image — the case onLoad misses.
  const setImgRef = useCallback(
    (node: HTMLImageElement | null) => {
      imgRef.current = node;
      captureNatural(node);
    },
    [captureNatural],
  );

  // Reset the transform whenever a NEW image (src) comes in. POO-571: do NOT null `natural` blindly;
  // re-read the (possibly already-decoded) image so the preview does not drop back to object-cover.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `src` is the intentional re-run trigger.
  useEffect(() => {
    setT({ zoom: 1, x: 0, y: 0 });
    captureNatural(imgRef.current);
  }, [src, captureNatural]);

  // POO-545/POO-571 [R2]: keep the viewport size fresh so the preview geometry matches the canvas
  // (which reads the live viewport at apply time). The first measure can run before the dialog is
  // laid out (clientWidth 0), so also measure on the next frame. ResizeObserver is guarded for jsdom.
  useEffect(() => {
    if (!open) return;
    measureViewport();
    const raf =
      typeof requestAnimationFrame === "function" ? requestAnimationFrame(measureViewport) : null;
    const el = viewportRef.current;
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measureViewport);
      ro.observe(el);
    }
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [open, measureViewport]);

  /** Clamp a candidate pan to the frame-covering bounds (no-op until measured). */
  function withClampedPan(zoom: number, x: number, y: number): Transform {
    if (!natural || viewport.w <= 0) return { zoom, x, y };
    const p = clampPan(viewport.w, viewport.h, natural.w, natural.h, zoom, x, y);
    return { zoom, x: p.x, y: p.y };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: t.x, baseY: t.y };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setT((current) =>
      withClampedPan(
        current.zoom,
        drag.baseX + (event.clientX - drag.startX),
        drag.baseY + (event.clientY - drag.startY),
      ),
    );
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  /** Zoom to a new level, re-clamping the pan (zooming out can pull the image inside the frame). */
  function onZoomChange(zoom: number) {
    setT((current) => withClampedPan(zoom, current.x, current.y));
  }

  /** Renders the visible crop to a canvas; falls back to the original src in jsdom. */
  function handleApply() {
    try {
      const viewportEl = viewportRef.current;
      const img = imgRef.current;
      if (!viewportEl || !img?.naturalWidth) throw new Error("image not ready");
      const vw = viewportEl.clientWidth;
      const vh = viewportEl.clientHeight;
      const outW = outputWidth ?? (aspect === 1 ? 512 : 1280);
      const outH = Math.round(outW / aspect);
      const k = outW / vw;
      // POO-545: the SAME rectangle the preview shows, scaled to the output — preview and export
      // cannot diverge because both derive from coverRect.
      const rect = coverRect(vw, vh, img.naturalWidth, img.naturalHeight, t.zoom, t.x, t.y);
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, rect.left * k, rect.top * k, rect.width * k, rect.height * k);
      onApply(canvas.toDataURL("image/png"));
    } catch {
      // PP-NOTE: jsdom (and very old browsers) cannot rasterize; ship the uncropped source instead.
      onApply(src);
    }
    onOpenChange(false);
  }

  // POO-545 [R1]: the preview rectangle, from the SAME coverRect the canvas uses. Null until the
  // natural + viewport sizes are known (jsdom / pre-decode) → the <img> falls back to object-cover.
  const previewRect =
    natural && viewport.w > 0 && viewport.h > 0
      ? coverRect(viewport.w, viewport.h, natural.w, natural.h, t.zoom, t.x, t.y)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div
          ref={viewportRef}
          data-testid="crop-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={cn(
            "relative w-full cursor-grab touch-none select-none overflow-hidden bg-surface-raised active:cursor-grabbing",
            round ? "rounded-full" : "rounded-xl",
          )}
          style={{ aspectRatio: String(aspect) }}
        >
          {/* Decorative while cropping; the result carries the meaning. POO-545: sized to the exact
              cover-fit rectangle (coverRect) so the visible region matches the export — no object-cover
              pre-clip. Falls back to object-cover only until the natural + viewport sizes are known. */}
          <img
            ref={setImgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={(event) => {
              // POO-571 [R1]: capture for the not-yet-decoded case; [R2]: the dialog is laid out by
              // now, so re-measure the viewport in case the initial measure hit a zero box.
              captureNatural(event.currentTarget);
              measureViewport();
            }}
            className={cn(
              "pointer-events-none absolute select-none",
              !previewRect && "inset-0 size-full object-cover",
            )}
            style={
              previewRect
                ? {
                    left: `${previewRect.left}px`,
                    top: `${previewRect.top}px`,
                    width: `${previewRect.width}px`,
                    height: `${previewRect.height}px`,
                    maxWidth: "none",
                  }
                : undefined
            }
          />
          {showSafeArea ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[12%] rounded-lg border border-foreground/80 border-dashed"
            >
              {safeAreaLabel ? (
                <span className="absolute top-2 left-3 font-medium text-[11px] text-foreground/80">
                  {safeAreaLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="text-muted-foreground">
            −
          </span>
          <input
            type="range"
            aria-label={zoomLabel}
            min={minZoom}
            max={3}
            step={0.01}
            value={t.zoom}
            onChange={(event) => onZoomChange(Number(event.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-surface-raised accent-primary"
          />
          <span aria-hidden="true" className="text-muted-foreground">
            +
          </span>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button onClick={handleApply}>{applyLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
