/**
 * @id PP-CORE-CMP-058 (POO-751)
 * @name GuardedLink — tests
 * @implements-rules-version v1
 *
 * The guarded link intercepts a plain left-click and routes it through the unsaved-changes guard
 * (POO-751 [R3]/[R5]): while a registered form is DIRTY the click is blocked and the confirm modal
 * appears (router.push is deferred until "Leave"); while CLEAN it navigates immediately, exactly like
 * a plain Link. Modified/non-primary clicks keep native behavior (never leave the page, so unguarded).
 */
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/lib/hooks/unsavedChanges";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { GuardedLink } from "./GuardedLink";

// GuardedLink reads @/i18n/navigation's useRouter + Link; mock both so the runner never loads
// next-intl's real navigation. `push` is a spy so we can assert WHEN navigation actually runs.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
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

/** Registers `dirty` with the guard then renders a guarded link into the SAME provider tree. */
function Harness({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return <GuardedLink href="/profile">Go to profile</GuardedLink>;
}

function renderGuardedLink(dirty: boolean) {
  return renderWithProviders(
    <UnsavedChangesProvider>
      <Harness dirty={dirty} />
    </UnsavedChangesProvider>,
  );
}

describe("GuardedLink (POO-751)", () => {
  it("[R3] navigates immediately on a plain click while clean", async () => {
    const user = userEvent.setup();
    push.mockClear();
    renderGuardedLink(false);
    await user.click(screen.getByRole("link", { name: "Go to profile" }));
    expect(push).toHaveBeenCalledWith("/profile");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("[R3]/[R5] blocks the click and opens the modal while dirty (no navigation)", async () => {
    const user = userEvent.setup();
    push.mockClear();
    renderGuardedLink(true);
    await user.click(screen.getByRole("link", { name: "Go to profile" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("[R5] Keep editing cancels — the modal closes and navigation never runs", async () => {
    const user = userEvent.setup();
    push.mockClear();
    renderGuardedLink(true);
    await user.click(screen.getByRole("link", { name: "Go to profile" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("[R5] Leave discards the edits and runs the deferred navigation", async () => {
    const user = userEvent.setup();
    push.mockClear();
    renderGuardedLink(true);
    await user.click(screen.getByRole("link", { name: "Go to profile" }));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(push).toHaveBeenCalledWith("/profile");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("keeps native behavior for a modified (cmd) click — never intercepts", async () => {
    const user = userEvent.setup();
    push.mockClear();
    renderGuardedLink(true);
    // A cmd/meta click opens a new tab and never leaves this page, so the guard must not fire.
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("link", { name: "Go to profile" }));
    await user.keyboard("{/Meta}");
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });
});
