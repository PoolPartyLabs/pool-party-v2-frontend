/**
 * @id PP-STR-CMP-023 (POO-1039)
 * @name FundingSourceSelector, tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The behaviours this component exists for: the running total [R1] and the CTA gate [R5].
 *
 * POO-1502 replaced a whole family of these. The old file's headline was "a BLOCKED row that is
 * visible, unselectable and ANNOUNCED rather than merely greyed [R2/R3/R7]"; [R11] hides that row
 * instead, so those tests now pin the ABSENCE and say which rule they overturned, rather than
 * disappearing and leaving the reversal undocumented.
 */
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { GasFeasibility } from "@/lib/provisioning";
import { GAS_ESCAPE_LABEL_KEYS, GAS_VERDICT_REASON_KEYS } from "@/lib/provisioning";
import { NATIVE_RESERVE_ETH } from "@/lib/provisioning/nativeReserve";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { FundingSourceSelector } from "./FundingSourceSelector";
import { fundingSourceKey } from "./fundingSelection";

const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

/** A funding source, defaulted to a plain 6-decimal USDC holding. */
function source(over: Partial<FundingSource> & Pick<FundingSource, "chainId" | "address">) {
  return {
    symbol: "USDC",
    decimals: 6,
    amount: "1200000000",
    usd: 1200,
    reachableChainIds: [over.chainId],
    isNative: false,
    logoUrl: "",
    ...over,
  } satisfies FundingSource;
}

/** An OK verdict for a chain, in the shape `classifyGasFeasibility` emits. */
function okVerdict(chainId: number): GasFeasibility {
  return {
    chainId,
    verdict: "OK",
    quotedGasUsd: 0.12,
    requiredGasUsd: 0.17,
    shortfallUsd: 0,
    surplusUsd: 3.2,
    reasonKey: GAS_VERDICT_REASON_KEYS.ok,
  };
}

/** A TOP_UP verdict, carrying the holding a gas slice would come from. */
function topUpVerdict(chainId: number): GasFeasibility {
  return {
    chainId,
    verdict: "TOP_UP",
    quotedGasUsd: 0.2,
    requiredGasUsd: 0.3,
    shortfallUsd: 0.28,
    surplusUsd: 0,
    reasonKey: GAS_VERDICT_REASON_KEYS.topUp,
    topUp: {
      token: {
        symbol: "USDC",
        address: "0xusdc",
        decimals: 6,
        balanceRaw: "1200000000",
        balanceUsd: 1200,
      },
      amountRaw: "280000",
      amountUsd: 0.28,
      buyNativeUsd: 0.28,
    },
  };
}

/** A BLOCKED verdict with both escapes, as the classifier annotates one. */
function blockedVerdict(chainId: number): GasFeasibility {
  return {
    chainId,
    verdict: "BLOCKED",
    quotedGasUsd: 0.2,
    requiredGasUsd: 0.25,
    shortfallUsd: 0.25,
    surplusUsd: 0,
    reasonKey: GAS_VERDICT_REASON_KEYS.noNative,
    escapes: [
      {
        kind: "bridge-native",
        labelKey: GAS_ESCAPE_LABEL_KEYS["bridge-native"],
        fromChainIds: [BASE],
      },
      { kind: "buy-crypto", labelKey: GAS_ESCAPE_LABEL_KEYS["buy-crypto"] },
    ],
  };
}

interface HarnessProps {
  sources: FundingSource[];
  gasByChainId?: Record<number, GasFeasibility>;
  requiredUsd?: number;
  bufferPct?: number;
  targetChainId?: number;
  allowShortfall?: boolean;
  initial?: string[];
  onSelectedChange?: (next: string[]) => void;
  onConfirm?: () => void;
  onOpenSettings?: () => void;
  onCancel?: () => void;
  mobileHeaderMounted?: boolean;
  quoteSeconds?: number;
  requoting?: boolean;
  details?: ReactNode;
}

