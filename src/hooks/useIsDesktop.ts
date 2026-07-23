/**
 * @id PP-CORE-HOK-023
 * @name useIsDesktop
 * @implements-rules-version v1 (POO-847 rules v1)
 *
 * Whether the viewport is at/above the app's DESKTOP breakpoint (`lg`, 1024px — the AppShell
 * sidebar/mobile split). Returns `null` on the server and on the first client render (before the
 * measurement effect runs) so a caller can hold a skeleton instead of acting on a guess, then the
 * measured boolean, tracked live on matchMedia changes.
 *
 * POO-847 (rules v1): the managed-strategy surface is desktop-only for now — the POO-224
 * owner→manage redirect and the `/manager?manage=` deep link gate on this, so below `lg` an owned
 * strategy opens as a plain invested strategy.
 */
"use client";

import { useEffect, useState } from "react";

/** The app's desktop split — Tailwind v4's `lg` is 64rem (rem, NOT 1024px: media-query rem tracks
 * the browser's default font size, so a px query would disagree with the CSS chrome for users with
 * a non-default base font). matchMedia accepts rem. */
const DESKTOP_QUERY = "(min-width: 64rem)";

/** `null` until measured (SSR / first render), then the live `lg`-and-up boolean. */
export function useIsDesktop(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}
