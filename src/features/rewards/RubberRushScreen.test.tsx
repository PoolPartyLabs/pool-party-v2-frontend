/**
 * @id PP-REW-SCR-001
 * @name Rubber Rush — tests
 * Behavior: renders the dashboard from the mock data (balance, tier, gamified actions, headline
 * stats, streak segments, referral fields) and copies the referral code via the Clipboard API.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rewardsService } from "@/lib/services";
import { rubberRush } from "@/mocks/data/rewards";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { RubberRushScreen } from "./RubberRushScreen";
import { __resetReferralStateForTests } from "./useReferral";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockClear();
  window.dataLayer = [];
  // The referral aside shares a module-level cache — start each test from a fresh fetch.
  __resetReferralStateForTests();
});

describe("RubberRushScreen", () => {
  it("tracks reward_program_viewed (rubber_rush) on render", () => {
    renderWithProviders(<RubberRushScreen data={rubberRush} />);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "reward_program_viewed", reward_program: "rubber_rush" }),
    );
  });

  it("renders the header, balance and tier", () => {
    renderWithProviders(<RubberRushScreen data={rubberRush} />);
    expect(screen.getByRole("heading", { name: "Rubber Rush" })).toBeInTheDocument();
    expect(screen.getByText("15,021")).toBeInTheDocument();
    expect(screen.getAllByText(/Swimmer/).length).toBeGreaterThan(0);
  });

  it("renders the gamified actions and headline stats", () => {
    renderWithProviders(<RubberRushScreen data={rubberRush} />);
    expect(screen.getByRole("button", { name: "Say Quack" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Duck Shoot" })).toBeInTheDocument();
    expect(screen.getByText("Total referrals")).toBeInTheDocument();
    expect(screen.getByText("Daily boost")).toBeInTheDocument();
    expect(screen.getByText("Quacks today")).toBeInTheDocument();
    expect(screen.getByText("0x")).toBeInTheDocument();
  });

  it("renders one filled-or-empty segment per streak day", () => {
    renderWithProviders(<RubberRushScreen data={rubberRush} />);
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("D7")).toBeInTheDocument();
  });

  it("clamps the streak label to the target — never shows x > 7 in 'x / 7 days' (POO-769)", () => {
    renderWithProviders(
      <RubberRushScreen data={{ ...rubberRush, streakDays: 10, streakTarget: 7 }} />,
    );
    expect(screen.queryByText("10 / 7 days")).toBeNull();
    expect(screen.getAllByText("7 / 7 days").length).toBeGreaterThan(0);
  });

  // POO-290 R1: before the one-time code exists the aside shows the create CTA. NOTE: this test
  // must run BEFORE the creation test below — the mock service session persists per test file.
  it("shows the referral create CTA before a code exists", async () => {
    renderWithProviders(<RubberRushScreen data={rubberRush} />);
    const cta = await screen.findByRole("link", { name: "Create your code" });
    expect(cta).toHaveAttribute("href", "/rewards/referral");
    expect(screen.queryByText("MARIA2026")).not.toBeInTheDocument();
  });

  // POO-854 R4/R5: the referral-rewards card renders in BOTH modes (the isMockMode gate is gone).
  // Assert plain-text fragments OUTSIDE any <hl> chunk so the rich-text split can't make them brittle,
  // plus the data-bound footer (friends progress + the fixed 1.5x tier multiplier).
  it("renders the referral-rewards card with copy, friends progress and multiplier", () => {
    renderWithProviders(<RubberRushScreen data={rubberRush} />);
    expect(screen.getByText("Referral Rewards")).toBeInTheDocument();
    expect(
      screen.getByText(/Share your referral code and give your referees a/),
    ).toBeInTheDocument();
    expect(screen.getByText(/This boost is one-time and non-cumulative/)).toBeInTheDocument();
    // POO-854 R1/R2/R3: footer reads the friends count (3) / target (5) and the 1.5x multiplier.
    expect(screen.getByText("3 / 5 Friends")).toBeInTheDocument();
    expect(screen.getByText("1.5x Multiplier")).toBeInTheDocument();
  });

  // POO-854 R4: with no referrals the card shows a zero progress ("0 / 5 Friends"), never hidden and
  // never fabricated.
  it("shows a zero friends-progress in the referral-rewards card when there are no referrals", () => {
    renderWithProviders(<RubberRushScreen data={{ ...rubberRush, referralFriends: 0 }} />);
    expect(screen.getByText("0 / 5 Friends")).toBeInTheDocument();
  });

  it("shows the code + link fields and copies once the code exists", async () => {
    await rewardsService.createReferralCode("MARIA2026");
    renderWithProviders(<RubberRushScreen data={rubberRush} />);

    expect(await screen.findByText("MARIA2026")).toBeInTheDocument();
    // POO-765 R3: the link field is the canonical `?ref=` share URL, not the legacy `/r/` form.
    expect(screen.getByText(/\?ref=MARIA2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Copy referral code"));

    expect(writeText).toHaveBeenCalledWith("MARIA2026");
    expect(await screen.findByLabelText("Copied")).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "reward_referral_shared" }),
    );
  });
});