/** Controlled host: the component owns no selection state, POO-1042 does. */
function Harness({
  sources,
  gasByChainId,
  requiredUsd = 1000,
  bufferPct = 5,
  targetChainId,
  allowShortfall,
  initial = [],
  onSelectedChange,
  onConfirm = () => {},
  onOpenSettings,
  onCancel,
  mobileHeaderMounted,
  quoteSeconds,
  requoting,
  details,
}: HarnessProps) {
  const [selected, setSelected] = useState<string[]>(initial);
  const verdicts =
    gasByChainId ??
    Object.fromEntries(sources.map((item) => [item.chainId, okVerdict(item.chainId)]));
  return (
    <FundingSourceSelector
      sources={sources}
      gasByChainId={verdicts}
      requiredUsd={requiredUsd}
      bufferPct={bufferPct}
      selected={selected}
      onSelectedChange={(next) => {
        setSelected(next);
        onSelectedChange?.(next);
      }}
      onConfirm={onConfirm}
      {...(targetChainId === undefined ? {} : { targetChainId })}
      {...(allowShortfall === undefined ? {} : { allowShortfall })}
      {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
      {...(onCancel === undefined ? {} : { onCancel })}
      {...(mobileHeaderMounted === undefined ? {} : { mobileHeaderMounted })}
      {...(quoteSeconds === undefined ? {} : { quoteSeconds })}
      {...(requoting === undefined ? {} : { requoting })}
      {...(details === undefined ? {} : { details })}
    />
  );
}

const baseUsdc = source({ chainId: BASE, address: "0xbase", usd: 600 });
const polygonWeth = source({
  chainId: POLYGON,
  address: "0xweth",
  symbol: "WETH",
  decimals: 18,
  amount: "150000000000000000",
  usd: 450,
});
const arbitrumUsdc = source({ chainId: ARBITRUM, address: "0xarb", usd: 300 });

describe("FundingSourceSelector", () => {
  it("lists every holding across every chain [R1]", () => {
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth, arbitrumUsdc]} />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: /USDC on Base/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /WETH on Polygon/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /USDC on Arbitrum/ })).toBeInTheDocument();
  });

  it("keeps the remaining shortfall visible and updates it as sources are picked [R1]", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} requiredUsd={1000} />);
    expect(screen.getByText("$1,000.00 still to go")).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));
    expect(screen.getByText("$600.00 of $1,000.00")).toBeInTheDocument();
    expect(screen.getByText("$400.00 still to go")).toBeInTheDocument();
  });

  it("reports the surplus once the requirement is passed [R1]", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} requiredUsd={1000} />);
    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));
    await user.click(screen.getByRole("option", { name: /WETH on Polygon/ }));
    expect(screen.getByText("$50.00 more than needed")).toBeInTheDocument();
  });

  // @rule POO-1502 [R12] — no verdict chips at all. Every row listed is usable, so a badge that
  // appears on 100% of rows carries zero information. This REPLACES the POO-1032 [R2] test that
  // asserted a badge on every row, and the replacement is the point rather than a deletion.
  it("[R12] carries no verdict badge on any row", () => {
    renderWithProviders(
      <Harness
        sources={[baseUsdc, polygonWeth]}
        gasByChainId={{ [BASE]: okVerdict(BASE), [POLYGON]: topUpVerdict(POLYGON) }}
      />,
    );
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs a top up")).not.toBeInTheDocument();
    expect(screen.queryByText("Can't be used yet")).not.toBeInTheDocument();
  });

  // @rule POO-1502 [R11] — a BLOCKED row is not rendered at all. This deliberately REVERSES POO-1032
  // [R2]/[R3], which required the opposite ("shown, greyed and EXPLAINED, never hidden", so the
  // user's own money would not look like it does not exist). The reversal was taken knowingly on
  // POO-1502 with that rule quoted, and the cost is stated there: the flow no longer tells anyone
  // why money they own cannot move. Pinned as a rule rather than left as an absence, so the next
  // person to re-add the row has to argue with a test instead of a memory.
  it("[R11] does not render a blocked row at all", () => {
    renderWithProviders(
      <Harness
        sources={[baseUsdc, arbitrumUsdc]}
        gasByChainId={{ [BASE]: okVerdict(BASE), [ARBITRUM]: blockedVerdict(ARBITRUM) }}
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.queryByRole("option", { name: /USDC on Arbitrum/ })).not.toBeInTheDocument();
  });

  // @rule POO-1502 [R11] — a TOP_UP row IS rendered and IS selectable. The planner prepends the gas
  // swap that fixes it, so that money is spendable; hiding it would hide usable funds, which is a
  // different and worse failure than hiding money that genuinely cannot move.
  it("[R11] renders a top-up row and lets it be picked", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderWithProviders(
      <Harness
        sources={[polygonWeth]}
        gasByChainId={{ [POLYGON]: topUpVerdict(POLYGON) }}
        onSelectedChange={onSelectedChange}
      />,
    );
    const row = screen.getByRole("option", { name: /WETH on Polygon/ });
    expect(row).not.toHaveAttribute("aria-disabled");
    await user.click(row);
    expect(onSelectedChange).toHaveBeenCalled();
  });

  // @rule POO-1502 [R11] — the same predicate that hides the BLOCKED chain hides the two other
  // unspendable classes, and it must: leaving a row the CTA then refuses is exactly the state
  // [R11] exists to remove, whatever the reason for the refusal.
  it("[R11] does not render a holding that cannot reach the operation's chain", () => {
    renderWithProviders(
      <Harness
        sources={[baseUsdc, { ...arbitrumUsdc, reachableChainIds: [ARBITRUM] }]}
        targetChainId={BASE}
        gasByChainId={{ [BASE]: okVerdict(BASE), [ARBITRUM]: okVerdict(ARBITRUM) }}
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.queryByRole("option", { name: /USDC on Arbitrum/ })).not.toBeInTheDocument();
  });

  it("hands back the selection in the order it was picked, which is route order [R4]", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderWithProviders(
      <Harness
        sources={[baseUsdc, polygonWeth, arbitrumUsdc]}
        onSelectedChange={onSelectedChange}
      />,
    );
    await user.click(screen.getByRole("option", { name: /WETH on Polygon/ }));
    await user.click(screen.getByRole("option", { name: /USDC on Arbitrum/ }));
    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));
    expect(onSelectedChange).toHaveBeenLastCalledWith([
      fundingSourceKey(polygonWeth),
      fundingSourceKey(arbitrumUsdc),
      fundingSourceKey(baseUsdc),
    ]);
  });

  it("shows the route position on each selected row, so what is seen is what executes [R4]", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} />);
    await user.click(screen.getByRole("option", { name: /WETH on Polygon/ }));
    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));
    expect(screen.getByRole("option", { name: /WETH on Polygon/ })).toHaveAccessibleDescription(
      /Step 1/,
    );
    expect(screen.getByRole("option", { name: /USDC on Base/ })).toHaveAccessibleDescription(
      /Step 2/,
    );
  });

  it("deselects a row that is picked twice [R4]", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc]} />);
    const row = screen.getByRole("option", { name: /USDC on Base/ });
    await user.click(row);
    expect(row).toHaveAttribute("aria-selected", "true");
    await user.click(row);
    expect(row).toHaveAttribute("aria-selected", "false");
  });

  it("keeps the CTA shut until the total covers the requirement [R5]", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} requiredUsd={1000} />);
    const cta = screen.getByRole("button", { name: "Confirm and start" });
    expect(cta).toBeDisabled();

    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));
    expect(cta).toBeDisabled();

    await user.click(screen.getByRole("option", { name: /WETH on Polygon/ }));
    expect(cta).toBeEnabled();
  });

  it("opens the CTA on an exact cover [R5]", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={600} />);
    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));
    expect(screen.getByRole("button", { name: "Confirm and start" })).toBeEnabled();
    expect(screen.getByText("Enough")).toBeInTheDocument();
  });

  it("keeps the CTA shut while nothing is selected, whatever the requirement [R5]", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={0} />);
    expect(screen.getByRole("button", { name: "Confirm and start" })).toBeDisabled();
  });

  it("confirms with the selection once covered [R5]", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={600} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));
    await user.click(screen.getByRole("button", { name: "Confirm and start" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders exactly the inventory it is given, applying no second dust filter [R6]", () => {
    const dust = source({ chainId: BASE, address: "0xdust", symbol: "DUST", usd: 0.4 });
    renderWithProviders(<Harness sources={[baseUsdc, dust]} />);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /DUST on Base/ })).toBeInTheDocument();
  });

  it("is operable from the keyboard [R7]", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={600} />);
    await user.tab();
    const row = screen.getByRole("option", { name: /USDC on Base/ });
    expect(row).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(row).toHaveAttribute("aria-selected", "true");
  });

  it("says so when there is nothing to spend, rather than rendering an empty box", () => {
    renderWithProviders(<Harness sources={[]} />);
    expect(screen.getByText("There's nothing here we can spend yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm and start" })).toBeDisabled();
  });

  it("announces the running total politely as it changes [R7]", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={1000} />);
    const live = screen.getByText("$1,000.00 still to go").closest("[aria-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
  });
});

