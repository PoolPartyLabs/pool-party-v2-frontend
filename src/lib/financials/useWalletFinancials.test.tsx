/**
 * @id PP-CORE-LIB-046 (POO-990)
 * @name useWalletFinancials — tests
 *
 * Behavior (PP-CORE-LIB-048): the hook reads the wallet C1 /financials payload UNCONDITIONALLY in real
 * mode once the SIWE session is up (the `financialsV2` flag gate was removed). Mock mode / not-signed-in
 * / a rejected read → null (the consumer renders the money KPIs as unavailable), and the action is not
 * invoked in the mock / signed-out cases (no wasted RTT).
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getWalletFinancialsAction = vi.fn();
const useSiweSession = vi.fn();
let mockModeValue = false;

vi.mock("@/features/home/actions", () => ({
  getWalletFinancialsAction: () => getWalletFinancialsAction(),
}));
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => useSiweSession(),
}));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mockModeValue;
  },
}));

import { useWalletFinancials } from "./useWalletFinancials";

function Probe() {
  const financials = useWalletFinancials();
  return <output>{financials === null ? "null" : String(financials.totalYield)}</output>;
}

afterEach(() => {
  getWalletFinancialsAction.mockReset();
  useSiweSession.mockReset();
  mockModeValue = false;
});

describe("useWalletFinancials", () => {
  it("reads the payload unconditionally in real mode when signed in", async () => {
    useSiweSession.mockReturnValue({ isSignedIn: true, status: "authenticated" });
    getWalletFinancialsAction.mockResolvedValue({ totalYield: 812.19 });
    render(<Probe />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("812.19"));
    expect(getWalletFinancialsAction).toHaveBeenCalledTimes(1);
  });

  it("returns null and never reads in mock mode", async () => {
    mockModeValue = true;
    useSiweSession.mockReturnValue({ isSignedIn: true, status: "authenticated" });
    render(<Probe />);
    expect(screen.getByRole("status").textContent).toBe("null");
    expect(getWalletFinancialsAction).not.toHaveBeenCalled();
  });

  it("returns null and never reads when not signed in", async () => {
    useSiweSession.mockReturnValue({ isSignedIn: false, status: "unauthenticated" });
    render(<Probe />);
    expect(screen.getByRole("status").textContent).toBe("null");
    expect(getWalletFinancialsAction).not.toHaveBeenCalled();
  });

  it("degrades to null when the read rejects (never blanks the surface, never a legacy figure)", async () => {
    useSiweSession.mockReturnValue({ isSignedIn: true, status: "authenticated" });
    getWalletFinancialsAction.mockRejectedValue(new Error("boom"));
    render(<Probe />);
    // Stays null (the initial value); the rejection is swallowed.
    await waitFor(() => expect(getWalletFinancialsAction).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toBe("null");
  });
});
