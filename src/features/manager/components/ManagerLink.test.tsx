/**
 * @id PP-MGR-CMP-012
 * @name ManagerLink.test
 * Behavior: links to /m/<handle> when a handle is set; renders plain text otherwise.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { ManagerLink } from "./ManagerLink";

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

describe("ManagerLink", () => {
  it("links to the manager profile when a handle is set", () => {
    renderWithProviders(<ManagerLink handle="delta-desk">Delta Desk</ManagerLink>);
    expect(screen.getByRole("link", { name: "Delta Desk" })).toHaveAttribute(
      "href",
      "/m/delta-desk",
    );
  });

  it("renders plain text when neither a handle nor an address is known", () => {
    renderWithProviders(<ManagerLink>Delta Desk</ManagerLink>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Delta Desk")).toBeInTheDocument();
  });

  // POO-620 R1: with no handle but a wallet address, the attribution links to /m/<address>.
  it("[POO-620] links to /m/<address> when only an address is known", () => {
    const address = "0x77d2e9a1b3c5d7f9a0b1c2d3e4f5a6b7c8d9e0f1";
    renderWithProviders(<ManagerLink address={address}>0x77d2…e0f1</ManagerLink>);
    expect(screen.getByRole("link", { name: "0x77d2…e0f1" })).toHaveAttribute(
      "href",
      `/m/${address}`,
    );
  });

  // POO-620 R1: the handle wins when both are present.
  it("[POO-620] prefers the handle over the address when both are set", () => {
    renderWithProviders(
      <ManagerLink handle="delta-desk" address="0x77d2e9a1b3c5d7f9a0b1c2d3e4f5a6b7c8d9e0f1">
        Delta Desk
      </ManagerLink>,
    );
    expect(screen.getByRole("link", { name: "Delta Desk" })).toHaveAttribute(
      "href",
      "/m/delta-desk",
    );
  });
});
