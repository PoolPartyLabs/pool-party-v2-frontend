import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog } from "../mandateCatalog";
import { createEmptyDraft, validateStep } from "../mandateDraft";
import { MandateCatalogStatus } from "./MandateCatalogStatus";

describe("Mandate loading contract", () => {
  it("exposes loading by accessible status name, not text, while Networks validation blocks", () => {
    const draft = {
      ...createEmptyDraft("2026-10-04", "loading-regression"),
      dataMode: "real" as const,
      catalogVersion: "v2-catalog-v1" as const,
    };
    const catalog = { ...buildMandateCatalog(), dataMode: "real" as const, loading: true };
    renderWithProviders(<MandateCatalogStatus catalog={catalog} draft={draft} />);
    expect(screen.getByRole("status", { name: "Loading v2 catalog" })).toBeInTheDocument();
    expect(screen.queryByText("Loading v2 catalog", { exact: true })).not.toBeInTheDocument();
    expect(validateStep(draft, "networks", catalog)).toMatchObject({ reason: "coming_soon" });
  });
});
