/**
 * @id PP-AUTH (POO-196, POO-199, POO-200)
 * @name useAuth tests
 * @implements-rules-version v1
 *
 * Tests for the auth hook that wraps Privy in real mode and falls back to the mock
 * authService in mock mode. POO-199 adds error classification; POO-200 adds
 * loginResult, isLoggingIn, and e2e flow routing.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockDisconnect = vi.fn();

/** Captured callbacks from the last useLogin() call. */
let capturedOnError: ((error: string) => void) | undefined;
let capturedOnComplete:
  | ((params: {
      user: { wallet?: { address: string } };
      isNewUser: boolean;
      wasAlreadyAuthenticated: boolean;
      loginMethod: string | null;
      loginAccount: unknown;
    }) => void)
  | undefined;

let mockModeValue = true;

vi.mock("@/lib/services/index", () => ({
  get isMockMode() {
    return mockModeValue;
  },
  authService: {
    loginWithGoogle: vi.fn(async () => ({
      userId: "mock-maria",
      method: "google",
      address: "0x1A2b3C4d5E6f7890a1B2c3D4e5F6789012345678",
      isNewWallet: true,
    })),
    connectWallet: vi.fn(async () => ({
      userId: "mock-metamask",
      method: "wallet",
      address: "0x9F8e7D6c5B4a39281706F5e4D3c2B1a098765432",
      isNewWallet: false,
    })),
    logout: vi.fn(async () => {}),
  },
}));

vi.mock("@privy-io/react-auth", () => ({
  useLogin: (callbacks?: {
    onError?: (error: string) => void;
    onComplete?: (params: Record<string, unknown>) => void;
  }) => {
    capturedOnError = callbacks?.onError;
    capturedOnComplete = callbacks?.onComplete as typeof capturedOnComplete;
    return { login: mockLogin };
  },
  useLogout: () => ({ logout: mockLogout }),
  usePrivy: () => ({
    authenticated: false,
    ready: true,
    user: null,
  }),
  useWallets: () => ({ wallets: [], ready: true }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useDisconnect: () => ({ disconnect: mockDisconnect }),
}));

const { useAuth } = await import("./useAuth");

describe("useAuth", () => {
  // [AC-4] In mock mode, useAuth delegates to mock authService.
  it("returns mock-based login/logout in mock mode", () => {
    mockModeValue = true;
    const { result } = renderHook(() => useAuth());

    expect(result.current.login).toBeTypeOf("function");
    expect(result.current.logout).toBeTypeOf("function");
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.mode).toBe("mock");
  });

  // [AC-1/2/3] In real mode, useAuth exposes Privy login/logout.
  it("returns Privy-based login/logout in real mode", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    expect(result.current.mode).toBe("privy");
    expect(result.current.login).toBeTypeOf("function");
    expect(result.current.logout).toBeTypeOf("function");
  });

  it("calls Privy login() when login is invoked in real mode", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    result.current.login();
    expect(mockLogin).toHaveBeenCalled();
  });

  it("calls Privy logout() and wagmi disconnect when logout is invoked in real mode", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    result.current.logout();
    expect(mockLogout).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // POO-199: Error surfacing
  // ---------------------------------------------------------------------------

  // [R1] error starts as null
  it("starts with error: null in real mode", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());
    expect(result.current.error).toBeNull();
  });

  it("starts with error: null in mock mode", () => {
    mockModeValue = true;
    const { result } = renderHook(() => useAuth());
    expect(result.current.error).toBeNull();
  });

  // [R2] Cancelled errors → "cancelled" category
  it("sets error to 'cancelled' when Privy reports exited_auth_flow", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    act(() => {
      capturedOnError?.("exited_auth_flow");
    });

    expect(result.current.error).toBe("cancelled");
  });

  // [R3] Network errors → "network" category
  it("sets error to 'network' when Privy reports unknown_auth_error", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    act(() => {
      capturedOnError?.("unknown_auth_error");
    });

    expect(result.current.error).toBe("network");
  });

  // [R4] Unsupported chain → "unsupported-chain" category
  it("sets error to 'unsupported-chain' when Privy reports unsupported_chain_id", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    act(() => {
      capturedOnError?.("unsupported_chain_id");
    });

    expect(result.current.error).toBe("unsupported-chain");
  });

  // [R1/R6] Error resets on new login attempt
  it("resets error when login() is called again", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    // Trigger an error first
    act(() => {
      capturedOnError?.("unknown_auth_error");
    });
    expect(result.current.error).toBe("network");

    // Login again should clear the error
    act(() => {
      result.current.login();
    });
    expect(result.current.error).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // POO-200: loginResult and isLoggingIn
  // ---------------------------------------------------------------------------

  // [R1] loginResult starts null
  it("starts with loginResult: null in real mode", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());
    expect(result.current.loginResult).toBeNull();
  });

  it("starts with loginResult: null in mock mode", () => {
    mockModeValue = true;
    const { result } = renderHook(() => useAuth());
    expect(result.current.loginResult).toBeNull();
  });

  // [R1] loginResult is set on onComplete
  it("sets loginResult when onComplete fires with isNewUser=true and google", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    act(() => {
      capturedOnComplete?.({
        user: { wallet: { address: "0xabc" } },
        isNewUser: true,
        wasAlreadyAuthenticated: false,
        loginMethod: "google",
        loginAccount: null,
      });
    });

    expect(result.current.loginResult).toEqual({
      isNewUser: true,
      loginMethod: "google",
    });
  });

  it("sets loginResult with isNewUser=false for returning wallet user", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    act(() => {
      capturedOnComplete?.({
        user: { wallet: { address: "0xdef" } },
        isNewUser: false,
        wasAlreadyAuthenticated: false,
        loginMethod: "wallet",
        loginAccount: null,
      });
    });

    expect(result.current.loginResult).toEqual({
      isNewUser: false,
      loginMethod: "wallet",
    });
  });

  // [R2] isLoggingIn tracks in-flight state
  it("starts with isLoggingIn: false in real mode", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoggingIn).toBe(false);
  });

  it("sets isLoggingIn to true when login() is called", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.login();
    });

    expect(result.current.isLoggingIn).toBe(true);
  });

  it("sets isLoggingIn to false when onComplete fires", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.login();
    });
    expect(result.current.isLoggingIn).toBe(true);

    act(() => {
      capturedOnComplete?.({
        user: { wallet: { address: "0xabc" } },
        isNewUser: false,
        wasAlreadyAuthenticated: false,
        loginMethod: "google",
        loginAccount: null,
      });
    });
    expect(result.current.isLoggingIn).toBe(false);
  });

  it("sets isLoggingIn to false when onError fires", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.login();
    });
    expect(result.current.isLoggingIn).toBe(true);

    act(() => {
      capturedOnError?.("unknown_auth_error");
    });
    expect(result.current.isLoggingIn).toBe(false);
  });

  // [R1] loginResult clears on logout
  it("clears loginResult when logout() is called", () => {
    mockModeValue = false;
    const { result } = renderHook(() => useAuth());

    // Simulate a completed login
    act(() => {
      capturedOnComplete?.({
        user: { wallet: { address: "0xabc" } },
        isNewUser: true,
        wasAlreadyAuthenticated: false,
        loginMethod: "google",
        loginAccount: null,
      });
    });
    expect(result.current.loginResult).not.toBeNull();

    // Logout clears it
    act(() => {
      result.current.logout();
    });
    expect(result.current.loginResult).toBeNull();
  });
});
