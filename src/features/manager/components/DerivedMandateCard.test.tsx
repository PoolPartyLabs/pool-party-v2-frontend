/**
 * @id PP-MGR-SCR-002
 * @name DerivedMandateCard.test
 * @implements-rules-version v1
 *
 * Behavior: always renders the read-only risk + category. POO-830 R5: when `tags` is passed (the
 * strategyCategoryFilter flag is on, BuildStep decides), it ALSO renders the read-only objective +
 * asset tag chips; without `tags` the card is exactly as before (flag-off parity).
 */
import { describe, expect, it } from "vitest";
import type { StrategyTags } from "@/lib/strategies/tags/deriveStrategyTags";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import type { DerivedMandate } from "../lib/deriveMandate";
import { DerivedMandateCard } from "./DerivedMandateCard";

const derived: DerivedMandate = { riskLevel: 3, categoryKey: "blueChip" };

describe("DerivedMandateCard", () => {
  it("renders the risk + category and NO tag rows when tags are omitted (flag-off parity)", () => {
    renderWithProviders(<DerivedMandateCard derived={derived} />);
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("Blue-chip LP")).toBeInTheDocument();
    // No objective / asset rows without the flag-gated tags prop.
    expect(screen.queryByText("Objective")).toBeNull();
    expect(screen.queryByText("Assets")).toBeNull();
  });

  // @rule R5 — a two-sided income tag set renders the objective + asset chips, read-only.
  it("renders the derived objective + asset tags when tags are passed", () => {
    const tags: StrategyTags = {
      objectiveTags: ["income"],
      assetTags: ["ethereum"],
      unverified: false,
    };
    renderWithProviders(<DerivedMandateCard derived={derived} tags={tags} />);
    expect(screen.getByText("Objective")).toBeInTheDocument();
    expect(screen.getByText("Income")).toBeInTheDocument();
    expect(screen.getByText("Assets")).toBeInTheDocument();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
  });

  // @rule R5 — a crypto->crypto rotation carries two objectives + two assets; each renders as a chip.
  it("renders every tag in a multi-tag (rotation) set", () => {
    const tags: StrategyTags = {
      objectiveTags: ["gradualBuy", "gradualSell"],
      assetTags: ["ethereum", "bitcoin"],
      unverified: false,
    };
    renderWithProviders(<DerivedMandateCard derived={derived} tags={tags} />);
    expect(screen.getByText("Gradual buy (DCA)")).toBeInTheDocument();
    expect(screen.getByText("Gradual sell")).toBeInTheDocument();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getByText("Bitcoin")).toBeInTheDocument();
  });
});
