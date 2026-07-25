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
 *   [R8] a materially worse re-quote PROMPTS. With no confirmer the rail refuses, which is the right
 *        default and a dead end: the leg aborts with no way for the user to accept.
 *   [R9] the itemised cost the user should read before confirming is on screen, above the confirm.
 *
 * The rail is stubbed here (it signs and broadcasts); `useProvisioningRail.test.tsx` is where the
 * journal and the confirmer run for real.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningPlan } from "@/lib/provisioning";
import { SCENARIOS } from "@/lib/provisioning";
import { realProvisioningPlan } from "../../../../tests/fixtures/realProvisioningPlan";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import type { RequoteChange } from "../lib/buildPlanSteps";
import { ProvisioningPanel } from "./ProvisioningPanel";

const { planHolder, railHolder } = vi.hoisted(() => ({
  planHolder: { current: null as ProvisioningPlan | null },
  railHolder: {
    openJournal: vi.fn(),
    closeJournal: vi.fn(),
    options: null as unknown,
    /** Captured from the panel, so a test can drive the prompt the way a real leg would. */
    confirmRequote: null as ((change: RequoteChange) => Promise<boolean>) | null,
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
      buildSteps: (_plan: ProvisioningPlan, reporters: { confirmRequote?: never }) => {
        railHolder.confirmRequote = (reporters.confirmRequote ?? null) as never;
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
}));

function noop() {}

const OPERATION = { kind: "invest" as const, strategyId: "strat-1" };

function renderPanel(props: Partial<Parameters<typeof ProvisioningPanel>[0]> = {}) {
  return renderWithProviders(
    <ProvisioningPanel
      input={SCENARIOS.usdcBridge}
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
  railHolder.confirmRequote = null;
  railHolder.options = null;
  railHolder.run = async () => ({ txHash: "0xleg" });
});

describe("[R9] the cost breakdown is on the plan, above the confirm", () => {
  it("renders what the route costs before the user is asked to approve it", async () => {
    renderPanel();

    const breakdown = await screen.findByTestId("provisioning-cost-breakdown");
    // The contract's own total, which is what POO-1040 built and nothing rendered.
    expect(breakdown).toHaveTextContent("You pay");
    expect(breakdown).toHaveTextContent("$122.83");
  });

  it("puts it ABOVE the confirm, so it is read before it is agreed to", async () => {
    renderPanel();

    const breakdown = await screen.findByTestId("provisioning-cost-breakdown");
    const cta = screen.getByRole("button", { name: "Confirm & continue" });
    // DOCUMENT_POSITION_FOLLOWING: the CTA comes after the costs.
    expect(breakdown.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers the buy-crypto peer option rather than only the route", async () => {
    renderPanel();

    expect(await screen.findByText("Buy crypto instead")).toBeInTheDocument();
  });
});

describe("[R7] the journal is minted at the confirm", () => {
  it("tells the rail what operation this route funds", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm & continue" });

    expect(railHolder.options).toMatchObject({
      operation: { kind: "invest", strategyId: "strat-1", targetChainId: 42161 },
    });
  });

  it("does not mint one for a plan the user is merely looking at", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm & continue" });

    expect(railHolder.openJournal).not.toHaveBeenCalled();
  });

  it("mints it with the approved plan the moment the user confirms", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));

    expect(railHolder.openJournal).toHaveBeenCalledTimes(1);
    expect(railHolder.openJournal).toHaveBeenCalledWith(planHolder.current);
  });

  it("retires it when the route completes, so nothing reads as still in flight", async () => {
    const onDone = vi.fn();
    renderPanel({ onDone });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(railHolder.closeJournal).toHaveBeenCalledTimes(1);
  });

  it("keeps the record when a leg fails, because that is exactly what recovery needs", async () => {
    railHolder.run = async () => {
      throw new Error("the wallet rejected the request");
    };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));

    await screen.findByRole("button", { name: "Try again" });
    expect(railHolder.closeJournal).not.toHaveBeenCalled();
  });
});

describe("[R8] a materially worse re-quote is put to the user", () => {
  /** Confirm the plan, then let the leg reach its re-quote gate and hand back the pending decision. */
  async function reachRequotePrompt() {
    let decided: boolean | null = null;
    railHolder.run = async () => {
      decided = await (railHolder.confirmRequote?.({
        legIndex: 0,
        amountIn: "40000000000000000",
        approvedAmountOut: "120400000",
        quotedAmountOut: "108000000",
        worseBps: 1030,
      }) ?? Promise.resolve(false));
      if (!decided) throw new Error("the new price was not approved");
      return { txHash: "0xleg" };
    };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & continue" }));
    await screen.findByRole("alertdialog");
    return () => decided;
  }

  it("wires a confirmer at all, so the rail is not left refusing by default", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Confirm & continue" });

    expect(railHolder.confirmRequote).toBeTypeOf("function");
  });

  it("shows how much worse the price got, in the user's own terms", async () => {
    await reachRequotePrompt();

    // 1030 bps is 10.30%: the figure the user is being asked to accept, not a bps count.
    expect(screen.getByRole("alertdialog")).toHaveTextContent("10.30%");
  });

  it("accepting lets the leg continue", async () => {
    const decision = await reachRequotePrompt();

    fireEvent.click(screen.getByRole("button", { name: "Accept new price" }));

    await waitFor(() => expect(decision()).toBe(true));
  });

  it("declining stops the route instead of signing a price nobody agreed to", async () => {
    const decision = await reachRequotePrompt();

    fireEvent.click(screen.getByRole("button", { name: "Stop here" }));

    await waitFor(() => expect(decision()).toBe(false));
    // And the user lands somewhere they can act from, not on a silently dead plan.
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
