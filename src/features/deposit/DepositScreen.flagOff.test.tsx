/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow — fiat confirm refuses when the on-ramp flag is dark (POO-1794)
 * @implements-rules-version v1 (POO-1794)
 * @analytics-events deposit_submitted, tx_amount_blocked
 *
 * Before POO-1794 `confirmFiat` collapsed two worlds into one `if (!realRail)` branch: mock mode,
 * where a printed receipt is honest, and REAL mode with the `fiatOnRamp` flag DARK, where a
 * production buyer was shown a "Deposit confirmed" receipt and a `deposit_completed` carrying
 * `value: amount` for a purchase that never happened. The on-ramp was not launched, so no provider
 * ever charged and no settlement ever landed, yet the screen claimed a completion.
 *
 * This suite pins the real + flag-off half of the split. Mock mode is byte-identical and is pinned
 * by the UNTOUCHED `DepositScreen.test.tsx` (the amount -> method -> review -> success walk) and
 * `DepositScreen.analytics.test.tsx` (the conclude-not-abandon walk), so [R3] is verified by those
 * two suites staying green rather than re-tested here: this file mocks `isMockMode: false` at module
 * scope and so cannot also exercise mock mode in the same file.
 *
 * Harness copied from `DepositScreen.realOnRamp.test.tsx`, with `isFeatureEnabled` flipped to
 * `false` so that `realRail` (`!isMockMode && isFeatureEnabled("fiatOnRamp")`) is false in REAL mode.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  within,
} from "../../../tests/utils/renderWithProviders";

// The two axes the bug conflated (CLAUDE.md premise 10: mock-vs-real is `isMockMode`; launched-or-not
// is the feature flag). Real mode, flag DARK: the exact production configuration that fabricated a
// receipt.
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isFeatureEnabled: () => false,
}));

// With `realRail` false the live buy-route hooks are disabled, so these are never called; stubbed to
// their degraded answer regardless, so nothing reaches a real server action while the module loads.
vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: vi.fn(async () => ({
    ok: false,
    code: "NOT_FOUND",
    message: "no pair",
  })),
  getOnRampQuoteAction: vi.fn(async () => ({
    ok: false,
    code: "NOT_FOUND",
    message: "no pair",
  })),
}));

// `deposit_completed`'s side effect. Asserting it is NEVER called is part of [R1]: no completion
// means no balance refresh either.
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/balances/balanceRefresh", () => ({ requestBalanceRefresh: refresh }));

// The screen reads the balance to size the pair; pin a wallet with gas so nothing reaches
// `useAccount()` (this suite mounts no WagmiProvider). The answer is irrelevant here: the confirm
// refuses before any pair is sized.
vi.mock("@/lib/balances/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: [
      {
        symbol: "ETH",
        name: "Ethereum",
        amount: 1,
        amountExact: "1",
        decimals: 18,
        usd: 2500,
        chainId: 8453,
        logoUrl: "",
        isNative: true,
        address: "0x0000000000000000000000000000000000000000",
      },
    ],
    totalUsd: 2500,
    dayChangeUsd: 0,
    dayChangePct: 0,
    isLoading: false,
    isRefreshing: false,
    refresh: vi.fn(),
  }),
}));

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

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as `0x${string}`,
    isLoading: false,
  }),
}));

import { DepositScreen } from "./DepositScreen";

function events(name: string) {
  return (window.dataLayer ?? []).filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && "event" in entry && entry.event === name,
  );
}

/** Amount -> method dialog -> review -> press Confirm (the money CTA that must now refuse). The
 * amount step prefills $100, so Continue opens the method dialog (JSDOM is never `isDesktop`), the
 * dialog's own Continue lands on review, and with no method list the confirm reads its generic
 * label. Identical walk to the mock-mode suite and to `realOnRamp`'s `reachRail`. */
function pressConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm & pay" }));
}

beforeEach(() => {
  window.dataLayer = [];
  refresh.mockClear();
});

describe("DepositScreen fiat confirm — real mode, fiatOnRamp dark (POO-1794)", () => {
  // @rule R1: the confirm refuses; it NEVER prints the receipt and NEVER claims a settlement.
  it("does not show the success receipt and does not emit deposit_completed", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    pressConfirm();

    // Not silence (premise 11 / AC4): the buyer is told the purchase did not happen.
    expect(screen.getByRole("heading", { name: "Purchase not completed" })).toBeInTheDocument();
    // The fabricated receipt is gone.
    expect(screen.queryByRole("heading", { name: "Deposit confirmed" })).not.toBeInTheDocument();
    expect(events("deposit_completed")).toHaveLength(0);
    // `deposit_completed`'s side effect never runs either.
    expect(refresh).not.toHaveBeenCalled();
  });

  // @rule R2: the refusal is COUNTED as a blocked intent and CONCLUDED, so the funnel identity
  // `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled` closes with
  // no phantom abandonment.
  it("emits exactly one tx_amount_blocked and reports no abandonment after unmount", () => {
    const { unmount } = renderWithProviders(<DepositScreen investContext={null} />);
    pressConfirm();

    // The submit still fires (the buyer did press confirm); the split only changed what follows it.
    expect(events("deposit_submitted")).toHaveLength(1);

    const blocked = events("tx_amount_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ flow: "deposit", block_reason: "onramp_disabled" });

    unmount();
    // conclude() ran, so the terminal refusal is not double-counted as a walk-away (mirrors
    // DepositScreen.analytics.test.tsx:201-209).
    expect(events("tx_flow_abandoned")).toHaveLength(0);
  });
});
