/**
 * @id PP-REW-SCR-003
 * @name Referral — tests
 * Behavior: before the one-time code exists the hero shows the creation form (immutability warning,
 * validation — POO-290); after, the code + link fields and the share action (copy fallback when
 * native share is unavailable), plus stats, how-it-works and the invited-friends list.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferralProgram } from "@/lib/schemas";
import { referral as emptyReferral } from "@/mocks/data/rewards";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { ReferralScreen } from "./ReferralScreen";
import { __resetReferralStateForTests } from "./useReferral";

vi.mock("@/i18n/navigation", () => ({
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

// The hero fetches the shared program — serve whatever the test sets as the current state. Mock mode
// so useReferral reads the mock service directly (POO-661), not the getReferralAction server action.
const state = vi.hoisted(() => ({ program: {} as unknown }));
vi.mock("@/lib/services", () => ({
  isMockMode: true,
  rewardsService: {
    getReferral: vi.fn(async () => state.program),
    createReferralCode: vi.fn(async (code: string) => {
      const candidate = code.trim();
      if (!/^[a-zA-Z0-9]{6,10}$/.test(candidate)) throw new Error("invalid");
      state.program = {
        ...(state.program as ReferralProgram),
        code: candidate,
        inviteLink: `app.pool-party.xyz?ref=${candidate}`,
      };
      return state.program;
    }),
  },
}));

/** The created/filled program (the pre-POO-290 fixture values). */
const filled: ReferralProgram = {
  rewardUsd: 10,
  minInvestUsd: 50,
  totalEarnedUsd: 20,
  friendsJoined: 3,
  code: "MARIA2026",
  inviteLink: "app.pool-party.xyz?ref=MARIA2026",
  invites: [
    { name: "João P.", status: "earned", investedUsd: 200 },
    { name: "Ana R.", status: "invested", investedUsd: 120 },
    { name: "Bruno S.", status: "earned", investedUsd: 60 },
    { name: "Pedro M.", status: "pending" },
  ],
};

/** A referee's program: this wallet was itself invited by someone (Feature A, POO-579). */
const referredProgram: ReferralProgram = { ...filled, invitedByCode: "FRIEND77" };

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  // Force the copy fallback by removing the native share API.
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  writeText.mockClear();
  window.dataLayer = [];
  state.program = filled;
  __resetReferralStateForTests();
});

