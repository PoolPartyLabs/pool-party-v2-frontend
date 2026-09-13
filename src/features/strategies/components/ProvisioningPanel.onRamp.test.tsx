/**
 * @id PP-CORE-CMP-046 (POO-1136, POO-1384, POO-1564, POO-1596, POO-1629)
 * @name ProvisioningPanel — the fiat buy step
 * @implements-rules-version v6 (POO-1629 rules v2) · v5 (POO-1641 rules v1) · v4 (POO-1596 rules v1) · v3 (POO-1564 rules v1) · v2 (POO-1384 / POO-1129 rules v4) · v1 (POO-1136 / POO-1129 rules v3)
 * @hackathon POO-1022 (Universal Funding)
 *
 * What the panel does with the `buy` step's two ends: the `requestId` it mints and the widget it
 * mounts for it.
 *
 * The defect these pin is a HANG, not a loss. `runOnRampBuy` returns a promise that only
 * `PaybisWidgetFrame` can settle, so a widget state the frame did not report left the buy step pending
 * forever: the panel stayed in `pending`, `onLockChange(true)` held the op modal undismissable, and
 * the caption offered a restart no button could perform. No money moved, and there was no way out.
 *
 * Rules under test (POO-1129 rules v3):
 *   [R7]  the frame is handed the wallet, or `open()` journals nothing and a reload double-charges
 *   [R11] a terminal widget state fails the buy step, releases the lock, and says so in fiat terms
 *   [R12] a post-`completed` close is NOT one of those states — pinned where it lives, on the hook
 *         (`useOnRampSettlement.test.tsx`), because the hook is what refuses to surface it
 *   [R10] (POO-1153) the panel THREADS the live received-fixed quote into the picker, and floors the
 *         amount it quotes at `PAYBIS_MIN_USD` so the labelled charge matches the order that will
 *         actually be placed
 *   POO-1596  and it threads the PAIR too: the list and the charge belong to the order the plan will
 *         actually mint (`sizeOnRampOrder`), not to the hook's `USDC-BASE` default
 *
 * The frame is stubbed rather than driven: this suite is about what the PANEL does with what the frame
 * reports. That the frame reports these states at all is `PaybisWidgetFrame.test.tsx`'s rule. The
 * [R10] block below is the same posture one layer up: `useBuyRouteQuote` and `FundingRoutePicker` are
 * each covered in isolation, and NOTHING covered the glue between them. That gap is this epic's
 * signature regression (a feature unreachable through the UI shipped once for exactly this reason), so
 * the on-ramp ACTIONS are stubbed and the whole panel-to-picker path runs for real.
 */
import type { AnchorHTMLAttributes, ReactNode, RefObject } from "react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import { recordOnRampRequest } from "@/lib/onramp/onRampJournal";
// POO-1573 [R5] v2: the code a refused mint carries, so the panel can name that cause specifically.
import { ONRAMP_ETH_UNPRICED_CODE } from "@/lib/onramp/schemas";
import type {
  ProvisioningNeedInput,
  ProvisioningOrder,
  ProvisioningPlan,
  ProvisioningStep,
} from "@/lib/provisioning";
import { PAYBIS_MIN_USD, SCENARIOS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { TransactionError } from "@/lib/tx/sendTransaction";
import { REAL_STEPS, realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
// POO-1596: a suite asserting that NO quote was spent waits out the real debounce window, rather
// than hardcoding a number that would silently stop measuring anything if this one moved.
import { QUOTE_DEBOUNCE_MS } from "../hooks/useBuyRouteQuote";
import type { PlanRailReporters, ProvisioningPanelHandle } from "./ProvisioningPanel";
import { ProvisioningPanel } from "./ProvisioningPanel";

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
  useRouter: () => ({ push: vi.fn() }),
}));

// POO-1153: the buy-route quote is gated OFF in mock mode (no Paybis rail behind the actions), so the
// [R10] block below has to run on the real side of that seam. `isMockMode` is a module constant read
// at import time, so it is replaced here rather than through `stubEnv`.
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));

/** The two server actions behind `useBuyRouteQuote`. Stubbed: the glue is what is under test. */
const onRamp = vi.hoisted(() => ({
  getMethods: vi.fn(),
  getQuote: vi.fn(),
}));
vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampPaymentMethodsAction: onRamp.getMethods,
  getOnRampQuoteAction: onRamp.getQuote,
}));

const { planHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
}));
vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: () => ({
    plan: planHolder.current,
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

const WALLET = "0xC3673ADc0000000000000000000000000000BEEF";

// POO-1384: the mint takes a second arg so the mock is typed to receive it. Without the explicit
// signature `mockImplementationOnce` cannot see either parameter.
// POO-1578: that arg is now an OPTIONS object rather than the bare confirmer, because the user's
// chosen payment method travels alongside it. Typed here too, or the doubles below destructure a
// field the compiler still believes is a function (tests pass at runtime, typecheck catches it).
const rail = vi.hoisted(() => ({
  mintOnRampRequest: vi.fn(
    async (
      _order: unknown,
      // Not optional here, and `confirmResume` not optional within it: this models what the PANEL
      // actually sends, which always carries the confirmer. Typing it as the fully-optional public
      // shape would make every double below guard a field that is never absent on this path.
      _options: {
        confirmResume: (intent: {
          requestId: string;
          startedAt: number;
          paid: boolean;
        }) => Promise<"resume" | "new">;
        paymentMethod?: string;
      },
    ) => ({ requestId: "req-1", wallet: "0xC3673ADc0000000000000000000000000000BEEF" }),
  ),
}));

// The bound rail is real-mode-only machinery (Privy + wagmi). The panel's job here is composing its
// two halves, so the mint is replaced and the composition is what runs.
vi.mock("../hooks/useProvisioningRail", () => ({
  useProvisioningRail: () => ({
    buildSteps: undefined,
    openJournal: () => {},
    closeJournal: () => {},
    mintOnRampRequest: rail.mintOnRampRequest,
  }),
}));

/**
 * The frame, as a pair of buttons.
 *
 * It renders the props the panel is asserted to pass (`wallet` above all: without it the real frame's
 * `open()` journals no intent) and lets a test push either outcome back up.
 */
vi.mock("./provisioning/PaybisWidgetFrame", () => ({
  PaybisWidgetFrame: ({
    requestId,
    wallet,
    onSettled,
    onTerminal,
  }: {
    requestId: string;
    wallet?: string;
    onSettled?: (deltas: unknown[]) => void;
    onTerminal?: (status: string) => void;
  }) => (
    <div data-testid="paybis-frame" data-request-id={requestId} data-wallet={wallet ?? ""}>
      <button type="button" onClick={() => onTerminal?.("closed")}>
        widget closed
      </button>
      <button type="button" onClick={() => onTerminal?.("unavailable")}>
        widget unavailable
      </button>
      <button type="button" onClick={() => onSettled?.([])}>
        widget settled
      </button>
    </div>
  ),
}));

/** POO-1403: the real `requestId` from the 2026-08-06 report (Paybis invoice `PB26086511232TX9`). */
const PAYBIS_REQUEST_ID = "19fd7802-cdb0-80b6-b36e-76befd2ee33f";

const ORDER: ProvisioningOrder = {
  currencyCode: "USDC-BASE",
  fiatAmount: "120.00",
  fiatCurrency: "USD",
};

const BUY_STEP: ProvisioningStep = {
  type: "buy",
  key: "buy",
  labelKey: "provisioning.steps.buy",
  fromToken: "USD",
  toToken: "USDC",
  toChainId: 8453,
  amountUsd: 120,
  poweredBy: "paybis",
  order: ORDER,
};

/** A one-step rail whose only step IS the fiat purchase, so the widget is what the route waits on. */
function buyOnlyRail(_plan: ProvisioningPlan, reporters: PlanRailReporters) {
  return [
    {
      key: "buy",
      run: async () => {
        await reporters.runOnRampBuy?.({ order: ORDER, expectedToken: "USDC-BASE" });
        return {};
      },
    },
  ];
}

function noop() {}

/**
 * POO-1576: the buy step ASKS before it mints now, so every path to the checkout goes through
 * "Choose how to pay" first.
 *
 * The on-ramp actions are stubbed to nothing in this suite (the glue to the PANEL is what it tests),
 * so the step renders its informational state and `Continue` proceeds on the rail's own prefill,
 * which is exactly the pre-POO-1576 behaviour every assertion below was written against. The step's
 * own rules are pinned in `ProvisioningPanel.methodStep.test.tsx`.
 */
async function continuePastMethodStep() {
  fireEvent.click(await screen.findByTestId("provisioning-method-continue"));
  await act(async () => {});
}

/**
 * Render and wait for the widget to mount on the running screen, then let React SETTLE, so what the
 * helper returns is a quiescent panel rather than a half-applied commit. POO-1503: there is no mock
 * Confirm to press any more; the seeded start runs the buy-only rail the moment the plan resolves.
 *
 * POO-1545: that settle is the fix for a real flake, and the reasoning is worth keeping because the
 * shape recurs. `findBy*` resolves off a DOM mutation, and React emits the mutation at COMMIT; the
 * passive effect that reports the lock (`ProvisioningPanel.tsx`, the `onLockChangeRef` projection
 * effect) runs in a LATER task. RTL knows this and tries to cover it: its `asyncWrapper` turns the
 * act environment OFF for the whole wait and then drains with exactly one `setTimeout(…, 0)`
 * (`@testing-library/react/dist/pure.js:83`). One macrotask is a bet, not a guarantee. Measured here
 * under machine load, the frame was in the document while `onLockChange` had only reached the
 * mid-flight `true` that minting the requestId legitimately asserts, one turn short of the `false`
 * the widget's mount produces.
 *
 * So the failure was never `[R13]` breaking; it was this helper handing callers a panel mid-commit
 * and letting them sample it. `act` flushes the passive queue to quiescence instead of hoping a
 * single turn suffices, which lets `[R13]` assert the lock EXACTLY. Deliberately not `waitFor` there:
 * `waitFor` would also accept a lock that sat `true` for a second before releasing, and a second of
 * undismissable modal on a money path is the bug the rule exists to catch.
 */
async function runToWidget(onLockChange?: (locked: boolean) => void) {
  const onDone = vi.fn();
  renderWithProviders(
    <ProvisioningPanel
      input={SCENARIOS.usdcBridge}
      opLabel="Invest in Stable Yield"
      onDone={onDone}
      onCancel={noop}
      buildPlanSteps={buyOnlyRail}
      {...(onLockChange ? { onLockChange } : {})}
    />,
  );
  await continuePastMethodStep();
  const frame = await screen.findByTestId("paybis-frame");
  await act(async () => {});
  return { frame, onDone };
}

beforeEach(() => {
  planHolder.current = realProvisioningPlan({
    steps: [BUY_STEP, REAL_STEPS[2] as ProvisioningStep],
  });
  rail.mintOnRampRequest.mockClear();
  // POO-1403: the on-ramp journal is real localStorage, and a record left by one test is exactly the
  // stale id the [R4] gate exists to keep off an unrelated failure.
  localStorage.clear();
});

/**
 * POO-1504 [R27]: the run no longer hands the operation back on its own. The bottom button IS the
 * state, so `Done` becomes enabled once every leg has settled and pressing it is what resumes the
 * original operation. The completion EVENT is unmoved: it still fires on settlement (premise 11), and
 * only the handoff waits for this press.
 */
async function pressDone(): Promise<void> {
  const done = await screen.findByTestId("provisioning-exec-state", undefined, { timeout: 3000 });
  await waitFor(() => expect(done).toBeEnabled(), { timeout: 3000 });
  fireEvent.click(done);
}

describe("ProvisioningPanel — the fiat buy step (POO-1136)", () => {
  // @rule R7 — the journal is keyed by wallet and written by the frame's `open()`. Drop the prop and
  // nothing is ever recorded, so a tab that dies in the paid-but-not-landed window has no in-flight
  // intent to resume and the rederived plan mints a SECOND purchase beside the first one's funds.
  it("[R7] hands the frame the wallet the requestId was minted for", async () => {
    const { frame } = await runToWidget();

    // POO-1384: a second arg now rides along, the resume confirmer the panel owns.
    // POO-1578: the optional tail is one OPTIONS object now, not a positional `confirmResume`, so the
    // user's chosen payment method has somewhere to travel that is not an argument every caller has to
    // pass `undefined` to reach.
    expect(rail.mintOnRampRequest).toHaveBeenCalledWith(ORDER, {
      confirmResume: expect.any(Function),
    });
    expect(frame).toHaveAttribute("data-request-id", "req-1");
    expect(frame).toHaveAttribute("data-wallet", WALLET);
  });

  // @rule R13 (POO-1384) — the buy step is the one `pending` phase that must NOT trap the user.
  //
  // Reported from production: the modal could not be dismissed while the vendor checkout was up.
  // Every other `pending` phase is one of OUR transactions mid-signature or mid-settlement, where a
  // dismissal orphans something on-chain; a buy is the user inside Paybis' card form, with nothing
  // of ours in flight. The overlay is unreachable there anyway (the click lands in the vendor's
  // iframe), so holding the lock only removes the escape it was never protecting.
  it("[R13] leaves the host dismissable while the vendor checkout is open", async () => {
    const onLockChange = vi.fn();
    const { frame } = await runToWidget(onLockChange);

    // The route IS running (the widget is mounted on the running screen) and the host is free anyway.
    expect(frame).toBeInTheDocument();
    // Exact, not `waitFor` (POO-1545): `runToWidget` has already settled React, so by here the lock
    // has reached its resting value and a `true` would mean the rule is genuinely broken.
    expect(onLockChange).toHaveBeenLastCalledWith(false);
  });

  // @rule R13 — and the lock still holds for every pending phase that is not a buy.
  it("[R13] holds the lock for a non-buy pending step", async () => {
    const onLockChange = vi.fn();
    planHolder.current = realProvisioningPlan({
      steps: [REAL_STEPS[2] as ProvisioningStep],
    });
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => [{ key: "transfer", run: () => new Promise(noop) }]}
        onLockChange={onLockChange}
      />,
    );

    await waitFor(() => expect(onLockChange).toHaveBeenLastCalledWith(true));
  });

  // @rule R15 (POO-1384) — the intent we cannot verify is a QUESTION, not a silent branch.
  it("[R15] asks the user before reusing or replacing an unverified in-flight purchase", async () => {
    // The rail hands the panel the decision, exactly as the real one does past the resumable window.
    let answered: "resume" | "new" | null = null;
    rail.mintOnRampRequest.mockImplementationOnce(async (_order, { confirmResume }) => {
      answered = await confirmResume({
        requestId: "req-old",
        startedAt: Date.now() - 22 * 60_000,
        paid: false,
      });
      return { requestId: answered === "resume" ? "req-old" : "req-new", wallet: WALLET };
    });

    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={buyOnlyRail}
      />,
    );
    await continuePastMethodStep();

    // It holds the mint and asks, rather than choosing for the user.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/purchase in progress/i);
    expect(dialog).toHaveTextContent(/22 minutes ago/);

    fireEvent.click(screen.getByRole("button", { name: "Resume that purchase" }));

    // The answer reaches the rail, and the widget then opens on the id the user chose.
    const frame = await screen.findByTestId("paybis-frame");
    expect(answered).toBe("resume");
    expect(frame).toHaveAttribute("data-request-id", "req-old");
  });

  it("[R15] starting a new one carries the fresh id into the widget", async () => {
    rail.mintOnRampRequest.mockImplementationOnce(async (_order, { confirmResume }) => {
      const choice = await confirmResume({
        requestId: "req-old",
        startedAt: Date.now() - 60 * 60_000,
        paid: false,
      });
      return { requestId: choice === "resume" ? "req-old" : "req-new", wallet: WALLET };
    });

    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={buyOnlyRail}
      />,
    );
    await continuePastMethodStep();
    fireEvent.click(await screen.findByRole("button", { name: "Start a new purchase" }));

    const frame = await screen.findByTestId("paybis-frame");
    expect(frame).toHaveAttribute("data-request-id", "req-new");
  });

  // @rule M5.2 (POO-1526) — both exits of the resume prompt are their own full-width rows; the
  // explicit 44pt is a min-height, not a bigger font.
  it("[M5.2] both resume-prompt exits carry an explicit 44pt touch target", async () => {
    rail.mintOnRampRequest.mockImplementationOnce(async (_order, { confirmResume }) => {
      const choice = await confirmResume({
        requestId: "req-old",
        startedAt: Date.now() - 60 * 60_000,
        paid: false,
      });
      return { requestId: choice === "resume" ? "req-old" : "req-new", wallet: WALLET };
    });

    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={buyOnlyRail}
      />,
    );
    await continuePastMethodStep();

    expect(await screen.findByRole("button", { name: "Resume that purchase" })).toHaveClass(
      "min-h-11",
    );
    expect(screen.getByRole("button", { name: "Start a new purchase" })).toHaveClass("min-h-11");
  });

  // @rule R16 (POO-1384) — the reported production loop, pinned.
  //
  // "Every time he opens any on-ramp modal it resumes in that transaction-complete screen and he
  // can't go anywhere." The purchase finished at Paybis, our settlement never saw the delta, the
  // record stayed `open`, and every mint reopened the same id onto the vendor's completed screen.
  // A paid intent must route to SETTLING, never back into the widget.
  it("[R16] a paid intent that never landed goes to settling, not back into the widget", async () => {
    rail.mintOnRampRequest.mockImplementationOnce(async (_order, { confirmResume }) => {
      const choice = await confirmResume({
        requestId: "req-paid",
        startedAt: Date.now() - 40 * 60_000,
        paid: true,
      });
      if (choice === "resume")
        throw new TransactionError("Your purchase is still settling", { code: "ONRAMP_SETTLING" });
      return { requestId: "req-new", wallet: WALLET };
    });

    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={buyOnlyRail}
      />,
    );
    await continuePastMethodStep();

    // The question is the PAID one: keep waiting, not reopen the checkout.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/still landing/i);
    fireEvent.click(screen.getByRole("button", { name: "Keep waiting" }));

    // It lands on settling, and NO widget is mounted: that is the whole fix.
    await screen.findByText("Your purchase is settling");
    expect(screen.queryByTestId("paybis-frame")).not.toBeInTheDocument();
  });

  // @rule R11 — the abandonment that used to hang: the user shuts the checkout without paying.
  it("[R11] a terminal close fails the buy step and releases the dismissal lock", async () => {
    const onLockChange = vi.fn();
    await runToWidget(onLockChange);

    fireEvent.click(screen.getByRole("button", { name: "widget closed" }));

    // It lands on the failure screen rather than staying pending forever behind a locked modal.
    await screen.findByTestId("provisioning-error");
    // `waitFor`, not a bare assertion: clearing the in-flight buy and leaving `pending` are two
    // separate state updates, so the lock briefly re-asserts in the window between them (POO-1384
    // put `onRampBuy` in the effect's deps). The settled value is what matters; racing the
    // transient is how this reads as flaky.
    await waitFor(() => expect(onLockChange).toHaveBeenLastCalledWith(false));
    // And the failure reads in the on-ramp's own terms: nothing was charged, nothing moved.
    expect(
      screen.getByText(
        "Your purchase did not go through, so no funds were moved. You can try again.",
      ),
    ).toBeInTheDocument();
    // The retry is offered, because re-running the buy resumes the journaled id ([R7]) rather than
    // minting a second one.
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  /**
   * @rule POO-1403 R1 — the failure screen carries the VENDOR's id, not only ours.
   *
   * This is the incident this issue came from: the report a user copies leads with a `Reference` that
   * is our browser trace, Paybis has never heard of it, and the `requestId` their support needs was on
   * no report at all. It is THIS SESSION's minted id, not a journal read; see the next two tests for
   * why that distinction is the whole correctness argument.
   */
  it("[POO-1403 R1] shows THIS session's minted Paybis ref on an on-ramp failure", async () => {
    // An older, unrelated purchase is in the journal, and must be ignored in favour of the mint.
    recordOnRampRequest({ requestId: PAYBIS_REQUEST_ID, wallet: WALLET });
    await runToWidget();

    fireEvent.click(screen.getByRole("button", { name: "widget closed" }));
    await screen.findByTestId("provisioning-error");

    expect(screen.getByText("Paybis ref")).toBeInTheDocument();
    // "req-1" is what the mint returned. The journaled PAYBIS_REQUEST_ID belongs to another purchase.
    expect(screen.getByText("req-1")).toBeInTheDocument();
    expect(screen.queryByText(PAYBIS_REQUEST_ID)).not.toBeInTheDocument();
  });

  /**
   * @rule POO-1403 R1 — the regression that motivated the redesign (review of #768).
   *
   * A failure BEFORE the mint succeeds journals nothing for that attempt, yet its code is still
   * `ONRAMP_*`. The first revision read the journal's newest record and would therefore print an
   * EARLIER, probably SETTLED purchase's id. Support looks it up, finds a completed charge, and tells
   * the user they were charged for an attempt where nothing was ever created. Showing nothing is the
   * only honest answer.
   */
  it("[POO-1403 R1] shows NO Paybis ref when the mint itself failed, despite an older record", async () => {
    recordOnRampRequest({ requestId: PAYBIS_REQUEST_ID, wallet: WALLET });
    rail.mintOnRampRequest.mockRejectedValueOnce(
      new TransactionError("Could not start the purchase", { code: "ONRAMP_INVALID_REQUEST" }),
    );
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={vi.fn()}
        onCancel={noop}
        buildPlanSteps={buyOnlyRail}
      />,
    );
    await continuePastMethodStep();
    await screen.findByTestId("provisioning-error");

    expect(screen.queryByText("Paybis ref")).not.toBeInTheDocument();
    expect(screen.queryByText(PAYBIS_REQUEST_ID)).not.toBeInTheDocument();
  });

  /**
   * @rule POO-1573 [R5] (rules v2): the in-flow host names the cause the mint refused on.
   *
   * The refusal is not "the purchase did not go through": nothing went anywhere, because the mint
   * aborted before the request id existed rather than falling back to a dollar charge on a card. The
   * generic buy copy would leave the user retrying with no idea what to expect, so this one cause gets
   * its own sentence. Pinned against the generic body below, which every OTHER buy failure keeps.
   */
  it("[POO-1573 R5] names the unpriced ETH cause on the failed-step screen", async () => {
    rail.mintOnRampRequest.mockRejectedValueOnce(
      new TransactionError("Could not price ETH for this purchase", {
        code: ONRAMP_ETH_UNPRICED_CODE,
      }),
    );
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={vi.fn()}
        onCancel={noop}
        buildPlanSteps={buyOnlyRail}
      />,
    );
    await continuePastMethodStep();
    await screen.findByTestId("provisioning-error");

    expect(screen.getByText(/we couldn't get an ETH price just now/)).toBeInTheDocument();
    expect(screen.queryByText(/Your purchase did not go through/)).not.toBeInTheDocument();
  });

  // @rule POO-1573 [R5] v2, SCOPE: every other buy failure keeps the copy it shipped with.
  it("[POO-1573 R5] keeps the generic buy copy for any other purchase failure", async () => {
    rail.mintOnRampRequest.mockRejectedValueOnce(
      new TransactionError("Could not start the purchase", { code: "ONRAMP_INVALID_REQUEST" }),
    );
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={vi.fn()}
        onCancel={noop}
        buildPlanSteps={buyOnlyRail}
      />,
    );
    await continuePastMethodStep();
    await screen.findByTestId("provisioning-error");

    expect(screen.getByText(/Your purchase did not go through/)).toBeInTheDocument();
    expect(screen.queryByText(/we couldn't get an ETH price just now/)).not.toBeInTheDocument();
  });

  /**
   * @rule POO-1403 R4 — and NOT on a failure that is not a purchase.
   *
   * The gate is the whole point of [R4] on this surface. This panel runs swaps, bridges and the invest
   * beside the buy, the journal keeps a purchase for 24 hours, and an ungated read would staple a real
   * Paybis id from an unrelated (probably successful) purchase onto a slippage revert. Support would
   * then chase an id that has nothing to do with the failure, which is worse than having none.
   */
  it("[POO-1403 R4] shows no Paybis ref when the failure is not the purchase", async () => {
    recordOnRampRequest({ requestId: PAYBIS_REQUEST_ID, wallet: WALLET });
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={vi.fn()}
        onCancel={noop}
        buildPlanSteps={() => [
          {
            key: "swap",
            run: async () => {
              // POO-1506 [R37]: NOT a slippage-classified failure on purpose — that kind no longer
              // reaches this screen at all (it lands on `8a`/`8b` instead), and this test is about
              // the Paybis-ref gate on a non-purchase failure, not about slippage specifically.
              throw new TransactionError("execution reverted", { code: "PROVISIONING_FAILED" });
            },
          },
        ]}
      />,
    );
    await screen.findByTestId("provisioning-error");

    expect(screen.queryByText("Paybis ref")).toBeNull();
    expect(screen.queryByText(PAYBIS_REQUEST_ID)).toBeNull();
  });

  // @rule R11 — the OTHER hang: the SDK never attaches, so no widget will ever render.
  it("[R11] the SDK-unavailable verdict fails the buy step too", async () => {
    const onLockChange = vi.fn();
    await runToWidget(onLockChange);

    fireEvent.click(screen.getByRole("button", { name: "widget unavailable" }));

    await screen.findByTestId("provisioning-error");
    await waitFor(() => expect(onLockChange).toHaveBeenLastCalledWith(false));
  });

  it("a settled purchase resolves the step and resumes the operation", async () => {
    const { onDone } = await runToWidget();

    fireEvent.click(screen.getByRole("button", { name: "widget settled" }));

    await pressDone();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // The widget is unmounted the moment the purchase settles: nothing is left holding the screen.
    expect(screen.queryByTestId("paybis-frame")).not.toBeInTheDocument();
  });
});

