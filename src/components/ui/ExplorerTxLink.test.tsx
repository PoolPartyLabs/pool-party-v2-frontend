/**
 * @id PP-CORE-CMP-050
 * @name ExplorerTxLink — tests
 * @implements-rules-version v1
 *
 * Behavior (POO-514 R2): the shared "View on explorer" affordance builds the /tx/{hash} URL for the
 * TX NETWORK via getExplorerTxUrl and renders nothing when the URL cannot be assembled (missing
 * network / hash, unsupported network) — never an explorer home page or a fabricated link.
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { ExplorerTxLink } from "./ExplorerTxLink";

const HASH = "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd";

describe("ExplorerTxLink", () => {
  // @rule R2 (POO-514)
  it("(R2) links the explorer /tx/ URL of the tx network", () => {
    renderWithProviders(<ExplorerTxLink network="base" hash={HASH} />);
    const link = screen.getByRole("link", { name: "View on explorer" });
    expect(link).toHaveAttribute("href", `https://basescan.org/tx/${HASH}`);
  });

  // @rule R2 (POO-514) — the network picks the explorer (never a hard-coded basescan).
  it("(R2) follows the network: arbitrum links Arbiscan, polygon links Polygonscan", () => {
    const { unmount } = renderWithProviders(<ExplorerTxLink network="arbitrum" hash={HASH} />);
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      `https://arbiscan.io/tx/${HASH}`,
    );
    unmount();
    renderWithProviders(<ExplorerTxLink network="polygon" hash={HASH} />);
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      `https://polygonscan.com/tx/${HASH}`,
    );
  });

  it("renders nothing without a network, without a hash, or on an unsupported network", () => {
    renderWithProviders(
      <>
        <ExplorerTxLink network={undefined} hash={HASH} />
        <ExplorerTxLink network="base" hash={null} />
        <ExplorerTxLink network="solana" hash={HASH} />
      </>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens in a new tab without leaking the opener", () => {
    renderWithProviders(<ExplorerTxLink network="base" hash={HASH} />);
    const link = screen.getByRole("link", { name: "View on explorer" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  // @rule POO-1508 R48/R59: a quiet text link, not a bordered button, for the settling screens.
  // Opt-in via `variant="text"`; every existing caller is unchanged (the default stays the button).
  describe("variant", () => {
    it("defaults to the bordered-button look, so every existing caller is unaffected", () => {
      renderWithProviders(<ExplorerTxLink network="base" hash={HASH} />);
      const link = screen.getByRole("link", { name: "View on explorer" });
      expect(link.className).toContain("border");
      expect(link.className).toContain("rounded-md");
    });

    it('variant="text" drops the border/button chrome for a plain inline link', () => {
      renderWithProviders(<ExplorerTxLink network="base" hash={HASH} variant="text" />);
      const link = screen.getByRole("link", { name: "View on explorer" });
      expect(link.className).not.toContain("border");
      expect(link.className).not.toContain("rounded-md");
      expect(link.className).toContain("underline");
    });

    it('variant="text" still assembles the same URL and still renders nothing when it cannot', () => {
      renderWithProviders(<ExplorerTxLink network="solana" hash={HASH} variant="text" />);
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  // @rule M5.1/M5.3 (POO-1526): "View on explorer" is on the issue's own 44pt list, and the text
  // variant shipped as a bare 20px line. It gets the house invisible hit area rather than a
  // min-height, biased downward so it cannot overlap the settling screen's Close 8px above it.
  describe("[M5.1] touch target on the text variant", () => {
    it("expands the text variant with the house invisible hit area", () => {
      renderWithProviders(<ExplorerTxLink network="base" hash={HASH} variant="text" />);
      const link = screen.getByRole("link", { name: "View on explorer" });
      // `relative` is what the absolute pseudo-element is positioned against; without it the hit
      // area would size itself off the nearest positioned ancestor instead of the link.
      expect(link).toHaveClass("relative");
      expect(link).toHaveClass("after:absolute");
      expect(link).toHaveClass("after:-inset-3.5");
    });

    it("[M5.3] caps the UPWARD growth under the 8px gap, spending the rest downward", () => {
      renderWithProviders(<ExplorerTxLink network="base" hash={HASH} variant="text" />);
      const link = screen.getByRole("link", { name: "View on explorer" });
      // 6px up (< the settling column's 8px gap-2, so the Close above is never covered) and 20px
      // down: 6 + 20 + 20 = 46px of target off a 20px line.
      expect(link).toHaveClass("after:-top-1.5");
      expect(link).toHaveClass("after:-bottom-5");
    });

    it("leaves the button variant's real 44px box alone", () => {
      renderWithProviders(<ExplorerTxLink network="base" hash={HASH} />);
      const link = screen.getByRole("link", { name: "View on explorer" });
      expect(link).toHaveClass("h-11");
      expect(link.className).not.toContain("after:");
    });
  });

  // @rule POO-1568 R1: the execution screen puts this link UNDER its state button, where it has to
  // read as that button's own secondary action. That needs the button's SHAPE with none of its
  // weight, which is neither shipped variant: `button` is a bordered CTA that would compete with
  // `Done`, and `text` is a bare underlined line that reads as an afterthought beneath one.
  describe('[R1] variant="ghost"', () => {
    it("takes the button's shape: full width, rounded, and a real 44px box", () => {
      renderWithProviders(<ExplorerTxLink network="base" hash={HASH} variant="ghost" />);
      const link = screen.getByRole("link", { name: "View on explorer" });
      expect(link).toHaveClass("w-full");
      expect(link).toHaveClass("rounded-md");
      // Same geometry as its bordered sibling, so the two differ in weight and nothing else. A real
      // box also means it never needs the `text` variant's invisible hit area, and so cannot grow
      // into the state button 8px above it.
      expect(link).toHaveClass("h-11");
      expect(link.className).not.toContain("after:");
    });

    it("stays quiet: no border, no fill, muted text that lifts on hover", () => {
      renderWithProviders(<ExplorerTxLink network="base" hash={HASH} variant="ghost" />);
      const link = screen.getByRole("link", { name: "View on explorer" });
      expect(link.className).not.toContain("border");
      expect(link.className).not.toContain("bg-");
      expect(link).toHaveClass("text-muted-foreground");
      expect(link).toHaveClass("hover:text-foreground");
      // Never the `text` variant's underline: this one reads as a button, not as a line of copy.
      expect(link.className).not.toContain("underline");
    });

    it("assembles the same URL, and still renders nothing when it cannot", () => {
      const { unmount } = renderWithProviders(
        <ExplorerTxLink network="base" hash={HASH} variant="ghost" />,
      );
      expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
        "href",
        `https://basescan.org/tx/${HASH}`,
      );
      unmount();
      renderWithProviders(<ExplorerTxLink network="solana" hash={HASH} variant="ghost" />);
      expect(screen.queryByRole("link")).toBeNull();
    });
  });
});
