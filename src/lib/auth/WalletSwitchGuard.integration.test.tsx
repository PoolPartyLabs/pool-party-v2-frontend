/**
 * @id PP-AUTH-CMP-002 (POO-899, POO-892)
 * @name WalletSwitchGuard + SIWE session integration tests
 * @implements-rules-version v1
 *
 * POO-899 integration coverage the unit suites cannot give: the REAL SiweSessionProvider, the REAL
 * WalletSwitchGuard and the REAL usePositions composed together (WalletSwitchGuard.test.tsx mocks
 * useSiweSession entirely, so it can never see the provider drop a handshake). Only the seams are
 * mocked: wagmi account/chain, Privy signMessage (a NEW function identity per render, the real
 * Privy behavior), the SIWE server actions, the positions action and the i18n router.
 *
 * [R3] A-to-B switch with the guard active (signOut + push + refresh): the session reaches
 * signed-in for B after B signs, and usePositions fetches B's positions exactly once thereafter.
 * [R4] A rejected wallet-B signature still lands on /sign-in via forced logout (POO-892 R3).
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WALLET_A = "0xAAAA00000000000000000000000000000000AAAA" as const;
const WALLET_B = "0xBBBB00000000000000000000000000000000BBBB" as const;

const mocks = vi.hoisted(() => ({
  account: { address: undefined as `0x${string}` | undefined },
  auth: {
    address: undefined as string | undefined,
    isAuthenticated: false,
    logout: vi.fn(),
  },
  /** The wallet the session cookie currently vouches for (null = no cookie). */
  sessionWallet: null as string | null,
  signMessage: vi.fn(),
  getNonce: vi.fn(),
  signIn: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  getPositions: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  chainId: 42161,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.account.address }),
  useChainId: () => mocks.chainId,
}));
vi.mock("@privy-io/react-auth", () => ({
  // POO-899: a NEW function identity per render (real Privy behavior), delegating to the spy.
  useSignMessage: () => ({
    signMessage: (input: { message: string }, options: { address: string }) =>
      mocks.signMessage(input, options),
  }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => `t:${key}` }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/features/auth/siweActions", () => ({
  getNonceAction: mocks.getNonce,
  signInAction: mocks.signIn,
  getSessionAction: mocks.getSession,
  signOutAction: mocks.signOut,
}));
vi.mock("@/features/portfolio/actions", () => ({ getPositionsAction: mocks.getPositions }));
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));
vi.mock("./useAuth", () => ({ useAuth: () => mocks.auth }));

import { usePositions } from "@/lib/positions/usePositions";
import { SiweSessionProvider, useSiweSession } from "./useSiweSession";
import { WalletSwitchGuard } from "./WalletSwitchGuard";

function StatusProbe() {
  const { status } = useSiweSession();
  return <div data-testid="status">{status}</div>;
}

/** The usePositions-level consumer HomeDataLoader keys on (real hook, mocked action). */
function PositionsProbe() {
  const { positions } = usePositions();
  return <div data-testid="positions">{positions === null ? "loading" : positions.length}</div>;
}

// A fresh element per call: re-rendering an identical element reference would let React bail out
// of the subtree, silently skipping the re-render churn these tests exist to exercise (POO-899).
function ui() {
  return (
    <SiweSessionProvider>
      <WalletSwitchGuard />
      <StatusProbe />
      <PositionsProbe />
    </SiweSessionProvider>
  );
}

/** A promise whose settlement the test controls (models the human signing latency). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Connect wallet A with a cookie already vouching for it (signed in without a prompt). */
async function signInWalletA() {
  mocks.account.address = WALLET_A;
  mocks.auth = { address: WALLET_A, isAuthenticated: true, logout: vi.fn() };
  mocks.sessionWallet = WALLET_A.toLowerCase();
  const view = render(ui());
  await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
  await waitFor(() => expect(mocks.getPositions).toHaveBeenCalledTimes(1));
  return view;
}

