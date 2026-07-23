/**
 * @id PP-PORT (POO-159)
 * @name PositionLink.test
 * @implements-rules-version v1
 * Unit tests for PositionLink: links to the strategy detail and emits position_detail_viewed on click.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { PositionLink } from "./PositionLink";

// next-intl's client navigation can't resolve under vitest; mock Link to a plain anchor (the
// project-wide convention) so onClick/href pass through.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("PositionLink", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it("links to the position's strategy detail", () => {
    renderWithProviders(
      <PositionLink positionId="pos_1" strategyId="str_7">
        Open position
      </PositionLink>,
    );
    const href = screen.getByRole("link", { name: "Open position" }).getAttribute("href");
    expect(href).toContain("/strategies/str_7");
  });

  it("emits position_detail_viewed with ids on click", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PositionLink positionId="pos_1" strategyId="str_7">
        Open position
      </PositionLink>,
    );
    await user.click(screen.getByRole("link", { name: "Open position" }));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "position_detail_viewed",
        position_id: "pos_1",
        strategy_id: "str_7",
      }),
    );
  });
});
