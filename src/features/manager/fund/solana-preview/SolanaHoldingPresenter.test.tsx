/**
 * @id PP-MGR-CMP-096
 * @name SolanaHoldingPresenter tests
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, controlled inline inspection tests
 */

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { SolanaHoldingPresenter, SolanaJupiterInspector } from "./SolanaHoldingPresenter";
import type { HoldingIntent, HoldingOrigin, JupiterQuote } from "./solanaHoldingModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

const origin: HoldingOrigin = {
  localId: "holding-a",
  cluster: "mainnet-beta",
  asset: {
    kind: "spl",
    network: "solana",
    cluster: "mainnet-beta",
    mint: WSOL_MINT,
    decimals: 9,
    symbol: "WSOL",
    unit: "base-units",
  },
  custody: {
    program: WSOL_MINT,
    authority: USDC_MINT,
    account: "11111111111111111111111111111111",
    positionId: USDC_MINT,
  },
};
const intent: HoldingIntent = {
  id: "buy-a",
  revision: "1",
  origin,
  side: "buy",
  input: {
    token: {
      kind: "spl",
      network: "solana",
      cluster: "mainnet-beta",
      mint: USDC_MINT,
      decimals: 6,
      symbol: "USDC",
      unit: "base-units",
    },
    raw: "1500000000",
  },
  outputToken: origin.asset,
  destination: { kind: "holding", account: origin.custody.account },
  wrapPlan: null,
};
const messages = {
  manager: {
    solanaPreview: {
      holding: {
        title: "Holding",
        tokenRisk: "Exposure to the token's price.",
        solana: "Solana",
        buy: "Buy",
        sell: "Sell",
        choose: "Choose an action",
        reviewBuy: "Review buy",
        reviewSell: "Review sell",
        backBuy: "Back to buy",
        backSell: "Back to sell",
        backActions: "Back to actions",
        confirmBuy: "Confirm buy",
        confirmSell: "Confirm sell",
        transactionUnavailable: "Transaction details are unavailable.",
        quantity: "Quantity",
        valueUsd: "Value (USD)",
        allocation: "Allocation",
        custody: "Custody",
        position: "Position",
        input: "Amount in",
        output: "Expected output",
        minimum: "Minimum received",
        destination: "Destination",
        idleOutput: "Idle output",
        principalBridge: "Principal Bridge",
        bypass: "Compatible token. No swap is required.",
        wrap: "Wrap SOL",
        unwrap: "Unwrap SOL",
        swap: "Automatic conversion",
        notAvailable: "Not available",
        stale: "Stale data",
        zero: "Confirmed zero",
        fixture: "Illustrative fixture",
        source: "Source",
        asOf: "As of",
        slot: "Slot",
        commitment: "Commitment",
        network: "Network",
        program: "Program",
        authority: "Authority",
        token: "Token",
        review: "Review",
        quote: "Quote validity",
        blockhash: "Blockhash validity",
        valid: "Valid",
        expired: "Expired",
        unknown: "Unknown",
        costs: "Costs",
        route: "Route",
        jupiter: "Jupiter Swap",
        managed: "Managed order and execute",
        composable: "Composable build",
        noQuote: "Quote details are unavailable.",
        includedInput: "Included in input",
        includedOutput: "Included in output",
        additional: "Additional",
        costUnknown: "Inclusion unknown",
        platform: "Platform",
        integrator: "Integrator",
        amm: "AMM",
        networkCost: "Network",
        rent: "Rent",
        priority: "Priority",
        tip: "Tip",
        quoteExpires: "Quote expires at",
        lastValidHeight: "Last valid block height",
        blockhashValue: "Blockhash",
        requestId: "Request ID",
        instructionPrograms: "Instruction programs",
      },
    },
  },
};
function Providers({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
const absent = { status: "unavailable" as const, source: null, reason: "not-integrated" };
// @rule R7: managed order execution and composable instructions keep separate inspection details.
it("distinguishes managed request IDs from composable instruction programs", () => {
  const source = {
    kind: "fixture" as const,
    fixtureId: "inspection-contract",
    sourceAsOf: "2026-10-07T00:00:00Z",
    slot: null,
  };
  const quote: JupiterQuote = {
    intentId: intent.id,
    intentRevision: intent.revision,
    origin,
    status: "available",
    source,
    quoteId: "inspection-a",
    input: intent.input,
    output: { token: origin.asset, raw: "10000000000" },
    minimumReceived: { token: origin.asset, raw: "9900000000" },
    route: ["Inspection route"],
    costs: [],
    inspection: {
      mode: "managed-order-execute",
      requestId: "managed-request-a",
      inputMint: USDC_MINT,
      outputMint: WSOL_MINT,
      rawInput: intent.input.raw,
      quoteValidity: absent,
      transactionValidity: absent,
      execution: { status: "unavailable", reason: "local-preview-only" },
    },
  };
  const clock = { now: null, blockHeight: null };
  const view = renderWithProviders(
    <Providers>
      <SolanaJupiterInspector intent={intent} quote={quote} clock={clock} />
    </Providers>,
  );
  expect(screen.getByText("Managed order and execute")).toBeVisible();
  expect(screen.getByText("managed-request-a")).toBeVisible();
  expect(screen.queryByText("Instruction programs")).toBeNull();
  const { requestId: _request, ...inspection } = quote.inspection as Extract<
    JupiterQuote["inspection"],
    { mode: "managed-order-execute" }
  >;
  const composable: JupiterQuote = {
    ...quote,
    inspection: {
      ...inspection,
      mode: "composable-build",
      instructionPrograms: [WSOL_MINT],
    },
  };
  view.rerender(
    <Providers>
      <SolanaJupiterInspector intent={intent} quote={composable} clock={clock} />
    </Providers>,
  );
  expect(screen.getByText("Composable build")).toBeVisible();
  expect(screen.getByText("Instruction programs")).toBeVisible();
  expect(screen.getByText(WSOL_MINT)).toBeVisible();
  expect(screen.queryByText("Request ID")).toBeNull();
  expect(screen.queryByText("managed-request-a")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
it("R6 choice offers Buy/Sell without LP, yield or amount controls", async () => {
  const mode = vi.fn();
  renderWithProviders(
    <Providers>
      <SolanaHoldingPresenter
        origin={origin}
        read={null}
        intent={null}
        quote={null}
        clock={{ now: null, blockHeight: null }}
        mode="choice"
        onMode={mode}
      />
    </Providers>,
  );
  expect(screen.getByRole("heading", { name: "Holding" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Buy" }));
  expect(mode).toHaveBeenCalledWith("buy");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText(/APY|Collect fees|Price range/)).toBeNull();
});
it("R3 quantity stays exact while USD missing, source remains visible", () => {
  renderWithProviders(
    <Providers>
      <SolanaHoldingPresenter
        origin={origin}
        read={{
          origin,
          snapshotId: "a",
          quantity: {
            status: "available",
            value: { token: origin.asset, raw: "9007199254740993" },
            source: {
              kind: "observed",
              source: "read-source",
              sourceAsOf: "2026-10-07T00:00:00Z",
              slot: "9007199254740993",
              commitment: "confirmed",
            },
          },
          valueUsd: absent,
          allocation: absent,
        }}
        intent={null}
        quote={null}
        clock={{ now: null, blockHeight: null }}
        mode="choice"
        onMode={vi.fn()}
      />
    </Providers>,
  );
  expect(screen.getByText("9007199.254740993 WSOL")).toBeVisible();
  expect(screen.getByText("read-source")).toBeVisible();
  expect(screen.getByText("9007199254740993")).toBeVisible();
});
it("R7 Buy review is inline, immutable and returns to the same mode", async () => {
  const mode = vi.fn();
  const view = renderWithProviders(
    <Providers>
      <SolanaHoldingPresenter
        origin={origin}
        read={null}
        intent={intent}
        quote={null}
        clock={{ now: null, blockHeight: null }}
        mode="buy"
        onMode={mode}
      />
    </Providers>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Review buy" }));
  expect(mode).toHaveBeenCalledWith("review-buy");
  view.rerender(
    <Providers>
      <SolanaHoldingPresenter
        origin={origin}
        read={null}
        intent={intent}
        quote={null}
        clock={{ now: null, blockHeight: null }}
        mode="review-buy"
        onMode={mode}
      />
    </Providers>,
  );
  expect(screen.getByRole("button", { name: "Confirm buy" })).toBeDisabled();
  expect(screen.getByText("Transaction details are unavailable.")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("1500 USDC")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Back to buy" }));
  expect(mode).toHaveBeenLastCalledWith("buy");
});
it("R6/R8 Sell review uses its own intent and returns to Sell with gray principal destination", async () => {
  const mode = vi.fn();
  const sell = {
    ...intent,
    side: "sell" as const,
    input: { token: origin.asset, raw: "1" },
    outputToken: intent.input.token,
    destination: {
      kind: "idle-output" as const,
      idleId: "idle-a",
      account: USDC_MINT,
      principalBridgeId: "bridge-a",
    },
  };
  renderWithProviders(
    <Providers>
      <SolanaHoldingPresenter
        origin={origin}
        read={null}
        intent={sell}
        quote={null}
        clock={{ now: null, blockHeight: null }}
        mode="review-sell"
        onMode={mode}
      />
    </Providers>,
  );
  expect(screen.getByRole("button", { name: "Confirm sell" })).toBeDisabled();
  expect(screen.getByText("Idle output")).toBeVisible();
  expect(document.querySelector("[data-holding-principal]")).toHaveAttribute(
    "data-tone",
    "principal",
  );
  await userEvent.click(screen.getByRole("button", { name: "Back to sell" }));
  expect(mode).toHaveBeenCalledWith("sell");
});
it("R2/R8 wrong-origin intent never leaks amount or enables review", () => {
  renderWithProviders(
    <Providers>
      <SolanaHoldingPresenter
        origin={origin}
        read={null}
        intent={{ ...intent, origin: { ...origin, localId: "other" } }}
        quote={null}
        clock={{ now: null, blockHeight: null }}
        mode="buy"
        onMode={vi.fn()}
      />
    </Providers>,
  );
  expect(screen.queryByText("1500 USDC")).toBeNull();
  expect(screen.getByRole("button", { name: "Review buy" })).toBeDisabled();
});
it("R6 compatible input exposes bypass and separate Jupiter has no fake quote", () => {
  renderWithProviders(
    <Providers>
      <SolanaHoldingPresenter
        origin={origin}
        read={null}
        intent={{ ...intent, input: { token: origin.asset, raw: "1" } }}
        quote={null}
        clock={{ now: null, blockHeight: null }}
        mode="buy"
        onMode={vi.fn()}
      />
    </Providers>,
  );
  expect(screen.getByText("Compatible token. No swap is required.")).toBeVisible();
  const view = renderWithProviders(
    <Providers>
      <SolanaJupiterInspector intent={null} quote={null} clock={{ now: null, blockHeight: null }} />
    </Providers>,
  );
  expect(view.getByText("Quote details are unavailable.")).toBeVisible();
  expect(screen.queryByRole("link", { name: /View pool|View position/ })).toBeNull();
});

// @rule R7/R8: mode transitions keep focus in the inline pane and preserve host-owned intent.
it("focuses the pane heading when the controlled mode changes by keyboard", async () => {
  const mode = vi.fn();
  const props = {
    origin,
    read: null,
    intent,
    quote: null,
    clock: { now: null, blockHeight: null },
    onMode: mode,
  };
  const view = renderWithProviders(
    <Providers>
      <SolanaHoldingPresenter {...props} mode="buy" />
    </Providers>,
  );
  screen.getByRole("button", { name: "Review buy" }).focus();
  await userEvent.keyboard("{Enter}");
  expect(mode).toHaveBeenCalledWith("review-buy");
  view.rerender(
    <Providers>
      <SolanaHoldingPresenter {...props} mode="review-buy" />
    </Providers>,
  );
  expect(screen.getByRole("heading", { name: "Holding" })).toHaveFocus();
});
// @rule R2: locale changes separators only, retaining every digit in a raw one-lamport amount.
it("formats tiny raw quantities with the locale separator", () => {
  renderWithProviders(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <SolanaHoldingPresenter
        origin={origin}
        read={null}
        intent={{ ...intent, input: { token: origin.asset, raw: "1" } }}
        quote={null}
        clock={{ now: null, blockHeight: null }}
        mode="buy"
        onMode={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("0,000000001 WSOL")).toBeVisible();
});
