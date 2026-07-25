/**
 * @id PP-CORE-LAY (SETUP / POO-194)
 * @name Providers test
 * @implements-rules-version v1
 *
 * TDD tests for the wallet provider layer. Verifies mock-mode gating, provider nesting order,
 * correct package imports (@privy-io/wagmi, not plain wagmi), and SSR-safe QueryClient.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks: replace heavy wallet SDKs with lightweight spies so we can
// assert mount/not-mount and nesting order without pulling in real providers.
// ---------------------------------------------------------------------------

// Track which providers rendered and in what order.
const renderLog: string[] = [];

vi.mock("@privy-io/react-auth", () => ({
  // The non-production WalletChainProbe (POO-1081) reads the connected wallets.
  useWallets: () => ({ wallets: [] }),
  PrivyProvider: ({ children }: { children: React.ReactNode }) => {
    renderLog.push("PrivyProvider");
    return <div data-testid="privy-provider">{children}</div>;
  },
}));

vi.mock("@privy-io/wagmi", () => ({
  WagmiProvider: ({ children }: { children: React.ReactNode }) => {
    renderLog.push("WagmiProvider");
    return <div data-testid="wagmi-provider">{children}</div>;
  },
  createConfig: vi.fn(() => ({})),
}));

// SIWE session provider is an inner detail of the tree; render its children directly
// (its real form pulls in Privy hooks, out of scope for the nesting assertions here).
vi.mock("@/lib/auth/useSiweSession", () => ({
  SiweSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Owner profile session store (POO-779) is likewise an inner detail here; render its children directly
// (its real form reads the SIWE session + auth hooks, out of scope for the nesting assertions).
vi.mock("@/lib/profile/useOwnerProfileSession", () => ({
  OwnerProfileSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The wallet switch guard (POO-892) is likewise an inner detail here; its real form reads the
// wagmi account + SIWE session + i18n router, out of scope for the nesting assertions.
vi.mock("@/lib/auth/WalletSwitchGuard", () => ({ WalletSwitchGuard: () => null }));

// The embedded-wallet activator (POO-1003) is likewise an inner detail here; its real form reads the
// Privy + wagmi hooks (out of scope for the nesting assertions), so render nothing.
vi.mock("@/lib/auth/EmbeddedWalletActivator", () => ({ EmbeddedWalletActivator: () => null }));

vi.mock("@tanstack/react-query", () => {
  class MockQueryClient {}
  return {
    QueryClient: MockQueryClient,
    QueryClientProvider: ({ children }: { children: React.ReactNode }) => {
      renderLog.push("QueryClientProvider");
      return <div data-testid="query-provider">{children}</div>;
    },
  };
});

// ---------------------------------------------------------------------------
// We need to control isMockMode per test. The providers module reads it at
// import time from services/index.ts, so we mock that module.
// ---------------------------------------------------------------------------
let mockModeValue = true;
vi.mock("@/lib/services/index", () => ({
  get isMockMode() {
    return mockModeValue;
  },
}));

// Must import AFTER mocks are declared.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Providers } = await import("./providers");

describe("Providers", () => {
  beforeEach(() => {
    renderLog.length = 0;
  });

  // [AC-1] In mock mode, Providers renders children with NO Privy/wagmi mounted.
  it("renders children without wallet providers in mock mode", () => {
    mockModeValue = true;

    render(
      <Providers>
        <span data-testid="child">hello</span>
      </Providers>,
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.queryByTestId("privy-provider")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wagmi-provider")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-provider")).not.toBeInTheDocument();
  });

  // [AC-2] In real mode the tree mounts in order PrivyProvider > QueryClientProvider > WagmiProvider.
  it("mounts PrivyProvider > QueryClientProvider > WagmiProvider in real mode", () => {
    mockModeValue = false;

    render(
      <Providers>
        <span data-testid="child">hello</span>
      </Providers>,
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByTestId("privy-provider")).toBeInTheDocument();
    expect(screen.getByTestId("query-provider")).toBeInTheDocument();
    expect(screen.getByTestId("wagmi-provider")).toBeInTheDocument();

    // Nesting order: Privy outermost, then QueryClient, then Wagmi.
    expect(renderLog).toEqual(["PrivyProvider", "QueryClientProvider", "WagmiProvider"]);
  });

  // [AC-2 cont.] Verify DOM nesting (Privy wraps QueryClient wraps Wagmi wraps child).
  it("nests providers so Privy is outermost and Wagmi is innermost", () => {
    mockModeValue = false;

    render(
      <Providers>
        <span data-testid="child">hello</span>
      </Providers>,
    );

    const privy = screen.getByTestId("privy-provider");
    const query = screen.getByTestId("query-provider");
    const wagmi = screen.getByTestId("wagmi-provider");
    const child = screen.getByTestId("child");

    expect(privy.contains(query)).toBe(true);
    expect(query.contains(wagmi)).toBe(true);
    expect(wagmi.contains(child)).toBe(true);
  });
});
