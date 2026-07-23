/**
 * @id PP-CORE-CMP-048 (POO-453)
 * @name StillLoadingNote tests
 * @implements-rules-version v2
 *
 * [R6] Renders the shared "still loading" note as a polite live region so a background retry reads
 * as reassurance, not an error. [R7] The compact `inline` variant + `updating` key drive the
 * populated-view background-refresh affordance without changing the polite-live-region contract.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => `common.${key}` }));

import { StillLoadingNote } from "./StillLoadingNote";

describe("StillLoadingNote", () => {
  it("[R6] renders the default note in a polite status region", () => {
    render(<StillLoadingNote />);
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("common.stillLoading");
    expect(note).toHaveAttribute("aria-live", "polite");
  });

  it("[R7] renders the compact 'updating' inline variant, still a polite status region", () => {
    render(<StillLoadingNote variant="inline" messageKey="updating" />);
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("common.updating");
    expect(note).toHaveAttribute("aria-live", "polite");
    // Inline variant is a compact line, never centered/block.
    expect(note.className).not.toContain("text-center");
  });
});
