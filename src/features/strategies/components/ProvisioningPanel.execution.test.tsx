/**
 * @id PP-CORE-CMP-046 (POO-1088)
 * @name ProvisioningPanel — the execution and failure screens
 * @implements-rules-version v1 (POO-1088 rules v2)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Screens 7 (Running, `6550:615`) and 8 (Step failed, `6550:703`), driven through the panel rather
 * than through the card, because what these rules are actually about is what the PANEL feeds the
 * card: which row failed, what the plan's own tolerance is, and what of the user's money is already
 * somewhere safe.
 *
 * Rules under test (POO-1088 rules v2):
 *   [F5-R2] a stopped route says "Not started", never "Waiting"
 *   [F5-R4] the signing disclosure rides on the row the wallet is asking about
 *   [F5-R5] the failure names what already settled, and NEVER a figure it cannot substantiate
 *   [F5-R6] the failed row quotes the plan's own slippage, not a hardcoded one
 *   [F5-R7] Try again and Back, with retry semantics unchanged
 *
 * A real plan, deliberately: a mock plan carries no legs, so the rail expands it into nothing and
 * none of the rows these rules describe would ever exist.
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
  within,
} from "../../../../tests/utils/renderWithProviders";
import { planRailSteps } from "../lib/buildPlanSteps";
import { ProvisioningPanel } from "./ProvisioningPanel";

// The plan phase's cost breakdown and the blocked branch both mount the locale-aware Link, which
// resolves app-router navigation that does not exist under jsdom. Stubbed to a plain anchor, as in
// every other suite in this folder.
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

function noop() {}

/**
 * A rail that settles every step until `failAt`, which throws `message`.
 *
 * The rail order is approve → swap → approve → bridge, so failing the fourth step leaves exactly one
 * value-moving step settled. That is the case the settled-safe figure is interesting for: there IS
 * something to report, and it is not the whole route.
 */
function railFailingAt(failAt: number, message: string) {
  return (plan: ProvisioningPlan) =>
    planRailSteps(plan).map((step, index) => ({
      key: step.key,
      run: async () => {
        if (index === failAt) throw new Error(message);
        return { txHash: `0x${step.key}` };
      },
    }));
}

/**
 * Wait for the failure screen to settle. POO-1503: there is no Confirm to press; the seeded mock
 * start runs the failing rail the moment the plan resolves.
 */
async function runUntilItFails(buildPlanSteps: ReturnType<typeof railFailingAt>) {
  renderWithProviders(
    <ProvisioningPanel
      input={SCENARIOS.usdcBridge}
      opLabel="Invest in Stable Yield"
      onDone={noop}
      onCancel={noop}
      buildPlanSteps={buildPlanSteps}
    />,
  );
  await screen.findByRole("button", { name: "Try again" });
}

describe("ProvisioningPanel — Running (POO-1088)", () => {
  beforeEach(() => {
    planHolder.current = realProvisioningPlan();
  });

  it("[F5-R4] puts the signing disclosure on the step the wallet is asking about", async () => {
    // A leg that never resolves holds the route open on its own row, which is what the wallet
    // handoff really looks like: one step live, everything after it waiting.
    const stall = (plan: ProvisioningPlan) =>
      planRailSteps(plan).map((step, index) => ({
        key: step.key,
        run: async () =>
          index === 0
            ? new Promise<never>(() => {})
            : Promise.resolve({ txHash: `0x${step.key}` } as const),
      }));
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={stall}
      />,
    );

    // The disclosure is a security affordance (UF-28 [R4]): it is where a user finds out whether the
    // wallet is asking for an ALLOWANCE or for a transfer.
    //
    // @rule POO-1504 R26 — it sits BELOW the carousel window now, not inside the row. Keeping it in the
    // row would give carousel rows two different heights, so the window would jump every time a
    // signature step came up. It still describes the step being signed, which is what this asserts:
    // the window shows the approval, in the gerund ([R24]), and the disclosure names that token.
    expect(
      within(screen.getByTestId("provisioning-exec-window")).getByText("Approving WETH"),
    ).toBeInTheDocument();
    const why = await screen.findByRole("button", { name: "What am I signing?" });
    fireEvent.click(why);
    expect(screen.getByText("Token approval")).toBeInTheDocument();
    // And it names the token, because an allowance is granted per token and keeps standing.
    expect(screen.getByText(/move your WETH/)).toBeInTheDocument();
  });

  it("[F5-R4] and on no other row, because only one step is ever being signed", async () => {
    const stall = (plan: ProvisioningPlan) =>
      planRailSteps(plan).map((step, index) => ({
        key: step.key,
        run: async () =>
          index === 0
            ? new Promise<never>(() => {})
            : Promise.resolve({ txHash: `0x${step.key}` } as const),
      }));
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={stall}
      />,
    );

    await screen.findByRole("button", { name: "What am I signing?" });
    expect(screen.getAllByRole("button", { name: "What am I signing?" })).toHaveLength(1);
  });
});

