/**
 * @id PP-CORE-CMP-015
 * @name FeatureFlagBanner.test
 * Behavior: shows a prominent preview notice for dark-launched areas (stage next/planned); renders
 * nothing for launched areas (stage core/live).
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { FeatureFlagBanner } from "./FeatureFlagBanner";

describe("FeatureFlagBanner", () => {
  it("shows a preview notice for a dark-launched area", () => {
    renderWithProviders(<FeatureFlagBanner feature="cards" />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Cards · Preview");
    expect(banner).toHaveTextContent("NEXT_PUBLIC_FEATURE_CARDS");
  });

  it("renders nothing for a launched (core/live) area", () => {
    renderWithProviders(<FeatureFlagBanner feature="home" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