/**
 * POO-1086 rules v1 — the v2 layout (Figma `6548:569`).
 *
 * The screen is stripped to a heading, a coverage meter and the rows. The arithmetic underneath is
 * deliberately untouched: `fundingProgress` still accumulates integer micro-dollars, a shortfall
 * still rounds up and a surplus still rounds down.
 */
describe("FundingSourceSelector — v2 layout", () => {
  it("[F3-R2] orders the screen heading, meter, buffer note, fill shortcut, rows, CTA", () => {
    const { container } = renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} />);

    const heading = screen.getByRole("heading", { name: "Choose tokens to convert" });
    const meter = screen.getByRole("progressbar");
    // [R50] The buffer disclosure sits between the meter and the shortcut, at rest. Its position is
    // the point: it is above the control that commits the money, not below it and not behind a tap.
    const bufferNote = screen.getByText(/set aside for price moves/i);
    const fill = screen.getByRole("button", { name: /convert what's needed/i });
    const list = screen.getByRole("listbox");
    const cta = screen.getByRole("button", { name: "Confirm and start" });

    const order = [heading, meter, bufferNote, fill, list, cta];
    for (let index = 1; index < order.length; index++) {
      const previous = order[index - 1] as HTMLElement;
      const current = order[index] as HTMLElement;
      // DOCUMENT_POSITION_FOLLOWING: `current` comes after `previous` in the document.
      expect(previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
    expect(container).toBeTruthy();
  });

  it("[F3-R3] the meter reports coverage as a progress bar", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={1200} />);

    const meter = screen.getByRole("progressbar");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("aria-valuenow", "0");

    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));

    // $600 of $1,200.
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("[F3-R3] the bar never overflows its track, however large the surplus", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={10} />);

    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("[F3-R3] says Enough once covered, and what is missing until then", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={600} />);

    expect(screen.getByText(/still to go/)).toBeInTheDocument();
    expect(screen.queryByText("Enough")).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));

    expect(screen.getByText("Enough")).toBeInTheDocument();
  });

  // @rule POO-1502 [R15] — the shortcut stops the moment the target is covered. This REPLACES the
  // POO-1086 [F3-R4] "picks every spendable row" test: `Convert everything` converted holdings the
  // operation had no use for, and every conversion is a real swap with a real fee.
  it("[R15] the fill stops as soon as the target is covered", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderWithProviders(
      <Harness
        sources={[baseUsdc, polygonWeth, arbitrumUsdc]}
        requiredUsd={500}
        onSelectedChange={onSelectedChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /convert what's needed/i }));

    // $600 alone covers $500, so the other two are left alone.
    expect(onSelectedChange).toHaveBeenCalledWith([fundingSourceKey(baseUsdc)]);
  });

  it("[R15] the fill keeps taking until the target is covered", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderWithProviders(
      <Harness
        sources={[baseUsdc, polygonWeth]}
        requiredUsd={900}
        onSelectedChange={onSelectedChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /convert what's needed/i }));

    expect(onSelectedChange).toHaveBeenCalledWith([
      fundingSourceKey(baseUsdc),
      fundingSourceKey(polygonWeth),
    ]);
  });

  // @rule POO-1502 [R11] + [R15] — one predicate decides what the list renders and what the fill
  // takes, so the shortcut can never pick a row the user cannot see.
  it("[R15] the fill never takes a row the list does not render", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderWithProviders(
      <Harness
        sources={[baseUsdc, polygonWeth, arbitrumUsdc]}
        requiredUsd={5000}
        gasByChainId={{
          [BASE]: okVerdict(BASE),
          [POLYGON]: blockedVerdict(POLYGON),
          [ARBITRUM]: okVerdict(ARBITRUM),
        }}
        onSelectedChange={onSelectedChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /convert what's needed/i }));

    expect(onSelectedChange).toHaveBeenCalledWith([
      fundingSourceKey(baseUsdc),
      fundingSourceKey(arbitrumUsdc),
    ]);
  });

  it("[R15] pressing it again clears the selection", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderWithProviders(
      <Harness
        sources={[baseUsdc, polygonWeth]}
        requiredUsd={900}
        onSelectedChange={onSelectedChange}
      />,
    );
    const fill = screen.getByRole("button", { name: /convert what's needed/i });

    await user.click(fill);
    await user.click(fill);

    expect(onSelectedChange).toHaveBeenLastCalledWith([]);
  });

  // @rule POO-1502 [R16] — the amount is what the click will select, not the target. The two differ
  // whenever whole-source selection overshoots, which is most of the time.
  it("[R16] shows what the click will actually select, not the target", () => {
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} requiredUsd={500} />);

    // $600 covers the $500 target on its own, so the click selects $600 and the row says $600.
    expect(screen.getByRole("button", { name: /convert what's needed/i })).toHaveTextContent(
      "$600.00",
    );
    expect(screen.getByRole("button", { name: /convert what's needed/i })).not.toHaveTextContent(
      "$500.00",
    );
  });

  // @rule POO-1502 [R15] — the shortcut carries `Recommended`, the same claim the route picker makes
  // on the screen before: this is the path with the fewest conversions.
  it("[R15] the fill carries the Recommended chip", () => {
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} requiredUsd={900} />);

    expect(screen.getByRole("button", { name: /convert what's needed/i })).toHaveTextContent(
      "Recommended",
    );
  });

  // @rule POO-1535 [M6.5] — the chip is a notch on the row's own top border, not an inline badge:
  // two inline attempts put it straight through the amount, and the amount is money (P2, never
  // truncated). Must be absolutely positioned, straddling the 1px stroke, filled with the page's
  // surface colour so the border reads as interrupted.
  it("[M6.5] the Recommended chip sits on the row's top border, and the amount is never displaced", () => {
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} requiredUsd={900} />);

    const chip = screen.getByText("Recommended");
    expect(chip).toHaveClass("absolute", "top-0", "right-4", "-translate-y-1/2", "bg-surface");
    const button = screen.getByRole("button", { name: /convert what's needed/i });
    expect(button).toHaveTextContent(/\$[\d,]+\.\d{2}/);
    // Lifted out of the FLOW, never out of the DOM: the recommendation stays inside the button and
    // so stays in the accessible name.
    expect(button).toContainElement(chip);
    expect(button).toHaveAccessibleName(/Recommended/);
  });

  // @rule POO-1535 [M6.5] — the notch is a BELOW-`sm` treatment ("Above `sm` nothing changes"). The
  // same element goes back into the flow above `sm` rather than a second one being rendered, so
  // there is one accessible name at every viewport.
  it("[M6.5] the notch is below `sm` only: at `sm` and above the inline chip is restored", () => {
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} requiredUsd={900} />);

    const chip = screen.getByText("Recommended");
    expect(chip).toHaveClass("sm:static", "sm:translate-y-0", "sm:bg-primary/10");
    // Every non-positional class is the pre-POO-1535 inline chip's, byte for byte.
    expect(chip).toHaveClass(
      "shrink-0",
      "rounded-full",
      "border",
      "border-primary/40",
      "px-2",
      "py-0.5",
      "font-medium",
      "text-primary",
      "text-xs",
    );
  });

  // @rule POO-1535 [M6.5] — 20px of clearance above the notched row, raised from 16, mirroring the
  // route picker's own gap-2 -> gap-5 fix. Above `sm` there is no notch to clear, so main's `gap-4`
  // stands.
  it("[M6.5] keeps 20px clearance (gap-5) around the notched row, not the old gap-4", () => {
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} requiredUsd={900} />);

    const wrapper = screen.getByRole("button", { name: /convert what's needed/i }).parentElement;
    expect(wrapper).toHaveClass("gap-5");
    expect(wrapper).not.toHaveClass("gap-4");
    expect(wrapper).toHaveClass("sm:gap-4");
  });

  it("[F3-R5] a picked row is marked with a check, and keeps its position for a screen reader", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} />);

    await user.click(screen.getByRole("option", { name: /WETH on Polygon/ }));
    const row = screen.getByRole("option", { name: /WETH on Polygon/ });

    expect(row).toHaveAttribute("aria-selected", "true");
    // The number moved to the Confirm screen; two numberings for one route is one too many.
    expect(row).not.toHaveTextContent(/^1$/);
    expect(row).toHaveAccessibleDescription(/Step 1/);
  });

  // @rule POO-1502 [R13] — the network is the badge on the token logo and nothing else. This
  // REPLACES POO-1086 [F3-R6], which put a short reason where the network name was: with [R11] there
  // are no unspendable rows left to explain, so the line under the symbol had nothing left to say
  // and the row lost it. The network survives where a person actually looks for it, on the logo.
  it("[R13] states the network on the logo badge, never as a text line", () => {
    renderWithProviders(<Harness sources={[polygonWeth]} requiredUsd={100} />);

    const row = screen.getByRole("option", { name: /WETH on Polygon/ });
    // Still announced, because the accessible name carries it. Just not printed twice.
    expect(row).toHaveAccessibleName(/WETH on Polygon/);
    expect(row).toHaveTextContent("WETH");
    expect(row.textContent).not.toContain("Polygon");
  });

  it("[F3-R7] the rows wrap long copy instead of overflowing", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} />);

    const row = screen.getByRole("option", { name: /USDC on Base/ });
    const wrapping = row.querySelectorAll(".break-words");
    expect(wrapping.length).toBeGreaterThan(0);
    expect(row.querySelectorAll(".min-w-0").length).toBeGreaterThan(0);
  });
});