describe("ProvisioningPanel — Step failed (POO-1088)", () => {
  beforeEach(() => {
    planHolder.current = realProvisioningPlan();
  });

  it("[F5-R5] titles the screen with the step the user can see failed", async () => {
    // Rail step 4 is the bridge, and the rail inserts two approval rows the plan does not carry, so
    // the number in the title is a DISPLAY index. Counting the plan's own steps would say 2.
    // POO-1506: NOT a slippage-classified message — see the note on the next test for why that
    // matters now.
    await runUntilItFails(railFailingAt(3, "execution reverted: transfer amount exceeds balance"));

    expect(screen.getByText("Step 4 failed")).toBeInTheDocument();
  });

  it("[F5-R6 → superseded by POO-1506 R37] a slippage failure no longer reaches this screen at all", async () => {
    // Originally: "the failed row quotes the plan's OWN slippage, never a hardcoded figure", proven
    // by a slippage-classified failure landing HERE and the row showing "Price moved past your 2%
    // slippage". POO-1506 [R37] makes that reachability impossible by design: a slippage failure now
    // NEVER lands on this generic screen, on the first attempt (auto-retry) or the second (`8b`
    // instead). `FAILURE_KEYS.slippage` / `executionStepCopy` are unchanged and still correct for
    // whatever OTHER surface can still reach this row with that kind (none currently can, for
    // provisioning) — this test now guards the ABSENCE, which is what would silently regress if a
    // future change reintroduced a path from a slippage failure to this phase. The scenario this test
    // was written for is proven positively in `ProvisioningPanel.slippageRetry.test.tsx` instead
    // (`8a`/`8b`, screens `7373:766` / `7373:817`).
    //
    // Not `runUntilItFails`: that helper waits for `Try again`, which is exactly the button [R37]
    // now keeps a slippage failure from ever reaching. This rail fails unconditionally, so the
    // auto-retry fails too and the run settles on `8b` — never on the generic screen.
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={railFailingAt(3, "execution reverted: price slippage check")}
      />,
    );
    // Post-POO-1503/#835: with no `context` the panel seeds the start itself; no Confirm exists.
    await screen.findByTestId("provisioning-slippage-raise");

    expect(screen.queryByTestId("provisioning-error")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByText("Price moved past your 2% slippage")).not.toBeInTheDocument();
  });

  it("[F5-R5] says what already settled, from the rows that really did", async () => {
    await runUntilItFails(railFailingAt(3, "execution reverted: transfer amount exceeds balance"));

    // The swap settled and the bridge did not, so $120.40 of theirs is sitting as USDC. The
    // approvals settled too and are worth nothing: an allowance moves no money.
    expect(screen.getByText("$120.40 already went through and is safe.")).toBeInTheDocument();
  });

  it("[F5-R5] and never invents one when nothing settled", async () => {
    await runUntilItFails(railFailingAt(0, "user rejected the request"));

    // [R10] The failure mode this rule exists for: a "$0.00 already went through and is safe" line
    // reads as a receipt for money that never moved. With nothing settled the screen says what
    // classified the failure instead, which also says no funds were moved.
    expect(screen.queryByText(/already went through/)).not.toBeInTheDocument();
    expect(screen.getByText(/No funds were moved/)).toBeInTheDocument();
  });

  it("[F5-R2] a route that stopped has no steps still 'Waiting'", async () => {
    await runUntilItFails(railFailingAt(3, "execution reverted: transfer amount exceeds balance"));

    // "Waiting" after a failure tells someone money is on its way when nothing is coming for it.
    expect(screen.queryByText("Waiting")).not.toBeInTheDocument();
    expect(screen.getAllByText("Not started").length).toBeGreaterThan(0);
  });

  it("[F5-R7] offers Try again and a way out", async () => {
    await runUntilItFails(railFailingAt(3, "execution reverted: transfer amount exceeds balance"));

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // Without the ghost, the only exits from a failed route were retrying it and the modal's X.
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("[F5-R7] Back returns to the host rather than retrying anything", async () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={onCancel}
        buildPlanSteps={railFailingAt(3, "execution reverted: transfer amount exceeds balance")}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
