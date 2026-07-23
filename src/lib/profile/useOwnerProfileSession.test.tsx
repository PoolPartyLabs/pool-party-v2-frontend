/**
 * @id PP-PROF-CTX-001 (POO-779)
 * @name owner profile session store tests
 * @implements-rules-version v2
 *
 * The session profile store (POO-779 R2): fetches the owner profile ONCE per signed-in session via
 * getOwnerProfileAction (the /users/me read, not a positions drain), refetches on wallet change and on
 * SIWE re-sign, holds a loading state through the signing window so the sidebar keeps its skeleton
 * instead of flashing "Become a manager" (POO-456, R3), and flips to manager locally after a create-pool
 * success without another read (R2). R1: the ONLY server call the role path makes is the profile read;
 * no portfolio/strategies request is ever issued.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOwnerProfile: vi.fn<() => Promise<{ isManager: boolean }>>(),
  session: { status: "signed-in" as string, isSignedIn: true },
  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as string | undefined,
  mockMode: false,
  // Portfolio/strategies spies: the role path must NEVER call these (R1).
  managerConsole: vi.fn(),
  managerStrategyDetail: vi.fn(),
}));

vi.mock("./ownerProfileActions", () => ({
  getOwnerProfileAction: mocks.getOwnerProfile,
}));
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => mocks.session,
}));
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: mocks.address }),
}));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
}));
// R1 regression guard: if the role path ever imported a portfolio/strategies read, these would fire.
vi.mock("@/features/manager/actions", () => ({
  getManagerConsoleAction: mocks.managerConsole,
  getManagerStrategyDetailAction: mocks.managerStrategyDetail,
}));

import { OwnerProfileSessionProvider, useOwnerProfileSession } from "./useOwnerProfileSession";

function Probe() {
  const { status, isManager, markManager } = useOwnerProfileSession();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="role">{isManager ? "manager" : "investor"}</span>
      <button type="button" onClick={markManager}>
        mark
      </button>
    </div>
  );
}

function renderStore() {
  return render(
    <OwnerProfileSessionProvider>
      <Probe />
    </OwnerProfileSessionProvider>,
  );
}

// Records the store status on EVERY render so a test can assert the very first (pre-effect) paint.
// `useIsManager` derives `isLoading` from `status === "loading"`, so a first paint of "idle" (the old
// init) yields { isManager: false, isLoading: false } and a real manager briefly sees "Become a
// manager" before the read resolves (POO-456 flash). The provider inits the real store to "loading".
function StatusRecorder({ into }: { into: string[] }) {
  const { status } = useOwnerProfileSession();
  into.push(status);
  return <span data-testid="status">{status}</span>;
}

describe("useOwnerProfileSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwnerProfile.mockResolvedValue({ isManager: true });
    mocks.session = { status: "signed-in", isSignedIn: true };
    mocks.address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    mocks.mockMode = false;
  });

  // @rule R2: fetch the owner profile once per session; the role reflects the snapshot.
  it("fetches the owner profile once on sign-in and exposes the role", async () => {
    renderStore();
    expect(await screen.findByText("manager")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("loaded");
    expect(mocks.getOwnerProfile).toHaveBeenCalledTimes(1);
  });

  // @rule R1: the role path issues ZERO portfolio/strategies requests (only the profile read).
  it("issues no portfolio or strategies request to resolve the role", async () => {
    renderStore();
    await screen.findByText("manager");
    expect(mocks.managerConsole).not.toHaveBeenCalled();
    expect(mocks.managerStrategyDetail).not.toHaveBeenCalled();
    expect(mocks.getOwnerProfile).toHaveBeenCalledTimes(1);
  });

  // @rule R2: a wallet change refetches the profile.
  it("refetches when the wallet changes", async () => {
    const { rerender } = renderStore();
    await screen.findByText("manager");
    expect(mocks.getOwnerProfile).toHaveBeenCalledTimes(1);

    mocks.address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    rerender(
      <OwnerProfileSessionProvider>
        <Probe />
      </OwnerProfileSessionProvider>,
    );
    await waitFor(() => expect(mocks.getOwnerProfile).toHaveBeenCalledTimes(2));
  });

  // @rule R2: a SIWE re-sign (signed-in -> signing -> signed-in) refetches the profile.
  it("refetches after a re-sign", async () => {
    const { rerender } = renderStore();
    await screen.findByText("manager");
    expect(mocks.getOwnerProfile).toHaveBeenCalledTimes(1);

    mocks.session = { status: "signing", isSignedIn: false };
    rerender(
      <OwnerProfileSessionProvider>
        <Probe />
      </OwnerProfileSessionProvider>,
    );
    mocks.session = { status: "signed-in", isSignedIn: true };
    rerender(
      <OwnerProfileSessionProvider>
        <Probe />
      </OwnerProfileSessionProvider>,
    );
    await waitFor(() => expect(mocks.getOwnerProfile).toHaveBeenCalledTimes(2));
  });

  // @rule R2: create-pool success flips the store to manager locally, without another read.
  it("flips to manager locally via markManager without refetching", async () => {
    mocks.getOwnerProfile.mockResolvedValue({ isManager: false });
    renderStore();
    expect(await screen.findByText("investor")).toBeInTheDocument();
    expect(mocks.getOwnerProfile).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("mark"));
    expect(await screen.findByText("manager")).toBeInTheDocument();
    expect(mocks.getOwnerProfile).toHaveBeenCalledTimes(1);
  });

  // @rule R3: the signing window holds a loading state (no become->manager flash) and does not fetch.
  it("holds loading through the signing window without fetching", () => {
    mocks.session = { status: "signing", isSignedIn: false };
    renderStore();
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    expect(mocks.getOwnerProfile).not.toHaveBeenCalled();
  });

  // @rule R2: settled not-signed-in is a terminal investor state with no fetch.
  it("is idle investor when not signed in, with no fetch", async () => {
    mocks.session = { status: "idle", isSignedIn: false };
    renderStore();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("idle"));
    expect(screen.getByTestId("role")).toHaveTextContent("investor");
    expect(mocks.getOwnerProfile).not.toHaveBeenCalled();
  });

  // @rule R3 (POO-456): the FIRST paint of a settled signed-in session is already `loading`, so the
  // manager entry holds its skeleton instead of flashing "Become a manager" before the read resolves.
  // Guards the exact gap the suite missed: the pre-effect init was "idle" -> isLoading false -> flash.
  it("first paints loading for a settled signed-in session before the read resolves", () => {
    // Never resolves: the effect cannot advance past loading, isolating the initial render value.
    mocks.getOwnerProfile.mockReturnValue(new Promise<{ isManager: boolean }>(() => {}));
    mocks.session = { status: "signed-in", isSignedIn: true };
    const renders: string[] = [];
    render(
      <OwnerProfileSessionProvider>
        <StatusRecorder into={renders} />
      </OwnerProfileSessionProvider>,
    );
    // The pre-effect render must already be loading (not the old "idle", which flashed the CTA).
    expect(renders[0]).toBe("loading");
  });

  // @rule R5: mock mode mounts the pass-through default (idle investor); markManager is a no-op and no
  // profile read is issued, since RealOwnerProfileSessionProvider is never mounted in mock mode.
  it("in mock mode reports the idle default and markManager is a no-op", () => {
    mocks.mockMode = true;
    renderStore();
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByTestId("role")).toHaveTextContent("investor");

    fireEvent.click(screen.getByText("mark"));
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByTestId("role")).toHaveTextContent("investor");
    expect(mocks.getOwnerProfile).not.toHaveBeenCalled();
  });
});