const NATIVE = "0x0000000000000000000000000000000000000000";

/** `eth` whole coins as an 18-decimal base-unit (wei) string. */
function wei(eth: number): string {
  return BigInt(Math.round(eth * 1e6))
    .toString()
    .concat("000000000000");
}

/** The native coin of a chain, defaulted onto Base. */
function nativeSource(over: Partial<FundingSource> & Pick<FundingSource, "chainId">) {
  return source({
    address: NATIVE,
    symbol: "ETH",
    decimals: 18,
    isNative: true,
    reachableChainIds: [ARBITRUM],
    ...over,
  });
}

describe("FundingSourceSelector — same-chain + native signing reserve (POO-1155)", () => {
  it("offers a same-chain holding whose reachable set omits its own chain", () => {
    // The root cause at the row: `reachableChainIds` excludes the source chain, so a holding on the
    // operation's OWN chain arrives with the target absent. It must still be selectable.
    const arb = source({
      chainId: ARBITRUM,
      address: "0xarb",
      usd: 17.54,
      reachableChainIds: [BASE, POLYGON],
    });
    renderWithProviders(<Harness sources={[arb]} targetChainId={ARBITRUM} requiredUsd={100} />);

    const row = screen.getByRole("option", { name: /USDC on Arbitrum/ });
    expect(row).not.toHaveAttribute("aria-disabled");
    expect(row).not.toHaveTextContent(/can'?t reach this network/i);
  });

  // @rule POO-1502 [R11] — a native coin below the signing reserve is not spendable, so since [R11]
  // it is not rendered either. POO-1155 greyed it and explained why; that explanation is part of the
  // cost this issue accepted knowingly. Spending it would strand the wallet with no way to sign,
  // which is why it must never simply become selectable instead.
  it("[R11] does not render a native coin below the signing reserve", () => {
    const eth = nativeSource({ chainId: BASE, amount: wei(NATIVE_RESERVE_ETH * 0.7), usd: 2 });
    renderWithProviders(<Harness sources={[eth]} targetChainId={BASE} requiredUsd={100} />);

    expect(screen.queryByRole("option", { name: /ETH on Base/ })).not.toBeInTheDocument();
    // And the screen says so, rather than rendering an empty list with no explanation.
    expect(screen.getByText("There's nothing here we can spend yet.")).toBeInTheDocument();
  });

  it("keeps a native coin above the reserve selectable", async () => {
    const user = userEvent.setup();
    const eth = nativeSource({ chainId: BASE, amount: wei(NATIVE_RESERVE_ETH * 5.5), usd: 18 });
    renderWithProviders(<Harness sources={[eth]} targetChainId={BASE} requiredUsd={100} />);

    const row = screen.getByRole("option", { name: /ETH on Base/ });
    expect(row).not.toHaveAttribute("aria-disabled");
    await user.click(row);
    expect(row).toHaveAttribute("aria-selected", "true");
  });

  it("counts only the native excess toward coverage, never the signing reserve", async () => {
    const user = userEvent.setup();
    const eth = nativeSource({ chainId: BASE, amount: wei(NATIVE_RESERVE_ETH * 5.5), usd: 18 });
    renderWithProviders(<Harness sources={[eth]} targetChainId={BASE} requiredUsd={100} />);

    await user.click(screen.getByRole("option", { name: /ETH on Base/ }));
    const meter = screen.getByText(/ of \$/).textContent ?? "";
    const selected = Number((meter.split(" of ")[0] ?? "").replace(/[^0-9.]/g, ""));
    expect(selected).toBeGreaterThan(0);
    expect(selected).toBeLessThan(18);
  });

  it("[allowShortfall] proceeds with nothing selected when the on-ramp can buy the rest", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(
      <Harness sources={[baseUsdc]} requiredUsd={5000} allowShortfall onConfirm={onConfirm} />,
    );

    const cta = screen.getByRole("button", { name: "Confirm and start" });
    expect(cta).toBeEnabled();
    await user.click(cta);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("[allowShortfall off] still gates the CTA on covering the requirement", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={5000} />);
    expect(screen.getByRole("button", { name: "Confirm and start" })).toBeDisabled();
  });
});

