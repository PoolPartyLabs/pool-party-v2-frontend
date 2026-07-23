/**
 * @id PP-CORE-CMP-056 (POO-713)
 * @name StrategyLogo tests
 * @implements-rules-version v1
 *
 * Renders the manager-uploaded logo as a decorative circular image (empty alt, aria-hidden) when a
 * URL is present, and falls back to an initials monogram (via initialsFor) when the URL is
 * absent/empty. Sizing/typography come from the passed className.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StrategyLogo } from "./StrategyLogo";

describe("StrategyLogo", () => {
  it("renders the logo image when a url is present", () => {
    const { container } = render(
      <StrategyLogo url="https://cdn.example/logo.png" name="ETH Steady" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://cdn.example/logo.png");
  });

  it("keeps the image decorative (empty alt, aria-hidden) since the name is adjacent", () => {
    const { container } = render(
      <StrategyLogo url="https://cdn.example/logo.png" name="ETH Steady" />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to an initials monogram when the url is absent", () => {
    const { container } = render(<StrategyLogo name="Delta Neutral" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("DN")).toBeInTheDocument();
  });

  it("falls back to initials when the url is an empty string", () => {
    const { container } = render(<StrategyLogo url="" name="Aerodrome" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AE")).toBeInTheDocument();
  });

  it("falls back to initials when the url is null", () => {
    const { container } = render(<StrategyLogo url={null} name="ETH Steady" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("ES")).toBeInTheDocument();
  });

  it("prefers a caller-supplied initials (the precomputed no-image fallback) over the name-derived one", () => {
    // ManagerStrategy carries a precomputed `initials`; the component uses it rather than re-deriving.
    render(<StrategyLogo name="Some Other Name" initials="XY" />);
    expect(screen.getByText("XY")).toBeInTheDocument();
  });

  it("keeps the initials monogram decorative (aria-hidden)", () => {
    render(<StrategyLogo name="ETH Steady" />);
    const monogram = screen.getByText("ES");
    expect(monogram).toHaveAttribute("aria-hidden", "true");
  });

  it("applies extra classes to both the image and the monogram branch", () => {
    const withLogo = render(
      <StrategyLogo url="https://cdn.example/logo.png" name="ETH" className="size-10 text-sm" />,
    );
    expect(withLogo.container.querySelector("img")).toHaveClass("size-10");
    withLogo.unmount();
    render(<StrategyLogo name="ETH" className="size-10 text-sm" />);
    expect(screen.getByText("ET")).toHaveClass("size-10");
  });
});
