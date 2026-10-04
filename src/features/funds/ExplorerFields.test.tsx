import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { ExplorerFields } from "./ExplorerFields";

const hash = `0x${"a".repeat(64)}`;
const address = `0x${"b".repeat(40)}`;
describe("fund explorer fields", () => {
  // @rule R4 @rule R5
  it("uses explicit nested chains and never mistakes position keys or fund ids for transaction hashes", () => {
    renderWithProviders(
      <ExplorerFields
        chainId={42161}
        value={{
          fundId: hash,
          positionKey: hash,
          transactionHash: hash,
          spokes: [{ chainId: "4663", adapter: address, transactionHash: hash }],
        }}
      />,
    );
    expect(
      screen.getAllByRole("link", { name: hash }).map((link) => link.getAttribute("href")),
    ).toEqual([
      `https://arbiscan.io/tx/${hash}`,
      `https://robinhoodchain.blockscout.com/tx/${hash}`,
    ]);
    expect(screen.getByRole("link", { name: address })).toHaveAttribute(
      "href",
      `https://robinhoodchain.blockscout.com/address/${address}`,
    );
  });
  // @rule R4
  it.each([
    ["42161", "4663"],
    ["4663", "42161"],
  ])("links every transit leg on source %s and destination %s", (source, destination) => {
    const value = {
      sourceChainId: source,
      destinationChainId: destination,
      transitId: hash,
      legs: {
        sent: { transactionHash: hash },
        deposited: { transactionHash: hash },
        filled: { transactionHash: hash },
        credited: { transactionHash: hash },
        acknowledgementPublished: { transactionHash: hash },
        acknowledged: { transactionHash: hash },
      },
    };
    renderWithProviders(<ExplorerFields value={value} chainId={42161} />);
    const bases: Record<string, string> = {
      "42161": "https://arbiscan.io",
      "4663": "https://robinhoodchain.blockscout.com",
    };
    expect(
      screen.getAllByRole("link", { name: hash }).map((link) => link.getAttribute("href")),
    ).toEqual(
      [source, source, destination, destination, "42161", "42161"].map(
        (chain) => `${bases[chain]}/tx/${hash}`,
      ),
    );
  });
  // @rule R2 @rule R4
  it("leaves absent, invalid and explicitly unknown chains unlinked", () => {
    renderWithProviders(
      <ExplorerFields
        value={{
          transactionHash: hash,
          manager: address,
          items: [{ chainId: "1", transactionHash: hash }],
        }}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  // @rule R4
  it("uses report publication and delivery chain contexts without linking job identifiers", () => {
    renderWithProviders(
      <ExplorerFields
        chainByField={{ publishTxHash: 4663, deliveryTxHash: 42161 }}
        value={{ jobId: hash, publishTxHash: hash, deliveryTxHash: hash }}
      />,
    );
    expect(
      screen.getAllByRole("link", { name: hash }).map((link) => link.getAttribute("href")),
    ).toEqual([
      `https://robinhoodchain.blockscout.com/tx/${hash}`,
      `https://arbiscan.io/tx/${hash}`,
    ]);
  });
});
