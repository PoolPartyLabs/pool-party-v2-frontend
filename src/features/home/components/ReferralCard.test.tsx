/**
 * @id PP-DASH-CMP-004
 * @name ReferralCard — tests
 * Behavior (POO-717): the Home "Invite & earn" card shares the FULL canonical `?ref=` referral URL,
 * built from the code as typed (never the legacy `/r/` link, never the bare code). It reuses the
 * shared ShareInviteButton (native share, copy fallback, analytics), and the small code-pill copy
 * affordance copies the SAME absolute `?ref=` URL for consistency.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetReferralStateForTests } from "@/features/rewards/useReferral";
import type { ReferralProgram } from "@/lib/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ReferralCard } from "./ReferralCard";

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

// The card reads the shared program via useReferral. Mock mode so useReferral reads the mock service
// directly (POO-661), not the getReferralAction server action.
const state = vi.hoisted(() => ({ program: {} as unknown }));
vi.mock("@/lib/services", () => ({
  isMockMode: true,
  rewardsService: {
    getReferral: vi.fn(async () => state.program),
    createReferralCode: vi.fn(),
  },
}));

/** A created program. The code is UPPER-case on purpose: the share URL must keep it as typed. */
const filled: ReferralProgram = {
  rewardUsd: 10,
  minInvestUsd: 50,
  totalEarnedUsd: 20,
  friendsJoined: 3,
  code: "MARIA2026",
  // The legacy `/r/` link still lives on the program; the card must NOT share this.
  inviteLink: "pool-party.xyz/r/maria2026",
  invites: [],
};

/** The pre-creation empty program (no code yet). */
const empty: ReferralProgram = {
  rewardUsd: 10,
  minInvestUsd: 50,
  totalEarnedUsd: 0,
  friendsJoined: 0,
  code: null,
  inviteLink: null,
  invites: [],
};

const writeText = vi.fn().mockResolvedValue(undefined);
const share = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockClear();
  share.mockClear();
  window.dataLayer = [];
  state.program = filled;
  __resetReferralStateForTests();
});

describe("ReferralCard (POO-717)", () => {
  it("shares the absolute `?ref=` URL (as typed) via copy fallback, never the `/r/` link", async () => {
    // No native share → ShareInviteButton falls back to clipboard.
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    renderWithProviders(<ReferralCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Share invite link" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://app.pool-party.xyz?ref=MARIA2026"),
    );
    // Never the legacy `/r/` link nor the bare code.
    expect(writeText).not.toHaveBeenCalledWith("https://pool-party.xyz/r/maria2026");
    expect(writeText).not.toHaveBeenCalledWith("MARIA2026");
  });

  it("uses the native share sheet with the absolute `?ref=` URL and tracks the share", async () => {
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    renderWithProviders(<ReferralCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Share invite link" }));

    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({ url: "https://app.pool-party.xyz?ref=MARIA2026" }),
    );
    await waitFor(() =>
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({ event: "reward_referral_shared" }),
      ),
    );
  });

  it("copies the SAME absolute `?ref=` URL from the code-pill affordance and tracks the share", async () => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    renderWithProviders(<ReferralCard />);

    // The pill's accessible name describes the action (it copies the invite link, not the bare code).
    fireEvent.click(await screen.findByRole("button", { name: "Copy invite link" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://app.pool-party.xyz?ref=MARIA2026"),
    );
    expect(writeText).not.toHaveBeenCalledWith("MARIA2026");
    // POO-717: the pill copy now emits reward_referral_shared, parity with ShareInviteButton / ReferralField.
    await waitFor(() =>
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({ event: "reward_referral_shared" }),
      ),
    );
  });

  it("shows the create CTA and no share action before a code exists", async () => {
    state.program = empty;
    renderWithProviders(<ReferralCard />);

    expect(await screen.findByText("Create your referral code")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share invite link" })).not.toBeInTheDocument();
  });
});