/**
 * POO-1502 [R17] and [R18]: the two things the screen gained rather than lost.
 */
describe("FundingSourceSelector — settings and details (POO-1502)", () => {
  // @rule [R17] — slippage and deadline live on THIS screen and nowhere else in the provisioning
  // flow. The dialog itself stays with the host, the same way the six transactional modals own
  // theirs; this component renders the affordance and calls back.
  it("[R17] opens the transaction settings from the gear", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    renderWithProviders(<Harness sources={[baseUsdc]} onOpenSettings={onOpenSettings} />);

    await user.click(screen.getByRole("button", { name: "Transaction settings" }));

    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  // A gear that opens nothing is worse than no gear: it promises a control the screen does not have.
  it("[R17] renders no gear when the host wires no settings", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} />);

    expect(screen.queryByRole("button", { name: "Transaction settings" })).not.toBeInTheDocument();
  });

  // @rule POO-1528 [M6.1] — [R17]'s rule is unchanged ("here and nowhere else"); mobileHeaderMounted
  // only moves WHERE "here" renders below `sm`, into a header this component does not own.
  it("[M6.1] mobileHeaderMounted hides this component's own gear below sm, not above it", () => {
    const onOpenSettings = vi.fn();
    renderWithProviders(
      <Harness sources={[baseUsdc]} onOpenSettings={onOpenSettings} mobileHeaderMounted />,
    );

    const gear = screen.getByRole("button", { name: "Transaction settings" });
    expect(gear).toHaveClass("hidden");
    expect(gear).toHaveClass("sm:block");
  });

  it("[M6.1] mobileHeaderMounted absent (default) leaves the gear unconditional, as before", () => {
    const onOpenSettings = vi.fn();
    renderWithProviders(<Harness sources={[baseUsdc]} onOpenSettings={onOpenSettings} />);

    const gear = screen.getByRole("button", { name: "Transaction settings" });
    expect(gear).not.toHaveClass("hidden");
  });

  // @rule POO-1528 [M6.2] — the countdown's mobile home once a host's header owns the gear.
  it("[M6.2] mobileHeaderMounted adds the countdown beside the coverage meter, mobile-only", () => {
    renderWithProviders(
      <Harness sources={[baseUsdc]} mobileHeaderMounted quoteSeconds={27} requiredUsd={1000} />,
    );

    // Two renders of the SAME figure now exist: the title-row one (quiet below sm) and the new
    // meter one (quiet above sm) — both present in the DOM, CSS decides which one is seen.
    expect(screen.getAllByText("Refreshes in 27s")).toHaveLength(2);
  });

  it("[M6.2] mobileHeaderMounted absent (default) renders the countdown once, where it always has", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} quoteSeconds={27} requiredUsd={1000} />);

    expect(screen.getAllByText("Refreshes in 27s")).toHaveLength(1);
  });

  // @rule [R18] — the *how* goes behind the disclosure. The *how much* never does, which is the half
  // of the rule a refactor is most likely to lose.
  it("[R18] hides the plan behind See details and keeps the coverage total visible", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Harness sources={[baseUsdc]} requiredUsd={1000} details={<p>Convert USDC on Base</p>} />,
    );

    expect(screen.queryByText("Convert USDC on Base")).not.toBeInTheDocument();
    // Collapsed, and the money is still on screen.
    expect(screen.getByText("$0.00 of $1,000.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /see details/i }));

    expect(screen.getByText("Convert USDC on Base")).toBeInTheDocument();
    expect(screen.getByText("$0.00 of $1,000.00")).toBeInTheDocument();
  });

  it("[R18] the disclosure reports its own state, and closes again", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc]} details={<p>Convert USDC on Base</p>} />);

    const toggle = screen.getByRole("button", { name: /see details/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    const open = screen.getByRole("button", { name: /hide details/i });
    expect(open).toHaveAttribute("aria-expanded", "true");

    await user.click(open);
    expect(screen.queryByText("Convert USDC on Base")).not.toBeInTheDocument();
  });

  // @rule M5.2 (POO-1526) — a tap-to-expand disclosure, the same class of control M5.2 names by
  // example ("Step N of M"); the explicit min-height is the fix, not a bigger icon.
  it("[M5.2] the See details disclosure carries an explicit 44pt touch target", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} details={<p>Convert USDC on Base</p>} />);

    expect(screen.getByRole("button", { name: /see details/i })).toHaveClass("min-h-11");
  });

  // @rule M5.2 (POO-1526) — its own full-width row; the explicit 44pt is a min-height, not a
  // bigger font.
  it("[M5.2] the Cancel row carries an explicit 44pt touch target", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} onCancel={() => {}} />);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("min-h-11");
  });

  /**
   * @rule POO-1526 [M5.1] / POO-1528 — deferred to POO-1528 on the assumption the shared
   * `TransactionModalHeader` would replace this gear outright. It only does so BELOW `sm`, and only
   * on a host that mounts that header, so for every remaining case (above `sm`, and the two manager
   * modals below it) the gear takes the house invisible hit area: 24px + 2x10px = the 44pt floor.
   */
  it("[M5.1] the gear carries a 44pt hit area wherever it still renders", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} onOpenSettings={() => {}} />);

    expect(screen.getByRole("button", { name: "Transaction settings" })).toHaveClass(
      "after:-inset-2.5",
    );
  });

  // There is no plan to show before one is quoted, and a disclosure that opens onto nothing is a
  // dead control on a screen whose whole job is removing them.
  it("[R18] renders no disclosure when there is nothing to disclose", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} />);

    expect(screen.queryByRole("button", { name: /see details/i })).not.toBeInTheDocument();
  });

  // @rule [R50] / CR-CORE-014 — the buffer is money sourced ABOVE what the operation costs. It is
  // stated at rest, on the screen where the user commits it, with the rate interpolated because
  // POO-1499 D9 makes it the server's to set.
  it("[R50] discloses the buffer at rest, with the rate it actually applies", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} bufferPct={5} />);

    expect(
      screen.getByText(
        "Includes 5% set aside for price moves. Anything left over comes back to your wallet.",
      ),
    ).toBeInTheDocument();
  });

  it("[R50] no locale hard-codes the rate", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} bufferPct={3} />);

    expect(screen.getByText(/Includes 3% set aside/)).toBeInTheDocument();
  });
});