/** Flip both wagmi and Privy to wallet B and re-render (the switch as the app sees it). */
function switchToWalletB(view: ReturnType<typeof render>) {
  mocks.account.address = WALLET_B;
  mocks.auth = { ...mocks.auth, address: WALLET_B };
  view.rerender(ui());
}

describe("WalletSwitchGuard + SiweSessionProvider integration (POO-899)", () => {
  beforeEach(() => {
    mocks.account.address = undefined;
    mocks.auth = { address: undefined, isAuthenticated: false, logout: vi.fn() };
    mocks.sessionWallet = null;
    mocks.signMessage.mockReset();
    mocks.getNonce.mockReset();
    mocks.signIn.mockReset();
    mocks.push.mockClear();
    mocks.refresh.mockClear();
    mocks.chainId = 42161;
    // The cookie is a live variable: signOutAction clears it, exactly like the real server action.
    mocks.getSession.mockReset().mockImplementation(async () => mocks.sessionWallet);
    mocks.signOut.mockReset().mockImplementation(async () => {
      mocks.sessionWallet = null;
    });
    mocks.getPositions.mockReset().mockResolvedValue({ ok: true, positions: [] });
  });

  // @rule R3 - the full switch choreography: guard clears A's session and refreshes, the provider
  // re-runs SIWE for B through the refresh-induced re-renders (new signMessage identity each), and
  // once B signs the session terminally reaches signed-in so positions load exactly once for B.
  it("[R3] A-to-B switch reaches signed-in for B and refetches positions exactly once", async () => {
    const view = await signInWalletA();

    // B has no cookie: a full handshake with a human-latency signature.
    mocks.getNonce.mockResolvedValue("nonce-b-12345678");
    const signature = deferred<{ signature: string }>();
    mocks.signMessage.mockReturnValue(signature.promise);
    mocks.signIn.mockResolvedValue(true);
    mocks.getPositions.mockClear();

    switchToWalletB(view);

    // POO-892 R2: the guard kills A's Bearer then navigates home with a fresh RSC render.
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    // B's prompt is up; the refresh-induced re-renders land while the user is still signing.
    await waitFor(() => expect(mocks.signMessage).toHaveBeenCalledTimes(1));
    view.rerender(ui());
    view.rerender(ui());

    // B signs: the handshake must settle signed-in, not be dropped by the re-render churn.
    await act(async () => signature.resolve({ signature: "0xsig-b" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));

    // One prompt, one nonce, and exactly one positions fetch for B (the isSignedIn gate opened once).
    expect(mocks.getNonce).toHaveBeenCalledTimes(1);
    expect(mocks.signMessage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.getPositions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("positions")).toHaveTextContent("0"));
    // A switch is not a logout: wallet B stays connected (POO-892 R2).
    expect(mocks.auth.logout).not.toHaveBeenCalled();
  });

  // @rule R4 - POO-892 R3 must not regress: a rejected wallet-B signature surfaces as a session
  // error THROUGH the re-render churn, so the guard can force the clean logout to /sign-in.
  it("[R4] rejected wallet-B signature forces logout to /sign-in", async () => {
    const view = await signInWalletA();

    mocks.getNonce.mockResolvedValue("nonce-b-12345678");
    const signature = deferred<{ signature: string }>();
    mocks.signMessage.mockReturnValue(signature.promise);

    switchToWalletB(view);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    await waitFor(() => expect(mocks.signMessage).toHaveBeenCalledTimes(1));
    view.rerender(ui());
    view.rerender(ui());

    // B rejects the prompt: the error must not be dropped by the churn.
    await act(async () => signature.reject(new Error("user rejected")));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));

    // POO-892 R3: forced clean logout, never a stuck blank state.
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/sign-in"));
    expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
    // signOut ran twice: once for the switch, once for the forced logout.
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
  });
});
