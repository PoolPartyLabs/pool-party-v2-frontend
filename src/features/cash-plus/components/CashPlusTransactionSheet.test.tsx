/** @id PP-CP-MOD-001 @name Cash+ review and receipt tests @implements-rules-version v1 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CashPlusController, CashPlusTransaction } from "@/lib/cash-plus/types";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { CashPlusTransactionSheet } from "./CashPlusTransactionSheet";

const hash = `0x${"1".repeat(64)}` as const;
function controller(transaction: CashPlusTransaction): CashPlusController {
  return {
    snapshot: {
      mode: "fork",
      networkName: "Arbitrum local fork",
      explorerUrl: null,
    } as CashPlusController["snapshot"],
    status: "ready",
    wallet: { connected: true, correctChain: true, balanceAssets: BigInt("100000000") },
    transaction,
    review: vi.fn(),
    confirm: vi.fn(),
    resetTransaction: vi.fn(),
    refresh: vi.fn(),
    connect: vi.fn(),
    switchNetwork: vi.fn(),
  };
}
describe("CashPlusTransactionSheet", () => {
  // @rule CP-TX08, CP-TX10: submission is pending until a decoded receipt exists.
  it("keeps a submitted hash pending and offers no duplicate confirmation action", () => {
    renderWithProviders(
      <CashPlusTransactionSheet
        open
        controller={controller({ phase: "pending", kind: "deposit", hash })}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Transaction submitted" })).toBeInTheDocument();
    expect(screen.getByText(hash)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Transaction confirmed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm transaction" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View on explorer" })).toBeNull();
  });
  // @rule CP-TX10: only actual receipt amounts appear in success.
  it("renders the confirmed amount from the receipt rather than the reviewed estimate", () => {
    renderWithProviders(
      <CashPlusTransactionSheet
        open
        controller={controller({
          phase: "success",
          kind: "redeem",
          amountAssets: BigInt("12000000"),
          receipt: {
            hash,
            blockNumber: BigInt("50"),
            kind: "redeem",
            assets: BigInt("11999987"),
            shares: BigInt("1000000000000000000"),
            tokens: [],
          },
        })}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Transaction confirmed" })).toBeInTheDocument();
    expect(screen.getByText("11.999987", { exact: false })).toBeInTheDocument();
  });
  // @rule CP-TX12: proportional redemption is explicitly different and names each component.
  it("reviews receipt tokens and their exact quantities without calling them a cash payment", () => {
    renderWithProviders(
      <CashPlusTransactionSheet
        open
        controller={controller({
          phase: "review",
          kind: "proportional",
          outputs: [
            {
              address: `0x${"1".repeat(40)}`,
              symbol: "aUSDC",
              decimals: 6,
              amount: BigInt("1234567"),
            },
          ],
        })}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Review pool assets exit" })).toBeInTheDocument();
    expect(screen.getByText("aUSDC")).toBeInTheDocument();
    expect(screen.getByText("1.234567")).toBeInTheDocument();
    expect(screen.getByText(/not a single USDC payment/)).toBeInTheDocument();
  });
  // @rule CP-UI12: closing the dialog restores the action that opened it.
  it("focuses the step heading and restores the opening action on close", async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open review
          </button>
          <CashPlusTransactionSheet
            open={open}
            controller={controller({
              phase: "review",
              kind: "deposit",
              amountAssets: BigInt("1000000"),
            })}
            onOpenChange={setOpen}
          />
        </>
      );
    }
    renderWithProviders(<Host />);
    await user.click(screen.getByRole("button", { name: "Open review" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Review investment" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open review" })).toHaveFocus());
  });
});
