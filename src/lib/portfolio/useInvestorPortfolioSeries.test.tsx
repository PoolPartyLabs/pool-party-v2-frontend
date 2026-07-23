/**
 * @id PP-PORT (POO-367)
 * @name useInvestorPortfolioSeries tests
 * @implements-rules-version v1
 *
 * Real mode reads the per-investor value series (getInvestorPortfolioSeriesAction) once the SIWE
 * session is up; every non-happy path (not signed in, session error, action reject) yields [] so the
 * hero chart degrades to honest-empty (POO-367 R2/R3). Mock mode never reads (returns []).
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeseriesPoint } from "@/lib/timeseries/timeseriesSchema";

const mocks = vi.hoisted(() => ({
  mockMode: false,
  session: { isSignedIn: true, status: "signed-in" as string },
  seriesImpl: null as null | (() => Promise<TimeseriesPoint[]>),
}));

vi.mock("@/features/portfolio/actions", () => ({
  getInvestorPortfolioSeriesAction: () =>
    mocks.seriesImpl ? mocks.seriesImpl() : Promise.resolve([]),
}));
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => mocks.session,
}));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
}));

import { useInvestorPortfolioSeries } from "./useInvestorPortfolioSeries";

function Probe() {
  const series = useInvestorPortfolioSeries();
  return <div data-testid="len">{series.length}</div>;
}

const twoPoints: TimeseriesPoint[] = [
  { date: "2026-06-19T00:00:00.000Z", value_usd: 100 },
  { date: "2026-06-20T00:00:00.000Z", value_usd: 110 },
];

describe("useInvestorPortfolioSeries", () => {
  beforeEach(() => {
    mocks.mockMode = false;
    mocks.session = { isSignedIn: true, status: "signed-in" };
    mocks.seriesImpl = null;
  });

  it("[R1] resolves the real series once signed in", async () => {
    mocks.seriesImpl = () => Promise.resolve(twoPoints);
    render(<Probe />);
    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  it("[R3] stays empty until the read resolves (initial render is [])", () => {
    let resolve: (v: TimeseriesPoint[]) => void = () => {};
    mocks.seriesImpl = () => new Promise((r) => (resolve = r));
    render(<Probe />);
    // Before the promise settles the series is empty → the hero renders honest-empty.
    expect(screen.getByTestId("len").textContent).toBe("0");
    resolve(twoPoints);
  });

  it("[R2] stays empty when not signed in (no read)", async () => {
    mocks.session = { isSignedIn: false, status: "idle" };
    render(<Probe />);
    // Give any (unexpected) async read a tick to settle, then assert still empty.
    await waitFor(() => expect(screen.getByTestId("len").textContent).toBe("0"));
  });

  it("[R2] degrades to empty when the action rejects (never throws to the boundary)", async () => {
    mocks.seriesImpl = () => Promise.reject(new Error("action failed"));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("len").textContent).toBe("0"));
  });

  it("[R5] never reads in mock mode (returns [])", async () => {
    mocks.mockMode = true;
    mocks.seriesImpl = () => Promise.resolve(twoPoints);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("len").textContent).toBe("0"));
  });
});
