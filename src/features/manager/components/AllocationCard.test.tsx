/**
 * @id PP-MGR-CMP-029
 * @name AllocationCard.test
 * Behavior (POO-739): renders the protocol row with the Uniswap badge + share bar, and per-token rows
 * with a token logo + percentage (restructured from the old joined text line).
 */
import { describe, expect, it } from "vitest";
import type { ManagerAllocation } from "@/lib/schemas";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { AllocationCard } from "./AllocationCard";

const allocation: ManagerAllocation = {
  protocols: [{ label: "Uniswap v3", pct: 100 }],
  tokens: [
    { label: "ETH", pct: 62 },
    { label: "USDC", pct: 38 },
  ],
};

describe("AllocationCard", () => {
  // @rule R2: the Uniswap protocol badge + per-token rows carry a token logo (restructured from the
  // old joined text line).
  it("renders the Uniswap protocol badge and per-token rows with logos and percentages", () => {
    const { container } = renderWithProviders(
      <AllocationCard allocation={allocation} network="arbitrum" />,
    );
    // Protocol: the Uniswap badge (logo + label).
    expect(screen.getByText("Uniswap v3")).toBeInTheDocument();
    expect(container.querySelector('img[src="/protocols/uniswap.svg"]')).not.toBeNull();
    // Tokens: per-row logo + symbol + percent (no longer a single joined text line).
    expect(screen.getByText("ETH")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("38%")).toBeInTheDocument();
    expect(container.querySelector('img[src="/tokens/eth.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="/tokens/usdc.png"]')).not.toBeNull();
  });
});
