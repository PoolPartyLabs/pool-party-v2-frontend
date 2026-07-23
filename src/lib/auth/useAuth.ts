"use client";

/**
 * @id PP-AUTH (POO-196, POO-199, POO-200)
 * @name useAuth
 * @implements-rules-version v1
 *
 * Unified auth hook. In real mode wraps Privy's useLogin/useLogout/usePrivy + wagmi useAccount.
 * In mock mode delegates to the mock authService from services/index.ts. Consumers call login()
 * and logout() without caring which mode is active.
 *
 * POO-199: Exposes classified error state from Privy's onError callback.
 * POO-200: Exposes loginResult (isNewUser/loginMethod) and isLoggingIn for e2e flow routing.
 */
import { useLogin, useLogout, usePrivy, useWallets } from "@privy-io/react-auth";
import { useCallback, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import type { Session } from "@/lib/services/index";
import { authService, isMockMode } from "@/lib/services/index";
import type { AuthErrorCategory } from "./classifyAuthError";
import { classifyAuthError } from "./classifyAuthError";

/** Result of a successful Privy login, used for routing decisions. */
export interface LoginResult {
  /** Whether this is the user's first login to the app (Privy-provided). */
  isNewUser: boolean;
  /** The login method used (e.g. "google", "wallet", "email"). */
  loginMethod: string | null;
}

/** Login method hint passed to login() to scope Privy's modal to a single method. */
export type LoginMethodHint = "google" | "wallet";

interface AuthState {
  /** Which mode is active. */
  mode: "mock" | "privy";
  /** Whether the user is authenticated (Privy authenticated + wagmi connected in real mode). */
  isAuthenticated: boolean;
  /** The connected wallet address, if any. */
  address: `0x${string}` | undefined;
  /** Whether the auth state is still loading. */
  isLoading: boolean;
  /**
   * Open the login flow. In real mode, opens Privy's popup scoped to the given method.
   * Pass "google" to show only Google OAuth, "wallet" for wallet connectors only,
   * or omit for Privy's default (all configured methods).
   */
  login: (method?: LoginMethodHint) => void;
  /** Log out and disconnect the wallet. */
  logout: () => void;
  /** Classified error from the last auth attempt, or null. Resets on new login(). */
  error: AuthErrorCategory | null;
  /** Result of the last successful login. Null until onComplete, cleared on logout. */
  loginResult: LoginResult | null;
  /** True between login() call and onComplete/onError. Used to disable UI during popup. */
  isLoggingIn: boolean;
}

/** Mock-mode auth: delegates to the imperative authService. */
function useMockAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);

  const login = useCallback(() => {
    authService.loginWithGoogle().then(setSession);
  }, []);

  const logout = useCallback(() => {
    authService.logout().then(() => setSession(null));
  }, []);

  return {
    mode: "mock",
    isAuthenticated: session !== null,
    address: session?.address as `0x${string}` | undefined,
    isLoading: false,
    login,
    logout,
    error: null,
    loginResult: null,
    isLoggingIn: false,
  };
}

/**
 * Real-mode auth: wraps Privy hooks. Opens Privy's built-in popup on login().
 *
 * biome-ignore: isMockMode is a module-level constant derived from an env var.
 * It never changes between renders, so the conditional dispatch in useAuth()
 * always picks the same branch for the lifetime of the process. Hook call
 * order is stable within each branch.
 */
function usePrivyAuth(): AuthState {
  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch (isMockMode is a build-time constant)
  const [error, setError] = useState<AuthErrorCategory | null>(null);
  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const [loginResult, setLoginResult] = useState<LoginResult | null>(null);
  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const { authenticated, ready } = usePrivy();
  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const { ready: walletsReady } = useWallets();
  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const { address, isConnected } = useAccount();
  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const { disconnect: wagmiDisconnect } = useDisconnect();

  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const { login: privyLogin } = useLogin({
    onComplete({ isNewUser, loginMethod }) {
      setError(null);
      setIsLoggingIn(false);
      setLoginResult({ isNewUser, loginMethod: loginMethod as string | null });
    },
    onError(errorCode) {
      const category = classifyAuthError(errorCode);
      setError(category);
      setIsLoggingIn(false);
      if (category !== "cancelled") {
        console.error("[useAuth] login failed", errorCode, "->", category);
      }
    },
  });

  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const { logout: privyLogout } = useLogout({
    onSuccess() {
      wagmiDisconnect();
      setLoginResult(null);
    },
  });

  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const login = useCallback(
    (method?: LoginMethodHint) => {
      setError(null);
      setIsLoggingIn(true);
      // Scope Privy's modal to the requested method (POO-200).
      // "google" → only Google OAuth; "wallet" → only wallet connectors.
      const loginMethods = method ? [method] : undefined;
      privyLogin(loginMethods ? { loginMethods } : undefined);
    },
    [privyLogin],
  );

  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const logout = useCallback(() => {
    setLoginResult(null);
    privyLogout();
  }, [privyLogout]);

  // Privy authenticated but wagmi hasn't connected yet: still loading (post-login handshake).
  const isHandshaking = authenticated && !isConnected;

  return {
    mode: "privy",
    isAuthenticated: authenticated && isConnected,
    address,
    isLoading: !ready || !walletsReady || isHandshaking,
    login,
    logout,
    error,
    loginResult,
    isLoggingIn,
  };
}

/**
 * Unified auth hook. Returns login/logout functions and auth state.
 * In mock mode: uses the mock authService.
 * In real mode: opens Privy's built-in popup (Google + wallet selection).
 */
export function useAuth(): AuthState {
  // Hooks must be called unconditionally, but we can choose which result to return.
  // In mock mode, Privy hooks aren't mounted (Providers is a passthrough), so we
  // can only call them in real mode.
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant, branch is stable across renders
    return useMockAuth();
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant, branch is stable across renders
  return usePrivyAuth();
}
