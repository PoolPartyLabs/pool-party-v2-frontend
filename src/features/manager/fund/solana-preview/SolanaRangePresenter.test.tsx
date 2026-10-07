/**
 * @id PP-MGR-CMP-095
 * @name SolanaRangePresenter tests
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, controlled presenter tests
 */

import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import ptManager from "@/i18n/messages/pt-BR/manager.json";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { SolanaRangePresenter } from "./SolanaRangePresenter";
import type { SolanaRangeContext, SolanaRangeDraft } from "./solanaRangeModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

/** Pure vectors are protocol math examples, never production pool discovery or financial fixtures. */
function rangeTestContext(protocol: "orca" | "raydium" = "orca"): SolanaRangeContext {
  const common = {
    cluster: "mainnet-beta" as const,
    program: "11111111111111111111111111111111",
    pool: WSOL_MINT,
    tokenA: {
      kind: "spl" as const,
      network: "solana" as const,
      cluster: "mainnet-beta" as const,
      mint: WSOL_MINT,
      decimals: 9,
      symbol: "WSOL",
      unit: "base-units" as const,
      tokenProgram: "11111111111111111111111111111111",
      extensions: { status: "unknown" as const },
    },
    tokenB: {
      kind: "spl" as const,
      network: "solana" as const,
      cluster: "mainnet-beta" as const,
      mint: USDC_MINT,
      decimals: 6,
      symbol: "USDC",
      unit: "base-units" as const,
      tokenProgram: "11111111111111111111111111111111",
      extensions: { status: "unknown" as const },
    },
    status: "available" as const,
    source: {
      kind: "observed" as const,
      source: "official-math-test-vector",
      sourceAsOf: "2026-10-07T00:00:00Z",
      slot: "1",
      commitment: "confirmed" as const,
    },
    tickSpacing: 64,
    tickCurrent: 0,
    sqrtPriceX64: "18446744073709551616",
    position: {
      positionId: USDC_MINT,
      pool: WSOL_MINT,
      rawLiquidity: "10",
      tickLower: -128,
      tickUpper: 128,
    },
  };
  return protocol === "orca"
    ? {
        ...common,
        protocol,
        fee: { kind: "fixed", baseFeeRate: "3000", effectiveFeeRate: null },
        tokenBadge: { status: "unknown" },
      }
    : {
        ...common,
        protocol,
        ammConfig: {
          address: USDC_MINT,
          tickSpacing: 64,
          tradeFeeRate: "100",
          protocolFeeRate: "0",
          fundFeeRate: "0",
        },
        feeOn: "unknown",
        dynamicFee: "unknown",
      };
}

