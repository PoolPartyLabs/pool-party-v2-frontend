/** @id PP-CP-HOOK-001 @name Cash+ mode isolation rules @implements-rules-version v1 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({
  mode: "preview",
  deployment: null,
  error: undefined,
  wallet: {
    connected: true,
    address: "0x3333333333333333333333333333333333333333",
    correctChain: true,
    getProvider: vi.fn(),
    connect: vi.fn(),
    switchNetwork: vi.fn(),
  },
}));
vi.mock("../CashPlusProvider", () => ({ useCashPlusEnvironment: () => context }));
vi.mock("@/lib/cash-plus/client", () => ({
  createCashPlusClient: vi.fn(() => {
    throw new Error("RPC_MUST_NOT_BE_CREATED");
  }),
  verifyCashPlusDeployment: vi.fn(),
}));

import { createCashPlusClient, verifyCashPlusDeployment } from "@/lib/cash-plus/client";
import { useCashPlus } from "./useCashPlus";

const wrap = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
};
describe("Cash+ preview isolation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });
  // @rule R1: preview executes local accounting only, with no wallet or RPC reads.
  it("runs a simulated investment without requesting a wallet or client", async () => {
    const { result } = renderHook(() => useCashPlus(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.snapshot?.mode).toBe("preview");
    await act(() => result.current.review("deposit", "100"));
    expect(result.current.transaction.phase).toBe("review");
    await act(() => result.current.confirm());
    expect(result.current.transaction.phase).toBe("success");
    expect(result.current.transaction.receipt?.simulated).toBe(true);
    expect(result.current.transaction.receipt?.hash).toBeUndefined();
    act(() => result.current.connect());
    await act(() => result.current.switchNetwork());
    expect(context.wallet.getProvider).not.toHaveBeenCalled();
    expect(context.wallet.connect).not.toHaveBeenCalled();
    expect(context.wallet.switchNetwork).not.toHaveBeenCalled();
    expect(createCashPlusClient).not.toHaveBeenCalled();
    expect(verifyCashPlusDeployment).not.toHaveBeenCalled();
  });
});
