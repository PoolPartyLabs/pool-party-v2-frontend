/**
 * @id PP-DEP-SCR-001
 * @name DepositScreen analytics (POO-1174)
 * @implements-rules-version v2
 *
 * POO-1174 [R1] [R3] [R4] [R5].
 *
 * Two events, and both are in the integrity core rather than nice-to-have.
 *
 * 1. **The abandonment.** Week one reconciles `deposit_completed` count and summed `value` against
 *    Paybis's own dashboard, which is the ONLY independent source this programme ever gets. Without
 *    an abandonment event a missing completion is ambiguous between someone walking away and a
 *    broken emitter, and nothing distinguishes them. This is what turns that one external check
 *    from suggestive into conclusive, and what makes
 *    `deposit_started = completed + failed + abandoned` close.
 *
 * 2. **`deposit_address_copied`, carrying `chain_id` and nothing else.** The address is excluded BY
 *    DERIVATION: it never enters the params object, in any shape, at any point. It is deliberately
 *    NOT handed to `sanitizeParams` to be scrubbed. A scrubber is a net with a mesh size; a value
 *    that never enters the object cannot be missed by one, cannot be caught by a future log of the
 *    params, and cannot reappear when someone adds a field and reorders the object. The test below
 *    asserts the ABSENCE of the address across the whole payload rather than just the shape of it,
 *    because the shape passing is not the property that matters.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_TX_EXITS } from "@/lib/analytics/txFlowKit";
import {
  fireEvent,
  renderWithProviders,
  screen,
  within,
} from "../../../tests/utils/renderWithProviders";
import { DepositScreen } from "./DepositScreen";

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

const auth = { address: "" as string | undefined, isLoading: false };
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: auth.address, isLoading: auth.isLoading }),
}));

/** The connected (checksummed) address the crypto path shows and copies. */
const ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

function events(name: string) {
  return (window.dataLayer ?? []).filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && "event" in entry && entry.event === name,
  );
}

