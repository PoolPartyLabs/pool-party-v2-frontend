/**
 * @id PP-DEP-SCR-001
 * @name DepositScreen, the copy-address label survives page translation
 * @implements-rules-version v1 (POO-1786 rules v1)
 *
 * POO-1786 [R1] [R2] (site S1). The copy-address CTA swaps `Copy` for `Check` beside its label once
 * the clipboard write lands. Chrome page translation replaces the label's text node with `<font>`
 * wrappers while React keeps the old node, so that swap's `insertBefore(check, textNode)` threw
 * `NotFoundError` (the POO-1762 crash shape, Sentry POOL-PARTY-FRONTEND-S) and the route error
 * boundary took the whole screen. The label now sits in its own span ([R1]); this suite replays the
 * rewrite through the shared `tests/utils/chromeTranslate.tsx` helper and flips `copied` ([R2]).
 *
 * The harness is the one `DepositScreen.analytics.test.tsx` uses to reach the same button.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatchBoundary, translateLikeChrome } from "../../../tests/utils/chromeTranslate";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { DepositScreen } from "./DepositScreen";

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

const auth = { address: "" as string | undefined, isLoading: false };
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: auth.address, isLoading: auth.isLoading }),
}));

/** The connected (checksummed) address the crypto path shows and copies. */
const ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

beforeEach(() => {
  window.dataLayer = [];
  auth.address = ADDRESS;
  auth.isLoading = false;
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Enter the crypto path and confirm the pre-selected network (Arbitrum). */
function openCryptoAndPickArbitrum() {
  fireEvent.click(screen.getAllByRole("button", { name: "Deposit crypto" })[0] as HTMLElement);
  fireEvent.click(screen.getByRole("radio", { name: "Arbitrum" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("DepositScreen, copy address after Chrome translated the label (POO-1786)", () => {
  // @rule POO-1786 R1 R2 (S1): flipping `copied` inserts the check beside an element React owns.
  it("[R1] [R2] confirms the copy without throwing and shows the check icon", async () => {
    // React logs the boundary-caught error; that log IS the failure under test, not noise to fix.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const caught: Error[] = [];
    renderWithProviders(
      <CatchBoundary onError={(error) => caught.push(error)}>
        <DepositScreen investContext={null} />
      </CatchBoundary>,
    );
    openCryptoAndPickArbitrum();
    const button = screen.getByRole("button", { name: "Copy" });
    translateLikeChrome(button);
    // The replay must have rewritten a node, or the case passes vacuously.
    expect(button.querySelector("font")).not.toBeNull();

    fireEvent.click(button);
    await waitFor(() => {
      if (caught.length > 0) return;
      expect(button.querySelector("svg.lucide-check")).not.toBeNull();
    });

    expect(caught.map((error) => error.name)).toEqual([]);
    expect(screen.getByRole("button", { name: "Copied" })).toBe(button);
  });

  // @rule POO-1786 R3 (S1): the seatbelt is invisible. The label span carries nothing of its own,
  // so it is one flex item where an anonymous one was, and the accessible name is still the label.
  it("[R3] wraps the label in a bare span and keeps the accessible name", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPickArbitrum();
    const button = screen.getByRole("button", { name: "Copy" });
    const label = button.querySelector("svg + span");
    expect(label).not.toBeNull();
    expect(label?.attributes).toHaveLength(0);
    expect(label?.textContent).toBe("Copy");
  });
});
