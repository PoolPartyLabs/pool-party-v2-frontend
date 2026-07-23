/**
 * @id PP-STR-CMP-005
 * @name StrategyMiniHeader — tests
 * Behavior (POO-846 R2): the mini header shows the strategy PHOTO (shared StrategyLogo) when a
 * logo URL is present, and falls back to the risk-tinted initials monogram when it is absent.
 */
import { describe, expect, it } from "vitest";
import type { Strategy } from "@/lib/schemas";
import { initialsFor } from "@/lib/utils/initials";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { StrategyMiniHeader } from "./StrategyMiniHeader";

const base: Strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 50,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY",
  status: "active",
  network: "base",
};

describe("StrategyMiniHeader", () => {
  it("[POO-846 R2] renders the strategy photo when a logo URL is present", () => {
    const { container } = renderWithProviders(
      <StrategyMiniHeader
        strategy={{ ...base, name: "Treasury Plus", logoUrl: "https://cdn.example/logo.png" }}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.example/logo.png");
    expect(screen.getByText("Treasury Plus")).toBeInTheDocument();
  });

  it("[POO-846 R2] falls back to the risk-tinted initials monogram when there is no logo", () => {
    const { container } = renderWithProviders(<StrategyMiniHeader strategy={base} />);
    expect(container.querySelector("img")).toBeNull();
    // initialsFor("Stable Yield") === "SY"; the monogram keeps the risk-2 tint as the fallback.
    const monogram = screen.getByText(initialsFor("Stable Yield"));
    expect(monogram.className).toContain("text-risk-2");
  });
});