/**
 * POO-1502 [R14]: list order is descending USD value.
 */
describe("FundingSourceSelector — order (POO-1502 [R14])", () => {
  // The inventory arrives most-valuable-first and is rendered verbatim. This pins the CONTRACT
  // rather than a local sort: re-sorting defensively here is the same mistake as re-filtering
  // defensively, and it is how two surfaces start disagreeing about what the user owns.
  it("[R14] renders the inventory in the order it was given, without re-sorting", () => {
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth, arbitrumUsdc]} />);

    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      `funding-source-${BASE}-0xbase`,
      `funding-source-${POLYGON}-0xweth`,
      `funding-source-${ARBITRUM}-0xarb`,
    ]);
  });

  // [R11] removes rows; it must never REORDER the ones that survive, or the descending-value
  // contract the inventory guarantees would stop holding on exactly the screens that filter.
  it("[R14] filtering out an unspendable row leaves the rest in order", () => {
    renderWithProviders(
      <Harness
        sources={[baseUsdc, polygonWeth, arbitrumUsdc]}
        gasByChainId={{
          [BASE]: okVerdict(BASE),
          [POLYGON]: blockedVerdict(POLYGON),
          [ARBITRUM]: okVerdict(ARBITRUM),
        }}
      />,
    );

    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      `funding-source-${BASE}-0xbase`,
      `funding-source-${ARBITRUM}-0xarb`,
    ]);
  });
});

