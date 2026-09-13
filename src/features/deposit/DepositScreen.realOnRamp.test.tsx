/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow — real on-ramp rail wiring (POO-1137)
 *
 * In real mode with `fiatOnRamp` on, the fiat confirm hands off to {@link StandaloneOnRampRail} instead
 * of the mocked direct success, and `deposit_completed` + the balance refresh fire on the CONFIRMED
 * settlement, never at submit. The rail itself is stubbed (its orchestration has its own suite); this
 * pins DepositScreen's wiring, and in particular the three things a failure has to get right:
 *
 *   - a PRE-settlement failure says nothing moved and returns to review (the mint then resumes the
 *     journaled id, [R7]);
 *   - a POST-settlement failure says the purchase settled and Try again RESUMES the rail's failed step,
 *     because re-entering from review would mint a second purchase against the same deposit;
 *   - the success receipt and `deposit_completed` quote the OBSERVED delta ([R4]), never the
 *     pre-purchase estimate the user can change inside the Paybis widget.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * POO-1513: the picker's two server actions, stubbed to their DEGRADED answer. This suite is about the
 * rail hand-off, and the "provider returned nothing" path is the one configuration in which the screen
 * has no method label at all, so it keeps every assertion here synchronous while still exercising the
 * real `useBuyRouteQuote`. The choice's own wiring is pinned in `DepositScreen.methods.test.tsx`.
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

const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/balances/balanceRefresh", () => ({ requestBalanceRefresh: refresh }));

/**
 * POO-1513 X1: the screen reads the balance to know which pair the purchase is minted on. Nothing in
 * this suite depends on the answer (both actions above are stubbed to their degraded reply, so there
 * is no figure either way), but the read must not reach `useAccount()`: this suite runs in real mode
 * and mounts no `WagmiProvider`. Pinned to a wallet that has gas, so the hand-off under test is the
 * ordinary USDC-direct one.
 */
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

// The rail stub captures the terminal callbacks so the wiring is deterministic, and exposes the retry
// handle a POST-settlement failure carries: whether the host calls THAT or re-enters from review is
// the difference between finishing one deposit and charging the card twice.
const railCallbacks = vi.hoisted(
  () =>
    ({ retry: vi.fn<() => void>() }) as {
      retry: Mock<() => void>;
      onSettled?: (
        settlement: { deltas: []; settledUsd: number; receivedUsdc: number } | null,
      ) => void;
      onSettling?: () => void;
      onFailed?: (failure: {
        error: { code?: string; message: string };
        settled: boolean;
        /** POO-1403 [R1]: the id THIS session minted, absent when it never got that far. */
        paybisRequestId?: string;
        retry: () => void;
      }) => void;
    },
);
vi.mock("./components/StandaloneOnRampRail", () => ({
  StandaloneOnRampRail: (props: {
    onSettled: (settlement: unknown) => void;
    onSettling: () => void;
    onFailed: (failure: unknown) => void;
  }) => {
    railCallbacks.onSettled = props.onSettled as never;
    railCallbacks.onSettling = props.onSettling;
    railCallbacks.onFailed = props.onFailed as never;
    return <div data-testid="standalone-onramp-rail">rail</div>;
  },
}));

import { recordOnRampRequest } from "@/lib/onramp/onRampJournal";
// POO-1573 [R5] v2: the code a refused mint carries, which routes back to review rather than to the
// failure screen. Imported rather than spelled out, so a rename cannot leave this suite passing.
import { ONRAMP_ETH_UNPRICED_CODE } from "@/lib/onramp/schemas";
import { DepositScreen } from "./DepositScreen";

/** POO-1403: the real values from the 2026-08-06 report (Paybis invoice `PB26086511232TX9`). */
const PAYBIS_REQUEST_ID = "19fd7802-cdb0-80b6-b36e-76befd2ee33f";
const WALLET = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

/** Amount → method → review → confirm, landing on the rail hand-off. */
function reachRail() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm & pay" }));
}

/** A settled purchase: $97.40 landed, of which 94.55 USDC is the deposit (the rest stays as gas). */
const SETTLEMENT = { deltas: [] as [], settledUsd: 97.4, receivedUsdc: 94.55 };

beforeEach(() => {
  window.dataLayer = [];
  // The on-ramp journal is real localStorage: a record left by one test must not be quoted by the next.
  localStorage.clear();
  refresh.mockClear();
  railCallbacks.retry = vi.fn<() => void>();
  railCallbacks.onSettled = undefined;
  railCallbacks.onSettling = undefined;
  railCallbacks.onFailed = undefined;
});

