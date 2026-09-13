/** @id PP-CP-CMP-002 @name Cash+ amount form tests @implements-rules-version v1 */
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en/cashPlus.json";
import type { CashPlusController } from "@/lib/cash-plus/types";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { CashPlusInvestPanel } from "./CashPlusInvestPanel";

function controller(overrides: Partial<CashPlusController> = {}): CashPlusController {
  return {
    snapshot: {
      capacityAssets: BigInt("40000000"),
      minimumDepositAssets: BigInt("1000000"),
      depositsPaused: false,
      oracleHealthy: true,
      accountShares: BigInt("0"),
    } as CashPlusController["snapshot"],
    status: "ready",
    wallet: { connected: true, correctChain: true, balanceAssets: BigInt("12500123") },
    transaction: { phase: "idle", kind: "deposit" },
    review: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn(),
    resetTransaction: vi.fn(),
    refresh: vi.fn(),
    connect: vi.fn(),
    switchNetwork: vi.fn(),
    ...overrides,
  };
}

describe("CashPlusInvestPanel", () => {
  // @rule CP-TX03: a failed balance read never substitutes capacity for Max.
  it("disables Max when the wallet balance read is unavailable", () => {
    renderWithProviders(
      <CashPlusInvestPanel
        controller={controller({
          wallet: { connected: true, correctChain: true, balanceAssets: null },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
  });

  // @rule CP-TX04: reject malformed/over-precise amounts before the review boundary.
  it.each([
    "1e2",
    "0.0000001",
    "0",
    "-2",
    "99",
  ])("does not review an invalid or over-balance amount: %s", async (value) => {
    const user = userEvent.setup();
    const c = controller();
    renderWithProviders(<CashPlusInvestPanel controller={c} />);
    await user.type(screen.getByLabelText("Amount in USDC"), value);
    await user.click(screen.getByRole("button", { name: "Review investment" }));
    expect(c.review).not.toHaveBeenCalled();
  });

  // @rule CP-TX01: Max preserves full token precision and the reviewed exact amount.
  it("fills the exact spendable balance and reviews the same amount", async () => {
    const user = userEvent.setup();
    const c = controller();
    renderWithProviders(<CashPlusInvestPanel controller={c} />);
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByLabelText("Amount in USDC")).toHaveValue("12.500123");
    await user.click(screen.getByRole("button", { name: "Review investment" }));
    expect(c.review).toHaveBeenCalledWith("deposit", "12.500123");
  });

  // @rule CP-UI13: locale decimals cross the signing boundary as canonical strings.
  it("accepts a Portuguese decimal comma without changing the signed quantity", async () => {
    const user = userEvent.setup();
    const c = controller();
    renderWithProviders(
      <NextIntlClientProvider locale="pt-BR" messages={{ cashPlus: messages }}>
        <CashPlusInvestPanel controller={c} />
      </NextIntlClientProvider>,
    );
    await user.type(screen.getByLabelText("Amount in USDC"), "12,50");
    await user.click(screen.getByRole("button", { name: "Review investment" }));
    expect(c.review).toHaveBeenCalledWith("deposit", "12.50");
  });
});
