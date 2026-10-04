/**
 * @id PP-MGR-CMP-059
 * @name useTextWidth
 * @implements-rules-version v1 (POO-2156 rules v1)
 * @analytics-events none, a measuring hook: nothing here is rendered or tracked.
 *
 * The width, in px, of one line of `text` drawn in `font` (a CSS font shorthand), measured with a
 * canvas `measureText` (coordinator plan section 3.5). It rides on PP-MGR-CMP-059: the renderer
 * measures the empty canvas's start-here sentence with it, and that width feeds `layoutGraph`
 * (`LayoutOptions.startHereWidth`), which shifts the empty graph by it in every locale ([L6]).
 *
 * Why this way:
 *
 * 1. **No layout thrash.** A canvas measures text without the page's layout: nothing is inserted
 *    into the document and no box is read. The only style read is the page's value of the CSS
 *    variables named in `font`, once per measure.
 * 2. **A sensible value before the first measure.** The server and the first client render have no
 *    measure, so the hook returns an ESTIMATE that matches the drawn English sentence (420 px for 72
 *    characters, canvas D). The measure runs in a layout effect, so the browser never paints the
 *    estimate; jsdom, which has no canvas, keeps it, so tests are deterministic.
 * 3. **The app's font.** The family is the brand face loaded by `next/font` under a hashed name, set
 *    on the page as `--font-poppins` (see `src/app/[locale]/layout.tsx`). A canvas cannot read a CSS
 *    variable, so the variables in `font` are resolved against `document.body` before measuring; one
 *    the page does not define is dropped and the fallbacks of the stack apply.
 * 4. **Measured again when it can change:** a new text or font (another locale), and when a web font
 *    finishes loading (`document.fonts`), since a measure taken with the fallback face is wrong.
 *
 * PP-NOTE: only `OffscreenCanvas` is used (every evergreen browser has it). Where it is missing the
 * estimate stays, which only moves an empty canvas by a few pixels.
 */
"use client";

import { useEffect, useLayoutEffect, useState } from "react";

// useLayoutEffect measures before paint in the browser; on the server it would only warn.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** px per character of Caption/Default: the drawn English sentence is 420 px for 72 characters. */
const CHAR_WIDTH_ESTIMATE = 420 / 72;

/** The width the hook reports until a canvas has measured the text. */
export function estimateTextWidth(text: string): number {
  return Math.ceil(text.length * CHAR_WIDTH_ESTIMATE);
}

/**
 * `font` with every `var(--name)` replaced by `read(name)`; a variable that reads empty is dropped
 * with its comma, so the rest of the family stack applies.
 */
export function resolveFontVariables(font: string, read: (name: string) => string): string {
  return font
    .replace(/var\((--[\w-]+)\)\s*(,\s*)?/g, (_match, name: string, comma: string | undefined) => {
      const value = read(name).trim();
      return value ? `${value}${comma ? ", " : ""}` : "";
    })
    .trim();
}

/** A canvas measure of `text` in `font`, or null where no canvas exists or it answers no width. */
function measure(text: string, font: string): number | null {
  if (typeof OffscreenCanvas === "undefined" || typeof document === "undefined") return null;
  const context = new OffscreenCanvas(1, 1).getContext("2d");
  if (!context) return null;
  const page = getComputedStyle(document.body);
  context.font = resolveFontVariables(font, (name) => page.getPropertyValue(name));
  const width = context.measureText(text).width;
  return Number.isFinite(width) && width > 0 ? width : null;
}

interface Measured {
  text: string;
  font: string;
  width: number;
}

/** The width of one line of `text` in `font`, in px (see the file header). */
export function useTextWidth(text: string, font: string): number {
  const [measured, setMeasured] = useState<Measured | null>(null);

  useIsomorphicLayoutEffect(() => {
    let active = true;
    const update = () => {
      if (!active) return;
      const width = measure(text, font);
      if (width === null) return;
      setMeasured((previous) =>
        previous && previous.text === text && previous.font === font && previous.width === width
          ? previous
          : { text, font, width },
      );
    };
    update();
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts) {
      return () => {
        active = false;
      };
    }
    fonts.ready?.then(update, () => {});
    fonts.addEventListener?.("loadingdone", update);
    return () => {
      active = false;
      fonts.removeEventListener?.("loadingdone", update);
    };
  }, [text, font]);

  // A measure of another text or font is stale until the effect measures again.
  return measured && measured.text === text && measured.font === font
    ? measured.width
    : estimateTextWidth(text);
}