function Controlled({ context = rangeTestContext() }: { context?: SolanaRangeContext }) {
  const [range, setRange] = useState<SolanaRangeDraft>({
    tickLower: -128,
    tickUpper: 128,
    displayInverted: false,
  });
  return <SolanaRangePresenter context={context} range={range} onChange={setRange} />;
}
const initialRange: SolanaRangeDraft = { tickLower: -128, tickUpper: 128, displayInverted: false };
// @rule POO-2291 R2,R8: leaving an origin discards uncommitted field text, including a null interval.
it.each([
  "another-position",
  "unavailable",
] as const)("does not resurrect abandoned field text after %s", async (transition) => {
  const context = rangeTestContext();
  if (!context.position) throw new Error("missing test position");
  const change = vi.fn();
  const view = renderWithProviders(
    <SolanaRangePresenter context={context} range={initialRange} onChange={change} />,
  );
  const input = screen.getByRole("textbox", { name: "Min price" });
  const before = input.getAttribute("value");
  await userEvent.clear(input);
  await userEvent.type(input, "995");
  view.rerender(
    <SolanaRangePresenter
      context={
        transition === "unavailable"
          ? null
          : { ...context, position: { ...context.position, positionId: WSOL_MINT } }
      }
      range={initialRange}
      onChange={change}
    />,
  );
  view.rerender(<SolanaRangePresenter context={context} range={initialRange} onChange={change} />);
  expect(screen.getByRole("textbox", { name: "Min price" })).toHaveValue(before);
  expect(change).not.toHaveBeenCalled();
});
// @rule POO-2291 R2,R3,R8: a changed deployment or snapshot cannot commit text from its predecessor.
it.each([
  "program",
  "snapshot",
] as const)("clears field edits after the canonical %s changes", async (transition) => {
  const context = rangeTestContext();
  const change = vi.fn();
  const view = renderWithProviders(
    <SolanaRangePresenter context={context} range={initialRange} onChange={change} />,
  );
  const input = screen.getByRole("textbox", { name: "Min price" });
  const before = input.getAttribute("value");
  await userEvent.clear(input);
  await userEvent.type(input, "995");
  const next =
    transition === "program"
      ? { ...context, program: USDC_MINT }
      : { ...context, source: { ...context.source, sourceAsOf: "2026-10-07T00:01:00Z" } };
  view.rerender(<SolanaRangePresenter context={next} range={initialRange} onChange={change} />);
  expect(screen.getByRole("textbox", { name: "Min price" })).toHaveValue(before);
  expect(change).not.toHaveBeenCalled();
});
// @rule POO-2291 R3: fixture provenance is visible and cannot masquerade as an observed market.
it("labels fixture versus observed source, exact slot and commitment", () => {
  const context = rangeTestContext();
  const view = renderWithProviders(
    <SolanaRangePresenter context={context} range={initialRange} onChange={vi.fn()} />,
  );
  expect(screen.getByText("official-math-test-vector")).toBeVisible();
  expect(screen.getByText("confirmed")).toBeVisible();
  expect(screen.getByText("1")).toBeVisible();
  view.rerender(
    <SolanaRangePresenter
      context={{
        ...context,
        source: {
          kind: "fixture",
          fixtureId: "range-fixture",
          sourceAsOf: context.source.sourceAsOf,
          slot: null,
        },
      }}
      range={initialRange}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText("Illustrative fixture, not an observed pool.")).toBeVisible();
  expect(screen.getByText("range-fixture")).toBeVisible();
  expect(screen.queryByText("confirmed")).toBeNull();
});
// @rule POO-2291 R2,R5: metadata permits tiny prices with more than 100 leading fractional zeroes.
it("does not invalidate an untouched tiny canonical price on focus and blur", async () => {
  const context = rangeTestContext();
  const tiny = {
    ...context,
    cluster: "devnet" as const,
    tokenA: {
      ...context.tokenA,
      cluster: "devnet" as const,
      decimals: 0,
      mint: "11111111111111111111111111111111",
    },
    tokenB: { ...context.tokenB, cluster: "devnet" as const, decimals: 255 },
  };
  renderWithProviders(
    <SolanaRangePresenter context={tiny} range={initialRange} onChange={vi.fn()} />,
  );
  await userEvent.click(screen.getByRole("textbox", { name: "Min price" }));
  await userEvent.tab();
  expect(screen.queryByRole("alert")).toBeNull();
});
// @rule R3,R5: null absence does not become price/ticks/composition fixtures.
it("shows unavailable live context without editable or invented range state", () => {
  renderWithProviders(<SolanaRangePresenter context={null} range={null} onChange={vi.fn()} />);
  expect(screen.getByText("Not available")).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText(/50%/)).toBeNull();
});
// @rule R5,R8: inversion keeps canonical ticks; current position remains separate.
it("renders verified orientation/current versus draft and changes one grid step", async () => {
  renderWithProviders(<Controlled />);
  expect(screen.getByRole("textbox", { name: "Min price" })).toBeInTheDocument();
  const current = document.querySelector("[data-solana-current-range]")?.textContent;
  await userEvent.click(screen.getByRole("button", { name: "Increase Min price" }));
  expect(document.querySelector("[data-solana-draft-range]")).toHaveAttribute(
    "data-tick-lower",
    "-64",
  );
  expect(document.querySelector("[data-solana-current-range]")?.textContent).toBe(current);
  await userEvent.click(screen.getByRole("button", { name: "USDC per WSOL" }));
  expect(screen.getByRole("button", { name: "WSOL per USDC" })).toBeInTheDocument();
  expect(document.querySelector("[data-solana-draft-range]")).toHaveAttribute(
    "data-tick-lower",
    "-64",
  );
  expect(screen.getByText("Composition")).toBeInTheDocument();
  expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
});
// @rule R5: blur snaps canonical locale values, collapsed endpoints report invalid draft.
it("accepts locale decimal input and surfaces collapsed snapped bounds", async () => {
  renderWithProviders(
    <NextIntlClientProvider locale="pt-BR" messages={{ manager: ptManager }}>
      <Controlled />
    </NextIntlClientProvider>,
  );
  const input = screen.getByRole("textbox", { name: ptManager.fundBuilder.canvas.panel.range.min });
  await userEvent.clear(input);
  await userEvent.type(input, "995,0");
  await userEvent.tab();
  expect(document.querySelector("[data-solana-draft-range]")).toHaveAttribute(
    "data-tick-lower",
    "-64",
  );
  await userEvent.clear(input);
  await userEvent.type(input, "2000");
  await userEvent.tab();
  expect(screen.getByRole("alert")).toBeVisible();
  expect(document.querySelector("[data-solana-draft-range]")).toHaveAttribute(
    "data-tick-lower",
    "-64",
  );
});
// @rule R3,R5: stale inputs cannot mutate draft, Orca full-only disables impossible custom.
it("keeps stale context read-only and full-range-only restriction explicit", () => {
  const context = rangeTestContext();
  const view = renderWithProviders(<Controlled context={{ ...context, status: "stale" }} />);
  expect(screen.getByRole("textbox", { name: "Min price" })).toHaveAttribute("readonly");
  view.rerender(
    <SolanaRangePresenter
      context={{ ...context, tickSpacing: 32768, position: null }}
      range={{ tickLower: -425984, tickUpper: 425984, displayInverted: false }}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "±10%" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Min price" })).toHaveAttribute("readonly");
});
