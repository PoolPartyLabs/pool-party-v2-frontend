/**
 * @id PP-MGR-CMP-047
 * @name BuildPanelSlot tests
 * @implements-rules-version v1 (POO-2287 and POO-2152 rules v1)
 * @analytics-events none, a presentational frame; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The right-hand column of the Build step (handoff v1.2 [AN9], panel heads-up HU1): a frame with the
 * "Configure block" overline whose body is whatever the slot is handed. This batch hands it the
 * panel stub (S5); the configuration batch replaces the body without touching the frame.
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../../../../tests/utils/renderWithProviders";
import { BuildPanelSlot } from "./BuildPanelSlot";

describe("BuildPanelSlot", () => {
  // @rule AN9
  it("[AN9] is a region named by its overline, Configure block", () => {
    renderWithProviders(<BuildPanelSlot />);

    expect(screen.getByRole("region", { name: "Configure block" })).toBeInTheDocument();
  });

  // @rule AN9
  it("[AN9] keeps natural case in the copy and draws the capitals with CSS", () => {
    renderWithProviders(<BuildPanelSlot />);

    const overline = screen.getByText("Configure block");
    expect(overline.className).toContain("uppercase");
    expect(overline.className).toContain("text-muted-foreground");
    expect(overline.className).toContain("text-xs");
  });

  // @rule AN9
  it("[AN9] is 360 wide, radius 20, on the surface token, 1 px border, padding 16, gap 16", () => {
    renderWithProviders(<BuildPanelSlot />);

    const region = screen.getByRole("region", { name: "Configure block" });
    for (const token of [
      "w-[360px]",
      "min-w-0",
      "max-w-full",
      "rounded-xl",
      "bg-surface",
      "border",
      "border-border",
      "p-4",
      "gap-4",
      "flex-col",
    ]) {
      expect(region.className).toContain(token);
    }
  });

  // @rule HU1
  it("[HU1] empty: only the overline", () => {
    renderWithProviders(<BuildPanelSlot />);

    const region = screen.getByRole("region", { name: "Configure block" });
    expect(region.children).toHaveLength(1);
  });

  // @rule HU1
  it("[HU1] with content: the body comes from the children, under the overline", () => {
    renderWithProviders(
      <BuildPanelSlot>
        <p>Nothing selected</p>
      </BuildPanelSlot>,
    );

    const region = screen.getByRole("region", { name: "Configure block" });
    const body = screen.getByText("Nothing selected");
    expect(region).toContainElement(body);
    expect(
      screen.getByText("Configure block").compareDocumentPosition(body) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
