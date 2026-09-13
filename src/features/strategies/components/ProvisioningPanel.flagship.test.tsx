/**
 * @id PP-CORE-CMP-046 (POO-1043)
 * @name ProvisioningPanel — the three loose ends
 * @implements-rules-version v6 (POO-1043 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * POO-1042 shipped the panel bound to the real rail and deliberately left three things unbound. Each
 * of them is a piece of finished work that no production caller reached, which is the same as not
 * having built it:
 *
 *   [R7] the recovery journal is minted at the CONFIRM and never before, so POO-1038's idempotency
 *        machinery actually runs, and a route the user only looked at leaves no in-flight record.
 *   [R8] a materially worse re-quote is measured against the run's shared buffer (POO-1508 [R43]
 *        rules v2, superseding the original "prompts the user" reading of this rule). With no
 *        consumer wired the rail refuses, which is the right default and a dead end: the leg aborts
 *        with no way to retry.
 *   [R9] the itemised cost the user should read before confirming is on screen, above the confirm.
 *
 * The rail is stubbed here (it signs and broadcasts); `useProvisioningRail.test.tsx` is where the
 * journal and the buffer consumer run for real.
 *
 * POO-1503 (Rafael, 2026-08-11): the suite runs in REAL mode now (a `context` with one covering
 * target-chain holding). The mock plan screen these rules were first proven on is deleted, and the
 * "approval" [R7] is about is step 2's `Confirm and start`; mock mode auto-starts, so "merely
 * looking" without minting is only a real-mode state.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { GasFeasibility, ProvisioningPlan } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { TransactionError } from "@/lib/tx/sendTransaction";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { PROVISIONING_BUFFER_EXCEEDED_CODE } from "../lib/buildPlanSteps";
import { ProvisioningPanel } from "./ProvisioningPanel";

const { planHolder, railHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
  railHolder: {
    openJournal: vi.fn(),
    closeJournal: vi.fn(),
    options: null as unknown,
    /** Captured from the panel, so a test can drive the gate the way a real leg would. */
    consumeBuffer: null as ((worseBps: number) => boolean) | null,
    /** What the stub rail's single step does. Replaced per test. */
    run: (async () => ({ txHash: "0xleg" })) as (ctx: Record<string, unknown>) => Promise<unknown>,
  },
}));

vi.mock("../hooks/useProvisioningPlan", () => ({
  useProvisioningPlan: () => ({
    plan: planHolder.current,
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

vi.mock("../hooks/useProvisioningRail", () => ({
  useProvisioningRail: (options: unknown) => {
    railHolder.options = options;
    return {
      buildSteps: (_plan: ProvisioningPlan, reporters: { consumeBuffer?: never }) => {
        railHolder.consumeBuffer = (reporters.consumeBuffer ?? null) as never;
        return [{ key: "swap-token-0", run: railHolder.run }];
      },
      openJournal: railHolder.openJournal,
      closeJournal: railHolder.closeJournal,
    };
  },
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
  useRouter: () => ({ push: vi.fn() }),
}));

function noop() {}

const OPERATION = { kind: "invest" as const, strategyId: "strat-1" };

const ARBITRUM = 42161;
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

/** One covering holding on the operation's own chain, so step 2 opens pre-selected and armed. */
function liveContext(): ProvisioningGateContext {
  const source: FundingSource = {
    chainId: ARBITRUM,
    address: USDC_ARBITRUM,
    symbol: "USDC",
    decimals: 6,
    amount: "500000000",
    usd: 500,
    reachableChainIds: [ARBITRUM],
    isNative: false,
    logoUrl: "",
  };
  const gas: GasFeasibility = {
    chainId: ARBITRUM,
    verdict: "OK",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0,
    surplusUsd: 5,
    reasonKey: "provisioning.gasVerdict.ok",
  };
  return {
    targetChainId: ARBITRUM,
    sources: [source],
    gasByChain: { [ARBITRUM]: gas },
    balancesByChain: { [ARBITRUM]: { nativeUsd: 5, tokenUsd: 500 } },
    gasEstimateUsd: 0.075,
  };
}

function renderPanel(props: Partial<Parameters<typeof ProvisioningPanel>[0]> = {}) {
  return renderWithProviders(
    <ProvisioningPanel
      input={SCENARIOS.usdcBridge}
      context={liveContext()}
      operation={OPERATION}
      opLabel="Invest in Stable Yield"
      onDone={noop}
      onCancel={noop}
      {...props}
    />,
  );
}

beforeEach(() => {
  planHolder.current = realProvisioningPlan();
  railHolder.openJournal.mockClear();
  railHolder.closeJournal.mockClear();
  railHolder.consumeBuffer = null;
  railHolder.options = null;
  railHolder.run = async () => ({ txHash: "0xleg" });
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

describe("[R9] the cost breakdown is on step 2, above the CTA that signs", () => {
  // POO-1503 [R18]: the itemisation lives behind `See details` on step 2 now, and opening the
  // disclosure is the read-before-agree moment these three cases pin.
  it("renders what the route costs before the user is asked to approve it", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "See details" }));
    const breakdown = await screen.findByTestId("provisioning-cost-breakdown");
    // The contract's own total, which is what POO-1040 built and nothing rendered.
    expect(breakdown).toHaveTextContent("You pay");
    expect(breakdown).toHaveTextContent("$122.83");
  });

  it("puts it ABOVE the CTA, so it is read before it is agreed to", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "See details" }));
    const breakdown = await screen.findByTestId("provisioning-cost-breakdown");
    const cta = screen.getByRole("button", { name: "Confirm and start" });
    // DOCUMENT_POSITION_FOLLOWING: the CTA comes after the costs.
    expect(breakdown.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers the buy-crypto peer option rather than only the route", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "See details" }));
    expect(await screen.findByText("Buy crypto instead")).toBeInTheDocument();
  });
});