beforeEach(() => {
  window.dataLayer = [];
  auth.address = ADDRESS;
  auth.isLoading = false;
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

/** Enter the crypto path and confirm the pre-selected network (Arbitrum). */
function openCryptoAndPick(name: string) {
  fireEvent.click(screen.getAllByRole("button", { name: "Deposit crypto" })[0] as HTMLElement);
  fireEvent.click(screen.getByRole("radio", { name }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("DepositScreen analytics, address copied (POO-1174 [R5])", () => {
  it("emits deposit_address_copied once the clipboard write resolves", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Arbitrum");
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    await vi.waitFor(() => {
      expect(events("deposit_address_copied")).toHaveLength(1);
    });
  });

  it("carries the chain_id of the network the user PICKED", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Arbitrum");
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    await vi.waitFor(() => {
      expect(events("deposit_address_copied")[0]).toMatchObject({ chain_id: 42161 });
    });
  });

  /**
   * Rules v2: the chain id resolves through the deposit-local `DEPOSIT_CHAIN_IDS`, not the app
   * chain config. `DEPOSIT_NETWORKS` offers Ethereum while `networkToChainId` is built from the
   * three operating chains, so a mainnet pick used to resolve `undefined` and the event shipped
   * with no `chain_id` at all: exactly the pick most likely to precede a loss-of-funds report,
   * invisible in GA4.
   */
  it("carries chain_id 1 for an Ethereum pick, which the app chain config cannot resolve", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Ethereum");
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    await vi.waitFor(() => {
      expect(events("deposit_address_copied")[0]).toMatchObject({ chain_id: 1 });
    });
  });

  /**
   * The rule that matters. Asserted against the SERIALISED payload, not against named fields: a
   * test that only checked `payload.address` would pass against a leak under any other key, and the
   * property being defended is that the value is nowhere at all.
   */
  it("never puts the wallet address anywhere in the payload", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Arbitrum");
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    await vi.waitFor(() => {
      expect(events("deposit_address_copied")).toHaveLength(1);
    });
    const payload = JSON.stringify(events("deposit_address_copied")[0]);
    expect(payload).not.toContain(ADDRESS);
    expect(payload).not.toContain(ADDRESS.toLowerCase());
    // Nothing shaped like a wallet address, under any key, ever.
    expect(payload).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("does NOT emit when the clipboard write is refused", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Arbitrum");
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(events("deposit_address_copied")).toHaveLength(0);
  });

  /**
   * Rules v2: `navigator.clipboard` itself is absent in insecure contexts and some in-app
   * browsers/WebViews. The earlier `Promise.resolve(clipboard?.writeText(...))` shape resolved
   * with `undefined` there, so the event fired although nothing was copied, the exact miscount
   * [R5]'s "a copy the browser refused is not a copy" exists to forbid. No API, no write, no
   * event; the optimistic "Copied" UI is a separate concern and stays.
   */
  it("does NOT emit when the Clipboard API is absent entirely", async () => {
    Object.assign(navigator, { clipboard: undefined });
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Arbitrum");
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(events("deposit_address_copied")).toHaveLength(0);
  });
});

describe("DepositScreen analytics, abandonment (POO-1174 [R1] [R3])", () => {
  // [R1] No `deposit_abandoned` name: the taxonomy already chose the cross-flow event plus a
  // discriminator, and `"deposit"` is already a member of AnalyticsFlow.
  it("emits tx_flow_abandoned with flow deposit when the user leaves the amount step", () => {
    const { unmount } = renderWithProviders(<DepositScreen investContext={null} />);
    unmount();
    expect(events("tx_flow_abandoned")).toHaveLength(1);
    expect(events("tx_flow_abandoned")[0]).toMatchObject({
      flow: "deposit",
      tx_exit: "amount",
    });
  });

  /**
   * [R2] `onramp` is a NEW member of ANALYTICS_TX_EXITS, added by this lane. Neither `pending` nor
   * `provision` describes a user sitting inside the Paybis widget, and this is the fiat funnel's
   * most valuable exit: it is the one the Paybis reconciliation has to be able to see.
   */
  it("has onramp as a real exit value, distinct from pending and provision", () => {
    // Asserted against the union rather than by driving the widget open, because the guarantee
    // [R2] makes is about the vocabulary: that this exit EXISTS and is not a synonym for either of
    // the two values it would otherwise have been folded into. Driving the third-party on-ramp UI
    // would test the fixture, not the rule.
    expect(ANALYTICS_TX_EXITS).toContain("onramp");
    expect(ANALYTICS_TX_EXITS).toContain("pending");
    expect(ANALYTICS_TX_EXITS).toContain("provision");
  });

  // [R4] A flow that failed or completed did not get abandoned, it got answered. Without this the
  // funnel arithmetic `started = completed + failed + abandoned` stops closing.
  //
  // Driven through the MOCK fiat path deliberately, because it is the one terminal path that needs
  // no timers: the amount step prefills $100, Continue opens the method dialog, the dialog's
  // Continue lands on review, and in mock mode Confirm runs `confirmFiat` -> `completeFiat`
  // SYNCHRONOUSLY (no widget, no settlement wait). An earlier shape of this test rendered with
  // `investContext={null}` and reached for the crypto path's "I've sent the funds" confirm, which
  // only exists UNDER an invest context; its completion then sat behind a 2.5s timer that unmount
  // clears, and its only assertion hid behind `if (concluded)`, so it passed vacuously regardless
  // of behaviour.
  it("does NOT report an abandonment after the flow concluded", () => {
    const { unmount } = renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & pay/i }));
    unmount();
    // Unconditional: the flow concluded before the unmount, so the completion fired exactly once
    // and no abandonment may accompany it in the same session.
    expect(events("deposit_completed")).toHaveLength(1);
    expect(events("tx_flow_abandoned")).toHaveLength(0);
  });
});
