/**
 * @id PP-STR-CMP-020
 * @name WithdrawFlowCards.test
 *
 * POO-803: the shared withdraw-family Review/Receipt cards — R5 (old rows gone), R6 (per-token
 * breakdowns with logos on the pair payout), R7 (collapsible structure + captions + arrival),
 * R9/R11 (receipt labels + structure). Fee figures are real-only: absent = hidden line.
 */
import { describe, expect, it } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { WithdrawReceiptCard, WithdrawReviewCard } from "./WithdrawFlowCards";

const review = {
  amountUsd: 500,
  feesAvailableUsd: 12.4,
  receivingPair: false,
  slippagePct: 2,
  slippageIsDefault: true,
  networkFeeUsd: 0.31,
  protocolFeeUsd: 0.49,
  priceImpactPct: 0.4,
  receiveAs: "USDC",
  arrival: "≈ 489.2 USDC · Arrives instantly",
};

describe("WithdrawReviewCard", () => {
  // @rule R7 — summary + caption + arrival always visible; the fee detail behind Show more.
  it("shows the summary, caption and arrival; folds the fee detail behind Show more", () => {
    renderWithProviders(<WithdrawReviewCard {...review} />);
    expect(screen.getByText("Amount requested")).toBeVisible();
    expect(screen.getByText("$500.00")).toBeVisible();
    expect(screen.getByText("Fees available to collect")).toBeVisible();
    expect(screen.getByText("Receive as")).toBeVisible();
    expect(screen.getByText("after fees & max. 2% slippage")).toBeVisible();
    expect(screen.getByText("≈ 489.2 USDC · Arrives instantly")).toBeVisible();
    expect(screen.getByText("Est. fee")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Est. fee")).toBeVisible();
    expect(screen.getByText("Max. slippage")).toBeVisible();
    // Auto badge on the untouched default (decision #7) + amber-eligible price impact row.
    expect(screen.getByText("Auto")).toBeVisible();
    expect(screen.getByText("Price impact")).toBeVisible();
  });

  // @rule R5 — the retired rows are gone from the shared card.
  it("renders none of the retired rows", () => {
    renderWithProviders(<WithdrawReviewCard {...review} />);
    expect(screen.queryByText("You receive at least")).not.toBeInTheDocument();
    expect(screen.queryByText("Remaining invested")).not.toBeInTheDocument();
    expect(screen.queryByText("Total received (min)")).not.toBeInTheDocument();
  });

  // @rule R6 — the pair payout breaks BOTH figures into per-token rows with logos.
  it("breaks Amount requested and Fees available into per-token rows on the pair payout", () => {
    renderWithProviders(
      <WithdrawReviewCard
        {...review}
        receivingPair
        arrival={undefined}
        amountTokens={[
          { symbol: "ETH", amount: 0.12 },
          { symbol: "USDC", amount: 250.5 },
        ]}
        feesTokens={[
          { symbol: "ETH", amount: 0.001 },
          { symbol: "USDC", amount: 6.2 },
        ]}
      />,
    );
    const amountRows = screen.getByTestId("withdraw-amount-tokens");
    expect(amountRows).toHaveTextContent("0.12 ETH");
    expect(amountRows).toHaveTextContent("250.5 USDC");
    expect(amountRows.querySelectorAll("img")).toHaveLength(2);
    const feeRows = screen.getByTestId("withdraw-fees-tokens");
    expect(feeRows).toHaveTextContent("0.001 ETH");
    expect(feeRows).toHaveTextContent("6.2 USDC");
    // POO-923 R3: the pair payout performs no swap, so the "after fees" caption is dropped
    // entirely; with no fabricated USDC arrival either, the pair-mode footer is empty.
    expect(screen.queryByText(/after fees/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Arrives instantly/)).not.toBeInTheDocument();
  });

  // @rule R1 (POO-923) — the USDC payout collapses to the single USD figure; the per-token split is
  // OMITTED even when it resolves (supersedes POO-846 R1's "show regardless of receive-as"). The
  // USDC-mode caption (with the slippage qualifier) is unchanged.
  it("[POO-923 R1] collapses both figures to the USD amount on the USDC payout", () => {
    renderWithProviders(
      <WithdrawReviewCard
        {...review}
        amountTokens={[
          { symbol: "ETH", amount: 0.12, usd: 250 },
          { symbol: "USDC", amount: 250.5, usd: 250 },
        ]}
        feesTokens={[
          { symbol: "ETH", amount: 0.001, usd: 6.2 },
          { symbol: "USDC", amount: 6.2, usd: 6.2 },
        ]}
      />,
    );
    // USDC mode (receivingPair=false): no per-token rows, the USD figures render instead.
    expect(screen.queryByTestId("withdraw-amount-tokens")).not.toBeInTheDocument();
    expect(screen.queryByTestId("withdraw-fees-tokens")).not.toBeInTheDocument();
    expect(screen.getByText("$500.00")).toBeVisible();
    expect(screen.getByText("$12.40")).toBeVisible();
    expect(screen.getByText("after fees & max. 2% slippage")).toBeVisible();
    // The USDC payout keeps a footer (caption + arrival), so the bordered block renders.
    expect(screen.getByTestId("receipt-footer")).toBeInTheDocument();
  });

  // @rule R3 (POO-923) — with the caption dropped AND no arrival on the standard pair path, the
  // pair-mode footer renders NOTHING: not even the bordered wrapper (undefined, not an empty node).
  it("[POO-923 R3] renders no footer block on the pair payout without an arrival line", () => {
    renderWithProviders(<WithdrawReviewCard {...review} receivingPair arrival={undefined} />);
    expect(screen.queryByText(/after fees/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Arrives instantly/)).not.toBeInTheDocument();
    // Locks the "no stray bordered block" invariant: undefined footer → wrapper absent entirely.
    expect(screen.queryByTestId("receipt-footer")).not.toBeInTheDocument();
  });

  // @rule POO-799 #1 — absent fee figures hide the Est. fee row entirely (no fabricated $0).
  it("hides the Est. fee row when no real figure exists", () => {
    renderWithProviders(
      <WithdrawReviewCard
        {...review}
        networkFeeUsd={undefined}
        protocolFeeUsd={undefined}
        priceImpactPct={undefined}
        slippageIsDefault={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.queryByText("Est. fee")).not.toBeInTheDocument();
    expect(screen.queryByText("Price impact")).not.toBeInTheDocument();
    // The custom slippage renders plain (no Auto badge).
    expect(screen.getByText("2%")).toBeVisible();
    expect(screen.queryByText("Auto")).not.toBeInTheDocument();
  });
});

describe("WithdrawReceiptCard", () => {
  const receipt = {
    strategyName: "Stable Yield",
    amountReceivedUsd: 489.2,
    feesCollectedUsd: 12.4,
    totalReceivedUsd: 501.6,
    slippagePct: 2,
    networkFeeUsd: 0.31,
    protocolFeeUsd: 0.49,
    priceImpactPct: 0.4,
    date: "Jul 11, 2026 · 02:10",
    txHashShort: "0xdead…abcd",
  };

  // @rule R9/R11 — receipt labels + structure: Fee/Slippage fold; Date/Transaction never collapse.
  it("shows Amount Received / Fees collected / Total received and folds Fee + Slippage", () => {
    renderWithProviders(<WithdrawReceiptCard {...receipt} />);
    expect(screen.getByText("Strategy")).toBeVisible();
    expect(screen.getByText("Amount Received")).toBeVisible();
    expect(screen.getByText("Fees collected")).toBeVisible();
    expect(screen.getByText("Total received")).toBeVisible();
    expect(screen.getByText("Date")).toBeVisible();
    expect(screen.getByText("Transaction")).toBeVisible();
    expect(screen.getByText("0xdead…abcd")).toBeVisible();
    expect(screen.getByText("Fee")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Fee")).toBeVisible();
    expect(screen.getByText("Slippage")).toBeVisible();
  });

  it("omits the Transaction row without a hash (never a fabricated tx)", () => {
    renderWithProviders(<WithdrawReceiptCard {...receipt} txHashShort={null} />);
    expect(screen.queryByText("Transaction")).not.toBeInTheDocument();
  });

  // @rule POO-841 R2 — when a name is missing the caller falls back to the position id; the belt
  // renders it TRUNCATED, never the raw 66-char id that overflowed the Strategy row (screenshot bug).
  it("[POO-841 R2] truncates a raw position id in the Strategy row", () => {
    const rawId = "0x357d9d041f953ae4885998c475744c500eba8d1a4cb26ccc3627c2ce553fd64c";
    renderWithProviders(<WithdrawReceiptCard {...receipt} strategyName={rawId} />);
    expect(screen.getByText("0x357d…d64c")).toBeVisible();
    expect(screen.queryByText(rawId)).toBeNull();
  });
});
