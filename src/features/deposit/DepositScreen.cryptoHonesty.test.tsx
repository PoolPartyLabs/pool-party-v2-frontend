/**
 * @id PP-DEP-SCR-005
 * @name Deposit flow: the crypto wait states its own absence (POO-1624)
 *
 * The crypto path never watched anything. A 2500ms `setTimeout` advanced the screen and a
 * `const CRYPTO_RECEIVED = 100` was printed as the amount that arrived, and NEITHER was gated on
 * `isMockMode`, so a buyer in production was shown a receipt for a deposit nobody measured while the
 * copy told them "We'll detect it automatically. No need to do anything."
 *
 * This suite is the real-mode half of the fix. It pins the three facts that make the screen honest:
 *
 *   1. the wait NEVER resolves itself, so no receipt and no figure exist to be wrong;
 *   2. `deposit_crypto_completed` does not fire, because premise 11 puts a `completed` on SETTLEMENT
 *      and a timer is not a settlement;
 *   3. the buyer is told we cannot confirm it, once, and counted as this screen's blocked intent.
 *
 * The MOCK-mode behaviour (the fixture receipt, the visual harness for `PP-DEP-SCR-006`) is pinned in
 * `DepositScreen.test.tsx`; the two suites together are what "gated on `isMockMode`" means here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../tests/utils/renderWithProviders";

vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));

/**
 * The two on-ramp actions, stubbed to their DEGRADED answer. Nothing in this suite reaches the fiat
 * path, and a degraded quote keeps the amount step synchronous.
 */
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

/**
 * Real mode mounts no `WagmiProvider`, so the balance read must not reach `useAccount()`. Pinned to a
 * wallet that holds gas; nothing here depends on the figure.
 */
vi.mock("@/lib/balances/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: [],
    totalUsd: 0,
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

const INVEST_CONTEXT = {
  strategyId: "s1",
  strategyName: "Stable Yield",
  shortfall: 97.93,
  investAmount: 100,
};

/** Amount step → crypto path → Arbitrum (pre-selected) → "I've sent the funds". */
function reachTheWait() {
  fireEvent.click(screen.getAllByRole("button", { name: "Deposit crypto" })[0] as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "I've sent the funds" }));
}

beforeEach(() => {
  window.dataLayer = [];
  localStorage.clear();
});