describe("DepositScreen fiat confirm — real rail (POO-1137)", () => {
  // @rule R5: the confirm hands off to the rail; deposit_completed + refresh fire on the CONFIRMED
  // settlement, not at submit.
  it("hands off to the rail and completes only on settlement", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();

    // The rail is mounted, and nothing has completed yet.
    expect(screen.getByTestId("standalone-onramp-rail")).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_submitted" }),
    );
    expect(window.dataLayer).not.toContainEqual(
      expect.objectContaining({ event: "deposit_completed" }),
    );
    expect(refresh).not.toHaveBeenCalled();

    // The rail reports the confirmed settlement.
    act(() => railCallbacks.onSettled?.(SETTLEMENT));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_completed" }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // @rule R4: the receipt and the completion event quote what the purchase DELIVERED, never the
  // entered $100 / 100.00 USDC estimate, neither of which happened.
  it("shows the settled delta on the receipt and in deposit_completed, not the estimate", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() => railCallbacks.onSettled?.(SETTLEMENT));

    expect(screen.getByText("$97.40")).toBeInTheDocument();
    expect(screen.getByText("94.55 USDC")).toBeInTheDocument();
    // Neither the entered $100 nor the deleted fee model's $102.50 (POO-1513 S3) may be quoted back.
    expect(screen.queryByText("$102.50")).not.toBeInTheDocument();
    expect(screen.queryByText("$100.00")).not.toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_completed", value: 97.4 }),
    );
  });

  // A PRE-settlement failure moved no money: the copy says so and Try again returns to review, from
  // where the confirm re-enters the rail ([R7] resumes the journaled id).
  it("shows the nothing-moved error and returns to review on a pre-settlement failure", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() =>
      railCallbacks.onFailed?.({
        error: { code: "ONRAMP_CLOSED", message: "closed" },
        settled: false,
        retry: railCallbacks.retry,
      }),
    );

    expect(screen.getByRole("heading", { name: "Purchase not completed" })).toBeInTheDocument();
    expect(screen.getByText(/no money was moved/)).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_failed", error_code: "ONRAMP_CLOSED" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("You'll receive")).toBeInTheDocument();
    expect(railCallbacks.retry).not.toHaveBeenCalled();
  });

  /**
   * @rule POO-1573 [R5] (rules v2): a purchase that never STARTED keeps the buyer on review.
   *
   * The mint refuses an `ETH-BASE` order whose ETH target could not be priced, before the request id
   * exists and before the widget mounts. Rules v1 fell back to a spend-fixed USD charge instead, which
   * re-fetches the method list in dollars, drops the SEPA the buyer had just chosen, and opens the
   * checkout on a card: the live report this cluster exists to close.
   *
   * So the failure screen is wrong here twice: nothing "did not go through", and its Try again walks
   * back to this exact screen anyway. The buyer stays on review, with the amount and method still on
   * screen, and one sentence saying what to do.
   */
  it("[POO-1573 R5] keeps the buyer on review when the mint could not price ETH", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() =>
      railCallbacks.onFailed?.({
        error: { code: ONRAMP_ETH_UNPRICED_CODE, message: "Could not price ETH for this purchase" },
        settled: false,
        retry: railCallbacks.retry,
      }),
    );

    // On review, not on the failure screen, and told why.
    expect(screen.getByText("You'll receive")).toBeInTheDocument();
    expect(
      screen.getByText(/We couldn't start your purchase because we couldn't get an ETH price/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Purchase not completed" }),
    ).not.toBeInTheDocument();
    // Still counted: the buyer wanted to buy and the product said no.
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_failed", error_code: ONRAMP_ETH_UNPRICED_CODE }),
    );
    // Retrying is the Confirm button that is already on screen; the rail's own handle is untouched
    // because there is no failed step to resume (nothing ran).
    expect(railCallbacks.retry).not.toHaveBeenCalled();

    // ...and the retry clears the line rather than leaving a stale warning over a fresh attempt.
    // Unnamed, like `reachRail()` above: POO-1513 deleted the hardcoded Pix default, so the confirm
    // takes the GENERIC label whenever the method list degraded, which is this suite's fixture.
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay" }));
    expect(
      screen.queryByText(/We couldn't start your purchase because we couldn't get an ETH price/),
    ).not.toBeInTheDocument();
  });

  /**
   * @rule POO-1573 [R5] (rules v2), SCOPE: every other pre-settlement failure is untouched.
   *
   * The branch above is keyed on one code. A failure that HAPPENED (a declined card, a closed
   * checkout) still gets the failure screen, because for those "the purchase did not go through" is
   * the true sentence and the retry semantics differ.
   */
  it("[POO-1573 R5] still shows the failure screen for a purchase that did start", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() =>
      railCallbacks.onFailed?.({
        error: { code: "ONRAMP_REJECTED", message: "declined" },
        settled: false,
        retry: railCallbacks.retry,
      }),
    );

    expect(screen.getByRole("heading", { name: "Purchase not completed" })).toBeInTheDocument();
    expect(
      screen.queryByText(/We couldn't start your purchase because we couldn't get an ETH price/),
    ).not.toBeInTheDocument();
  });

  /**
   * @rule POO-1173 D1 R2 — the most common failure on this screen must not arrive blank.
   *
   * The conversion leg asks for a signature, the user declines, and the provider answers `4001`.
   * `toTxError` stringifies that, so the rail hands over `code: "4001"`; the old emitter forwarded it
   * verbatim, `sanitizeParams` refused the digits by shape, and `deposit_failed` reached GA4 with NO
   * `error_code` at all. The event carrying the charge is the one that most needs to say why.
   */
  it("[POO-1173 R2] reports a declined conversion signature as USER_REJECTED, not as digits", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() =>
      railCallbacks.onFailed?.({
        error: { code: "4001", message: "User rejected the request." },
        settled: true,
        retry: railCallbacks.retry,
      }),
    );

    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_failed", error_code: "USER_REJECTED" }),
    );
    expect(JSON.stringify(window.dataLayer)).not.toContain('"4001"');
  });

  // The blocking defect. The card WAS charged and the funds landed as ETH on Base, so "no money was
  // moved" would be a lie, and Try again must resume the rail's failed step instead of re-entering the
  // purchase: the rail stays mounted throughout precisely so that handle stays live.
  it("says the purchase settled and resumes the rail on a post-settlement failure", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() =>
      railCallbacks.onFailed?.({
        error: { code: "USER_REJECTED", message: "rejected" },
        settled: true,
        retry: railCallbacks.retry,
      }),
    );

    expect(screen.getByRole("heading", { name: "Your purchase went through" })).toBeInTheDocument();
    expect(screen.getByText(/resting as ETH on Base/)).toBeInTheDocument();
    expect(screen.queryByText(/no money was moved/)).not.toBeInTheDocument();
    // The rail is still mounted behind the error screen, which is what keeps `retry` usable.
    expect(screen.getByTestId("standalone-onramp-rail")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(railCallbacks.retry).toHaveBeenCalledTimes(1);
    // Never back to review: that is the path that mints a second purchase.
    expect(screen.queryByText("You'll receive")).not.toBeInTheDocument();
    expect(screen.getByTestId("standalone-onramp-rail")).toBeInTheDocument();
  });

  /**
   * @rule POO-1403 R1 — `/deposit` is an on-ramp surface by construction: every failure it shows is a
   * fiat purchase's. Our `Reference` finds our trace and Paybis has never heard of it, so the vendor's
   * own `requestId` sits beside it, labelled, on the one screen where the user will contact support.
   *
   * Asserted on a POST-settlement failure on purpose: that is the case where the card WAS charged, so
   * "was this person charged" is a question only Paybis' record answers.
   */
  it("[POO-1403 R1] shows the Paybis ref beside our reference on the failure screen", () => {
    // An older, unrelated purchase sits in the journal and must NOT be what is shown: the rail
    // carries the id it actually minted for this attempt.
    recordOnRampRequest({ requestId: "req-from-an-older-purchase", wallet: WALLET });
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() =>
      railCallbacks.onFailed?.({
        error: { code: "USER_REJECTED", message: "rejected" },
        settled: true,
        paybisRequestId: PAYBIS_REQUEST_ID,
        retry: railCallbacks.retry,
      }),
    );

    expect(screen.getByText("Paybis ref")).toBeInTheDocument();
    expect(screen.getByText(PAYBIS_REQUEST_ID)).toBeInTheDocument();
    expect(screen.queryByText("req-from-an-older-purchase")).not.toBeInTheDocument();
  });

  /**
   * @rule POO-1403 R1 — an attempt that minted nothing shows nothing, even with an older purchase in
   * the journal. The first revision read the journal and would have printed that older, probably
   * settled, purchase's id, telling support the user was charged when this attempt never created one.
   */
  it("[POO-1403 R1] renders no Paybis row when this attempt minted nothing", () => {
    recordOnRampRequest({ requestId: "req-from-an-older-purchase", wallet: WALLET });
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() =>
      railCallbacks.onFailed?.({
        error: { code: "ONRAMP_CLOSED", message: "closed" },
        settled: false,
        retry: railCallbacks.retry,
      }),
    );

    expect(screen.queryByText("Paybis ref")).toBeNull();
    expect(screen.queryByText("undefined")).toBeNull();
  });

  /**
   * @rule POO-1403 R5 — the `requestId` is not a secret, but it IS a handle on someone's payment. It
   * goes to the report and to Sentry, both first-party; it does not go to GA4, where POO-243 [R3]
   * keeps error detail to a digest.
   */
  it("[POO-1403 R5] never sends the requestId to GA4", () => {
    recordOnRampRequest({ requestId: PAYBIS_REQUEST_ID, wallet: WALLET });
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() =>
      railCallbacks.onFailed?.({
        error: { code: "ONRAMP_ERROR", message: "boom" },
        settled: false,
        retry: railCallbacks.retry,
      }),
    );

    expect(JSON.stringify(window.dataLayer)).not.toContain(PAYBIS_REQUEST_ID);
  });

  // A reconcile timeout is money-in-flight, not a failure: the settling screen, no completion event.
  it("shows the settling screen on a reconcile timeout", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    reachRail();
    act(() => railCallbacks.onSettling?.());

    expect(screen.getByRole("heading", { name: "Payment received" })).toBeInTheDocument();
    expect(window.dataLayer).not.toContainEqual(
      expect.objectContaining({ event: "deposit_completed" }),
    );
  });
});
