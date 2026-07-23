/**
 * @id PP-MGR-CMP-033 (POO-771)
 * @name ManagerAvatar — tests
 *
 * Behavior (POO-771 R8): renders the manager's avatar image when a URL is set; falls back to the
 * initials monogram otherwise or when the image fails to load; the monogram derives from the first
 * ALPHANUMERIC character (never the leading "@" of an "@handle"); and the present-only mode renders
 * nothing when there is no image (the detail hero).
 */
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { ManagerAvatar } from "./ManagerAvatar";

describe("ManagerAvatar", () => {
  // @rule R8
  it("renders the avatar image when a URL is set", () => {
    renderWithProviders(<ManagerAvatar avatarUrl="https://cdn.example/a.png" name="@aave-labs" />);
    const img = screen.getByTestId("manager-avatar-image");
    expect(img).toHaveAttribute("src", "https://cdn.example/a.png");
  });

  // @rule R8
  it("falls back to the initials monogram when no URL is set", () => {
    renderWithProviders(<ManagerAvatar name="Pool Party Labs" />);
    expect(screen.queryByTestId("manager-avatar-image")).toBeNull();
    // First alphanumeric char of "Pool Party Labs" → "P".
    expect(screen.getByText("P")).toBeInTheDocument();
  });

  // @rule R8: the monogram is the first ALPHANUMERIC char, never the "@" of an "@handle".
  it("derives the monogram from the first alphanumeric char, never '@'", () => {
    renderWithProviders(<ManagerAvatar name="@aave-labs" />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByText("@")).toBeNull();
  });

  // @rule R8: image load failure → monogram fallback.
  it("falls back to the monogram when the image fails to load", () => {
    renderWithProviders(
      <ManagerAvatar avatarUrl="https://cdn.example/broken.png" name="@numen-capital" />,
    );
    fireEvent.error(screen.getByTestId("manager-avatar-image"));
    expect(screen.queryByTestId("manager-avatar-image")).toBeNull();
    expect(screen.getByText("N")).toBeInTheDocument();
  });

  // @rule R8: present-only mode (the detail hero) renders nothing without an image.
  it("renders nothing without an image when the monogram fallback is disabled", () => {
    const { container } = renderWithProviders(
      <ManagerAvatar name="@aave-labs" showMonogramFallback={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
