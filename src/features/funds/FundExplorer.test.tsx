import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { FundExplorer } from "./FundExplorer";

const mocks = vi.hoisted(() => ({ load: vi.fn(), address: `0x${"1".repeat(40)}`, signedIn: true }));
const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => flags.enabled }),
}));
vi.mock("./fundActions", () => ({ loadFundsAction: mocks.load }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.address }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => ({ isSignedIn: mocks.signedIn }),
}));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/features/manager/fund/components/FundDraftsSlot", () => ({
  FundDraftsSlot: () => <p>existing-drafts</p>,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));

describe("v2 fund lists POO-2181", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.signedIn = true;
    flags.enabled = true;
    mocks.load.mockResolvedValue({
      ok: true,
      data: { funds: [mockFund], holders: {}, wallet: mocks.address },
    });
  });
  it("links the owned manager v2 section to fallback drafts only with the flag on", () => {
    const view = renderWithProviders(<FundExplorer view="manager" />);
    expect(screen.getByRole("link", { name: "Review & launch drafts (v2)" })).toHaveAttribute(
      "href",
      "/manager/fund-launch/review",
    );
    flags.enabled = false;
    view.rerender(<FundExplorer view="manager" />);
    expect(
      screen.queryByRole("link", { name: "Review & launch drafts (v2)" }),
    ).not.toBeInTheDocument();
  });
  it("R2 renders rich v2 cards without V1 shapes", async () => {
    renderWithProviders(<FundExplorer view="explore" />);
    expect(await screen.findByText(mockFund.profile?.name ?? "missing")).toBeInTheDocument();
    expect(screen.getByText("Share Price")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /details/i })).toHaveAttribute(
      "href",
      `/funds/${mockFund.coreVault}`,
    );
    expect(screen.getByRole("link", { name: mockFund.manager })).toHaveAttribute(
      "href",
      `https://arbiscan.io/address/${mockFund.manager}`,
    );
  });
  it("R6 renders loading then empty", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { funds: [], holders: {}, wallet: null } });
    renderWithProviders(<FundExplorer view="explore" />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    expect(await screen.findByText(/No funds/)).toBeInTheDocument();
  });
  it("R6 catches rejected reads and retries", async () => {
    mocks.load.mockRejectedValueOnce(new Error("private error"));
    renderWithProviders(<FundExplorer view="explore" />);
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private error");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText(mockFund.profile?.name ?? "missing")).toBeInTheDocument();
  });
  it("R5 refreshes on a launch journal update", async () => {
    renderWithProviders(<FundExplorer view="explore" />);
    await screen.findByText(mockFund.profile?.name ?? "missing");
    fireEvent(window, new CustomEvent("pp:v2:launch-changed", { detail: { completed: true } }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  });
  it("R3 requires a session in the manager view but preserves drafts", () => {
    mocks.signedIn = false;
    renderWithProviders(<FundExplorer view="manager" />);
    expect(screen.getByText("existing-drafts")).toBeInTheDocument();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("R6 shows a distinct dormant API state with retry", async () => {
    mocks.load.mockResolvedValue({ ok: false, error: { status: 503, code: "V2_UNAVAILABLE" } });
    renderWithProviders(<FundExplorer view="manager" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("not available yet");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText("Launch journeys")).toBeInTheDocument();
  });
  it("R5 does not reload the fund list for an incomplete checkpoint", async () => {
    renderWithProviders(<FundExplorer view="explore" />);
    await screen.findByText(mockFund.profile?.name ?? "missing");
    fireEvent(window, new CustomEvent("pp:v2:launch-changed", { detail: { completed: false } }));
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it("R3 hides funds from a mismatched verified session", async () => {
    mocks.load.mockResolvedValue({
      ok: true,
      data: { funds: [mockFund], holders: {}, wallet: `0x${"2".repeat(40)}` },
    });
    renderWithProviders(<FundExplorer view="manager" />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    expect(screen.queryByText(mockFund.profile?.name ?? "missing")).not.toBeInTheDocument();
  });
  it("R5 ignores a stale read after switching views", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    mocks.load.mockResolvedValue({
      ok: true,
      data: { funds: [], holders: {}, wallet: mocks.address },
    });
    const { rerender } = renderWithProviders(<FundExplorer view="explore" />);
    rerender(<FundExplorer view="manager" />);
    await screen.findByText(/No funds/);
    resolveOld({ ok: true, data: { funds: [mockFund], holders: {}, wallet: null } });
    await waitFor(() =>
      expect(screen.queryByText(mockFund.profile?.name ?? "missing")).not.toBeInTheDocument(),
    );
  });
});
