/**
 * @id PP-MGR-SCR-001 (POO-364)
 * @name ManagerConsoleDataLoader tests
 * @implements-rules-version v1
 *
 * Skeleton on first load only; a post-write refresh keeps the console mounted (no skeleton flash,
 * R2); a `?created=1` navigation triggers a bounded in-place re-poll so a just-created strategy
 * surfaces without a manual reload.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { isSignedIn: true, status: "signed-in" as string, error: null as unknown },
  action: vi.fn(),
  detailAction: vi.fn(),
  created: null as string | null,
}));

vi.mock("@/lib/auth/useSiweSession", () => ({ useSiweSession: () => mocks.session }));
vi.mock("./actions", () => ({
  getManagerConsoleAction: mocks.action,
  getManagerStrategyDetailAction: mocks.detailAction,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.created ? `created=${mocks.created}` : ""),
}));
// The poll internals are covered by usePostWriteRefresh's own test; here the helper just forwards to
// the caller's local refresher so we can assert the created-flag wiring triggers a re-fetch.
vi.mock("@/lib/tx/usePostWriteRefresh", () => ({
  usePostWriteRefresh: (refreshLocal?: () => void) => () => refreshLocal?.(),
}));
vi.mock("./ManagerConsoleScreen", () => ({
  ManagerConsoleScreen: ({
    strategies,
    onConsoleRefresh,
  }: {
    strategies: unknown[];
    onConsoleRefresh: () => void;
  }) => (
    <div data-testid="console">
      <span data-testid="count">{strategies.length}</span>
      <button type="button" data-testid="refresh" onClick={onConsoleRefresh}>
        refresh
      </button>
    </div>
  ),
}));
// POO-694: the loader now resolves real-mode avatar/banner uploaders via `useUploadMedia`, which calls
// Privy/wagmi wallet hooks. This test renders without those providers (it mocks ManagerConsoleScreen),
// so stub the hook to a no-op uploader — the upload wiring is covered by ManagerProfileTabView's tests.
vi.mock("@/lib/media/useUploadMedia", () => ({ useUploadMedia: () => vi.fn() }));

import { ManagerConsoleDataLoader } from "./ManagerConsoleDataLoader";

const payload = (n: number) => ({
  dashboard: {},
  strategies: Array.from({ length: n }, (_, i) => ({ id: `s${i}` })),
  profile: {},
});

describe("ManagerConsoleDataLoader", () => {
  beforeEach(() => {
    mocks.session = { isSignedIn: true, status: "signed-in", error: null };
    mocks.action.mockReset();
    mocks.created = null;
    window.history.replaceState(null, "", "/manager");
  });

  // @rule R2
  it("shows the skeleton on first load, then the console", async () => {
    let resolve!: (v: unknown) => void;
    mocks.action.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<ManagerConsoleDataLoader />);
    expect(screen.queryByTestId("console")).toBeNull(); // first load → skeleton
    resolve(payload(2));
    await waitFor(() => expect(screen.getByTestId("console")).toBeInTheDocument());
    expect(screen.getByTestId("count")).toHaveTextContent("2");
  });

  // @rule R2
  it("refreshes in place without flashing the skeleton (R2)", async () => {
    mocks.action.mockResolvedValueOnce(payload(2));
    let resolveSecond!: (v: unknown) => void;
    mocks.action.mockReturnValueOnce(
      new Promise((r) => {
        resolveSecond = r;
      }),
    );
    render(<ManagerConsoleDataLoader />);
    await waitFor(() => expect(screen.getByTestId("console")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("refresh")); // slow refetch in flight
    expect(screen.getByTestId("console")).toBeInTheDocument(); // stays mounted, no skeleton
    expect(screen.getByTestId("count")).toHaveTextContent("2");

    resolveSecond(payload(3));
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("3"));
  });

  // @rule R3
  it("re-polls once when ?created=1 is present", async () => {
    mocks.created = "1";
    mocks.action.mockResolvedValue(payload(1));
    render(<ManagerConsoleDataLoader />);
    await waitFor(() => expect(screen.getByTestId("console")).toBeInTheDocument());
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(2)); // created → one extra fetch
  });

  // @rule R3
  it("does not re-poll without the created flag", async () => {
    mocks.action.mockResolvedValue(payload(1));
    render(<ManagerConsoleDataLoader />);
    await waitFor(() => expect(screen.getByTestId("console")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.action).toHaveBeenCalledTimes(1);
  });
});
