import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../../tests/utils/renderWithProviders";
import { FundLaunchJourney } from "./FundLaunchJourney";

const hash = `0x${"ab".repeat(32)}`;
const core = `0x${"12".repeat(20)}`;
const state = vi.hoisted(() => ({
  outcome: "in-progress",
  error: false,
  mock: false,
  reportWaiting: false,
}));
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
vi.mock("./useV2Launch", () => ({
  useV2Launch: () => ({
    journey: { draft: { review: { name: "Income fund demo" } } },
    addresses: { coreVault: core },
    steps: [
      ...(state.reportWaiting
        ? [{ id: "report", kind: "report", chainId: 42161, status: "waiting" }]
        : []),
      {
        id: "create",
        kind: "create",
        chainId: 42161,
        status: "submitted",
        txHash: hash,
        explorerUrl: `https://arbiscan.io/tx/${hash}`,
        receiptStatus: "unknown",
        error: null,
      },
      {
        id: "profile",
        kind: "profile",
        chainId: 42161,
        status: "confirmed",
        txHash: null,
        explorerUrl: null,
        receiptStatus: null,
        error: null,
      },
      {
        id: "discover-spoke",
        kind: "discover",
        chainId: 4663,
        status: "confirmed",
        result: {
          discovered: { chains: [{ chainId: "4663", spokeVault: core, status: "created" }] },
        },
      },
    ],
    error: state.error
      ? { messageKey: "fundLaunch.partialFailure", code: "BALANCE_CHANGED" }
      : null,
    ready: true,
    busy: false,
    journal: {},
    outcome: state.outcome,
    sign: vi.fn(),
    retry: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
  }),
}));
describe("launch Journey outcomes [R3, R6]", () => {
  beforeEach(() => {
    state.outcome = "in-progress";
    state.error = false;
    state.mock = false;
    state.reportWaiting = false;
  });
  it("shows an honest finalized-report wait estimate without a failure", () => {
    state.reportWaiting = true;
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for an accepted report. Typically 14-19 minutes",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shows broadcast hashes as explorer links immediately, receipt status and existing fund", () => {
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("link", { name: hash })).toHaveAttribute(
      "href",
      `https://arbiscan.io/tx/${hash}`,
    );
    expect(screen.getByText(/Receipt: Not yet confirmed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: core })).toHaveAttribute(
      "href",
      `https://arbiscan.io/address/${core}`,
    );
    expect(screen.getAllByText(/Off-chain step completed/)).toHaveLength(2);
    expect(screen.getByRole("link", { name: `spokeVault: ${core}` })).toHaveAttribute(
      "href",
      `https://robinhoodchain.blockscout.com/address/${core}`,
    );
    expect(screen.getByRole("button", { name: "Sign next step" })).toBeEnabled();
  });
  it("renders partial failure and retry while preserving the created fund", () => {
    state.error = true;
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("alert")).toHaveTextContent("BALANCE_CHANGED");
    expect(screen.getByRole("button", { name: "Retry failed step" })).toBeEnabled();
  });
  it("renders completion without another signing control", () => {
    state.outcome = "completed";
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("status")).toHaveTextContent("Launch completed");
    expect(screen.queryByRole("button", { name: "Sign next step" })).not.toBeInTheDocument();
  });
  it("does not mount the wallet journey in mock mode", () => {
    state.mock = true;
    renderWithProviders(<FundLaunchJourney journeyId="journey" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Launch requires real mode");
  });
});
