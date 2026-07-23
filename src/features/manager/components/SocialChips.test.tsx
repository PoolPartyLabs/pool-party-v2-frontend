/**
 * @id PP-MGR-CMP-034
 * @name SocialChips — tests
 * Behavior (POO-850 rules v1): the WEBSITE chip is unpinned (its SOCIAL_NETWORKS entry has
 * `domains: null`), so clicking it warns before leaving to an UNVERIFIED external site (R1) and only
 * opens the URL in a new tab on Continue, keeping noopener,noreferrer (R1). The four domain-pinned
 * chips (X / Telegram / Discord / YouTube) keep opening directly, with no confirm (R2). The chips are
 * derived internally from the serializable socials record, never a component/Icon prop (R3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { SocialChips } from "./SocialChips";

describe("SocialChips", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // window.open is a real navigation in jsdom; stub it so we can assert the exact call.
    openSpy = vi.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // @rule R1
  // @rule R3
  it("intercepts the website chip: confirms (naming the domain) before opening, only on Continue", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SocialChips socials={{ website: "https://acme.finance/vault" }} />);

    // The website chip is a link labelled with its domain (not the raw URL, not "Website").
    const chip = screen.getByRole("link", { name: "acme.finance" });
    expect(chip).toHaveAttribute("href", "https://acme.finance/vault");

    await user.click(chip);

    // Clicking does NOT navigate directly; the external-link confirm appears first.
    expect(openSpy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("You're leaving Pool Party")).toBeInTheDocument();
    // The destination domain is surfaced in the confirm body.
    expect(within(dialog).getByText(/acme\.finance/)).toBeInTheDocument();

    // Cancel closes the confirm without navigating.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(openSpy).not.toHaveBeenCalled();

    // Re-open and Continue → opens the URL in a new tab, keeping noopener,noreferrer.
    await user.click(screen.getByRole("link", { name: "acme.finance" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(openSpy).toHaveBeenCalledWith(
      "https://acme.finance/vault",
      "_blank",
      "noopener,noreferrer",
    );
  });

  // @rule R2
  it("passes a domain-pinned social chip (X) straight through with no confirm", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SocialChips socials={{ x: "https://x.com/acme" }} />);

    const chip = screen.getByRole("link", { name: "X" });
    expect(chip).toHaveAttribute("href", "https://x.com/acme");
    expect(chip).toHaveAttribute("target", "_blank");
    expect(chip).toHaveAttribute("rel", "noopener noreferrer");

    await user.click(chip);
    // A pinned network never opens the external-link confirm.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders nothing when no socials are set", () => {
    const { container } = renderWithProviders(<SocialChips socials={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