describe("[R7] the journal is minted at the confirm", () => {
  it("tells the rail what operation this route funds", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm and start" });

    expect(railHolder.options).toMatchObject({
      operation: { kind: "invest", strategyId: "strat-1", targetChainId: 42161 },
    });
  });

  it("does not mint one for a plan the user is merely looking at", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm and start" });

    expect(railHolder.openJournal).not.toHaveBeenCalled();
  });

  it("mints it with the approved plan the moment the user confirms", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));

    expect(railHolder.openJournal).toHaveBeenCalledTimes(1);
    expect(railHolder.openJournal).toHaveBeenCalledWith(planHolder.current);
  });

  it("retires it when the route completes, so nothing reads as still in flight", async () => {
    const onDone = vi.fn();
    renderPanel({ onDone });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));

    await pressDone();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // @rule POO-1504 R27 — the journal closes on SETTLEMENT, not on this press. It is asserted after
    // the press only because that is when the test can be sure the run is over.
    expect(railHolder.closeJournal).toHaveBeenCalledTimes(1);
  });

  it("keeps the record when a leg fails, because that is exactly what recovery needs", async () => {
    railHolder.run = async () => {
      throw new Error("the wallet rejected the request");
    };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));

    await screen.findByRole("button", { name: "Try again" });
    expect(railHolder.closeJournal).not.toHaveBeenCalled();
  });
});

describe("[R43] rules v2: the run's shared buffer decides, not a step that asks to accept a worse price", () => {
  /**
   * Confirm the plan, then let the leg trip the buffer gate (`consumeBuffer` refuses) and reach the
   * "prices moved" prompt. No `RequoteChange` payload any more: the gate is a single boolean the rail
   * consults BEFORE throwing, exactly as `buildPlanSteps.ts`'s `gateRequote` does it for real.
   */
  async function reachBufferExceededPrompt(
    props: Partial<Parameters<typeof ProvisioningPanel>[0]> = {},
  ) {
    railHolder.run = async () => {
      const absorbed = railHolder.consumeBuffer?.(1030) ?? false;
      if (!absorbed) {
        throw new TransactionError("nothing was sent and your money did not move", {
          code: PROVISIONING_BUFFER_EXCEEDED_CODE,
        });
      }
      return { txHash: "0xleg" };
    };
    renderPanel(props);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));
    await screen.findByRole("alertdialog");
  }

  it("wires a consumer at all, so the rail is not left refusing by default", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm and start" });

    expect(railHolder.consumeBuffer).toBeTypeOf("function");
  });

  it("shows the buffer-exceeded prompt, naming the market rather than the product", async () => {
    await reachBufferExceededPrompt();

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Prices moved while this ran");
  });

  it("takes focus when it appears, so it is announced rather than silently waiting", async () => {
    await reachBufferExceededPrompt();

    // Nothing the user did put this on screen, so nothing would move focus to it either. Focus lands
    // on the dialog itself, not on its retry button, so the label and body are read out first.
    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveFocus());
  });

  it("Try again retries the SAME leg with a fresh attempt, not the same rejected one", async () => {
    let attempt = 0;
    railHolder.run = async () => {
      attempt += 1;
      // Only the FIRST attempt trips the gate: a fresh quote on retry is what "Try again" promises.
      if (attempt === 1) {
        const absorbed = railHolder.consumeBuffer?.(1030) ?? false;
        if (!absorbed) {
          throw new TransactionError("nothing was sent and your money did not move", {
            code: PROVISIONING_BUFFER_EXCEEDED_CODE,
          });
        }
      }
      return { txHash: "0xleg" };
    };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and start" }));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(attempt).toBe(2));
    // The prompt clears once the retry lands: no lingering "prices moved" dialog over a settled run.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("Cancel aborts the run instead of retrying blind", async () => {
    const onCancel = vi.fn();
    await reachBufferExceededPrompt({ onCancel });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // @rule M5.2 (POO-1526) — both exits of the buffer-exceeded prompt are their own full-width rows,
  // so the 44pt target is an explicit min-height, not a bigger font.
  it("[M5.2] both prompt exits carry an explicit 44pt touch target", async () => {
    await reachBufferExceededPrompt();

    expect(screen.getByRole("button", { name: "Try again" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("min-h-11");
  });
});
