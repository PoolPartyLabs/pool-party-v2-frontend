/**
 * @id PP-CORE-CMP-046
 * @name ProvisioningPanel — tests
 * @implements-rules-version v3 (POO-1088 rules v2) · v2 (POO-1037 rules v1) · v1
 * Variant-agnostic plan render (multi + gas-only), execution → resume (onDone), cancel, the in-flight
 * lock, and the cleared-custom-gas regression. Uses fireEvent for the flow (see CollectModal.test).
 *
 * POO-1037 (hackathon POO-1022): the long bridge step. A leg that settles on another chain takes
 * MINUTES, so the panel has to say how long, hold the dismissal lock for the whole wait [R5], and
 * degrade at the poll ceiling into a recoverable "still settling" state that offers NO retry [R3] —
 * a retry would re-invoke the step verbatim and re-broadcast a bridge that is already in flight.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import type { ProvisioningNeedInput } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
// Type-only across the server boundary, exactly as the panel imports it.
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { TransactionError } from "@/lib/tx/sendTransaction";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { BRIDGE_PENDING_CODE } from "../lib/awaitBridgeSettlement";
import { ProvisioningPanel } from "./ProvisioningPanel";

// Two mounted surfaces now render the locale-aware Link: POO-1043 [R9]'s ProvisioningCostBreakdown in
// the plan phase (its buy-crypto peer option) and POO-1044 [R3]'s buy-crypto escape on the blocked
// error branch. next-intl's navigation factory reaches for `next/navigation` at import time and
// app-router navigation does not exist under jsdom, so it is stubbed, which is the repository's
// standing test convention (88 files).
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

function noop() {}

interface StubPlan {
  steps: { type: string; key: string }[];
}

/** Immediate real-seam steps so the flow settles without the 900ms mock delay. */
const immediateSteps = (plan: StubPlan) =>
  plan.steps
    .filter((s) => s.type !== "op")
    .map((s) => ({ key: s.key, run: async () => ({ txHash: `0x${s.key}` }) }));

/** Real-seam steps where the bridge leg never settles: the wait a real bridge imposes. */
const hangingBridgeSteps = (plan: StubPlan) =>
  plan.steps
    .filter((s) => s.type !== "op")
    .map((s) => ({
      key: s.key,
      run:
        s.type === "bridge"
          ? () => new Promise<{ txHash: string }>(() => {})
          : async () => ({ txHash: `0x${s.key}` }),
    }));

/** Real-seam steps where the bridge leg reaches the poll ceiling still un-arrived. */
const ceilingBridgeSteps = (plan: StubPlan) =>
  plan.steps
    .filter((s) => s.type !== "op")
    .map((s) => ({
      key: s.key,
      run: async () => {
        if (s.type !== "bridge") return { txHash: `0x${s.key}` };
        throw new TransactionError("Bridged funds have not arrived yet", {
          code: BRIDGE_PENDING_CODE,
          txHash: "0x9f2c1d4a6b8e0f3c5a7d9e1b2c4f6a8d0e2b4c6f8a0d2e4b6c8f0a2d4e6b8c0f",
        });
      },
    }));

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