describe("DepositScreen crypto wait, real mode (POO-1624)", () => {
  // @rule POO-1624 [R1]: nothing observes the address, so the wait cannot resolve itself. The timer
  // that used to is mock-only now, and its absence is the whole point: a screen that settles on time
  // rather than on money is a false receipt with a delay in front of it.
  it("[R1] never advances to a receipt on its own, however long the buyer waits", () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<DepositScreen investContext={INVEST_CONTEXT} />);
      reachTheWait();
      act(() => {
        // Twenty times the deleted timer. Nothing may appear.
        vi.advanceTimersByTime(50_000);
      });

      expect(screen.queryByRole("heading", { name: "Deposit received" })).toBeNull();
      // The fabricated figure, in both of the shapes the receipt rendered it in.
      expect(screen.queryByText(/97\.93 USDC/)).toBeNull();
      expect(screen.queryByText(/100 USDC/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // @rule POO-1624 [R2]: a `completed` fires on SETTLEMENT (premise 11). With no observation there is
  // no settlement, so the event must not exist for this buyer at all.
  it("[R2] never fires deposit_crypto_completed", () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<DepositScreen investContext={INVEST_CONTEXT} />);
      reachTheWait();
      act(() => {
        vi.advanceTimersByTime(50_000);
      });

      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({ event: "deposit_crypto_started" }),
      );
      expect(window.dataLayer).not.toContainEqual(
        expect.objectContaining({ event: "deposit_crypto_completed" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // @rule POO-1624 [R3]: the copy promises only what the implementation delivers. The deleted line
  // said "We'll detect it automatically. No need to do anything."; neither half was true.
  it("[R3] tells the buyer we cannot confirm it, and never promises automatic detection", () => {
    renderWithProviders(<DepositScreen investContext={INVEST_CONTEXT} />);
    reachTheWait();

    expect(
      screen.getByRole("heading", { name: "Check back in a few minutes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/We cannot confirm transfers sent from another app/),
    ).toBeInTheDocument();
  });

  /**
   * @rule POO-1624 [R3], the half with teeth, asserted against the LOCALE SOURCE.
   *
   * The two DOM negatives that used to close the test above could not fail. `queryByText(/detect it
   * automatically/i)` targeted a string this same change deleted from all 12 locales, and
   * `/leave this page/i` never existed in code at all (it is Figma-only copy). A negative over a
   * string that exists nowhere in the tree asserts nothing, which is the vacuous class the
   * `DepositScreen.test.tsx` follow-up commit had just fixed one file over.
   *
   * The rule this pins is about the COPY, and the copy lives in the locale files, so that is what is
   * read. All 12 rather than `en` alone, deliberately: parity (`pnpm i18n:check`) proves the KEYS
   * match and says nothing about what a value promises, so a promise re-entering a single translated
   * locale is exactly the leak this can catch and the source-only version cannot.
   */
  it("[R3] promises no automatic detection in any locale's crypto wait copy", () => {
    // Detection promises, plus the frame's "you can leave" invitation, which is false for the same
    // reason: nothing survives the navigation.
    const promises = [/detect/i, /automatic/i, /leave this page/i, /we.?ll let you know/i];

    for (const locale of locales) {
      const raw = readFileSync(
        join(process.cwd(), "src/i18n/messages", locale, "deposit.json"),
        "utf8",
      );
      const crypto = (JSON.parse(raw) as { crypto: Record<string, string> }).crypto;
      // Positive first, so a renamed or missing key fails LOUDLY here rather than silently passing
      // every negative below against `undefined`.
      expect(typeof crypto.waitingTitle).toBe("string");
      expect(typeof crypto.waitingBody).toBe("string");

      for (const promise of promises) {
        expect(`${locale} waitingTitle: ${crypto.waitingTitle}`).not.toMatch(promise);
        expect(`${locale} waitingBody: ${crypto.waitingBody}`).not.toMatch(promise);
      }
    }
  });

  // @rule POO-1624 [R4]: the confirm exists to RESUME the investment (POO-604 / POO-605), so the way
  // back to the strategy has to survive losing the fabricated receipt that used to carry it.
  it("[R4] keeps the invest return, with the committed amount", () => {
    renderWithProviders(<DepositScreen investContext={INVEST_CONTEXT} />);
    reachTheWait();

    expect(screen.getByRole("link", { name: "Invest now" })).toHaveAttribute(
      "href",
      "/strategies/s1?invest=100",
    );
  });

  // @rule POO-1624 [R5]: the buyer asked us to confirm a deposit and the product said it cannot. That
  // is this screen's blocked intent (premise 11), and its count is the denominator for whether the
  // real observation is worth building.
  it("[R5] reports the refusal as a blocked intent, exactly once", () => {
    renderWithProviders(<DepositScreen investContext={INVEST_CONTEXT} />);
    reachTheWait();

    const blocked = (window.dataLayer as Record<string, unknown>[]).filter(
      (entry) =>
        entry.event === "tx_amount_blocked" && entry.block_reason === "transfer_unobserved",
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ flow: "deposit" });
  });

  // A flow that ended did not get abandoned. Leaving the screen we just told them to leave must not
  // count as drop-off, or the deposit funnel reports churn on the one path that works by design.
  it("[R5] concludes the flow, so leaving the page is not counted as abandonment", () => {
    const { unmount } = renderWithProviders(<DepositScreen investContext={INVEST_CONTEXT} />);
    reachTheWait();
    unmount();

    expect(window.dataLayer).not.toContainEqual(
      expect.objectContaining({ event: "tx_flow_abandoned" }),
    );
  });
});
