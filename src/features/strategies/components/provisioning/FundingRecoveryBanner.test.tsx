/**
 * @id PP-STR-CMP-025 (POO-1055)
 * @name FundingRecoveryBanner — tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The end-to-end version of the recovery story: a real journal in `localStorage`, the real §3.5
 * reconciler over a stubbed chain, and the banner a returning user actually sees. Nothing between
 * the record and the pixels is mocked, because the gap POO-1055 closes is precisely that the record
 * was correct and nobody ever rendered it.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";
import {
  createJournal,
  type FundingLeg,
  type FundingOperationKind,
  getJournal,
  updateLeg,
} from "../../lib/fundingJournal";
import { JOURNAL_POLL_CEILING_MS } from "../../lib/reconcileFundingJournal";
import { FundingRecoveryBanner } from "./FundingRecoveryBanner";

const WALLET = "0xc3673adc0000000000000000000000000000beef";
const POLYGON = 137;
const ARBITRUM = 42161;
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const SWAP_HASH = `0x${"11".repeat(32)}`;
const BRIDGE_HASH = `0x${"22".repeat(32)}`;

const mocks = vi.hoisted(() => ({
  address: undefined as string | undefined,
  receipts: {} as Record<string, { status: "success" | "reverted" } | null>,
  nonces: {} as Record<number, number>,
  balances: {} as Record<string, bigint>,
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.address }) }));

// The repository's standing convention for the locale-aware Link (next-intl's navigation factory
// reaches for `next/navigation` at import time).
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

// PP-INTEGRATION-POINT: the per-chain RPC reads behind the §3.5 `ChainReader`.
vi.mock("@/lib/tokens/readErc20", () => ({
  readTransactionReceiptStatus: async (hash: string) => mocks.receipts[hash] ?? null,
  readTransactionCount: async (_owner: string, chainId: number) => mocks.nonces[chainId] ?? 7,
  readErc20Balance: async (token: string, _owner: string, chainId: number) =>
    mocks.balances[`${chainId}:${token}`] ?? BigInt(0),
  readNativeBalance: async () => BigInt(0),
}));

const ROUTE = [
  {
    index: 0,
    kind: "swap-token" as const,
    chainId: POLYGON,
    tokenIn: WETH_POLYGON,
    tokenOut: USDC_POLYGON,
    amountIn: "1000000000000000000",
    minAmountOut: "2940000000",
  },
  {
    index: 1,
    kind: "bridge" as const,
    chainId: POLYGON,
    tokenIn: USDC_POLYGON,
    tokenOut: USDC_ARBITRUM,
    destChainId: ARBITRUM,
    amountIn: "3000000000",
    minAmountOut: "2996000000",
  },
];

function persistJournal(
  patches: Partial<FundingLeg>[],
  operation: { kind: FundingOperationKind; strategyId?: string } = {
    kind: "invest",
    strategyId: "strat-1",
  },
): string {
  const journal = createJournal({
    wallet: WALLET,
    operation: { targetChainId: ARBITRUM, ...operation },
    legs: ROUTE.slice(0, patches.length),
  });
  patches.forEach((patch, index) => {
    updateLeg(journal.journalId, index, patch);
  });
  return journal.journalId;
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.address = "0xC3673ADc0000000000000000000000000000BEEF";
  mocks.receipts = {};
  mocks.nonces = {};
  mocks.balances = {};
});

describe("[R1] a killed tab mid-bridge produces a visible, actionable surface", () => {
  it("names the operation, the leg and how far the route got", async () => {
    persistJournal([
      { status: "settled", txHash: SWAP_HASH, settledAt: Date.now() },
      {
        status: "broadcast",
        txHash: BRIDGE_HASH,
        broadcastAt: Date.now(),
        nonceBefore: 8,
        destBalanceBefore: "1000000",
      },
    ]);
    mocks.receipts[BRIDGE_HASH] = { status: "success" };

    renderWithProviders(<FundingRecoveryBanner />);

    expect(await screen.findByText("You have funding in progress")).toBeInTheDocument();
    expect(screen.getByText("Adding money to a strategy")).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText(/Move from Polygon/)).toBeInTheDocument();
    // R6: reassuring and true. The money is not lost, it is in transit.
    expect(
      screen.getByText("Your funds are on the way. This can take a few minutes."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Sent\. We are waiting for it to land, and we will not send it again\./),
    ).toBeInTheDocument();
    // The leg's own explorer link, on the leg's own chain.
    expect(screen.getByRole("link", { name: /explorer/i })).toHaveAttribute(
      "href",
      `https://polygonscan.com/tx/${BRIDGE_HASH}`,
    );
  });

  it("renders nothing at all when there is no route to recover", async () => {
    const { container } = renderWithProviders(<FundingRecoveryBanner />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("offers no way to drop the record while money is still in flight", async () => {
    persistJournal([
      {
        status: "broadcast",
        txHash: SWAP_HASH,
        broadcastAt: Date.now(),
        nonceBefore: 7,
      },
    ]);
    mocks.receipts[SWAP_HASH] = null;

    renderWithProviders(<FundingRecoveryBanner />);
    await screen.findByText("You have funding in progress");

    // Deleting the record of an in-flight transaction is how the next session double-sends it.
    expect(screen.queryByRole("button", { name: "Stop showing this" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });
});

describe("[R2] the surface offers re-derivation, never a re-send", () => {
  it("routes a resumable journal back to the operation so its plan is derived afresh", async () => {
    persistJournal([{ status: "planned", nonceBefore: 7 }]);
    mocks.nonces[POLYGON] = 7;

    renderWithProviders(<FundingRecoveryBanner />);

    expect(
      await screen.findByText("We can pick this up from where it stopped."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pick up where this left off" })).toHaveAttribute(
      "href",
      "/strategies/strat-1",
    );
  });

  // move-range and close only exist in the Manager Console, so resuming an investor detail page
  // would hand the manager a screen that cannot run the operation they were part-way through.
  it("resumes a manager-only operation on the manager's own screen", async () => {
    persistJournal([{ status: "planned", nonceBefore: 7 }], {
      kind: "move-range",
      strategyId: "strat-1",
    });
    mocks.nonces[POLYGON] = 7;

    renderWithProviders(<FundingRecoveryBanner />);

    expect(
      await screen.findByRole("link", { name: "Pick up where this left off" }),
    ).toHaveAttribute("href", "/manager/strategies/strat-1");
  });

  it("falls back to the portfolio when the route has no strategy to return to", async () => {
    persistJournal([{ status: "planned", nonceBefore: 7 }], { kind: "invest" });
    mocks.nonces[POLYGON] = 7;

    renderWithProviders(<FundingRecoveryBanner />);

    expect(
      await screen.findByRole("link", { name: "Pick up where this left off" }),
    ).toHaveAttribute("href", "/portfolio");
  });

  it("shows an ambiguous leg the account it came from, and asks rather than acting", async () => {
    persistJournal([
      {
        status: "broadcast",
        txHash: SWAP_HASH,
        broadcastAt: Date.now() - JOURNAL_POLL_CEILING_MS - 1_000,
        nonceBefore: 7,
      },
    ]);
    mocks.receipts[SWAP_HASH] = null;
    mocks.nonces[POLYGON] = 9;

    renderWithProviders(<FundingRecoveryBanner />);

    expect(
      await screen.findByText("We need you to check one thing before we continue."),
    ).toBeInTheDocument();
    // §3.9: the account, on the chain the leg was sent from, is the only thing that can resolve it.
    expect(screen.getByRole("link", { name: "See your wallet activity" })).toHaveAttribute(
      "href",
      `https://polygonscan.com/address/${WALLET}`,
    );
    // POO-1508 [R46]: with no hash there is nothing safe to re-send, so "Pick up where this left
    // off" is not offered AT ALL here, not merely de-emphasised beside the account link.
    expect(
      screen.queryByRole("link", { name: "Pick up where this left off" }),
    ).not.toBeInTheDocument();
  });
});

describe("[R5] the user can stop a resolved route from nagging", () => {
  it("deletes the record when the user abandons it", async () => {
    const journalId = persistJournal([{ status: "planned", nonceBefore: 7 }]);
    mocks.nonces[POLYGON] = 7;

    renderWithProviders(<FundingRecoveryBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop showing this" }));

    await waitFor(() => expect(screen.queryByText("You have funding in progress")).toBeNull());
    expect(getJournal(journalId)).toBeNull();
  });
});
