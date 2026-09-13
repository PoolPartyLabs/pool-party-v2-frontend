/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow — the in-flight purchase question (POO-1642)
 * @implements-rules-version v11 (POO-1642 rules v1)
 *
 * POO-1384 built `confirmResume` so an in-flight purchase intent that has aged out with no observed
 * payment asks the BUYER rather than deciding silently. `ProvisioningPanel` passed it. `/deposit`
 * did not, and `useProvisioningRail` states the consequence in its own comment: absent a
 * `confirmResume` the mint "falls through to minting, which is exactly the pre-POO-1384 behavior".
 *
 * Both journeys in the production report are reachable from that one missing prop:
 *
 *   - **paid and not arrived**: the app reopens the vendor widget on its completed screen and the
 *     buyer cannot leave it;
 *   - **not paid and expired**: a NEW request is minted silently, and if the first is still in
 *     flight the card is charged twice.
 *
 * The rail is stubbed here (its own suite drives the flow); this pins what the screen does with the
 * question: which one it asks, how it looks, what each answer resolves to, that the promise settles
 * on EVERY exit including the teardown, and that the interception is reported as blocked intent.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfirmResumePurchase } from "@/features/strategies/hooks/useProvisioningRail";
import { toTxError } from "@/lib/tx/diagnostics";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  within,
} from "../../../tests/utils/renderWithProviders";

vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isFeatureEnabled: () => true,
}));
/**
 * This suite is about the PAYBIS rail, so it pins the rail rather than the flags behind it.
 *
 * POO-1807 review N1: `realRail` used to read `isFeatureEnabled("fiatOnRamp")`, which the mock above
 * answers, and now comes from `useOnRampProvider()` so a Dev-menu override cannot move one gate
 * while the other answers for the env. That hook reads `useFeatureFlags`, not `isFeatureEnabled`,
 * and both on-ramp flags ship off, so without this line the screen resolves `none` and mounts no
 * rail at all. Naming the rail is also what these tests actually mean.
 */
vi.mock("@/lib/onramp/useOnRampProvider", () => ({ useOnRampProvider: () => "paybis" }));

// Stubbed to their DEGRADED answer, exactly as the sibling rail suite does: this file is about the
// question, and "the provider returned nothing" is the one configuration with no method label at
// all, which keeps every assertion here synchronous.
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

vi.mock("@/lib/balances/balanceRefresh", () => ({ requestBalanceRefresh: vi.fn() }));

// A wallet that already holds gas, so the hand-off under test is the ordinary USDC-direct one and
// the read never reaches `useAccount()` (this suite runs in real mode and mounts no WagmiProvider).
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

/**
 * The rail stub captures the prop this whole issue is about. Capturing it is itself an assertion:
 * before POO-1642 the screen rendered `StandaloneOnRampRail` with no `confirmResume` at all, so
 * `railProps.confirmResume` was `undefined` and the mint decided silently.
 */
const railProps = vi.hoisted(
  () => ({}) as { confirmResume?: ConfirmResumePurchase; receiveUsd?: number },
);
vi.mock("./components/StandaloneOnRampRail", () => ({
  StandaloneOnRampRail: (props: { confirmResume?: ConfirmResumePurchase; receiveUsd: number }) => {
    railProps.confirmResume = props.confirmResume;
    railProps.receiveUsd = props.receiveUsd;
    return <div data-testid="standalone-onramp-rail">rail</div>;
  },
}));

import { DepositScreen } from "./DepositScreen";

/** The real values from the 2026-08-06 production report (Paybis invoice `PB26086511232TX9`). */
const REQUEST_ID = "19fd7802-cdb0-80b6-b36e-76befd2ee33f";

/** Amount → method → review → confirm, landing on the rail hand-off. */
function reachRail() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm & pay" }));
}

/** Mount, reach the rail, and ask the screen the question the rail's mint would ask. */
function ask(intent: { paid: boolean; minutesAgo?: number }) {
  const rendered = renderWithProviders(<DepositScreen investContext={null} />);
  reachRail();
  const confirmResume = railProps.confirmResume;
  if (!confirmResume) throw new Error("the screen handed the rail no confirmResume");
  let decision!: Promise<"resume" | "new">;
  act(() => {
    decision = confirmResume({
      requestId: REQUEST_ID,
      startedAt: Date.now() - (intent.minutesAgo ?? 20) * 60_000,
      paid: intent.paid,
    });
  });
  // Nothing in this suite lets a rejection escape: [R8] rejects on teardown, and an unobserved
  // rejection would fail an unrelated test in this file.
  decision.catch(() => {});
  return { ...rendered, decision };
}

beforeEach(() => {
  window.dataLayer = [];
  // The on-ramp journal is real localStorage: a record left by one test must not be quoted by the next.
  localStorage.clear();
  railProps.confirmResume = undefined;
  railProps.receiveUsd = undefined;
});

