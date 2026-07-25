/**
 * @id PP-STR-CMP-023 (POO-1039)
 * @name FundingSourceSelector, tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The three behaviours this component exists for: the running total [R1], the CTA gate [R5], and a
 * BLOCKED row that is visible, unselectable and ANNOUNCED rather than merely greyed [R2/R3/R7].
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { GasFeasibility } from "@/lib/provisioning";
import { GAS_ESCAPE_LABEL_KEYS, GAS_VERDICT_REASON_KEYS } from "@/lib/provisioning";
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
  initial?: string[];
  onSelectedChange?: (next: string[]) => void;
  onConfirm?: () => void;
}

/** Controlled host: the component owns no selection state, POO-1042 does. */
function Harness({
  sources,
  gasByChainId,
  requiredUsd = 1000,
  initial = [],
  onSelectedChange,
  onConfirm = () => {},
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
      selected={selected}
      onSelectedChange={(next) => {
        setSelected(next);
        onSelectedChange?.(next);
      }}
      onConfirm={onConfirm}
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
    expect(screen.getByText("Selected: $600.00")).toBeInTheDocument();
    expect(screen.getByText("$400.00 still to go")).toBeInTheDocument();
  });

  it("reports the surplus once the requirement is passed [R1]", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness sources={[baseUsdc, polygonWeth]} requiredUsd={1000} />);
    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));
    await user.click(screen.getByRole("option", { name: /WETH on Polygon/ }));
    expect(screen.getByText("$50.00 more than needed")).toBeInTheDocument();
  });

  it("carries a gas verdict badge on every row [R2]", () => {
    renderWithProviders(
      <Harness
        sources={[baseUsdc, polygonWeth, arbitrumUsdc]}
        gasByChainId={{
          [BASE]: okVerdict(BASE),
          [POLYGON]: topUpVerdict(POLYGON),
          [ARBITRUM]: blockedVerdict(ARBITRUM),
        }}
      />,
    );
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Needs a top up")).toBeInTheDocument();
    expect(screen.getByText("Can't be used yet")).toBeInTheDocument();
  });

  it("keeps a blocked row visible instead of hiding the user's own money [R2]", () => {
    renderWithProviders(
      <Harness
        sources={[baseUsdc, arbitrumUsdc]}
        gasByChainId={{ [BASE]: okVerdict(BASE), [ARBITRUM]: blockedVerdict(ARBITRUM) }}
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /USDC on Arbitrum/ })).toBeInTheDocument();
  });

  it("refuses to select a blocked row [R3]", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderWithProviders(
      <Harness
        sources={[baseUsdc, arbitrumUsdc]}
        gasByChainId={{ [BASE]: okVerdict(BASE), [ARBITRUM]: blockedVerdict(ARBITRUM) }}
        onSelectedChange={onSelectedChange}
      />,
    );
    const blocked = screen.getByRole("option", { name: /USDC on Arbitrum/ });
    await user.click(blocked);
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(blocked).toHaveAttribute("aria-selected", "false");
    expect(blocked).toHaveAttribute("aria-disabled", "true");
  });

  it("announces the blocked reason and what would unblock it, not just greys the row [R3][R7]", () => {
    renderWithProviders(
      <Harness sources={[arbitrumUsdc]} gasByChainId={{ [ARBITRUM]: blockedVerdict(ARBITRUM) }} />,
    );
    const blocked = screen.getByRole("option", { name: /USDC on Arbitrum/ });
    const description = blocked.getAttribute("aria-describedby");
    expect(description).toBeTruthy();
    expect(blocked).toHaveAccessibleDescription(/You have no ETH on Arbitrum/);
    expect(blocked).toHaveAccessibleDescription(/Move a little ETH over from another network/);
    expect(blocked).toHaveAccessibleDescription(/Buy crypto/);
  });

  it("explains a top-up row too, so the extra step is never a surprise [R2]", () => {
    renderWithProviders(
      <Harness sources={[polygonWeth]} gasByChainId={{ [POLYGON]: topUpVerdict(POLYGON) }} />,
    );
    expect(screen.getByRole("option", { name: /WETH on Polygon/ })).toHaveAccessibleDescription(
      /convert a little USDC into POL/,
    );
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
    const cta = screen.getByRole("button", { name: "Continue" });
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
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(screen.getByText("Exactly covered")).toBeInTheDocument();
  });

  it("keeps the CTA shut while nothing is selected, whatever the requirement [R5]", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={0} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("confirms with the selection once covered [R5]", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={600} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("option", { name: /USDC on Base/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
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
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("announces the running total politely as it changes [R7]", () => {
    renderWithProviders(<Harness sources={[baseUsdc]} requiredUsd={1000} />);
    const live = screen.getByText("$1,000.00 still to go").closest("[aria-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
  });
});