/**
 * The HOST's dismissal, mid-purchase — the other side of the same hang [R11] closed.
 *
 * [R13] deliberately releases the dismissal lock while the vendor checkout is up, so Esc, the
 * overlay and the native X all reach the host's `onOpenChange` there. The host answers that by
 * asking the panel (`requestClose()`), and until this suite existed the panel had no answer for the
 * buy: it fell through the `phase === "pending"` guard, the host closed, `PaybisWidgetFrame`
 * unmounted, and the `runOnRampBuy` promise that ONLY the frame can settle was left pending with
 * nothing alive to resolve it. Same hang as [R11], reached from outside the panel instead of inside.
 *
 * These pin the exit, not a confirmation: [R13] is that leaving mid-buy stays allowed.
 */
describe("ProvisioningPanel — dismissing the host mid-purchase (POO-1384 [R13])", () => {
  /** The buy-only rail, plus a handle on how its single step actually ended. */
  function observedBuyRail() {
    const outcome = { settled: false, failedWith: null as string | null };
    const buildSteps = (_plan: ProvisioningPlan, reporters: PlanRailReporters) => [
      {
        key: "buy",
        run: async () => {
          try {
            await reporters.runOnRampBuy?.({ order: ORDER, expectedToken: "USDC-BASE" as const });
            outcome.settled = true;
          } catch (error) {
            // `TransactionError(message, cause)` — the code rides on `cause`, which is where
            // `onRampTerminalError` puts it and where the flow's classifier reads it from.
            outcome.failedWith = (error as { cause?: { code?: string } }).cause?.code ?? "UNKNOWN";
            throw error;
          }
          return {};
        },
      },
    ];
    return { outcome, buildSteps };
  }

  async function runToWidgetWithHandle(onLockChange?: (locked: boolean) => void) {
    const ref = createRef<ProvisioningPanelHandle>();
    const { outcome, buildSteps } = observedBuyRail();
    const { unmount } = renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={buildSteps}
        {...(onLockChange ? { onLockChange } : {})}
      />,
    );
    // POO-1576: the method step stands between the run starting and the checkout mounting.
    await continuePastMethodStep();
    await screen.findByTestId("paybis-frame");
    // POO-1545: settle the passive queue rather than sampling a half-applied commit.
    await act(async () => {});
    return { ref, outcome, unmount };
  }

  /** Exactly how the host calls it: on the imperative handle, outside any `fireEvent`. */
  function requestClose(ref: RefObject<ProvisioningPanelHandle | null>): boolean | undefined {
    let proceed: boolean | undefined;
    act(() => {
      proceed = ref.current?.requestClose();
    });
    return proceed;
  }

  // @rule R13 — leaving mid-buy is ALLOWED. No `Stop here?`, because nothing of ours is in flight
  // and being trapped in the vendor's iframe is the report this rule answers.
  it("[R13] lets the close proceed, with no confirmation raised", async () => {
    const { ref } = await runToWidgetWithHandle();

    expect(requestClose(ref)).toBe(true);
    expect(screen.queryByText("Stop here?")).not.toBeInTheDocument();
  });

  // @rule R13 — and it must SETTLE the purchase on the way out. This is the regression: the promise
  // has exactly one resolver (the frame the host is about to unmount), so a close that does not fail
  // it hangs the rail forever behind an open journal record and a minted requestId.
  it("[R13] fails the awaited buy instead of leaving it pending forever", async () => {
    const { ref, outcome } = await runToWidgetWithHandle();

    requestClose(ref);
    await act(async () => {});

    expect(outcome.failedWith).toBe("ONRAMP_CLOSED");
    expect(outcome.settled).toBe(false);
    // The frame is gone with the purchase it was mounted for, so nothing can settle it late either.
    expect(screen.queryByTestId("paybis-frame")).not.toBeInTheDocument();
  });

  // @rule R13 × POO-1564 — the exit KEEPS its telemetry cohort. `fail()` nulls `onRampBuy` while
  // the panel is still mounted, so the re-render used to recompute `exitPhaseRef` back to `pending`
  // before the unmount cleanup read it — silently reclassifying the one series that answers "did
  // unlocking the modal cost us purchases?" (the `buy` > `pending` ranking POO-1384 wrote down).
  // The sticky closed-during-buy record keeps the abandonment saying `buy`.
  it("[R13] the abandonment still reports funding_exit: buy for a mid-buy host close", async () => {
    window.dataLayer = [];
    const { ref, unmount } = await runToWidgetWithHandle();

    requestClose(ref);
    await act(async () => {});
    unmount();

    const abandoned = ((window.dataLayer ?? []) as Record<string, unknown>[]).filter(
      (entry) => entry.event === "funding_plan_abandoned",
    );
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatchObject({ funding_exit: "buy" });
  });

  // @rule R13 — the recovery banner is told to re-read the journal NOW, exactly as `Stop anyway`
  // does. The run opened a record when it started and this exit does not close it, so without the
  // ping the user only learns about the interrupted route on their next page load.
  it("[R13] asks the recovery banner to re-check on the way out", async () => {
    const recheck = vi.fn();
    window.addEventListener("pp:funding-recovery-recheck", recheck);
    const { ref } = await runToWidgetWithHandle();

    requestClose(ref);

    expect(recheck).toHaveBeenCalledTimes(1);
    window.removeEventListener("pp:funding-recovery-recheck", recheck);
  });

  // @rule R13 — a close BEFORE the widget mounts (the mint is still in flight) is not this path:
  // the lock is legitimately held there, and the panel keeps its ordinary mid-run confirmation.
  it("[R13] still confirms a close while the purchase is only being minted", async () => {
    const ref = createRef<ProvisioningPanelHandle>();
    // A mint that never resolves: the buy step is running, no widget has mounted yet.
    rail.mintOnRampRequest.mockImplementationOnce(() => new Promise(() => {}));
    const { buildSteps } = observedBuyRail();
    renderWithProviders(
      <ProvisioningPanel
        ref={ref}
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={buildSteps}
      />,
    );
    // POO-1576: past the method step, so the panel is genuinely mid-MINT rather than mid-question.
    // A close DURING the question is its own path with its own rule (it proceeds, see
    // `ProvisioningPanel.methodStep.test.tsx`); this pins the state after it.
    await continuePastMethodStep();
    await screen.findByTestId("provisioning-exec-window");
    await act(async () => {});

    expect(requestClose(ref)).toBe(false);
    expect(screen.getByText("Stop here?")).toBeInTheDocument();
  });
});