/**
 * POO-1502 [R17] and [R18]: the two things the screen gained rather than lost.
 */
describe("FundingSourceSelector — settings and details (POO-1502)", () => {
  // @rule [R17] — slippage and deadline live on THIS screen and nowhere else in the provisioning
  // flow. The dialog itself stays with the host, the same way the six transactional modals own
  // theirs; this component renders the affordance and calls back.
  it("[R17] opens the transaction settings from the gear", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    renderWithProviders(<Harness sources={[baseUsdc]} onOpenSettings={onOpenSettings} />);

    await user.click(screen.getByRole("button", { name: "Transaction settings" }));

    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  // A gear that opens nothing is worse than no gear: it promises a control the screen does not have.
  it("[R17] renders no gear when the host wires no settings", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} />);

    expect(screen.queryByRole("button", { name: "Transaction settings" })).not.toBeInTheDocument();
  });

  // @rule POO-1528 [M6.1] — [R17]'s rule is unchanged ("here and nowhere else"); mobileHeaderMounted
  // only moves WHERE "here" renders below `sm`, into a header this component does not own.
  it("[M6.1] mobileHeaderMounted hides this component's own gear below sm, not above it", () => {
    const onOpenSettings = vi.fn();
    renderWithProviders(
      <Harness sources={[baseUsdc]} onOpenSettings={onOpenSettings} mobileHeaderMounted />,
    );

    const gear = screen.getByRole("button", { name: "Transaction settings" });
    expect(gear).toHaveClass("hidden");
    expect(gear).toHaveClass("sm:block");
  });

  it("[M6.1] mobileHeaderMounted absent (default) leaves the gear unconditional, as before", () => {
    const onOpenSettings = vi.fn();
    renderWithProviders(<Harness sources={[baseUsdc]} onOpenSettings={onOpenSettings} />);

    const gear = screen.getByRole("button", { name: "Transaction settings" });
    expect(gear).not.toHaveClass("hidden");
  });

  // @rule POO-1528 [M6.2] — the countdown's mobile home once a host's header owns the gear.
  it("[M6.2] mobileHeaderMounted adds the countdown beside the coverage meter, mobile-only", () => {
    renderWithProviders(
      <Harness sources={[baseUsdc]} mobileHeaderMounted quoteSeconds={27} requiredUsd={1000} />,
    );

    // Two renders of the SAME figure now exist: the title-row one (quiet below sm) and the new
    // meter one (quiet above sm) — both present in the DOM, CSS decides which one is seen.
    expect(screen.getAllByText("Refreshes in 27s")).toHaveLength(2);
  });

  it("[M6.2] mobileHeaderMounted absent (default) renders the countdown once, where it always has", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} quoteSeconds={27} requiredUsd={1000} />);

    expect(screen.getAllByText("Refreshes in 27s")).toHaveLength(1);
  });

  // @rule [R18] — the *how* goes behind the disclosure. The *how much* never does, which is the half
  // of the rule a refactor is most likely to lose.
  it("[R18] hides the plan behind See details and keeps the coverage total visible", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Harness sources={[baseUsdc]} requiredUsd={1000} details={<p>Convert USDC on Base</p>} />,
    );

    expect(screen.queryByText("Convert USDC on Base")).not.toBeInTheDocument();
    // Collapsed, and the money is still on screen.
    expect(screen.getByText("$0.00 of $1,000.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /see details/i }));

    expect(screen.getByText("Convert USDC on Base")).toBeInTheDocument();
    expect(screen.getByText("$0.00 of $1,000.00")).toBeInTheDocument();
  });

  it("[R18] the disclosure reports its own state, and closes again", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc]} details={<p>Convert USDC on Base</p>} />);

    const toggle = screen.getByRole("button", { name: /see details/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    const open = screen.getByRole("button", { name: /hide details/i });
    expect(open).toHaveAttribute("aria-expanded", "true");

    await user.click(open);
    expect(screen.queryByText("Convert USDC on Base")).not.toBeInTheDocument();
  });

  // @rule M5.2 (POO-1526) — a tap-to-expand disclosure, the same class of control M5.2 names by
  // example ("Step N of M"); the explicit min-height is the fix, not a bigger icon.
  it("[M5.2] the See details disclosure carries an explicit 44pt touch target", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} details={<p>Convert USDC on Base</p>} />);

    expect(screen.getByRole("button", { name: /see details/i })).toHaveClass("min-h-11");
  });

  // @rule M5.2 (POO-1526) — its own full-width row; the explicit 44pt is a min-height, not a
  // bigger font.
  it("[M5.2] the Cancel row carries an explicit 44pt touch target", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} onCancel={() => {}} />);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("min-h-11");
  });

  // There is no plan to show before one is quoted, and a disclosure that opens onto nothing is a
  // dead control on a screen whose whole job is removing them.
  it("[R18] renders no disclosure when there is nothing to disclose", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} />);

    expect(screen.queryByRole("button", { name: /see details/i })).not.toBeInTheDocument();
  });

  // @rule [R50] / CR-CORE-014 — the buffer is money sourced ABOVE what the operation costs. It is
  // stated at rest, on the screen where the user commits it, with the rate interpolated because
  // POO-1499 D9 makes it the server's to set.
  it("[R50] discloses the buffer at rest, with the rate it actually applies", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} bufferPct={5} />);

    expect(
      screen.getByText(
        "Includes 5% set aside for price moves. Anything left over comes back to your wallet.",
      ),
    ).toBeInTheDocument();
  });

  it("[R50] no locale hard-codes the rate", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} bufferPct={3} />);

    expect(screen.getByText(/Includes 3% set aside/)).toBeInTheDocument();
  });
});

