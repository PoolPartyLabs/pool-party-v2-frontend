"use client";

import { useCallback, useEffect, useState } from "react";

/** A state updater that accepts the next value or a function of the previous value. */
type SetValue<T> = (next: T | ((prev: T) => T)) => void;

/**
 * SSR-safe React state that persists to `localStorage` under `key`.
 *
 * Use this ONLY for simple, non-sensitive UI preferences — sort order, filters, view toggles, a
 * dismissed hint. NEVER store tokens, balances, addresses, or auth/role flags (e.g. manager/
 * `isManager`): those are security-relevant and must come from the session/backend, never from a
 * value the user can edit in devtools. The stored value must be JSON-serializable.
 *
 * Hydration-safe: the server and the first client render both use `initialValue` (so the markup
 * matches and React doesn't warn), then an effect reads the persisted value and updates it. Writes
 * happen only when the returned setter is called (a user action) — never on mount — so a stored
 * preference is never clobbered by the initial value. Changes are mirrored across tabs via the
 * `storage` event. If `localStorage` is unavailable (private mode, quota, SSR) every access fails
 * silently and the hook behaves like `useState`.
 *
 * @param key Stable `localStorage` key. Prefix with the app namespace, e.g. `"pp.strategies.sort"`.
 * @param initialValue Value used before hydration and when nothing is stored.
 */
export function usePersistentState<T>(key: string, initialValue: T): [T, SetValue<T>] {
  const [value, setValue] = useState<T>(initialValue);

  // Hydrate from localStorage after mount (client only); falls back to initialValue on any failure.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Unavailable storage or malformed JSON — keep initialValue.
    }
  }, [key]);

  // Keep other tabs in sync without writing back (avoids an echo loop).
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== key || event.newValue === null) return;
      try {
        setValue(JSON.parse(event.newValue) as T);
      } catch {
        // Ignore a malformed cross-tab payload.
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  // Persist only on an explicit update, so hydration never overwrites the stored value.
  const setPersistent = useCallback<SetValue<T>>(
    (next) => {
      setValue((prev) => {
        const resolved = next instanceof Function ? next(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Ignore quota/availability errors — state still updates in memory.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, setPersistent];
}
