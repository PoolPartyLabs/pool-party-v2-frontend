/**
 * @id PP-PROF-SCR-001
 * @name Profile hub - real-mode logout tests (POO-890)
 * @implements-rules-version v1
 *
 * In real mode the logout confirm must clear the server-side SIWE session (signOutAction) BEFORE
 * navigating to /sign-in, in addition to the Privy logout. Forces isMockMode=false (the mock-mode
 * logout is covered in ProfileHubScreen.test.tsx).
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

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  logout: vi.fn(),
  signOut: vi.fn(async () => {}),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
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

vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ logout: mocks.logout }) }));
vi.mock("@/features/auth/siweActions", () => ({ signOutAction: mocks.signOut }));
// The referral card and Quacks chip fetch on mount; stub them so the hub renders without services.
vi.mock("@/features/rewards/useReferral", () => ({ useReferral: () => ({ program: null }) }));
vi.mock("@/features/rewards/hooks/useQuacksBalance", () => ({ useQuacksBalance: () => 0 }));

describe("ProfileHubScreen (real mode) - POO-890 logout session invalidation", () => {
  beforeEach(() => {
    window.dataLayer = [];
    mocks.push.mockClear();
    mocks.logout.mockClear();
    mocks.signOut.mockClear();
    mocks.signOut.mockImplementation(async () => {});
  });

  function confirmLogout() {
    renderWithProviders(<ProfileHubScreen user={mockProfileUser} />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Log out" }));
  }

  // @rule POO-890 R1 - logout clears pp_access_token server-side before navigation.
  it("[R1] clears the SIWE session via signOutAction before routing to sign-in", async () => {
    confirmLogout();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/sign-in"));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    // The cookie clear must land BEFORE the navigation (R1: "before navigation").
    const signOutOrder = Number(mocks.signOut.mock.invocationCallOrder[0]);
    const pushOrder = Number(mocks.push.mock.invocationCallOrder[0]);
    expect(signOutOrder).toBeLessThan(pushOrder);
  });

  // @rule POO-890 R1 - a failing cookie clear must not trap the user in the app.
  it("[R1] still routes to sign-in when signOutAction fails", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("network"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    confirmLogout();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/sign-in"));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