/**
 * The GLUE, POO-1153 [R10]. `useBuyRouteQuote` is covered on its own and `FundingRoutePicker` is
 * covered on its own; what nothing covered is the panel wiring one into the other, which is precisely
 * how this epic has already shipped a feature that was unreachable through the UI. So here the two
 * server actions are the only stubs and everything between them and the rendered row runs for real.
 */
describe("ProvisioningPanel — the live buy-route quote (POO-1153)", () => {
  const BASE = 8453;
  const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  const CARD = {
    paymentMethod: "poolparty-credit-card",
    displayName: "Credit Card",
    minUsd: 10,
    minCurrencyCode: "USD",
  };

  /** A received-fixed quote whose charge deliberately differs from the amount that was requested. */
  function quoteCharging(chargeUsd: number) {
    return {
      ok: true as const,
      quote: {
        quoteId: "quote_1",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "destination",
        paymentMethods: [
          {
            id: "poolparty-credit-card",
            name: "Credit Card",
            chargeUsd,
            chargeAmount: chargeUsd.toFixed(2),
            chargeCurrencyCode: "USD",
            receiveAmount: "105.500000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    };
  }

  const usdcOnBase = {
    address: USDC_BASE,
    chainId: BASE,
    symbol: "USDC",
    decimals: 6,
    amount: "50000000",
    usd: 50,
    reachableChainIds: [BASE],
    isNative: false,
    logoUrl: "",
  };

  const context: ProvisioningGateContext = {
    targetChainId: BASE,
    sources: [usdcOnBase],
    gasByChain: {
      [BASE]: {
        chainId: BASE,
        verdict: "OK",
        quotedGasUsd: 0.02,
        requiredGasUsd: 0.075,
        shortfallUsd: 0,
        surplusUsd: 5,
        reasonKey: "provisioning.gasVerdict.ok",
      },
    },
    balancesByChain: { [BASE]: { nativeUsd: 5, tokenUsd: 50 } },
    gasEstimateUsd: 0.5,
  };

  /** $100 + gas against $50 of tokens: a genuine choice, so the picker leads. */
  const partialInput: ProvisioningNeedInput = {
    currentChainId: BASE,
    targetChainId: BASE,
    opRequiredUsdc: 100,
    gasEstimateUsd: 0.5,
  };

  /**
   * The same wallet, on a Base the operation cannot pay gas on (POO-1596).
   *
   * `TOP_UP` is deliberately not `BLOCKED`: the holding stays SELECTABLE (`isSelectableVerdict`
   * excludes only `BLOCKED`), so the picker still has two routes and leads, while
   * `onRampRouteBuysGas` reads the verdict as not-OK and the plan's purchase goes ETH-first. That is
   * the exact wallet this defect is about, and it is a wallet that still sees the buy row.
   */
  const gasFirstContext: ProvisioningGateContext = {
    ...context,
    gasByChain: {
      [BASE]: {
        chainId: BASE,
        verdict: "TOP_UP",
        quotedGasUsd: 0.02,
        requiredGasUsd: 0.075,
        shortfallUsd: 0.06,
        surplusUsd: 0,
        reasonKey: "provisioning.gasVerdict.topUp",
      },
    },
  };

  /** Render on the "Where from" screen with the on-ramp flag on. */
  async function renderRoutes(
    input: ProvisioningNeedInput,
    gateContext: ProvisioningGateContext = context,
  ) {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
    renderWithProviders(
      <ProvisioningPanel
        input={input}
        context={gateContext}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={() => []}
      />,
    );
    expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute("data-phase", "routes");
  }

  // The flag is read through `useFeatureFlags`, whose client snapshot is memoised for the module's
  // lifetime, so the override has to be cleared around every case or it leaks across the file.
  beforeEach(() => {
    __resetDevOverridesForTests();
    onRamp.getMethods.mockReset();
    onRamp.getQuote.mockReset();
  });
  afterEach(() => {
    __resetDevOverridesForTests();
    vi.unstubAllEnvs();
  });

  // @rule R10 — the wiring itself. The hook resolves a charge and the picker must SHOW it: this is the
  // assertion that fails if the prop is dropped, renamed, or never threaded, which is the regression
  // isolated hook and component suites cannot see.
  it("[R10] threads the resolved quote charge into the picker's buy row", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: true, methods: [CARD] });
    onRamp.getQuote.mockResolvedValue(quoteCharging(108.42));

    await renderRoutes(partialInput);

    expect(await screen.findByText("$108.42 with Credit Card")).toBeInTheDocument();
    // And the pending caption is gone, so the live figure genuinely replaced the fallback.
    expect(screen.queryByText("Final charge shown at checkout")).not.toBeInTheDocument();
  });

  // @rule POO-1512: the method-minimum gate compares on the CRYPTO side (`buyOrderUsd` vs
  // `PAYBIS_MIN_USD`), never the method's fiat minimum, which since POO-1512 arrives in the buyer's
  // own currency and is not USD-comparable. An order well above the floor surfaces no minimum,
  // whatever the method's own floor says.
  it("does not surface a method minimum when the order is above the app floor", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: true, methods: [{ ...CARD, minUsd: 25 }] });
    onRamp.getQuote.mockResolvedValue(quoteCharging(108.42));

    await renderRoutes(partialInput);

    await screen.findByText("$108.42 with Credit Card");
    expect(screen.queryByText(/Minimum/)).not.toBeInTheDocument();
  });

  // @rule POO-1512: the other side of the same boundary: an order sitting AT the floor (a sub-floor
  // requirement clamped up to `PAYBIS_MIN_USD`) is the smallest order the app can place, and there a
  // method's own minimum is what can still reject it, so it is stated, in ITS OWN currency ([R7]).
  it("surfaces the method's own minimum, in its currency, when the order sits at the floor", async () => {
    // One resolved buyer currency drives BOTH figures (POO-1512): the charge and the minimum arrive
    // in the same fiat, here EUR, and each is printed in it.
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "EUR",
      methods: [{ ...CARD, minUsd: 12.5, minCurrencyCode: "EUR" }],
    });
    const quote = quoteCharging(10.4);
    quote.quote.currencyCodeFrom = "EUR";
    const method = quote.quote.paymentMethods[0];
    if (method) method.chargeCurrencyCode = "EUR";
    onRamp.getQuote.mockResolvedValue(quote);

    await renderRoutes({ ...partialInput, opRequiredUsdc: 3 });

    expect(await screen.findByText("Minimum €12.50 with Credit Card")).toBeInTheDocument();
    // And the charge row agrees on the currency, so one flow never shows two denominations.
    //
    // AWAITED, not sampled. Since POO-1596 F1 the minimum arrives with the METHODS list rather than
    // with the quote, so the assertion above no longer implicitly waits for the quote to settle and a
    // synchronous `getByText` here would race it. Two figures with two different arrival times need
    // two waits.
    expect(await screen.findByText("€10.40 with Credit Card")).toBeInTheDocument();
  });

  // @rule R10 — the FLOOR. `buildPlan.buildOnRampSteps` sizes the real order through `sizeOnRampOrder`,
  // which floors it at `PAYBIS_MIN_USD`. Quoting a $3 requirement AS $3 would label a charge below the
  // smallest order this app can place: not a conservative estimate, a wrong one, and wrong in the
  // direction that surprises the user at the payment step. The picker therefore quotes the floor,
  // exactly as the order will be sized.
  it("[R10] floors the quoted amount at the Paybis minimum for a sub-floor requirement", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: true, methods: [CARD] });
    onRamp.getQuote.mockResolvedValue(quoteCharging(10.4));

    await renderRoutes({ ...partialInput, opRequiredUsdc: 3 });

    await waitFor(() => expect(onRamp.getQuote).toHaveBeenCalled());
    expect(onRamp.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ amount: PAYBIS_MIN_USD, direction: "receive" }),
    );
    // The seeded requirement itself ($3 x 1.05 = $3.15) is never what gets priced.
    expect(onRamp.getQuote).not.toHaveBeenCalledWith(expect.objectContaining({ amount: 3.15 }));
  });

  /**
   * @rule POO-1641 R3 — what the buy route asks Paybis to DELIVER is the bare requirement.
   *
   * `buyOrderUsd` was `max($10, grossUpForOnRampFee(shortfall))`, and POO-1166's gross-up existed to
   * survive a 1% cut of our own that the delivery never suffers: it is a partner-side configuration
   * already inside the price Paybis quotes (Rafael, 2026-08-16). So the buyer was charged for a
   * percent nobody receives.
   *
   * The requirement here is `$105.00`: the $100 operation through `seedRequiredUsd`'s 5% source
   * buffer, with no gas term because this wallet's Base verdict is `OK`. That buffer is a DIFFERENT
   * thing and POO-1641 leaves it alone, so the figure moves by exactly the fee and nothing else:
   * `$106.07 -> $105.00`.
   *
   * Pinned on the QUOTE argument rather than on a rendered figure because that argument IS
   * `buyOrderUsd`: this is the same value the plan will place the order at, and the only place the
   * panel exposes it.
   */
  it("[POO-1641] quotes the bare requirement, with no fee gross-up on top", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: true, methods: [CARD] });
    onRamp.getQuote.mockResolvedValue(quoteCharging(108.42));

    await renderRoutes(partialInput);

    await waitFor(() => expect(onRamp.getQuote).toHaveBeenCalled());
    expect(onRamp.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 105, direction: "receive" }),
    );
    expect(onRamp.getQuote).not.toHaveBeenCalledWith(expect.objectContaining({ amount: 106.07 }));
  });

  /**
   * @rule POO-1641 R7 — the one consequence the issue did not name, kept rather than papered over.
   *
   * The method-minimum disclosure is gated on `buyOrderUsd <= PAYBIS_MIN_USD`: the order sits AT the
   * app floor, the smallest we place, where a method's own minimum is the only thing that can still
   * reject it. A requirement in `(9.90, 10.00)` used to gross up to `$10.01..$10.10` and therefore
   * skipped that disclosure entirely, so the gross-up was silencing the warning on exactly the orders
   * it was written for.
   *
   * A $9.47 operation seeds to $9.95 through the 5% source buffer, which is the narrow band this is
   * about. It used to gross to $10.06 and hide the minimum; the order is now $10.00 and it is stated.
   */
  it("[POO-1641] states the method minimum for a requirement the gross-up used to lift over the floor", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [{ ...CARD, minUsd: 12.5, minCurrencyCode: "USD" }],
    });
    onRamp.getQuote.mockResolvedValue(quoteCharging(10.4));

    // 9.47 x 1.05 = $9.95, and 9.95 / 0.99 = $10.06: over the floor, disclosure silenced.
    await renderRoutes({ ...partialInput, opRequiredUsdc: 9.47 });

    expect(await screen.findByText("Minimum $12.50 with Credit Card")).toBeInTheDocument();
    await waitFor(() => expect(onRamp.getQuote).toHaveBeenCalled());
    expect(onRamp.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ amount: PAYBIS_MIN_USD, direction: "receive" }),
    );
  });

  // @rule POO-1153 — degradation, end to end. The quote is refused and the panel shows the pending
  // caption rather than an error, a spinner, or the FE's own shortfall. POO-1446 reworded that
  // caption to name the CHARGE; deleting it was considered and rejected (Rafael, 2026-08-13),
  // because this failing-quote path is exactly the case `CR-CORE-016` is BLOCKING on: with no
  // caption the row's title would stand alone as if it were the price.
  //
  // @rule POO-1629 [R1]/[R5] rules v2: the pair-unavailable 404 belongs to the METHODS read, not to
  // this one. A quote refusal is `ONRAMP_UPSTREAM_REJECTED` (422): `POST /on-ramp/quote` maps every
  // upstream 4xx through `asQuoteFailure` (api `paybis.service.ts:393-410`) and never reaches
  // `throwIfPairUnavailable`, which only `getPaymentMethods` calls. The divergence is deliberate and
  // recorded in api `13c4c5b`: a quote carries an amount and a payment method as well as the pair,
  // so its refusal cannot be attributed to the pair. Nothing here branches on the value, so the
  // caption assertion below holds either way; the fixture is corrected so it describes a refusal
  // that can actually happen.
  it("degrades to the pending caption when the quote cannot be priced", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: true, methods: [CARD] });
    onRamp.getQuote.mockResolvedValue({
      ok: false,
      code: "ONRAMP_UPSTREAM_REJECTED",
      message: "no",
    });

    await renderRoutes(partialInput);

    await waitFor(() => expect(onRamp.getQuote).toHaveBeenCalled());
    // Positive first: the buy row is genuinely on screen, so the caption assertion cannot pass
    // against an empty render.
    expect(await screen.findByRole("button", { name: /Buy \$/ })).toBeInTheDocument();
    expect(screen.getByText("Final charge shown at checkout")).toBeInTheDocument();
  });

  /**
   * @rule POO-1629 [R1]/[R5] rules v2: the METHODS half of the same degrade, and the one this issue
   * exists for.
   *
   * The sibling above was RECLASSIFIED to the quote path, which left the scenario POO-1629 is named
   * after with no panel-level coverage at all: Paybis does not sell the pair, so
   * `getPaymentMethods` 404s with `ONRAMP_PAIR_UNAVAILABLE` and the quote is never attempted. That
   * is not an exotic branch. On dev it is the ordinary state for any pair the sandbox map does not
   * cover, so it is the rendering a reviewer opening the panel there is most likely to meet.
   *
   * The hook guarantees the quote is skipped (`useBuyRouteQuote.test.tsx`, "degrades to no figure
   * when payment-methods fails, without quoting"); this mirrors it end to end, so a future change
   * that quotes anyway on a dead pair fails HERE as well as in the hook suite.
   */
  it("degrades to the pending caption when the pair is unavailable, without quoting", async () => {
    onRamp.getMethods.mockResolvedValue({
      ok: false,
      code: "ONRAMP_PAIR_UNAVAILABLE",
      message: "no",
    });

    await renderRoutes(partialInput);

    await waitFor(() => expect(onRamp.getMethods).toHaveBeenCalled());
    // Positive first: the degrade must still RENDER the buy row. A pair we cannot price is not a
    // reason to withhold the purchase, which is the whole "degrades, never blocks" contract.
    expect(await screen.findByRole("button", { name: /Buy \$/ })).toBeInTheDocument();
    expect(screen.getByText("Final charge shown at checkout")).toBeInTheDocument();
    // No method is named beside a figure that does not exist.
    expect(screen.queryByText(/with Credit Card/)).not.toBeInTheDocument();
    // Wait out the REAL debounce window before asserting the quote never ran. Without this the
    // assertion below is vacuous: the quote is debounced by `QUOTE_DEBOUNCE_MS`, so "not called yet"
    // is true of a HEALTHY pair too, and the test would pass with the fixture flipped to `ok: true`
    // (measured). Waiting on the constant rather than a hardcoded number keeps it honest if the
    // debounce ever moves. Same guard the gas-first case below uses, for the same reason.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, QUOTE_DEBOUNCE_MS + 50));
    });
    // The quote is never attempted: with no methods there is nothing to price, and asking would
    // spend a POST on the shared per-API-key throttle to be told the same thing twice.
    expect(onRamp.getQuote).not.toHaveBeenCalled();
  });

  // --- POO-1596: the row is about the pair the plan will actually mint ---------------------------
  // The same seam POO-1513 closed on `/deposit`. The hook defaults `currencyCodeTo` to `USDC-BASE`,
  // so a plan whose gas is funded by the on-ramp (`sizeOnRampOrder` -> `ETH-BASE`) had its charge
  // priced, and its method named, on a pair the buyer is never billed on. The mint then lists for
  // `order.currencyCode` (`useProvisioningRail`), so a method absent from THAT list falls back to a
  // card: POO-1578 [R3]'s silent substitution, arriving by a route nobody chose.

  // @rule POO-1596: the pair comes from the SHIPPED sizer, never a default.
  it("[POO-1596] lists the methods of the pair the plan will mint when the buy funds gas", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: true, methods: [CARD] });
    onRamp.getQuote.mockResolvedValue(quoteCharging(108.42));

    await renderRoutes(partialInput, gasFirstContext);

    await waitFor(() => expect(onRamp.getMethods).toHaveBeenCalled());
    expect(onRamp.getMethods).toHaveBeenCalledWith({ currencyCodeTo: "ETH-BASE" });
    expect(onRamp.getMethods).not.toHaveBeenCalledWith({ currencyCodeTo: "USDC-BASE" });
  });

  // @rule POO-1596: and no charge is asserted for it. The received-fixed quote asks Paybis to
  // deliver `amount` OF `currencyCodeTo`, which says nothing at all for `ETH-BASE`: that target is
  // `gasFloorEth + fundingUsd / ethUsd`, solved at MINT time against a price this client does not
  // hold (POO-1573). Same answer `/deposit` reached under POO-1513, via the same `pricingEnabled`.
  it("[POO-1596] spends no quote on the gas-first pair and keeps the neutral caption", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: true, methods: [CARD] });
    onRamp.getQuote.mockResolvedValue(quoteCharging(108.42));

    await renderRoutes(partialInput, gasFirstContext);

    await waitFor(() => expect(onRamp.getMethods).toHaveBeenCalled());
    // Wait out the real debounce window rather than a hardcoded number, so this stops measuring
    // nothing if `QUOTE_DEBOUNCE_MS` ever moves.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, QUOTE_DEBOUNCE_MS + 50));
    });

    expect(onRamp.getQuote).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /Buy \$/ })).toBeInTheDocument();
    expect(screen.getByText("Final charge shown at checkout")).toBeInTheDocument();
    // And no method is named beside a figure that does not exist.
    expect(screen.queryByText(/with Credit Card/)).not.toBeInTheDocument();
  });

  /**
   * @rule POO-1596 F1: the panel's own gate, which no hook test can reach.
   *
   * `buyMethodMinUsd` is threaded only when `methodMinUsd` is present AND `buyOrderUsd` sits at the
   * app floor (POO-1512's crypto-side comparison). Before F1 the minimum was written only inside the
   * quote effect, so the gas-first leg, which deliberately spends no quote, satisfied the second half
   * and failed the first: the disclosure went dark on exactly the order that is small enough for a
   * method's own floor to reject it.
   *
   * So this is the two halves meeting: the minimum row renders from the METHODS list with no quote
   * behind it, and no charge is printed beside it, because there is none to print.
   */
  it("[POO-1596] states the method minimum on an unpriced gas-first order at the floor", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: true, currencyCodeFrom: "USD", methods: [CARD] });
    onRamp.getQuote.mockResolvedValue(quoteCharging(10.4));

    // A sub-floor requirement, clamped up to `PAYBIS_MIN_USD`: the smallest order the app can place.
    await renderRoutes({ ...partialInput, opRequiredUsdc: 3 }, gasFirstContext);

    expect(await screen.findByText("Minimum $10.00 with Credit Card")).toBeInTheDocument();
    // ...and nothing was quoted for it, so the caption stands in for the figure.
    expect(onRamp.getQuote).not.toHaveBeenCalled();
    expect(screen.getByText("Final charge shown at checkout")).toBeInTheDocument();
    // No charge row beside the minimum. The charge prints as "$10.40 with Credit Card", which the
    // minimum's own "Minimum $10.00 with Credit Card" must not be mistaken for.
    expect(screen.queryByText(/^\$[\d.,]+ with Credit Card$/)).not.toBeInTheDocument();
  });

  // @rule POO-1596: the ordinary wallet is untouched: Base pays its own gas, the order is USDC, and
  // the pair and the live charge are exactly what they were before this issue.
  it("[POO-1596] still lists and prices USDC-BASE when the wallet can pay Base gas", async () => {
    onRamp.getMethods.mockResolvedValue({ ok: true, methods: [CARD] });
    onRamp.getQuote.mockResolvedValue(quoteCharging(108.42));

    await renderRoutes(partialInput);

    expect(await screen.findByText("$108.42 with Credit Card")).toBeInTheDocument();
    expect(onRamp.getMethods).toHaveBeenCalledWith({ currencyCodeTo: "USDC-BASE" });
    expect(onRamp.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ currencyCodeTo: "USDC-BASE" }),
    );
  });
});