describe("DepositScreen — the in-flight purchase question (POO-1642)", () => {
  // @rule R2: the screen hands the rail a question to ask. Without this prop the mint falls through
  // to minting, which is the double charge.
  it("hands the rail a confirmResume", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    expect(screen.getByTestId("standalone-onramp-rail")).toBeInTheDocument();
    expect(railProps.confirmResume).toBeTypeOf("function");
  });

  /**
   * @rule R4 — journey 2, the double charge. An intent that aged out with no observed payment: we do
   * not know whether money moved, so the buyer is asked instead of a second purchase being minted.
   */
  it("[R4] asks about an unverified purchase, and resumes it when the buyer says so", async () => {
    const { decision } = ask({ paid: false });

    const prompt = screen.getByRole("alertdialog");
    expect(within(prompt).getByText("You may have a purchase in progress")).toBeInTheDocument();
    fireEvent.click(within(prompt).getByRole("button", { name: "Resume that purchase" }));

    await expect(decision).resolves.toBe("resume");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  // @rule R4: "Start a new purchase" is the deliberate discard, and it is the ONLY way this screen
  // mints beside an intent it cannot verify.
  it("[R4] starts a new purchase when the buyer disowns the old one", async () => {
    const { decision } = ask({ paid: false });
    fireEvent.click(screen.getByRole("button", { name: "Start a new purchase" }));
    await expect(decision).resolves.toBe("new");
  });

  /**
   * @rule R3 — journey 1, the dead end. A PAID intent must never reopen the widget: "every time he
   * opens any on-ramp modal it resumes in that transaction-complete screen and he can't go
   * anywhere". So the question is a different question, and its resume answer means KEEP WAITING.
   */
  it("[R3] asks a paid purchase differently, and keeping waiting resolves to resume", async () => {
    const { decision } = ask({ paid: true });

    const prompt = screen.getByRole("alertdialog");
    expect(within(prompt).getByText("Your purchase is still landing")).toBeInTheDocument();
    expect(within(prompt).queryByRole("button", { name: "Resume that purchase" })).toBeNull();
    fireEvent.click(within(prompt).getByRole("button", { name: "Keep waiting" }));

    await expect(decision).resolves.toBe("resume");
  });

  // @rule R7: a real dialog, not a `window.confirm`. Labelled by its title, described by its body,
  // and focused when it opens, so a screen reader announces the question rather than the buyer
  // discovering it. PP-A11Y.
  it("[R7] renders an accessible alertdialog and moves focus to it", () => {
    ask({ paid: false });

    const prompt = screen.getByRole("alertdialog");
    expect(prompt).toHaveFocus();
    const titleId = prompt.getAttribute("aria-labelledby");
    const bodyId = prompt.getAttribute("aria-describedby");
    expect(titleId).toBeTruthy();
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(titleId ?? "")).toHaveTextContent(
      "You may have a purchase in progress",
    );
    expect(document.getElementById(bodyId ?? "")).toHaveTextContent("20 minutes ago");
  });

  /**
   * @rule R8 — a promise that never resolves is a hang, and the teardown is the one exit no button
   * covers.
   *
   * Rejecting rather than resolving is the whole point: resolving `"new"` with nobody left watching
   * would mint the second purchase this issue exists to prevent, and resolving `"resume"` would
   * reopen a checkout onto an unmounted screen.
   */
  it("[R8] rejects the pending question when the screen unmounts", async () => {
    const { decision, unmount } = ask({ paid: false });
    unmount();
    // Asserted THROUGH `toTxError`, the same lens `useWalletSignFlow` reads a rejected step with, so
    // this pins that the flow ends legibly rather than merely that some object was thrown.
    await expect(decision.catch((error) => toTxError(error).code)).resolves.toBe(
      "ONRAMP_ABANDONED",
    );
  });

  // @rule R8: the resolver is cleared with the state that renders it, so a second press cannot
  // settle the same promise twice or leave a dialog behind.
  it("[R8] settles exactly once, and clears the question with the answer", async () => {
    const { decision } = ask({ paid: false });
    const startNew = screen.getByRole("button", { name: "Start a new purchase" });
    fireEvent.click(startNew);
    fireEvent.click(startNew);
    await expect(decision).resolves.toBe("new");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  /**
   * @rule R9 — premise 11's blocked intent. The buyer pressed Confirm & pay and the product did not
   * proceed: it interrupted with a question only they can answer. A disabled CTA generates no click,
   * no error and no event, and this interception would be the same silence.
   */
  it("[R9] reports the unverified interception as blocked intent, once", async () => {
    const { decision } = ask({ paid: false });

    const blocked = (window.dataLayer ?? []).filter(
      (entry) => (entry as { event?: string }).event === "tx_amount_blocked",
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({
      flow: "deposit",
      block_reason: "purchase_unverified",
    });

    // The two answers are two answers to ONE blocked attempt, so neither gets an event of its own.
    fireEvent.click(screen.getByRole("button", { name: "Start a new purchase" }));
    await expect(decision).resolves.toBe("new");
    expect(
      (window.dataLayer ?? []).filter(
        (entry) => (entry as { event?: string }).event === "tx_amount_blocked",
      ),
    ).toHaveLength(1);
  });

  // @rule R9: the two journeys are separated by their reason, because they point at opposite fixes.
  // A paid-but-unsettled intent means our settlement observer missed a delta; an unverified one
  // means the intent aged out and only the buyer knows whether they paid.
  it("[R9] names the paid journey with its own reason", () => {
    ask({ paid: true });
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "tx_amount_blocked",
        flow: "deposit",
        block_reason: "purchase_paid_unsettled",
      }),
    );
  });
});
