/**
 * @id PP-PROF-SCR-001
 * @name Profile hub — tests
 * Behavior: renders identity + referral + grouped rows; Log out opens the confirm dialog and
 * confirming clears the session and routes to sign-in.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockProfileUser } from "@/mocks/data/profile";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../../../tests/utils/renderWithProviders";
import { ProfileHubScreen } from "./ProfileHubScreen";

const { push, logout, getReferral } = vi.hoisted(() => ({
  push: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  // Filled program: the featured card shows code + stats (the empty state is covered by the
  // ReferralScreen / service tests — POO-290).
  getReferral: vi.fn().mockResolvedValue({
    rewardUsd: 10,
    minInvestUsd: 50,
    totalEarnedUsd: 30,
    friendsJoined: 3,
    code: "MARIA2026",
    inviteLink: "app.pool-party.xyz?ref=maria2026",
    invites: [],
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
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

vi.mock("@/lib/services", () => ({
  isMockMode: true,
  authService: { logout },
  rewardsService: { getReferral, createReferralCode: vi.fn() },
}));

// useAuth imports these at module level; stub them so the import resolves.
vi.mock("@privy-io/react-auth", () => ({
  useLogin: () => ({ login: vi.fn() }),
  useLogout: () => ({ logout: vi.fn() }),
  usePrivy: () => ({ authenticated: false, ready: true }),
  useWallets: () => ({ wallets: [], ready: true }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
}));

// POO-343: the chip reads the REAL Quacks source. A value distinct from mockProfileUser.quacks (15,021)
// proves it's wired to the hook, not the hardcoded prop.
vi.mock("@/features/rewards/hooks/useQuacksBalance", () => ({
  useQuacksBalance: () => 8888,
}));

describe("ProfileHubScreen", () => {
  beforeEach(async () => {
    window.dataLayer = [];
    // The referral surfaces share a module-level cache — start each test from a fresh fetch.
    const { __resetReferralStateForTests } = await import("@/features/rewards/useReferral");
    __resetReferralStateForTests();
  });

  it("renders the identity, referral and menu rows", () => {
    renderWithProviders(<ProfileHubScreen user={mockProfileUser} />);
    expect(screen.getByRole("heading", { name: "Maria Silva" })).toBeInTheDocument();
    // Identity renders twice: mobile header + desktop aside (POO-108 R7).
    expect(screen.getAllByText("maria@email.com")).toHaveLength(2);
    expect(screen.getAllByText("Invite & earn")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Personal information" })).toBeInTheDocument();
  });

  // @rule POO-849 R1 — the hub renders the persisted avatar photo on BOTH identity sites (mobile
  // header + desktop aside).
  it("[POO-849 R1] renders the avatar photo on both the mobile header and desktop aside", () => {
    const { container } = renderWithProviders(
      <ProfileHubScreen user={{ ...mockProfileUser, avatar: "https://cdn.example/me.png" }} />,
    );
    // Both sites render in jsdom (CSS media queries do not hide them), so the photo appears twice.
    expect(container.querySelectorAll('img[src="https://cdn.example/me.png"]')).toHaveLength(2);
    // The monogram is replaced by the photo at both sites.
    expect(screen.queryAllByText(mockProfileUser.initial)).toHaveLength(0);
  });

  it("[POO-849 R1] falls back to the initials monogram when there is no avatar", () => {
    renderWithProviders(<ProfileHubScreen user={{ ...mockProfileUser, avatar: "" }} />);
    // Both identity sites show the initials monogram (mockProfileUser.initial === "M").
    expect(screen.getAllByText(mockProfileUser.initial)).toHaveLength(2);
  });

  it("renders the desktop identity aside with the real Quacks balance + Edit profile (POO-343)", () => {
    renderWithProviders(<ProfileHubScreen user={mockProfileUser} />);
    // Reads the real source (mocked to 8,888), NOT the hardcoded mockProfileUser.quacks (15,021).
    expect(screen.getByText("8,888 Quacks")).toBeInTheDocument();
    expect(screen.queryByText("15,021 Quacks")).toBeNull();
    const edit = screen.getByRole("link", { name: "Edit profile" });
    expect(edit).toHaveAttribute("href", "/profile/personal");
  });

  it("hides the manager-only rows when the user isn't a manager", () => {
    renderWithProviders(<ProfileHubScreen user={mockProfileUser} />);
    expect(screen.queryByText("Manager profile")).toBeNull();
    // POO-766 R2: the Manager Incentive Program row is manager-only too.
    expect(screen.queryByText("Manager Incentive Program")).toBeNull();
  });

  it("renders the gold Manager row right after the referral card for managers", () => {
    renderWithProviders(<ProfileHubScreen user={{ ...mockProfileUser, isManager: true }} />);
    // Mobile placement (own gold section after the referral card) + desktop row in Rewards.
    expect(screen.getAllByText("Manager profile")).toHaveLength(2);
    expect(screen.getAllByText("Your public manager page")).toHaveLength(2);
    // POO-766 R2: the Manager Incentive Program row is visible for managers.
    expect(screen.getByText("Manager Incentive Program")).toBeInTheDocument();
  });

  it("logs out via the confirm dialog", async () => {
    renderWithProviders(<ProfileHubScreen user={mockProfileUser} />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Log out" }));
    expect(window.dataLayer).toContainEqual(expect.objectContaining({ event: "auth_logout" }));
    expect(logout).toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
  });

  it("still routes to sign-in when logout fails", async () => {
    push.mockClear();
    logout.mockRejectedValueOnce(new Error("network"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(<ProfileHubScreen user={mockProfileUser} />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
    errorSpy.mockRestore();
  });
});
