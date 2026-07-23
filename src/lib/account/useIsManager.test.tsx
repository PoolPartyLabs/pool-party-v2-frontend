/**
 * @id PP-MGR (POO-224, POO-456, POO-779)
 * @name useIsManager tests
 * @implements-rules-version v2
 *
 * POO-779: the role is now derived from the session profile store (`useOwnerProfileSession`), not a
 * positions drain. The hook is a thin projection: it reads the store, issues NO request of its own (R1),
 * reports the manager role only once the profile is loaded, keeps a loading state through the store's
 * loading window so the sidebar skeleton never flashes "Become a manager" (R3), and stays investor in
 * mock mode where the Dev-menu toggle drives the entry (R5).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerProfileSession, OwnerProfileStatus } from "@/lib/profile/useOwnerProfileSession";

const mocks = vi.hoisted(() => ({
  store: {
    status: "loaded" as OwnerProfileStatus,
    isManager: false,
    markManager: vi.fn(),
  } as OwnerProfileSession,
  mockMode: false,
}));

vi.mock("@/lib/profile/useOwnerProfileSession", () => ({
  useOwnerProfileSession: () => mocks.store,
}));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
}));

import { useIsManager } from "./useIsManager";

function Probe() {
  const { isManager } = useIsManager();
  return <div data-testid="role">{isManager ? "manager" : "investor"}</div>;
}

function LoadingProbe() {
  const { isLoading } = useIsManager();
  return <div data-testid="loading">{isLoading ? "loading" : "ready"}</div>;
}

describe("useIsManager", () => {
  beforeEach(() => {
    mocks.store = { status: "loaded", isManager: false, markManager: vi.fn() };
    mocks.mockMode = false;
  });

  // @rule R1: the role reads the store — a loaded manager profile resolves to manager.
  it("is a manager when the loaded profile store says so", () => {
    mocks.store = { status: "loaded", isManager: true, markManager: vi.fn() };
    render(<Probe />);
    expect(screen.getByTestId("role")).toHaveTextContent("manager");
  });

  // @rule R1: a loaded non-manager profile resolves to investor.
  it("is an investor when the loaded profile store says so", () => {
    mocks.store = { status: "loaded", isManager: false, markManager: vi.fn() };
    render(<Probe />);
    expect(screen.getByTestId("role")).toHaveTextContent("investor");
  });

  // @rule R3 (POO-456): a fully-exited manager still resolves as manager — the role rides the sticky
  // profile flag, not positions, so there is nothing to drop after a full exit.
  it("keeps the manager role for a fully-exited manager (sticky flag)", () => {
    mocks.store = { status: "loaded", isManager: true, markManager: vi.fn() };
    render(<Probe />);
    expect(screen.getByTestId("role")).toHaveTextContent("manager");
  });

  // @rule R5: mock mode ignores the store (the Dev-menu toggle drives the entry there).
  it("is an investor in mock mode regardless of the store", () => {
    mocks.mockMode = true;
    mocks.store = { status: "loaded", isManager: true, markManager: vi.fn() };
    render(<Probe />);
    expect(screen.getByTestId("role")).toHaveTextContent("investor");
  });

  // @rule R3: while the store is loading (incl. the SIWE signing window) the hook reports loading, so
  // the sidebar keeps its skeleton instead of flashing "Become a manager".
  it("is loading (no flash) while the store is loading", () => {
    mocks.store = { status: "loading", isManager: false, markManager: vi.fn() };
    render(<LoadingProbe />);
    expect(screen.getByTestId("loading")).toHaveTextContent("loading");
  });

  // @rule R3: a loading store never resolves the role to a terminal manager answer (skeleton holds).
  it("does not report the manager role while the store is loading", () => {
    mocks.store = { status: "loading", isManager: true, markManager: vi.fn() };
    render(<Probe />);
    expect(screen.getByTestId("role")).toHaveTextContent("investor");
  });

  // @rule R2: a settled not-signed-in store (idle) is a terminal investor, not loading.
  it("is investor and not loading when the store is idle", () => {
    mocks.store = { status: "idle", isManager: false, markManager: vi.fn() };
    render(<LoadingProbe />);
    expect(screen.getByTestId("loading")).toHaveTextContent("ready");
  });

  // @rule R5: mock mode is never loading (the toggle is instant).
  it("never loads in mock mode", () => {
    mocks.mockMode = true;
    mocks.store = { status: "loading", isManager: false, markManager: vi.fn() };
    render(<LoadingProbe />);
    expect(screen.getByTestId("loading")).toHaveTextContent("ready");
  });
});
