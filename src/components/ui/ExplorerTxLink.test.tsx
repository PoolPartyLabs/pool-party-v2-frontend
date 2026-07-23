/**
 * @id PP-CORE-CMP-050
 * @name ExplorerTxLink — tests
 * @implements-rules-version v1
 *
 * Behavior (POO-514 R2): the shared "View on explorer" affordance builds the /tx/{hash} URL for the
 * TX NETWORK via getExplorerTxUrl and renders nothing when the URL cannot be assembled (missing
 * network / hash, unsupported network) — never an explorer home page or a fabricated link.
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { ExplorerTxLink } from "./ExplorerTxLink";

const HASH = "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd";

describe("ExplorerTxLink", () => {
  // @rule R2 (POO-514)
  it("(R2) links the explorer /tx/ URL of the tx network", () => {
    renderWithProviders(<ExplorerTxLink network="base" hash={HASH} />);
    const link = screen.getByRole("link", { name: "View on explorer" });
    expect(link).toHaveAttribute("href", `https://basescan.org/tx/${HASH}`);
  });

  // @rule R2 (POO-514) — the network picks the explorer (never a hard-coded basescan).
  it("(R2) follows the network: arbitrum links Arbiscan, polygon links Polygonscan", () => {
    const { unmount } = renderWithProviders(<ExplorerTxLink network="arbitrum" hash={HASH} />);
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      `https://arbiscan.io/tx/${HASH}`,
    );
    unmount();
    renderWithProviders(<ExplorerTxLink network="polygon" hash={HASH} />);
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      `https://polygonscan.com/tx/${HASH}`,
    );
  });

  it("renders nothing without a network, without a hash, or on an unsupported network", () => {
    renderWithProviders(
      <>
        <ExplorerTxLink network={undefined} hash={HASH} />
        <ExplorerTxLink network="base" hash={null} />
        <ExplorerTxLink network="solana" hash={HASH} />
      </>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens in a new tab without leaking the opener", () => {
    renderWithProviders(<ExplorerTxLink network="base" hash={HASH} />);
    const link = screen.getByRole("link", { name: "View on explorer" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });
});
