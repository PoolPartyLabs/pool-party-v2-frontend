/**
 * @id PP-AUTH (POO-270, POO-376, POO-899)
 * @name SIWE session
 * @implements-rules-version v1
 *
 * Runs the SIWE handshake once after Privy login (nonce → sign the Pool Party message with the
 * connected wallet → sign-in), which persists the access token in an httpOnly cookie. Exposes
 * the session status so wallet-scoped data loaders can wait until the server can derive the
 * wallet identity. Real-mode only; in mock mode it reports signed-in without touching Privy.
 *
 * POO-376: when {@link isSiweEip4361Enabled} is on, the handshake signs a real EIP-4361 message
 * bound to the live origin + chain and forwards the full message so the backend can verify it
 * verbatim; otherwise it keeps the legacy branded message + payload unchanged.
 *
 * POO-899: the handshake lifecycle is keyed on wallet identity ONLY (`address`,
 * `isAuthenticated`); `signMessage`, `chainId` and the localized statement are read through a
 * latest-value ref. Privy rebuilds its context value on every PrivyProvider render, so
 * `signMessage` has a new identity each render; keeping it in the effect deps let any
 * mid-handshake re-render (e.g. WalletSwitchGuard's `router.refresh()` after an A-to-B wallet
 * switch) abandon the in-flight run while the one-shot `startedFor` ref blocked a re-subscribe,
 * silently dropping wallet B's successful sign-in and hanging the app on "signing".
 */
"use client";

import { useSignMessage } from "@privy-io/react-auth";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useChainId } from "wagmi";
import { getNonceAction, getSessionAction, signInAction } from "@/features/auth/siweActions";
import { defaultChain } from "@/lib/chains";
import { isMockMode } from "@/lib/services";
import { buildLegacySiweMessage, buildSiweMessage, isSiweEip4361Enabled } from "./siweMessage";
import { useAuth } from "./useAuth";

/** Lifecycle of the SIWE handshake. */
export type SiweStatus = "idle" | "signing" | "signed-in" | "error";

/** The current SIWE session. */
export interface SiweSession {
  status: SiweStatus;
  /** True once the access-token cookie is set (the server can derive the wallet). */
  isSignedIn: boolean;
  error: unknown;
}

// PP-NOTE: personal_sign is chain-agnostic; the API only uses `network` as verification context.
const SIWE_NETWORK = "arbitrum";

/** Per-handshake context resolved from the connected wallet + locale (used by the EIP-4361 path). */
interface SiweSignContext {
  /** EIP-155 chain id the connected wallet is on. */
  chainId: number;
  /** Localized, human-readable assertion shown in the wallet before signing. */
  statement: string;
}

/** Privy's `signMessage` call shape (the slice we use). */
type SignMessageFn = (
  input: { message: string },
  options: { address: string },
) => Promise<{ signature: string }>;

/**
 * In-flight handshake per wallet, kept at module scope so a React strict-mode double-mount (or any
 * remount within a page load) reuses the same promise instead of prompting a second signature. The
 * httpOnly access-token cookie is the durable cache across refreshes; this only dedupes concurrency.
 */
const inFlightHandshakes = new Map<string, Promise<boolean>>();

/**
 * Ensure the connected wallet has a server session, signing only when there isn't one already:
 *   1. If the session cookie already vouches for this wallet → reuse it (no signature).
 *   2. Otherwise run the SIWE handshake once (nonce → sign → sign-in).
 * Returns whether the wallet is signed in.
 */
