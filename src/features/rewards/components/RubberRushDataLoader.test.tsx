/**
 * @id PP-REW-SCR-001 (POO-209, POO-270)
 * @name Rubber Rush data loader tests
 * @implements-rules-version v1
 *
 * Waits for the SIWE session, then calls getRubberRushAction (wallet derived server-side);
 * shows the skeleton until data resolves.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RubberRush } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  session: { isSignedIn: false, status: "idle" as string, error: null as unknown },
  action: vi.fn(),
}));

vi.mock("@/lib/auth/useSiweSession", () => ({ useSiweSession: () => mocks.session }));
vi.mock("../actions", () => ({ getRubberRushAction: mocks.action }));
vi.mock("../RubberRushScreen", () => ({
  RubberRushScreen: ({ data }: { data: RubberRush }) => (
    <div data-testid="screen">{data.quacks}</div>
  ),
}));
vi.mock("./RubberRushSkeleton", () => ({
  RubberRushSkeleton: () => <div data-testid="skeleton" />,
}));

import { RubberRushDataLoader } from "./RubberRushDataLoader";

const sample = {
  quacks: 15021,
  tierIndex: 1,
  duckShoot: { triesLeft: 7 },
} as unknown as RubberRush;

describe("RubberRushDataLoader", () => {
  beforeEach(() => {
    mocks.session = { isSignedIn: false, status: "idle", error: null };
    mocks.action.mockReset();
  });

  it("shows the skeleton until signed in, then fetches and renders the screen", async () => {
    mocks.session = { isSignedIn: true, status: "signed-in", error: null };
    let resolve!: (v: RubberRush) => void;
    mocks.action.mockReturnValue(new Promise<RubberRush>((r) => (resolve = r)));

    render(<RubberRushDataLoader />);

    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("screen")).not.toBeInTheDocument();

    resolve(sample);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveTextContent("15021");
    expect(mocks.action).toHaveBeenCalledWith();
  });

  it("does not fetch until the session is signed in", () => {
    render(<RubberRushDataLoader />);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(mocks.action).not.toHaveBeenCalled();
  });
});
