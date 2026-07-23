/**
 * @id PP-CORE-CMP-023
 * @name RewardsPill.test
 * Behavior: renders the Quacks balance as a link to the Rubber Rush rewards area, and (POO-712 R5)
 * reveals a tooltip mirroring v1's "earn 1 Quack per $1 deposited" explanation on keyboard focus.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { RewardsPill } from "./RewardsPill";

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

describe("RewardsPill", () => {
  it("links to the Rubber Rush rewards area and shows the balance", () => {
    renderWithProviders(<RewardsPill quacks={1234} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining("/rewards/rubber-rush"));
    expect(link).toHaveTextContent("1,234");
  });

  // POO-712 R5: hovering/focusing the Quacks pill reveals the Rubber Rush explanation (mirror v1).
  it("reveals the Rubber Rush explanation tooltip on focus", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RewardsPill quacks={1234} />);
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "You earn 1 Quack per day for every $1 deposited on Pool Party.",
    );
  });

  // POO-762 R2: "1 Quack" is emphasized gold and the deposited "$1" green via t.rich markup tags.
  it("emphasizes '1 Quack' (gold) and '$1 deposited' (green) in the tooltip", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RewardsPill quacks={1234} />);
    await user.tab();
    const tip = await screen.findByRole("tooltip");
    expect(tip.querySelector(".text-primary")?.textContent).toContain("1 Quack");
    expect(tip.querySelector(".text-success")?.textContent).toContain("$1 deposited");
  });
});