async function ensureSignedIn(
  address: `0x${string}`,
  signMessage: SignMessageFn,
  ctx: SiweSignContext,
): Promise<boolean> {
  const key = address.toLowerCase();
  const pending = inFlightHandshakes.get(key);
  if (pending) return pending;

  const run = (async () => {
    // 1. Reuse an existing valid session for this wallet — no signature needed (the cached path).
    const sessionWallet = await getSessionAction();
    if (sessionWallet && sessionWallet.toLowerCase() === key) return true;
    // 2. No session: run the SIWE handshake (the single signature prompt).
    const nonce = await getNonceAction(address);

    if (isSiweEip4361Enabled) {
      // PP-SECURITY (POO-376): bind the signature to the LIVE origin + chain. A look-alike site
      // signs a message carrying its own host, which the backend (verifying against its own known
      // domain) rejects. The full message is forwarded so the backend verifies it verbatim.
      const message = buildSiweMessage({
        domain: window.location.host,
        uri: window.location.origin,
        address,
        chainId: ctx.chainId,
        nonce,
        statement: ctx.statement,
      });
      const { signature } = await signMessage({ message }, { address });
      // PP-INTEGRATION-POINT (POO-376): backend must verify this EIP-4361 message against its own
      // domain, check chainId/expiry, and burn the single-use nonce (companion pool-party-api issue).
      return signInAction({ wallet: address, signature, nonce, network: SIWE_NETWORK, message });
    }

    // Legacy path (flag off): the backend reconstructs this exact string and verifies against it.
    const message = buildLegacySiweMessage(address, nonce);
    const { signature } = await signMessage({ message }, { address });
    return signInAction({ wallet: address, signature, nonce, network: SIWE_NETWORK });
  })();
  inFlightHandshakes.set(key, run);
  // Drop once settled: the cookie is the durable cache, and a failure should stay retryable. The
  // trailing catch keeps this cleanup chain from re-throwing a rejected signature as an unhandled
  // rejection (POO-899); callers still observe the failure on the returned `run` promise.
  void run.finally(() => inFlightHandshakes.delete(key)).catch(() => {});
  return run;
}

const MOCK_SESSION: SiweSession = { status: "signed-in", isSignedIn: true, error: null };

const SiweSessionContext = createContext<SiweSession>(MOCK_SESSION);

/** Read the current SIWE session. */
export function useSiweSession(): SiweSession {
  return useContext(SiweSessionContext);
}

/** Real-mode provider: drives the handshake off the Privy auth state. */
function RealSiweSessionProvider({ children }: { children: ReactNode }) {
  const { address, isAuthenticated } = useAuth();
  const { signMessage } = useSignMessage();
  const chainId = useChainId() || defaultChain.id;
  const statement = useTranslations("auth")("signInStatement");
  const [session, setSession] = useState<SiweSession>({
    status: "idle",
    isSignedIn: false,
    error: null,
  });
  // The wallet we've already started a handshake for (avoids re-signing on every render).
  const startedFor = useRef<string | null>(null);

  // POO-899: latest-value ref for the handshake helpers, refreshed on every committed render. The
  // handshake effect below reads through it instead of depping on them, so Privy's per-render
  // `signMessage` identity churn (and a chain/locale change) never aborts an in-flight handshake.
  const latest = useRef({ signMessage, chainId, statement });
  useEffect(() => {
    latest.current = { signMessage, chainId, statement };
  });

  // [R1]/[R2] (POO-899): keyed on wallet identity only, so the cleanup abandons a run solely on a
  // genuine identity change or unmount; a mid-handshake re-render can no longer drop the result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: signMessage/chainId/statement are read via the latest-value ref; depping them aborted in-flight handshakes on Privy's per-render identity churn (POO-899).
  useEffect(() => {
    if (!isAuthenticated || !address) {
      startedFor.current = null;
      setSession({ status: "idle", isSignedIn: false, error: null });
      return;
    }
    if (startedFor.current === address) return;
    startedFor.current = address;

    let active = true;
    setSession({ status: "signing", isSignedIn: false, error: null });
    ensureSignedIn(
      address,
      // Resolve the signer at CALL time: by the sign step (seconds after start) Privy may have
      // re-rendered and re-issued the function; the stale closure must never be the one invoked.
      (input, options) => latest.current.signMessage(input, options),
      { chainId: latest.current.chainId, statement: latest.current.statement },
    )
      .then((ok) => {
        if (!active) return;
        setSession(
          ok
            ? { status: "signed-in", isSignedIn: true, error: null }
            : { status: "error", isSignedIn: false, error: new Error("Sign-in failed") },
        );
      })
      .catch((error) => {
        if (active) setSession({ status: "error", isSignedIn: false, error });
      });

    return () => {
      active = false;
    };
  }, [address, isAuthenticated]);

  return <SiweSessionContext.Provider value={session}>{children}</SiweSessionContext.Provider>;
}

/**
 * Provides the SIWE session. Gated on `!isMockMode`: in mock mode it reports signed-in
 * without mounting Privy hooks (mock-mode routes never call the wallet-scoped loaders anyway).
 */
export function SiweSessionProvider({ children }: { children: ReactNode }) {
  if (isMockMode) {
    return (
      <SiweSessionContext.Provider value={MOCK_SESSION}>{children}</SiweSessionContext.Provider>
    );
  }
  return <RealSiweSessionProvider>{children}</RealSiweSessionProvider>;
}