/**
 * POO-1502 [R14]: list order is descending USD value.
 */
describe("FundingSourceSelector — order (POO-1502 [R14])", () => {
  // The inventory arrives most-valuable-first and is rendered verbatim. This pins the CONTRACT
  // rather than a local sort: re-sorting defensively here is the same mistake as re-filtering
  // defensively, and it is how two surfaces start disagreeing about what the user owns.
  it("[R14] renders the inventory in the order it was given, without re-sorting", () => {
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth, arbitrumUsdc]} />);

    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      `funding-source-${BASE}-0xbase`,
      `funding-source-${POLYGON}-0xweth`,
      `funding-source-${ARBITRUM}-0xarb`,
    ]);
  });

  // [R11] removes rows; it must never REORDER the ones that survive, or the descending-value
  // contract the inventory guarantees would stop holding on exactly the screens that filter.
  it("[R14] filtering out an unspendable row leaves the rest in order", () => {
    renderWithProviders(
      <Harness
        sources={[baseUsdc, polygonWeth, arbitrumUsdc]}
        gasByChainId={{
          [BASE]: okVerdict(BASE),
          [POLYGON]: blockedVerdict(POLYGON),
          [ARBITRUM]: okVerdict(ARBITRUM),
        }}
      />,
    );

    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      `funding-source-${BASE}-0xbase`,
      `funding-source-${ARBITRUM}-0xarb`,
    ]);
  });
});