describe("ProvisioningPanel", () => {
  // @rule POO-1503 R3: the mock Confirm screen is deleted (Rafael, 2026-08-11, literal acceptance),
  // so mock mode auto-starts once the fixture plan resolves and the RUNNING card is where the plan is
  // rendered. What the test always pinned still holds one surface later: a multi-step plan shows its
  // steps, its op anchor and its mock badge, and no gas picker (POO-1509 [R34]).
  it("auto-starts in mock mode and renders the running plan (op label + steps, no gas picker)", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    // Straight to the execution surface: no Confirm heading, no Confirm press.
    expect(await screen.findByText("Working on it")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Almost there" })).not.toBeInTheDocument();
    expect(screen.getByText("Move to Arbitrum")).toBeInTheDocument();
    expect(screen.getByText("Invest in Stable Yield")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /gas amount/i })).not.toBeInTheDocument();
    // @rule POO-807 R1: the execution view carries the visible mock-mode indicator.
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
  });

  // @rule POO-1509 R4 — OVERTURNS the screen this asserted. A gas-only requirement is no longer a
  // "One step" variant of the plan: it is the auxiliary `Not enough gas`, in both modes. The
  // variant-agnostic claim the test was written for still holds, one level up: the panel renders
  // whatever the need says, and it says gas-only here.
  it("is variant-agnostic: a gas-only need renders the auxiliary gas screen", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.gasOnly}
        opLabel="Withdraw from Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Not enough gas" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /gas amount/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "One step" })).not.toBeInTheDocument();
  });

  it("runs the execution then resumes the op (onDone) on success", async () => {
    const onDone = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
        onDone={onDone}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );
    // POO-1503: no Confirm press. The mock seed starts the run the moment the plan resolves.
    // [F5-R3] The execution headline. Renamed from "Setting up your funds" when the v2 screens
    // landed, and this assertion was left behind pointing at a string no locale still holds.
    expect(await screen.findByText("Working on it")).toBeInTheDocument();
    // @rule POO-1504 R27 — the run finishing and the operation resuming are two events now: the
    // state button says `Done` on settlement, and pressing it is the handoff.
    await pressDone();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  // @rule POO-1504 R28 — every leg needs a signature, so leaving is how a route strands halfway: the
  // keep-open line stands while the rail works, and goes the moment the run has finished, because
  // there is nothing left to keep open for and a warning that outlives its truth is what makes the
  // rest of the copy less believable.
  it("[R28] shows the keep-open line during the run and drops it once the run has finished", async () => {
    // A bridge leg that never settles: the run is observably IN FLIGHT for as long as the test looks.
    const running = renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={hangingBridgeSteps}
      />,
    );
    expect(await screen.findByText("Keep this open.")).toBeInTheDocument();
    running.unmount();

    // The same route with every leg settling: once the state button reads enabled (`Done`), the run
    // has finished and the line must be gone, before any press.
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridgeGas}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={immediateSteps}
      />,
    );
    const done = await screen.findByTestId("provisioning-exec-state", undefined, { timeout: 3000 });
    await waitFor(() => expect(done).toBeEnabled(), { timeout: 3000 });
    expect(screen.queryByText("Keep this open.")).not.toBeInTheDocument();
  });

  // POO-1503: the mock Confirm screen carried mock mode's only pre-run Cancel and is deleted, so the
  // back-out this pins is the auxiliary gas screen's, which is the one mock-reachable screen that
  // still stands before the run.
  it("returns to the host (onCancel) when the gas screen is dismissed", async () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.gasOnly}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(onCancel).toHaveBeenCalled();
  });

  // @rule POO-1509 R35 — the rule this pins is unchanged, but it MOVED with the control: an empty or
  // invalid Custom amount must not enable the CTA. It is asserted on the auxiliary gas screen, which
  // is the only screen that has a Custom field now. The original defect (review POO-409) was a
  // cleared field re-enabling the CTA and dropping the swap-gas step from the plan.
  it("[R35] disables the gas CTA when the custom amount is cleared", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.gasOnly}
        opLabel="Withdraw from Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("Custom gas amount")).toBeInTheDocument();
    expect(screen.getByTestId("gas-topup-confirm")).toBeDisabled();
  });

  it("reports the in-flight lock while provisioning runs", async () => {
    const onLockChange = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcOnly}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        onLockChange={onLockChange}
        buildPlanSteps={immediateSteps}
      />,
    );
    // POO-1503: the run starts from the mock seed, and the lock reports the moment it does.
    await waitFor(() => expect(onLockChange).toHaveBeenCalledWith(true));
  });

  // POO-1503: every case in this block used to press the mock Confirm first. That screen is deleted,
  // so the mock seed starts each run the moment the fixture plan resolves; the awaits that follow
  // are what synchronise on it.
  describe("POO-1037 — the long bridge step", () => {
    it("[R2] tells the user how long the bridge leg takes while it is running", async () => {
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={hangingBridgeSteps}
        />,
      );
      // The mock plan carries no `estimatedFillTimeMs`, so the honest unknown-ETA line shows rather
      // than an invented constant.
      expect(
        await screen.findByText(/We'll continue as soon as your funds arrive/),
      ).toBeInTheDocument();
    });

    it("[R5] holds the dismissal lock for the whole settlement wait", async () => {
      const onLockChange = vi.fn();
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          onLockChange={onLockChange}
          buildPlanSteps={hangingBridgeSteps}
        />,
      );
      await waitFor(() => expect(onLockChange).toHaveBeenLastCalledWith(true));
      // The bridge never settles, so the lock must still be held: nothing may close the modal while
      // money is in flight between two chains.
      expect(onLockChange.mock.calls.filter(([locked]) => locked === false)).toHaveLength(1);
    });

    it("[R5] releases the lock exactly once when the wait degrades", async () => {
      const onLockChange = vi.fn();
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          onLockChange={onLockChange}
          buildPlanSteps={ceilingBridgeSteps}
        />,
      );
      // Mount reports unlocked, Confirm locks, the ceiling unlocks. Exactly once, in that order.
      await waitFor(() => expect(onLockChange.mock.calls).toEqual([[false], [true], [false]]));
    });

    it("[R3] degrades to the still-settling state at the ceiling, with the transfer verifiable", async () => {
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={ceilingBridgeSteps}
        />,
      );

      expect(await screen.findByText("Still on its way")).toBeInTheDocument();
      // Never presented as a failure, and never as a success.
      expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
      // [R2] the user can verify the transfer independently, on the chain it was broadcast on.
      expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
        "href",
        expect.stringContaining(
          "0x9f2c1d4a6b8e0f3c5a7d9e1b2c4f6a8d0e2b4c6f8a0d2e4b6c8f0a2d4e6b8c0f",
        ),
      );
    });

    it("[R3] offers no retry at the ceiling, which would re-broadcast a bridge already in flight", async () => {
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={ceilingBridgeSteps}
        />,
      );

      expect(await screen.findByText("Still on its way")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("[R3] the plan stays recoverable: closing the degraded state returns to the host", async () => {
      const onCancel = vi.fn();
      const onDone = vi.fn();
      renderWithProviders(
        <ProvisioningPanel
          input={SCENARIOS.usdcBridge}
          opLabel="Invest in Stable Yield"
          onDone={onDone}
          onCancel={onCancel}
          buildPlanSteps={ceilingBridgeSteps}
        />,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Close" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      // The operation is NEVER resumed off an unsettled bridge: that would spend money that has not
      // arrived on the target chain.
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  // POO-1135: the "Where from" picker mount. Gated behind the fiatOnRamp flag, so the crypto-only cut
  // opens straight on the source selector exactly as it did.
  describe("the fiat 'Where from' picker (POO-1135)", () => {
    const BASE = 8453;
    const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

    // The panel reads the flag through `useFeatureFlags`, whose client snapshot is memoised for the
    // module's lifetime. Without this reset the first `stubEnv` below would leak into every later
    // case in the file, including the flag-OFF one.
    beforeEach(() => {
      __resetDevOverridesForTests();
    });
    afterEach(() => {
      __resetDevOverridesForTests();
    });

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

    // A wallet that covers only part of a $100 requirement, so with the on-ramp on there are two
    // routes (tokens-plus-buy and buy) and the picker has a genuine choice to offer.
    const partialContext: ProvisioningGateContext = {
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
    const partialInput: ProvisioningNeedInput = {
      currentChainId: BASE,
      targetChainId: BASE,
      opRequiredUsdc: 100,
      gasEstimateUsd: 0.5,
    };

    // @rule POO-1543 — the header's "You need $X" and the recommended `tokens` card's "Use your $Y"
    // describe the SAME requirement and must agree. Before this fix they didn't whenever the target
    // chain already had enough native gas (`verdict: "OK"`, so the route added no gas component) but
    // the quote still carried a positive `gasEstimateUsd`: the header added that estimate
    // unconditionally while the route added it only when the verdict said gas was actually needed,
    // so a wallet with plenty of gas saw "You need $105.53" above a card reading "Use your $105.00",
    // a real, user-visible disagreement about one number (murilo, 2026-08-13, from a live test
    // pool screenshot). Both now read $105.00: `(100 * 1.05)`, gas excluded on both sides since the
    // verdict is OK.
    it("[POO-1543] the header and the recommended tokens route agree when the wallet already has enough gas", async () => {
      vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
      try {
        const coveredContext: ProvisioningGateContext = {
          ...partialContext,
          // A wallet that fully covers the $100 requirement on its own, so `resolveFundingRoutes`
          // returns a `tokens` route (not `tokens-plus-buy`/`buy`) — the one whose amount the
          // header is meant to introduce. The on-ramp flag has to be on too, or `buy`/`deposit`
          // never join `tokens` and a single-route screen is skipped straight to `sources`.
          sources: [{ ...usdcOnBase, usd: 150 }],
        };
        renderWithProviders(
          <ProvisioningPanel
            input={partialInput}
            context={coveredContext}
            opLabel="Invest in Stable Yield"
            onDone={noop}
            onCancel={noop}
            buildPlanSteps={() => []}
          />,
        );

        expect(await screen.findByText("You need $105.00")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^use your \$105\.00/i })).toBeInTheDocument();
        // Regression guard: the pre-fix figure (gas added unconditionally) must never reappear.
        expect(screen.queryByText(/\$105\.53/)).not.toBeInTheDocument();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    // @rule POO-1543 — the OTHER branch of the same gate, so both are pinned. When the target chain
    // does NOT already hold gas (`verdict: "TOP_UP"`) the header must still ADD a gas component: the
    // fix shares the rows' PREDICATE, it is not a decision to stop counting gas. Without this case a
    // later "simplify" that hardcoded the gas term to zero would pass the OK-verdict test above and
    // ship a header that understates every top-up requirement, silently.
    //
    // It also pins what POO-1543 does NOT close. With gas needed the header adds the QUOTE's
    // estimate (`(100 + 0.50) * 1.05 = $105.53`) while `routeGasComponentUsd` gives the tokens row
    // the constant `GAS_CUSTOM_MIN_USDC_USD` (`(100 + 5) * 1.05 = $110.25`). Predicate shared,
    // amount not: a $4.72 gap with the header the LOWER of the two. Asserted rather than left
    // implicit, so the day the three sizers are reconciled this test fails and states the decision.
    it("[POO-1543] the header still adds the gas component when the target chain needs a top-up", async () => {
      vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
      try {
        const topUpContext: ProvisioningGateContext = {
          ...partialContext,
          sources: [{ ...usdcOnBase, usd: 150 }],
          gasByChain: {
            [BASE]: {
              chainId: BASE,
              verdict: "TOP_UP",
              quotedGasUsd: 0.02,
              requiredGasUsd: 0.075,
              shortfallUsd: 0.075,
              surplusUsd: 0,
              reasonKey: "provisioning.gasVerdict.topUp",
            },
          },
        };
        renderWithProviders(
          <ProvisioningPanel
            input={partialInput}
            context={topUpContext}
            opLabel="Invest in Stable Yield"
            onDone={noop}
            onCancel={noop}
            buildPlanSteps={() => []}
          />,
        );

        // The gas term is genuinely counted: strip it and this header would read $105.00.
        expect(await screen.findByText("You need $105.53")).toBeInTheDocument();
        expect(screen.queryByText("You need $105.00")).not.toBeInTheDocument();
        // And the residual, stated: the row sizes its own gas from the constant, not the quote.
        expect(screen.getByRole("button", { name: /^use your \$110\.25/i })).toBeInTheDocument();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    /**
     * @rule POO-1543, the OTHER consumer of the same seed. `seededRequiredUsd` does not only feed the
     * header: with the on-ramp OFF it is also the source selector's `requiredUsd`, which is the `Y` in
     * the meter's "X of Y". That prop reads `input.opRequiredUsdc` only when the on-ramp is ON, so the
     * crypto-only cut is where the gas gating moved a second user-visible number, and PR #866 shipped
     * with no test on it (PR review, 0xmvercosa).
     *
     * Two mounts, because "$105.00" alone would still pass if the gas component were deleted outright
     * rather than gated. The denominator has to FOLLOW the target-chain verdict: absent when the wallet
     * already holds gas (`OK`), present when it does not (`TOP_UP`), which is the same verdict the
     * `tokens` row reads.
     */
    it("[POO-1543] the crypto-only denominator follows the target-chain gas verdict", async () => {
      // Flag OFF, so `resolveFundingRoutes` returns one route, the picker is skipped and step 2 is the
      // first screen. The one target-chain, non-native holding arrives pre-selected (POO-1155), so the
      // meter reads a real numerator rather than "$0.00 of".
      const coveredContext: ProvisioningGateContext = {
        ...partialContext,
        sources: [{ ...usdcOnBase, amount: "150000000", usd: 150 }],
        balancesByChain: { [BASE]: { nativeUsd: 5, tokenUsd: 150 } },
      };
      const gasHeld = renderWithProviders(
        <ProvisioningPanel
          input={partialInput}
          context={coveredContext}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={() => []}
        />,
      );

      expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute(
        "data-phase",
        "sources",
      );
      // `(100 * 1.05)`, gas excluded: the verdict is OK, so the wallet is not asked to fund gas it is
      // already holding. Same figure as the header's, on a screen the header never reaches.
      expect(screen.getByText("$150.00 of $105.00")).toBeInTheDocument();
      // Regression guard, as on the header: the pre-fix denominator must never reappear.
      expect(screen.queryByText(/\$105\.53/)).not.toBeInTheDocument();
      gasHeld.unmount();

      // The other direction. Gas IS needed on the target chain, so the component belongs in the
      // denominator and `(100 + 0.5) * 1.05` is the honest ask. A gate that simply dropped the gas
      // would pass the mount above and fail here.
      renderWithProviders(
        <ProvisioningPanel
          input={partialInput}
          context={{
            ...coveredContext,
            gasByChain: {
              [BASE]: {
                chainId: BASE,
                verdict: "TOP_UP",
                quotedGasUsd: 0.02,
                requiredGasUsd: 0.075,
                shortfallUsd: 0.055,
                surplusUsd: 0,
                reasonKey: "provisioning.gasVerdict.topUp",
              },
            },
          }}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={() => []}
        />,
      );

      expect(await screen.findByText("$150.00 of $105.53")).toBeInTheDocument();
    });

    /**
     * @rule POO-1543 + POO-1042 [R7], the second untested consumer: the same `requiredUsd` prop is
     * what the CTA gates on. With the on-ramp OFF `allowShortfall` is false, so the ORIGINAL coverage
     * gate stands and `Confirm and start` opens only once the selection covers that figure. Lowering
     * the seed therefore lowers the bar at which the CTA opens, which is a money decision, not a
     * caption.
     *
     * The wallet is sized to sit BETWEEN the two figures ($105.20: above the gas-gated $105.00, below
     * the pre-fix $105.53) so the assertion cannot pass by accident. Before the fix this exact wallet
     * read "$0.33 still to go" beside a disabled CTA while already holding every dollar and every cent
     * of gas the operation needed.
     *
     * [R7]'s hard constraint is the second half: the CTA must never flip from enabled to disabled
     * underneath the user. The seed opens it; the quoted plan is the final word (`quotedPlanFallsShort`
     * re-measures the selection against the plan's own total), so the check is re-asserted once that
     * quote is on screen, which is what `See details` discloses.
     *
     * LIMIT, stated so the name does not overclaim. The mock `computePlan` returns a plan whose `buy`
     * step (about $114) exceeds the quote's own `totalPayUsd` (about $104), so `sourcesMustCoverUsd`
     * is 0 and `quotedPlanFallsShort` can never be true on this fixture. The second half is therefore
     * an INVARIANT assertion over the quoted screen, not an exercised flip path: it will catch a
     * future regression that makes the [R7] re-check fire on a covered selection, but it cannot fail
     * today for the reason the name suggests. The mock-fidelity gap behind that is tracked on
     * POO-1572.
     */
    it("[POO-1543] the crypto-only CTA opens against the gas-gated figure and does not flip back", async () => {
      const betweenContext: ProvisioningGateContext = {
        ...partialContext,
        sources: [{ ...usdcOnBase, amount: "105200000", usd: 105.2 }],
        balancesByChain: { [BASE]: { nativeUsd: 5, tokenUsd: 105.2 } },
      };
      renderWithProviders(
        <ProvisioningPanel
          input={partialInput}
          context={betweenContext}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={() => []}
        />,
      );

      expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute(
        "data-phase",
        "sources",
      );
      expect(screen.getByText("$105.20 of $105.00")).toBeInTheDocument();
      const cta = screen.getByRole("button", { name: "Confirm and start" });
      expect(cta).toBeEnabled();

      // The quoted plan lands and the selection is re-measured against it. [R7]: this is the moment a
      // flip would happen, and it must not.
      fireEvent.click(screen.getByRole("button", { name: "See details" }));
      expect(await screen.findByText("You pay")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm and start" })).toBeEnabled();
      // And the re-pick banner, which is what a genuine shortfall against the quote would raise.
      expect(screen.queryByText(/Pick one more source/i)).not.toBeInTheDocument();
    });

    // @rule POO-1502 [R20] — `<` on step 2 returns to step 1. Gated on having ARRIVED from step 1:
    // in the crypto-only cut `resolveFundingRoutes` returns one route, the picker is skipped, and a
    // back arrow would point at a screen that never existed.
    it("[R20] back on step 2 returns to the route picker", async () => {
      vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
      try {
        renderWithProviders(
          <ProvisioningPanel
            input={partialInput}
            context={partialContext}
            opLabel="Invest in Stable Yield"
            onDone={noop}
            onCancel={noop}
            buildPlanSteps={() => []}
          />,
        );

        fireEvent.click(await screen.findByRole("button", { name: /^use \$[\d,.]+ \+ buy \$/i }));
        expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute(
          "data-phase",
          "sources",
        );

        fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

        expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute(
          "data-phase",
          "routes",
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("[R20] shows no back control when step 1 was never on screen", () => {
      // Flag off: one route, the picker is skipped, and step 2 is the first screen the user sees.
      renderWithProviders(
        <ProvisioningPanel
          input={partialInput}
          context={partialContext}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={() => []}
        />,
      );

      expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
    });

    it("leads with the picker when the on-ramp is enabled and there is a real choice", async () => {
      vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
      try {
        renderWithProviders(
          <ProvisioningPanel
            input={partialInput}
            context={partialContext}
            opLabel="Invest in Stable Yield"
            onDone={noop}
            onCancel={noop}
            buildPlanSteps={() => []}
          />,
        );

        const panel = await screen.findByTestId("provisioning-panel");
        expect(panel).toHaveAttribute("data-phase", "routes");
        expect(screen.getByRole("button", { name: /^buy \$/i })).toBeInTheDocument();

        // Choosing a token route advances to the source selector (the plan is still suspended, so no
        // upstream call runs).
        fireEvent.click(screen.getByRole("button", { name: /^use \$[\d,.]+ \+ buy \$/i }));
        expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute(
          "data-phase",
          "sources",
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("the crypto-only cut (flag off) skips the picker and opens on the source selector", async () => {
      renderWithProviders(
        <ProvisioningPanel
          input={partialInput}
          context={partialContext}
          opLabel="Invest in Stable Yield"
          onDone={noop}
          onCancel={noop}
          buildPlanSteps={() => []}
        />,
      );

      const panel = await screen.findByTestId("provisioning-panel");
      expect(panel).toHaveAttribute("data-phase", "sources");
      expect(screen.queryByRole("button", { name: /^buy \$/i })).not.toBeInTheDocument();
    });

    // PR 719 review, BLOCKING. The [R7] re-check measured the SELECTED sources against the plan's
    // gross `totalPayUsd`, which by [R2] is the whole requirement. A `buy` step is paid by card, from
    // no funding source at all, so every fiat-funded remainder scored as unfunded and the panel
    // bounced back to the source selector. On the pure-buy route the selection is EMPTY, so the
    // shortfall was the entire total and the route could never reach the plan it had just chosen.
    it("[R7] the buy route reaches its own plan, not the fall-short source selector", async () => {
      vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
      try {
        renderWithProviders(
          <ProvisioningPanel
            input={partialInput}
            context={partialContext}
            opLabel="Invest in Stable Yield"
            onDone={noop}
            onCancel={noop}
            buildPlanSteps={() => []}
          />,
        );

        fireEvent.click(await screen.findByRole("button", { name: /^buy \$/i }));

        // @rule POO-1503 R3 — the case matrix routes a pure buy `1 -> Buy -> 7`, so there is no plan
        // phase to land on: the click IS the start. What the test is about is unchanged and is the
        // reason it was written, that the buy route must not be hijacked back to the re-pick.
        await waitFor(() => {
          expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending");
        });
        // The plan it chose, with the fiat leg on it.
        // @rule POO-1504 R21 — the carousel keeps the full list mounted for the e2e contract, so the
        // current step is in the DOM twice. The query says which copy it means: the window is what a
        // person sees. The title is the plain form because this rail runs no steps, so nothing is
        // active ([R24] conjugates on state, and `idle` is not a state that gets conjugated).
        expect(
          within(screen.getByTestId("provisioning-exec-window")).getByText(/buy usdc/i),
        ).toBeInTheDocument();
        // And NOT the re-pick, whose banner is the tell.
        expect(screen.queryByText(/pick one more source/i)).not.toBeInTheDocument();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    // The same defect, on a MIXED plan: the selection covers the seeded requirement (so the selector's
    // CTA opens) but not the quoted total, and the buy leg covers the rest. Before the fix the panel
    // re-picked; the requirement is small here precisely so the quote's fixed fees push `totalPayUsd`
    // above the seed, which is what makes the pre-fix bounce reachable at all.
    const smallContext: ProvisioningGateContext = {
      ...partialContext,
      sources: [{ ...usdcOnBase, amount: "11500000", usd: 11.5 }],
      balancesByChain: { [BASE]: { nativeUsd: 5, tokenUsd: 11.5 } },
    };
    const smallInput: ProvisioningNeedInput = {
      currentChainId: BASE,
      targetChainId: BASE,
      opRequiredUsdc: 10,
      gasEstimateUsd: 0.5,
    };

    it("[R7] a tokens-plus-buy plan is not re-picked for the share the card covers", async () => {
      vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
      try {
        renderWithProviders(
          <ProvisioningPanel
            input={smallInput}
            context={smallContext}
            opLabel="Invest in Stable Yield"
            onDone={noop}
            onCancel={noop}
            buildPlanSteps={() => []}
          />,
        );

        // Tokens route -> pick the one holding -> confirm.
        fireEvent.click(await screen.findByRole("button", { name: /^use your \$/i }));
        fireEvent.click(await screen.findByRole("option", { name: /USDC on Base/i }));
        // @rule POO-1503 R19 — step 2's CTA signs, so it is `Confirm and start` (D2) and it lands on
        // the run rather than on a Confirm screen.
        fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));

        await waitFor(() => {
          expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending");
        });
        // @rule POO-1504 R21 — the carousel keeps the full list mounted for the e2e contract, so the
        // current step is in the DOM twice. The query says which copy it means: the window is what a
        // person sees. The title is the plain form because this rail runs no steps, so nothing is
        // active ([R24] conjugates on state, and `idle` is not a state that gets conjugated).
        expect(
          within(screen.getByTestId("provisioning-exec-window")).getByText(/buy usdc/i),
        ).toBeInTheDocument();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
