/**
 * @id PP-DASH-CMP-007 (POO-579)
 * @name ReferralWelcomeBanner — tests
 *
 * Feature B (POO-579): a one-time welcome banner shown on Home right after a new user's referral was
 * validated (the `pp-referral-welcome` flag is pending). It renders once, consumes the flag on mount
 * (so a later mount does not re-show it), and is dismissible.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markReferralWelcomePending } from "@/features/rewards/referralWelcome";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { ReferralWelcomeBanner } from "./ReferralWelcomeBanner";

describe("ReferralWelcomeBanner", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  // @rule R11: renders when the flag is pending and clears it (once-only)
  it("renders the welcome banner when a referral welcome is pending", () => {
    markReferralWelcomePending();
    renderWithProviders(<ReferralWelcomeBanner />);
    expect(screen.getByText(/Welcome to Pool Party!/)).toBeInTheDocument();
  });

  // @rule R11: nothing renders when no flag is pending
  it("renders nothing when no welcome is pending", () => {
    const { container } = renderWithProviders(<ReferralWelcomeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  // @rule R11: the flag is consumed on mount → a second (fresh) mount does not re-show
  it("consumes the flag so a second mount does not re-render the banner", () => {
    markReferralWelcomePending();
    const first = renderWithProviders(<ReferralWelcomeBanner />);
    expect(screen.getByText(/Welcome to Pool Party!/)).toBeInTheDocument();
    first.unmount();

    const { container } = renderWithProviders(<ReferralWelcomeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  // @rule R11: dismiss hides the banner
  it("hides the banner when dismissed", () => {
    markReferralWelcomePending();
    renderWithProviders(<ReferralWelcomeBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Welcome to Pool Party!/)).not.toBeInTheDocument();
  });
});
