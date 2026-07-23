/**
 * @id PP-CORE-LIB-039 (POO-751)
 * @name unsavedChanges
 * @implements-rules-version v1
 *
 * The unsaved-changes navigation guard: a provider + hooks that warn before leaving a screen with a
 * dirty (unsaved) form. Two surfaces cooperate (POO-751):
 *
 *  - {@link useUnsavedChanges}(dirty): a save-bearing screen registers its `dirty` flag. While ANY
 *    registered form is dirty the provider is "armed"; the hook also installs a `beforeunload`
 *    listener so the BROWSER's native prompt fires on tab-close / refresh / hard navigation (a custom
 *    modal is impossible there — browser security, [R2]).
 *  - {@link useNavigationGuard}(): IN-APP navigation sites (nav links, tab switches, back links) wrap
 *    their navigation in `guard(proceed)`. When armed, `guard` opens ONE {@link ConfirmDialog} and
 *    runs `proceed` only if the user confirms "Leave"; otherwise it runs `proceed` immediately ([R1]).
 *
 * The App Router exposes no navigation-block API, so interception is explicit at the nav sites
 * ({@link GuardedLink}, ConsoleShell's tab switch). The browser BACK button is intentionally NOT
 * modal-guarded in this MVP (decision 2026-07-09); `beforeunload` still covers close/refresh.
 */
"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** The provider API consumed by {@link useUnsavedChanges} + {@link useNavigationGuard}. */
interface UnsavedChangesContextValue {
  /** Register/update a form's dirty flag, keyed by a stable id (cleared on unmount / when clean). */
  setDirty: (id: string, dirty: boolean) => void;
  /**
   * Run `proceed` immediately when no registered form is dirty; when one is, open the confirm modal
   * and run `proceed` only if the user confirms leaving.
   */
  guard: (proceed: () => void) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

/**
 * Mounts the single confirm modal and tracks whether any registered form is dirty. Placed above the
 * app chrome (the AppShell) so both the chrome's nav links and the page content can consume it.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  // The set of dirty form ids. A ref (not state): reads are pull-based via `guard`, so a form going
  // dirty/clean must NOT re-render the whole app subtree — only the modal open-state (below) does.
  const dirtyIds = useRef<Set<string>>(new Set());
  // The deferred navigation awaiting confirmation (null = modal closed). Stored as state so the
  // modal opens/closes; wrapped in an outer fn because useState treats a bare fn arg as an updater.
  const [pending, setPending] = useState<(() => void) | null>(null);

  const setDirty = useCallback((id: string, dirty: boolean) => {
    if (dirty) dirtyIds.current.add(id);
    else dirtyIds.current.delete(id);
  }, []);

  const guard = useCallback((proceed: () => void) => {
    if (dirtyIds.current.size === 0) {
      proceed();
      return;
    }
    setPending(() => proceed);
  }, []);

  const value = useMemo<UnsavedChangesContextValue>(() => ({ setDirty, guard }), [setDirty, guard]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t("unsavedChanges.title")}
        body={t("unsavedChanges.body")}
        confirmLabel={t("unsavedChanges.leave")}
        cancelLabel={t("unsavedChanges.stay")}
        // "Leave" discards the edits and runs the deferred navigation; ConfirmDialog closes after.
        onConfirm={() => pending?.()}
      />
    </UnsavedChangesContext.Provider>
  );
}

/**
 * Register a save-bearing form's `dirty` state with the guard ([R2]/[R6]). While dirty, the browser's
 * native `beforeunload` prompt fires on close/refresh/hard-nav. No-ops safely without a provider
 * (still installs `beforeunload`), so a screen rendered outside the shell / in a test degrades cleanly.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const ctx = useContext(UnsavedChangesContext);
  const id = useId();

  useEffect(() => {
    ctx?.setDirty(id, dirty);
    return () => ctx?.setDirty(id, false);
  }, [ctx, id, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Modern browsers show their own generic prompt; preventDefault + returnValue arms it.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

/**
 * Returns `guard(proceed)` for an in-app navigation site ([R1]). Without a provider it runs `proceed`
 * straight through, so a nav site works unguarded outside the shell (and in isolation tests).
 */
export function useNavigationGuard(): (proceed: () => void) => void {
  const ctx = useContext(UnsavedChangesContext);
  return useCallback((proceed: () => void) => (ctx ? ctx.guard(proceed) : proceed()), [ctx]);
}
