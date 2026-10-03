/**
 * @id PP-MGR-CMP-042
 * @name NetworkDots.test
 * @implements-rules-version v2 (POO-2142 rules v2)
 * @analytics-events none, decoration with a name attached
 *
 * POO-2123 [R10], epic POO-2119. A network logo must say which network it is, in every size and on
 * every screen: tooltip on hover and focus, plus `title` and an accessible name for touch and screen
 * readers. A row of coloured circles that only a Uniswap native can decode is the failure this rule
 * exists to prevent, so each of the three carriers is asserted separately.
 */
import { describe, expect, it } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog } from "../mandateCatalog";
import { NetworkDots, NetworkLogoWithName } from "./NetworkDots";

const catalog = buildMandateCatalog();

describe("NetworkDots", () => {
  // @rule R10
  it("names every network it draws, as an accessible name and as a title", () => {
    renderWithProviders(<NetworkDots networks={["arbitrum", "robinhood"]} catalog={catalog} />);

    const arbitrum = screen.getByRole("img", { name: "Arbitrum" });
    expect(arbitrum).toHaveAttribute("title", "Arbitrum");
    const robinhood = screen.getByRole("img", { name: "Robinhood Chain" });
    expect(robinhood).toHaveAttribute("title", "Robinhood Chain");
  });

  // @rule R10
  it("reveals the network name in a tooltip on hover", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NetworkDots networks={["robinhood"]} catalog={catalog} />);

    await user.hover(screen.getByRole("img", { name: "Robinhood Chain" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Robinhood Chain");
  });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // it("draws a brand-coloured monogram for a network with no committed mark", () => {
  //   renderWithProviders(<NetworkDots networks={["unichain"]} catalog={catalog} />);
  //
  //   const unichain = screen.getByRole("img", { name: "Unichain" });
  //   // No asset under public/networks, so the monogram path: the catalog's brand colour and a "U".
  //   expect(unichain).toHaveTextContent("U");
  //   expect(unichain.querySelector("img")).toBeNull();
  //   const monogram = unichain.querySelector("span[style]");
  //   // The colour comes from the catalog, not from a second map inside this component (#F50DB4).
  //   expect(monogram).toHaveStyle({ backgroundColor: "rgb(245, 13, 180)" });
  // });

  it("renders nothing for an empty network list", () => {
    const { container } = renderWithProviders(<NetworkDots networks={[]} catalog={catalog} />);

    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0);
  });

  it("draws at most `max` logos", () => {
    renderWithProviders(
      <NetworkDots networks={["arbitrum", "robinhood"]} catalog={catalog} max={1} />,
    );

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "Robinhood Chain" })).not.toBeInTheDocument();
  });
});

describe("NetworkLogoWithName", () => {
  // @rule R10
  it("carries the name as title, accessible name and tooltip", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NetworkLogoWithName network="robinhood" catalog={catalog} size={24} />);

    const robinhood = screen.getByRole("img", { name: "Robinhood Chain" });
    expect(robinhood).toHaveAttribute("title", "Robinhood Chain");

    await user.hover(robinhood);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Robinhood Chain");
  });
});
