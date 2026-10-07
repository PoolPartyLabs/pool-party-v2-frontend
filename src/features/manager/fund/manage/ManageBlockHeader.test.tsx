/** @id PP-MGR-CMP-091 @implements-rules-version v2 */
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import deManager from "@/i18n/messages/de/manager.json";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  render,
  renderWithProviders,
  screen,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { ManageBlockHeader } from "./ManageBlockHeader";
import { type ManagePosition, normalizeManageModel } from "./manageModel";

const positions = normalizeManageModel(mockFund).positions;
const liquidity = positions.find((position) => position.kind === "liquidity");
const supply = positions.find((position) => position.kind === "supply");
if (!liquidity || !supply) throw new Error("Manage position fixtures missing");

describe("ManageBlockHeader", () => {
  // @rule POO-2272 R5: protocol, full subtype and origin network belong to one inline header.
  it.each([
    { name: "liquidity", position: liquidity, subtitle: "Liquidity position" },
    { name: "supply", position: supply, subtitle: "Supply position" },
  ])("keeps the selected origin and subtype together for $name", ({ position, subtitle }) => {
    const { container } = renderWithProviders(<ManageBlockHeader position={position} />);
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    const content = within(header as HTMLElement);
    expect(content.getByText(position.protocol)).toBeVisible();
    expect(content.getByText(subtitle)).toBeVisible();
    expect(
      content.getByText(position.network === "arbitrum" ? "Arbitrum" : "Robinhood"),
    ).toBeVisible();
    expect(content.queryByRole("button")).not.toBeInTheDocument();
  });

  // @rule POO-2272 R5: Collect may show the selected pair while keeping the same origin.
  it("uses the operation's complete pair context without replacing its origin", () => {
    const { container } = renderWithProviders(
      <ManageBlockHeader position={liquidity} subtitle="USDG / WETH" />,
    );
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    const content = within(header as HTMLElement);
    expect(content.getByText("USDG / WETH")).toBeVisible();
    expect(content.queryByText("Liquidity position")).not.toBeInTheDocument();
    expect(content.getByText(liquidity.protocol)).toBeVisible();
    expect(content.getByText("Robinhood")).toBeVisible();
  });

  // @rule POO-2272 R5/R8: identity updates atomically, with complete long text in longer locales.
  it("replaces the previous origin without retaining its protocol or network", () => {
    const first: ManagePosition = {
      ...liquidity,
      protocol: "A long protocol identity for this selected liquidity position",
      network: "robinhood",
    };
    const localizedHeader = (position: ManagePosition) => (
      <NextIntlClientProvider locale="de" messages={{ manager: deManager }}>
        <ManageBlockHeader position={position} />
      </NextIntlClientProvider>
    );
    const view = render(localizedHeader(first));
    expect(screen.getByText(first.protocol)).toHaveTextContent(first.protocol);
    expect(screen.getByText(deManager.manageV2.liquidityType)).toBeVisible();
    expect(screen.getByText("Robinhood")).toBeVisible();
    view.rerender(localizedHeader({ ...supply, network: "arbitrum" }));
    expect(screen.queryByText(first.protocol)).not.toBeInTheDocument();
    expect(screen.queryByText("Robinhood")).not.toBeInTheDocument();
    expect(screen.getByText(supply.protocol)).toBeVisible();
    expect(screen.getByText(deManager.manageV2.supplyType)).toBeVisible();
    expect(screen.getByText("Arbitrum")).toBeVisible();
  });
});
