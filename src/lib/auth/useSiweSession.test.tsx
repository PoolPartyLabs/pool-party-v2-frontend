/**
 * @id PP-AUTH (POO-270, POO-376, POO-899)
 * @name SIWE session tests
 * @implements-rules-version v1
 *
 * Real-mode handshake: nonce -> sign -> sign-in -> signed-in; failure -> error; no wallet -> idle.
 * Flag-off (default) signs the legacy branded message and the legacy payload; flag-on (POO-376)
 * signs a real EIP-4361 message and additionally sends the full `message` for verbatim backend
 * verification.
 *
 * POO-899: the Privy mock hands out a NEW `signMessage` function identity on every render, exactly
 * like the real `@privy-io/react-auth` provider (its context value is a fresh object literal per
 * render). A referentially stable mock is why the mid-handshake-abandon bug went undetected. The
 * churn suite ([R1]/[R2]) additionally re-renders and mutates chainId/statement mid-handshake.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { parseSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { address: undefined as string | undefined, isAuthenticated: false },
  signMessage: vi.fn(),
  getNonce: vi.fn(),
  signIn: vi.fn(),
  getSession: vi.fn(),
  eip4361: false,
  chainId: 42161,
  statementPrefix: "t:",
}));

vi.mock("./useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@privy-io/react-auth", () => ({
  // POO-899: a NEW function identity per render (real Privy behavior), delegating to the spy.
  useSignMessage: () => ({
    signMessage: (input: { message: string }, options: { address: string }) =>
      mocks.signMessage(input, options),
  }),
}));
vi.mock("wagmi", () => ({ useChainId: () => mocks.chainId }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `${mocks.statementPrefix}${key}`,
}));
vi.mock("@/features/auth/siweActions", () => ({
  getNonceAction: mocks.getNonce,
  signInAction: mocks.signIn,
  getSessionAction: mocks.getSession,
}));
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));
// The EIP-4361 gate is toggled per test via the hoisted mock; the real builders are kept.
vi.mock("./siweMessage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./siweMessage")>();
  return {
    ...actual,
    get isSiweEip4361Enabled() {
      return mocks.eip4361;
    },
  };
});

import { SiweSessionProvider, useSiweSession } from "./useSiweSession";

function Probe() {
  const { status } = useSiweSession();
  return <div data-testid="status">{status}</div>;
}

// A fresh element per call: re-rendering an identical element reference would let React bail out
// of the subtree, silently skipping the re-render churn these tests exist to exercise (POO-899).
function ui() {
  return (
    <SiweSessionProvider>
      <Probe />
    </SiweSessionProvider>
  );
}

function renderProvider() {
  return render(ui());
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

describe("SiweSessionProvider (real mode)", () => {
  beforeEach(() => {
    mocks.auth = { address: undefined, isAuthenticated: false };
    mocks.signMessage.mockReset();
    mocks.getNonce.mockReset();
    mocks.signIn.mockReset();
    mocks.eip4361 = false;
    mocks.chainId = 42161;
    mocks.statementPrefix = "t:";
    // Default: no existing session -> the handshake runs.
    mocks.getSession.mockReset().mockResolvedValue(null);
  });

  it("stays idle when no wallet is connected", () => {
    renderProvider();
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(mocks.getNonce).not.toHaveBeenCalled();
  });

  it("runs nonce -> sign -> sign-in and reaches signed-in (legacy message, flag off)", async () => {
    mocks.auth = { address: "0xWALLET", isAuthenticated: true };
    mocks.getNonce.mockResolvedValue("nonce-1");
    mocks.signMessage.mockResolvedValue({ signature: "0xsig" });
    mocks.signIn.mockResolvedValue(true);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    expect(mocks.getNonce).toHaveBeenCalledWith("0xWALLET");
    expect(mocks.signMessage).toHaveBeenCalledWith(
      { message: expect.stringContaining("Nonce: nonce-1") },
      { address: "0xWALLET" },
    );
    // Flag off: exact legacy payload, no full message sent.
    const payload = mocks.signIn.mock.calls[0]?.[0];
    expect(payload).toEqual({
      wallet: "0xWALLET",
      signature: "0xsig",
      nonce: "nonce-1",
      network: "arbitrum",
    });
    expect(payload.message).toBeUndefined();
  });

  it("signs an EIP-4361 message and sends the full message when the flag is on", async () => {
    // @rule R8
    mocks.eip4361 = true;
    mocks.chainId = 8453;
    mocks.auth = { address: "0x1111111111111111111111111111111111111111", isAuthenticated: true };
    mocks.getNonce.mockResolvedValue("abcd1234efgh5678");
    mocks.signMessage.mockResolvedValue({ signature: "0xsig" });
    mocks.signIn.mockResolvedValue(true);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));

    const signed = mocks.signMessage.mock.calls[0]?.[0]?.message as string;
    const parsed = parseSiweMessage(signed);
    expect(parsed.nonce).toBe("abcd1234efgh5678");
    expect(parsed.chainId).toBe(8453);
    expect(parsed.version).toBe("1");
    expect(parsed.domain).toBeDefined();
    expect(parsed.uri).toBeDefined();
    expect(signed).not.toContain("Welcome to Pool Party!");

    // Flag on: the full signed message is forwarded so the backend can verify it verbatim.
    const payload = mocks.signIn.mock.calls[0]?.[0];
    expect(payload.message).toBe(signed);
    expect(payload).toMatchObject({
      wallet: "0x1111111111111111111111111111111111111111",
      signature: "0xsig",
      nonce: "abcd1234efgh5678",
      network: "arbitrum",
    });
  });

  it("reaches error when sign-in fails", async () => {
    mocks.auth = { address: "0xWALLET", isAuthenticated: true };
    mocks.getNonce.mockResolvedValue("nonce-1");
    mocks.signMessage.mockResolvedValue({ signature: "0xsig" });
    mocks.signIn.mockResolvedValue(false);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
  });

  it("reuses an existing session (cached cookie) without prompting a signature", async () => {
    mocks.auth = { address: "0xCACHED", isAuthenticated: true };
    // The cookie already vouches for this wallet -> no nonce / signature / sign-in.
    mocks.getSession.mockResolvedValue("0xcached");

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    expect(mocks.signMessage).not.toHaveBeenCalled();
    expect(mocks.getNonce).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  describe("mid-handshake churn (POO-899)", () => {
    // @rule R1 - regression-from-bug: the wallet-switch guard's router.refresh() re-renders the
    // tree while a human signature is pending and Privy hands out a new signMessage identity per
    // render; the in-flight handshake must still terminally settle the session. On the buggy code
    // the dep-keyed cleanup abandoned the run (active=false), the one-shot startedFor ref blocked
    // the re-subscribe, and the successful sign-in was silently dropped (status stuck "signing").
    it("[R1] reaches signed-in when the tree re-renders mid-handshake with a new signMessage identity", async () => {
      mocks.auth = { address: "0xWALLET", isAuthenticated: true };
      mocks.getNonce.mockResolvedValue("nonce-1");
      const signature = deferred<{ signature: string }>();
      mocks.signMessage.mockReturnValue(signature.promise);
      mocks.signIn.mockResolvedValue(true);

      const view = renderProvider();
      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signing"));
      // The wallet prompt is up: the handshake is genuinely mid-flight at the sign step.
      await waitFor(() => expect(mocks.signMessage).toHaveBeenCalledTimes(1));

      // The refresh-induced re-renders land while the user is still signing.
      view.rerender(ui());
      view.rerender(ui());

      // The user signs; the result must not be dropped.
      await act(async () => signature.resolve({ signature: "0xsig" }));

      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
      expect(mocks.signIn).toHaveBeenCalledTimes(1);
    });

    // @rule R2 - helper identity churn (signMessage per render, chainId, translated statement)
    // never aborts or restarts an in-flight handshake: nonce + signature happen exactly once.
    it("[R2] churning chainId/statement/signMessage mid-handshake keeps one nonce and one signature", async () => {
      mocks.eip4361 = true;
      mocks.auth = {
        address: "0x1111111111111111111111111111111111111111",
        isAuthenticated: true,
      };
      const nonce = deferred<string>();
      mocks.getNonce.mockReturnValue(nonce.promise);
      const signature = deferred<{ signature: string }>();
      mocks.signMessage.mockReturnValue(signature.promise);
      mocks.signIn.mockResolvedValue(true);

      const view = renderProvider();
      await waitFor(() => expect(mocks.getNonce).toHaveBeenCalledTimes(1));

      // Churn every helper dependency while the nonce fetch is in flight.
      mocks.chainId = 8453;
      view.rerender(ui());
      mocks.statementPrefix = "changed:";
      view.rerender(ui());
      view.rerender(ui()); // signMessage identity churns on every render by itself

      await act(async () => nonce.resolve("abcd1234efgh5678"));
      await waitFor(() => expect(mocks.signMessage).toHaveBeenCalledTimes(1));
      await act(async () => signature.resolve({ signature: "0xsig" }));

      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
      expect(mocks.getNonce).toHaveBeenCalledTimes(1);
      expect(mocks.signMessage).toHaveBeenCalledTimes(1);
      expect(mocks.signIn).toHaveBeenCalledTimes(1);
    });
  });
});