describe("ReferralScreen", () => {
  it("tracks reward_program_viewed (referral) on render", () => {
    renderWithProviders(<ReferralScreen data={filled} />);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "reward_program_viewed", reward_program: "referral" }),
    );
  });

  it("tracks reward_referral_shared when sharing", async () => {
    renderWithProviders(<ReferralScreen data={filled} />);
    fireEvent.click(screen.getByRole("button", { name: "Share invite link" }));
    await waitFor(() =>
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({ event: "reward_referral_shared" }),
      ),
    );
  });

  it("renders the quacks hero, code and link", () => {
    renderWithProviders(<ReferralScreen data={filled} />);
    // POO-833: the hero pitches quacks, not a USDC give-get, until the program pays out in USDC.
    expect(
      screen.getByRole("heading", { name: "Invite friends, earn quacks" }),
    ).toBeInTheDocument();
    expect(screen.getByText("MARIA2026")).toBeInTheDocument();
    expect(screen.getByText("app.pool-party.xyz?ref=MARIA2026")).toBeInTheDocument();
  });

  // Feature A (POO-579): a referred user sees who invited them, near the header.
  it("shows the 'Invited by <code>' line when the user was referred", () => {
    renderWithProviders(<ReferralScreen data={referredProgram} />);
    expect(screen.getByText("Invited by FRIEND77")).toBeInTheDocument();
  });

  it("renders nothing about an inviter when invitedByCode is absent", () => {
    renderWithProviders(<ReferralScreen data={filled} />);
    expect(screen.queryByText(/Invited by/)).not.toBeInTheDocument();
  });

  it("renders nothing about an inviter when invitedByCode is null", () => {
    renderWithProviders(<ReferralScreen data={{ ...filled, invitedByCode: null }} />);
    expect(screen.queryByText(/Invited by/)).not.toBeInTheDocument();
  });

  it("renders the friends-joined stat and how-it-works, without the USDC total-earned tile", () => {
    renderWithProviders(<ReferralScreen data={filled} />);
    // POO-833: "Total earned $" is hidden (quacks only, no USDC payout yet).
    expect(screen.queryByText("Total earned")).not.toBeInTheDocument();
    expect(screen.queryByText("$20.00")).not.toBeInTheDocument();
    expect(screen.getByText("Friends joined")).toBeInTheDocument();
    expect(screen.getByText("How it works")).toBeInTheDocument();
  });

  it("renders the invited friends with status badges", () => {
    renderWithProviders(<ReferralScreen data={filled} />);
    expect(screen.getByText("João P.")).toBeInTheDocument();
    expect(screen.getByText("Pedro M.")).toBeInTheDocument();
    // POO-833: the "earned" badge is now "Rewarded" (no USDC amount).
    expect(screen.getAllByText("Rewarded").length).toBeGreaterThan(0);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shares the canonical `?ref=` link (code as typed) when native share is unavailable", () => {
    renderWithProviders(<ReferralScreen data={filled} />);

    fireEvent.click(screen.getByRole("button", { name: "Share invite link" }));

    // POO-717 R7: the share action now emits the full `?ref=` URL (one identity per code), not the
    // legacy `/r/` path. The code is kept as typed (MARIA2026), never lowercased.
    expect(writeText).toHaveBeenCalledWith("https://app.pool-party.xyz?ref=MARIA2026");
  });

  // POO-290 R1/R2: no code yet → creation form with the immutability warning; created once →
  // fields + share, and the invites list shows its empty fallback.
  it("shows the creation form (with the immutability warning) before a code exists", () => {
    state.program = emptyReferral;
    renderWithProviders(<ReferralScreen data={emptyReferral} />);

    expect(screen.getByText("Choose your code")).toBeInTheDocument();
    expect(
      screen.getByText("Choose carefully. Your code can't be changed later."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create code" })).toBeInTheDocument();
    expect(screen.getByText("No friends invited yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share invite link" })).not.toBeInTheDocument();
  });

  it("creates the code once (as typed) and flips the hero to code + link + share", async () => {
    state.program = emptyReferral;
    renderWithProviders(<ReferralScreen data={emptyReferral} />);

    fireEvent.change(screen.getByPlaceholderText("YOURCODE"), { target: { value: "Maria2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Create code" }));

    // Displayed and linked AS TYPED — the canonical `?ref=` link keeps the casing (POO-853 R3).
    expect(await screen.findByText("Maria2026")).toBeInTheDocument();
    expect(screen.getByText("app.pool-party.xyz?ref=Maria2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share invite link" })).toBeInTheDocument();
  });

  it("rejects an invalid code (min 6 alphanumerics) with the validation hint", async () => {
    state.program = emptyReferral;
    renderWithProviders(<ReferralScreen data={emptyReferral} />);

    fireEvent.change(screen.getByPlaceholderText("YOURCODE"), { target: { value: "abc12" } });
    fireEvent.click(screen.getByRole("button", { name: "Create code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Use 6 to 10 letters or numbers.");
  });

  // POO-290 R1/R2: no code yet → creation form with the immutability warning; created once →
  // fields + share, and the invites list shows its empty fallback.
  it("shows the creation form (with the immutability warning) before a code exists", () => {
    state.program = emptyReferral;
    renderWithProviders(<ReferralScreen data={emptyReferral} />);

    expect(screen.getByText("Choose your code")).toBeInTheDocument();
    expect(
      screen.getByText("Choose carefully. Your code can't be changed later."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create code" })).toBeInTheDocument();
    expect(screen.getByText("No friends invited yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share invite link" })).not.toBeInTheDocument();
  });

  it("creates the code once (as typed) and flips the hero to code + link + share", async () => {
    state.program = emptyReferral;
    renderWithProviders(<ReferralScreen data={emptyReferral} />);

    fireEvent.change(screen.getByPlaceholderText("YOURCODE"), { target: { value: "Maria2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Create code" }));

    // Displayed and linked AS TYPED — the canonical `?ref=` link keeps the casing (POO-853 R3).
    expect(await screen.findByText("Maria2026")).toBeInTheDocument();
    expect(screen.getByText("app.pool-party.xyz?ref=Maria2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share invite link" })).toBeInTheDocument();
  });

  it("rejects an invalid code (min 6 alphanumerics) with the validation hint", async () => {
    state.program = emptyReferral;
    renderWithProviders(<ReferralScreen data={emptyReferral} />);

    fireEvent.change(screen.getByPlaceholderText("YOURCODE"), { target: { value: "abc12" } });
    fireEvent.click(screen.getByRole("button", { name: "Create code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Use 6 to 10 letters or numbers.");
  });
});
