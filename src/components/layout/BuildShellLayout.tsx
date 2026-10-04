/**
 * @id PP-CORE-LAY-001 (private context)
 * @name BuildShellLayout
 * @implements-rules-version v1 (POO-2209)
 * @analytics-events none, effective layout state only
 */
"use client";
import { createContext, useContext, useEffect } from "react";
export const BuildShellLayoutContext = createContext<((build: boolean) => void) | null>(null);
export function useBuildShellLayout(build: boolean) {
  const setBuild = useContext(BuildShellLayoutContext);
  useEffect(() => {
    setBuild?.(build);
    return () => setBuild?.(false);
  }, [build, setBuild]);
}
