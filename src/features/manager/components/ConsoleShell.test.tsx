/**
 * @name ConsoleShell — tests
 * Behavior (POO-704): the console chrome forwards the owner `displayName` to its greeting, so the
 * manager-side thread (page → ManagerConsoleDataLoader → ManagerConsoleScreen → ConsoleShell →
 * GreetingHeading) is pinned the same way HomeView pins the investor thread.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { ConsoleShell } from "./ConsoleShell";

// GreetingHeading + ConsoleShell both import @/i18n/navigation (Link + useRouter); mock both so the
// suite doesn't load next-intl's navigation in the runner.
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
  useRouter: () => ({ push: vi.fn() }),
}));

describe("ConsoleShell", () => {
  it("[POO-704] forwards the owner displayName to the greeting", () => {
    renderWithProviders(
      <ConsoleShell active="overview" onSelectTab={() => {}} displayName="Zed Console">
        <div />
      </ConsoleShell>,
    );
    expect(
      screen.getByRole("heading", { name: /Good (morning|afternoon|evening), Zed Console/ }),
    ).toBeInTheDocument();
  });
});
