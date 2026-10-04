/** @id PP-MGR-CMP-081 @implements-rules-version v1 (POO-2233), preserves POO-2212 */
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../../tests/utils/renderWithProviders";
import { FundLaunchJourney, type FundLaunchJourneyState } from "./FundLaunchJourney";

const hash = `0x${"ab".repeat(32)}`;
const core = `0x${"12".repeat(20)}`;
const state = vi.hoisted(() => ({ mock: false, launch: null as FundLaunchJourneyState | null }));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return state.mock;
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: import("react").ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./useV2Launch", () => ({ useV2Launch: () => state.launch }));
type Step = FundLaunchJourneyState["steps"][number];
function step(kind: Step["kind"], changes: Partial<Step> = {}): Step {
  return {
    id: kind,
    kind,
    chain: 42161,
    chainId: 42161,
    dependencies: [],
    label: `manager.fundLaunch.${kind}`,
    status: "idle",
    txHash: null,
    explorerUrl: null,
    receiptStatus: null,
    error: null,
    waitReason: null,
    result: null,
    ...changes,
  };
}
function setup(steps?: Step[], changes: Partial<FundLaunchJourneyState> = {}) {
  const launch: FundLaunchJourneyState = {
    journey: { draft: { review: { name: "Income fund demo" } } },
    addresses: { coreVault: core },
    steps: steps ?? [
      step("approve", { status: "confirmed" }),
      step("create", {
        status: "submitted",
        txHash: hash,
        explorerUrl: `https://arbiscan.io/tx/${hash}`,
        receiptStatus: "unknown",
      }),
      step("profile"),
    ],
    loadingError: false,
    ready: true,
    busy: false,
    journal: {},
    error: null,
    outcome: "in-progress",
    sign: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    cancel: vi.fn(),
    ...changes,
  };
  state.launch = launch;
  return launch;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.mock = false;
  setup();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("launch current-step window (POO-2233)", () => {
  it("[R1,R7] shows exactly one step for a long plan and keeps its evidence and footer reachable", () => {
    const launch = setup();
    launch.steps.push(
      ...Array.from({ length: 12 }, (_, index) => step("open", { id: `position-${index}` })),
    );
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getAllByRole("heading", { name: "Create and seed fund" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Approve USDC" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Open position" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-launch-current-step]")).toHaveLength(1);
    expect(screen.getByText("Step 2 of 15")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: hash })).toHaveAttribute(
      "href",
      `https://arbiscan.io/tx/${hash}`,
    );
    expect(screen.getByText(/Receipt: Not yet confirmed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: core })).toHaveAttribute(
      "href",
      `https://arbiscan.io/address/${core}`,
    );
    const footer = document.querySelector("[data-launch-footer]");
    expect(footer).toHaveClass("shrink-0");
    expect(screen.getByRole("button", { name: "Sign next step" })).toBeEnabled();
    expect(document.querySelector("[data-launch-details]")).toHaveClass("overflow-y-auto");
  });
  it("[R2] shows the actual wallet operation ahead of an earlier report wait", () => {
    setup(
      [
        step("report", { status: "waiting", reportWaitStartedAt: Date.now() }),
        step("open", { status: "signing" }),
        step("bridge"),
      ],
      { busy: true },
    );
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("heading", { name: "Open position" })).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Wait for accepted report" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
  it("[R1] preserves indexing details for the current discovery wait", () => {
    setup([step("open", { status: "waiting", waitReason: "discovery" }), step("report")]);
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(
      screen.getByText("Waiting for indexing. This step will retry automatically."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("[R3,R4] shows 19:00, keeps waiting at zero and does not sign or retry because time elapsed", () => {
    vi.useFakeTimers();
    const launch = setup(
      [step("report", { status: "waiting", reportWaitStartedAt: Date.now() }), step("bridge")],
      { busy: true },
    );
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("timer")).toHaveTextContent("19:00");
    expect(screen.getByRole("timer")).toHaveAttribute("aria-live", "off");
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("timer")).toHaveTextContent("18:59");
    act(() => {
      vi.setSystemTime(Date.now() + 20 * 60_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");
    expect(
      screen.getByText("This is taking longer than estimated. Waiting for the Wormhole report."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bridge to Robinhood" })).not.toBeInTheDocument();
    expect(launch.sign).not.toHaveBeenCalled();
    expect(launch.retry).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("[R5] switches to the next real step as soon as the report is confirmed, before countdown expiry", () => {
    const start = Date.now();
    setup([step("report", { status: "waiting", reportWaitStartedAt: start }), step("bridge")], {
      busy: true,
    });
    const view = renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("timer")).toHaveTextContent("19:00");
    setup(
      [
        step("report", { status: "confirmed", reportWaitStartedAt: start }),
        step("bridge", { status: "signing" }),
      ],
      { busy: true },
    );
    view.rerender(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("heading", { name: "Bridge to Robinhood" })).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-launch-current-step]")).toHaveLength(1);
  });
  it("[R1,R6] preserves partial failure, current failed step and explicit Retry", () => {
    const launch = setup(
      [step("report", { status: "failed", error: "BALANCE_CHANGED" }), step("bridge")],
      {
        error: { messageKey: "fundLaunch.partialFailure", code: "BALANCE_CHANGED" },
        outcome: "failed",
      },
    );
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(
      screen.getAllByRole("alert").some((node) => node.textContent?.includes("BALANCE_CHANGED")),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry failed step" }));
    expect(launch.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: core })).toBeInTheDocument();
  });
  it("[R1] retains final discovery evidence and completed outcome without signing controls", () => {
    setup(
      [
        step("discover", {
          status: "confirmed",
          result: { discovered: { chains: [{ chainId: "4663", spokeVault: core }] } },
        }),
      ],
      { outcome: "completed" },
    );
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("status")).toHaveTextContent("Launch completed");
    expect(screen.getByText(/Off-chain step completed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `spokeVault: ${core}` })).toHaveAttribute(
      "href",
      `https://robinhoodchain.blockscout.com/address/${core}`,
    );
    expect(screen.queryByRole("button", { name: "Sign next step" })).not.toBeInTheDocument();
  });
  it("[R1] shows no invented step for an unavailable empty plan", () => {
    setup([], { ready: false });
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(document.querySelector("[data-launch-current-step]")).toBeNull();
    expect(screen.queryByText(/Step 0 of 0|Step 1 of 0/)).not.toBeInTheDocument();
  });
});

describe("preserved launch consent (POO-2212)", () => {
  it("opens without signing; close pauses and reopening needs explicit Resume", () => {
    const launch = setup();
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("dialog", { name: "Fund launch journey" })).toBeInTheDocument();
    expect(launch.sign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(launch.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume journey" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(launch.sign).not.toHaveBeenCalled();
    expect(launch.resume).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Resume journey" }),
    );
    expect(launch.resume).toHaveBeenCalledTimes(1);
  });
  it("keeps Pause reachable while another signing prompt is disabled", () => {
    const launch = setup(undefined, { busy: true });
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("button", { name: "Sign next step" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Pause journey" }));
    expect(launch.cancel).toHaveBeenCalledTimes(1);
  });
  it("returns keyboard focus to the reopen control after Escape", async () => {
    const launch = setup();
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(launch.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Resume journey" })).toHaveFocus();
    expect(launch.sign).not.toHaveBeenCalled();
  });
  it("does not mount a wallet journey in mock mode", () => {
    state.mock = true;
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Launch requires real mode");
  });
});
