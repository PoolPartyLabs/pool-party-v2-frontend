import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../../tests/utils/renderWithProviders";
import { FundLaunchJourney } from "./FundLaunchJourney";

const hash = `0x${"ab".repeat(32)}`;
const core = `0x${"12".repeat(20)}`;
vi.mock("@/lib/services", () => ({ isMockMode: false }));
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
    ],
    ready: true,
    busy: false,
    journal: {},
    outcome: "in-progress",
    sign: vi.fn(),
    retry: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
  }),
}));
describe("launch Journey outcomes [R3, R6]", () => {
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
    expect(screen.getByText(/Off-chain step completed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign next step" })).toBeEnabled();
  });
});
