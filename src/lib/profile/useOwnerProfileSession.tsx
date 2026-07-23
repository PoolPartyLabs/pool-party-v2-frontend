/**
 * @id PP-PROF-CTX-001 (POO-779)
 * @name owner profile session store
 * @implements-rules-version v2
 *
 * The client session store for the signed-in owner's profile (POO-779 R2). It fetches the owner
 * profile ONCE per signed-in session via {@link getOwnerProfileAction} (the `/users/me` read — NOT a
 * positions drain, R1), shares it with every consumer, refetches on wallet change and on a SIWE
 * re-sign, and exposes {@link OwnerProfileSession.markManager} so a create-pool success flips the role
 * locally without another read. Today the sole field is the manager role; it is the natural landing spot
 * for the POO-704 display-name reader and any future owner-scoped client state.
 *
 * Loading semantics preserve the POO-456 sidebar flash guard: through the SIWE signing window the store
 * reports `loading`, so `useIsManager` keeps the manager entry's skeleton instead of flashing
 * "Become a manager" before the role resolves. Real-mode only, mirroring {@link SiweSessionProvider}: in
 * mock mode it is never mounted (Providers is a pass-through) and its default context reports idle, while
 * `useIsManager` short-circuits to the Dev-menu toggle there (R5).
 *
 * Structure mirrors `useSiweSession` (the established session-context precedent); the repo uses React
 * context, not Zustand, for shared client-session state.
 */
"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { isMockMode } from "@/lib/services";
import { getOwnerProfileAction } from "./ownerProfileActions";

/** Lifecycle of the owner profile session read. */
export type OwnerProfileStatus = "idle" | "loading" | "loaded" | "error";

/** The shared owner profile session. */
export interface OwnerProfileSession {
  /** Where the once-per-session read is: idle (not signed in), loading, loaded, or a degraded error. */
  status: OwnerProfileStatus;
  /** Whether the signed-in wallet is a manager (only meaningful once `status` is `loaded`). */
  isManager: boolean;
  /** Flip the role to manager locally after a create-pool success — no refetch (R2). */
  markManager: () => void;
}

const DEFAULT_SESSION: OwnerProfileSession = {
  status: "idle",
  isManager: false,
  markManager: () => {},
};

const OwnerProfileSessionContext = createContext<OwnerProfileSession>(DEFAULT_SESSION);

/** Read the shared owner profile session. */
export function useOwnerProfileSession(): OwnerProfileSession {
  return useContext(OwnerProfileSessionContext);
}

/** Reactive state of the once-per-session read (the `markManager` mutator is added by the provider). */
type OwnerProfileState = Pick<OwnerProfileSession, "status" | "isManager">;

/** Real-mode provider: fetches the owner profile once per signed-in session and shares it. */
function RealOwnerProfileSessionProvider({ children }: { children: ReactNode }) {
  const { status: siweStatus, isSignedIn } = useSiweSession();
  const { address } = useAuth();
  // Init `loading`, not `idle`: on the first paint (SSR + hydration, before the mount effect runs) a
  // settled signed-in manager must hold the sidebar skeleton, not flash "Become a manager" (POO-456).
  // The effect still settles to `idle` for a not-signed-in user and `loaded`/`error` otherwise.
  const [state, setState] = useState<OwnerProfileState>({ status: "loading", isManager: false });
  // The wallet key we've already fetched for in the current signed-in epoch. Reset on sign-out and on a
  // fresh handshake so a wallet change or a re-sign refetches; unchanged across renders so a stable
  // signed-in session fetches exactly once.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    // Signing window: the SIWE handshake is running. Hold `loading` so the sidebar keeps its skeleton
    // (no "Become a manager" flash, POO-456); keep the last known role. Clear the fetch key so the role
    // is re-read once the (re-)sign settles.
    if (siweStatus === "signing") {
      loadedFor.current = null;
      setState((prev) => ({ status: "loading", isManager: prev.isManager }));
      return;
    }
    // Settled not-signed-in (idle / logged-out) or a failed handshake: terminal investor, no read.
    if (siweStatus === "error" || !isSignedIn) {
      loadedFor.current = null;
      setState({ status: "idle", isManager: false });
      return;
    }
    // Signed in: fetch the owner profile once per (wallet, signed-in epoch).
    const key = address ?? "session";
    if (loadedFor.current === key) return;
    loadedFor.current = key;

    let active = true;
    setState((prev) => ({ status: "loading", isManager: prev.isManager }));
    getOwnerProfileAction()
      .then((snapshot) => {
        if (active) setState({ status: "loaded", isManager: snapshot.isManager });
      })
      .catch(() => {
        // getOwnerProfileAction already degrades internally; this is a belt-and-suspenders investor
        // fallback for a transport failure of the action itself.
        if (active) setState({ status: "error", isManager: false });
      });
    return () => {
      active = false;
    };
  }, [siweStatus, isSignedIn, address]);

  const markManager = useCallback(() => {
    setState({ status: "loaded", isManager: true });
  }, []);

  return (
    <OwnerProfileSessionContext.Provider value={{ ...state, markManager }}>
      {children}
    </OwnerProfileSessionContext.Provider>
  );
}

/**
 * Provides the owner profile session. Gated on `!isMockMode`, mirroring {@link SiweSessionProvider}: in
 * mock mode it reports the idle default without touching the auth/session hooks, and `useIsManager`
 * short-circuits to the Dev-menu toggle there.
 */
export function OwnerProfileSessionProvider({ children }: { children: ReactNode }) {
  if (isMockMode) {
    return (
      <OwnerProfileSessionContext.Provider value={DEFAULT_SESSION}>
        {children}
      </OwnerProfileSessionContext.Provider>
    );
  }
  return <RealOwnerProfileSessionProvider>{children}</RealOwnerProfileSessionProvider>;
}
