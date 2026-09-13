/**
 * @id PP-CORE-CMP-044 (POO-1041, POO-1381)
 * @name ProvisioningPlanCard — real-step rendering tests
 * @implements-rules-version v3 (POO-1381 rules v2) · v2 (POO-1041 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The card against a REAL plan, which is the only kind that carries legs, an ETA and a broadcast
 * hash. Rules under test:
 *   [R2] a bridge row shows its ETA and, once broadcast, a per-leg explorer link
 *   [R4] a missing network or hash renders NO link, never an explorer home page
 *   [R6] the rail's approval rows are rendered, so the card lists what the user actually signs
 *
 * POO-1381: the Confirm-screen step list now collapses by default, so the plan-mode explorer-link
 * tests below expand it first ({@link expandSteps}) before an accessibility-tree query (`getByRole`)
 * can reach a row that is `hidden` while collapsed. The fixture these use carries no inline gas
 * selector, so it is a collapsible plan. Running mode, and any plan that renders the gas selector,
 * are never collapsed (rules v2), so those tests are untouched. The collapse behaviour itself is
 * covered by its own describe block at the end.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProvisioningLegToken } from "@/lib/provisioning";
import { mockComputePlan, SCENARIOS } from "@/lib/provisioning";
import {
  gasTopUpStep,
  REAL_STEPS,
  realProvisioningPlan,
  USDC_ARBITRUM,
  USDG_ROBINHOOD,
} from "../../../../../tests/fixtures/realProvisioningPlan";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../../tests/utils/renderWithProviders";
import { planRailSteps } from "../../lib/buildPlanSteps";
import { ProvisioningPlanCard } from "./ProvisioningPlanCard";
import { buildPlanView, type PlanViewOptions } from "./provisioningView";

const TX_HASH = "0x9f2c1d4a6b8e0f3c5a7d9e1b2c4f6a8d0e2b4c6f8a0d2e4b6c8f0a2d4e6b8c0f";

function renderCard(options: PlanViewOptions = {}) {
  const plan = realProvisioningPlan();
  const view = buildPlanView(plan, { railSteps: planRailSteps(plan), ...options });
  return renderWithProviders(<ProvisioningPlanCard view={view} opLabel="Invest in Stable Yield" />);
}

/**
 * Reveal the collapsed-by-default Confirm-screen step list (POO-1381 [R1]).
 *
 * While collapsed the rows are `hidden`, so they are out of the accessibility tree and `getByRole`
 * cannot reach them. The plan-mode explorer-link assertions below are about the row content, not the
 * collapse, so they expand first and leave the collapse to its own describe block.
 */
function expandSteps() {
  fireEvent.click(screen.getByRole("button", { name: "Show steps" }));
}

describe("ProvisioningPlanCard — real steps (POO-1041)", () => {
  it("[R6] lists the approval the rail will ask for, alongside the legs and the op anchor", () => {
    renderCard();

    expect(screen.getByText("Approve WETH")).toBeInTheDocument();
    // The swap label interpolates its destination token; before POO-1041 the mapper passed no
    // value and this row rendered the raw i18n key.
    // @rule POO-1087 F4-R2 — the title names what is SPENT, not what the route ends up holding.
    // Every funding swap converts TO the same asset, so "Convert WETH" read alike on every row.
    expect(screen.getByText("Convert WETH")).toBeInTheDocument();
    expect(screen.getByText("Move to Arbitrum")).toBeInTheDocument();
    expect(screen.getByText("Invest in Stable Yield")).toBeInTheDocument();
  });

  it("[R2] says how long the bridge takes, from the quote's own estimate", () => {
    renderCard();

    expect(screen.getByText(/about 3 minutes/)).toBeInTheDocument();
  });

  it("[R2] links an in-flight bridge row to its transaction, on the chain it broadcast on", () => {
    renderCard({ statusByKey: { "bridge-1": "active" }, txHashByKey: { "bridge-1": TX_HASH } });
    expandSteps(); // POO-1381: the link lives in a row that is collapsed by default.

    const link = screen.getByRole("link", { name: "View on explorer" });
    expect(link).toHaveAttribute("href", `https://polygonscan.com/tx/${TX_HASH}`);
  });

  it("[R4] renders no link at all until the leg has broadcast", () => {
    renderCard({ statusByKey: { "bridge-1": "active" } });
    // POO-1381: expand so the absence is genuine (no hash), not merely the list being collapsed.
    expandSteps();

    expect(screen.queryByRole("link", { name: "View on explorer" })).not.toBeInTheDocument();
  });

  it("[R4] renders no link for a chain the app cannot name an explorer for", () => {
    const plan = realProvisioningPlan({
      steps: REAL_STEPS.map((step) =>
        step.key === "bridge-1"
          ? { ...step, chainId: 1, leg: step.leg && { ...step.leg, chainId: 1 } }
          : step,
      ),
    });
    const view = buildPlanView(plan, { txHashByKey: { "bridge-1": TX_HASH } });
    renderWithProviders(<ProvisioningPlanCard view={view} opLabel="Invest in Stable Yield" />);
    // POO-1381: expand so the absence is genuine (unknown explorer), not the list being collapsed.
    expandSteps();

    expect(screen.queryByRole("link", { name: "View on explorer" })).not.toBeInTheDocument();
  });
});

/**
 * POO-1087 rules v1 — the v2 Confirm card (Figma `6548:723`, `6549:707`).
 */
describe("ProvisioningPlanCard — v2 Confirm", () => {
  it("[F4-R2] the bridge caption names where the funds come FROM, not where they go", () => {
    renderCard();

    // The title already says "Move to Arbitrum". A caption repeating the destination would waste
    // the one line that can say which chain is being drained.
    expect(screen.getByText("Move to Arbitrum")).toBeInTheDocument();
    expect(screen.getByText("From Polygon")).toBeInTheDocument();
  });

  it("[F4-R2] a swap row names the network it runs on", () => {
    renderCard();

    expect(screen.getByText("Convert WETH")).toBeInTheDocument();
    expect(screen.getAllByText("Polygon").length).toBeGreaterThan(0);
  });

  it("[F4-R4] the card closes on the fees line", () => {
    renderCard();

    expect(screen.getByText("Fees included.")).toBeInTheDocument();
  });

  // @rule POO-1509 R34 — OVERTURNS POO-1085 [F4-R3], which labelled the gas figure `Gas on arrival`
  // above an inline picker on the gas row. The picker is gone from this flow (it lives only on
  // `Not enough gas`, [R35]), and a label whose only job was to name the figure that control changed
  // has nothing left to name. The assertion is kept and INVERTED rather than deleted, so the rule it
  // reverses stays legible to whoever reads this next.
  it("[R34] renders no gas picker and no gas label under a gas row", () => {
    const plan = realProvisioningPlan();
    const view = buildPlanView(plan, { railSteps: planRailSteps(plan) });
    // Force a gas row: the real fixture is a funding route, not a top-up.
    const withGas = {
      ...view,
      rows: view.rows.map((row, index) =>
        index === 0 ? { ...row, isGas: true, amountUsd: 10 } : row,
      ),
    };

    renderWithProviders(<ProvisioningPlanCard view={withGas} opLabel="Invest in Stable Yield" />);

    expect(screen.queryByRole("group", { name: /gas amount/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Gas on arrival")).not.toBeInTheDocument();
  });

  it("[R34] has no gas label on an ordinary funding plan either", () => {
    renderCard();

    expect(screen.queryByText("Gas on arrival")).not.toBeInTheDocument();
  });
});

/**
 * POO-1088 rules v1 — the execution screens (Figma `6550:615`, `6550:703`).
 *
 * The same card the user confirmed, with statuses. Not a second list: `PlanView` already carries
 * status, hash and explorer network per row, and two lists is the misalignment POO-1041 [R6] fixed.
 */
describe("ProvisioningPlanCard — running mode", () => {
  function renderRunning(
    statusByKey: Record<string, "idle" | "active" | "done" | "error" | "skipped">,
    execution: {
      routeFailed?: boolean;
      errorKind?: "slippage" | "userRejected";
      slippagePct?: number;
    } = {},
  ) {
    const plan = realProvisioningPlan();
    const view = buildPlanView(plan, { railSteps: planRailSteps(plan), statusByKey });
    return renderWithProviders(
      <ProvisioningPlanCard
        view={view}
        opLabel="Invest in Stable Yield"
        mode="running"
        execution={execution}
      />,
    );
  }

  it("[F5-R2] a settled step says so, and the one in flight points at the wallet", () => {
    const plan = realProvisioningPlan();
    const keys = buildPlanView(plan, { railSteps: planRailSteps(plan) }).rows.map((row) => row.key);
    const [first, second] = keys;
    if (!first || !second) throw new Error("fixture has too few rows");

    renderRunning({ [first]: "done", [second]: "active" });

    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
  });

  /**
   * POO-1109 [R3]/[R5]. The e2e harness polls these attributes to follow a route leg by leg, so they
   * are a contract, not decoration: if the testid or `data-status` stops rendering, the harness sees
   * a route with no legs and reports "nothing to verify on chain" for a bridge that really ran. The
   * contract used to live on `WalletSteps`; POO-1088 moved the execution surface to this card, and
   * that move merges into main WITHOUT a conflict, so nothing but this test would have caught it.
   */
  it("[POO-1109] exposes each leg's key, status and hash for the e2e harness", () => {
    const plan = realProvisioningPlan();
    const view = buildPlanView(plan, { railSteps: planRailSteps(plan) });
    const swap = view.rows.find((row) => row.type === "swap-token");
    const bridge = view.rows.find((row) => row.type === "bridge");
    if (!swap || !bridge) throw new Error("fixture has no swap or no bridge");

    renderWithProviders(
      <ProvisioningPlanCard
        view={buildPlanView(plan, {
          railSteps: planRailSteps(plan),
          statusByKey: { [swap.key]: "done", [bridge.key]: "active" },
          txHashByKey: { [swap.key]: TX_HASH },
        })}
        opLabel="Invest in Stable Yield"
        mode="running"
      />,
    );

    const swapRow = screen.getByTestId(`wallet-step-${swap.key}`);
    expect(swapRow).toHaveAttribute("data-status", "done");
    expect(swapRow).toHaveAttribute("data-tx-hash", TX_HASH);

    const bridgeRow = screen.getByTestId(`wallet-step-${bridge.key}`);
    expect(bridgeRow).toHaveAttribute("data-status", "active");
    // Absent, not empty: the harness reads a missing attribute as "not broadcast yet".
    expect(bridgeRow).not.toHaveAttribute("data-tx-hash");
  });

  it("[POO-1109] emits the harness's own word for a step that has not run", () => {
    renderRunning({});

    // `WalletSteps` mapped `idle` to `pending`, and the harness was written against that. The card
    // keeps the word so the vocabulary does not shift under a helper nobody edited.
    const plan = realProvisioningPlan();
    const view = buildPlanView(plan, { railSteps: planRailSteps(plan) });
    const first = view.rows.find((row) => !row.isOp);
    if (!first) throw new Error("fixture has no leg rows");
    expect(screen.getByTestId(`wallet-step-${first.key}`)).toHaveAttribute(
      "data-status",
      "pending",
    );
  });

  it("[POO-1109] does NOT expose the op anchor, which is not a funding leg", () => {
    renderRunning({});

    // The harness maps one node to one leg and waits for every one of them to settle. The operation
    // never settles inside the panel, so exposing it would hang the wait on a row the rail never runs.
    const plan = realProvisioningPlan();
    const op = buildPlanView(plan, { railSteps: planRailSteps(plan) }).rows.find((row) => row.isOp);
    if (!op) throw new Error("fixture has no op row");
    expect(screen.queryByTestId(`wallet-step-${op.key}`)).not.toBeInTheDocument();
  });

  it("[F5-R2] an unstarted step is WAITING while the route is alive", () => {
    renderRunning({});

    expect(screen.getAllByText("Waiting").length).toBeGreaterThan(0);
    expect(screen.queryByText("Not started")).not.toBeInTheDocument();
  });

  it("[F5-R2] and NOT STARTED once something has failed", () => {
    // "Waiting" after a failure reads as still-in-flight: it tells someone their money is on its
    // way when nothing is coming for it.
    renderRunning({}, { routeFailed: true });

    expect(screen.getAllByText("Not started").length).toBeGreaterThan(0);
    expect(screen.queryByText("Waiting")).not.toBeInTheDocument();
  });

  it("[F5-R6] a slippage failure quotes the plan's OWN tolerance", () => {
    const plan = realProvisioningPlan();
    const keys = buildPlanView(plan, { railSteps: planRailSteps(plan) }).rows.map((row) => row.key);
    const [first] = keys;
    if (!first) throw new Error("fixture has no rows");

    renderRunning(
      { [first]: "error" },
      { routeFailed: true, errorKind: "slippage", slippagePct: 0.5 },
    );

    expect(screen.getByText("Price moved past your 0.5% slippage")).toBeInTheDocument();
  });

  it("[F5-R6] and drops the figure entirely when the plan has none", () => {
    const plan = realProvisioningPlan();
    const keys = buildPlanView(plan, { railSteps: planRailSteps(plan) }).rows.map((row) => row.key);
    const [first] = keys;
    if (!first) throw new Error("fixture has no rows");

    renderRunning({ [first]: "error" }, { routeFailed: true, errorKind: "slippage" });

    // Never a fabricated default (POO-1082 [R10]).
    expect(screen.getByText("The price moved while this step was running")).toBeInTheDocument();
    expect(screen.queryByText(/2% slippage/)).not.toBeInTheDocument();
  });

  it("[F5-R1] the gas control is gone once the route is running", () => {
    const plan = realProvisioningPlan();
    const view = buildPlanView(plan, { railSteps: planRailSteps(plan) });
    const withGas = {
      ...view,
      rows: view.rows.map((row, index) => (index === 0 ? { ...row, isGas: true } : row)),
    };

    renderWithProviders(
      <ProvisioningPlanCard view={withGas} opLabel="Invest in Stable Yield" mode="running" />,
    );

    // The amount is committed the moment the route starts; a control that changes nothing is worse
    // than no control. Since POO-1509 [R34] it is absent on the Confirm screen too.
    expect(screen.queryByRole("group", { name: /gas amount/i })).not.toBeInTheDocument();
  });

  it("[F5-R1] the running step keeps its number, so the badge still says WHICH step", () => {
    const plan = realProvisioningPlan();
    const keys = buildPlanView(plan, { railSteps: planRailSteps(plan) }).rows.map((row) => row.key);
    const [first, second] = keys;
    if (!first || !second) throw new Error("fixture has too few rows");

    renderRunning({ [first]: "done", [second]: "active" });

    // A spinner that REPLACES the number tells the user something is happening and forgets to say
    // what. The Figma keeps the digit and spins a ring around it.
    const active = screen.getByText("Continue in your wallet").closest("li");
    expect(active).not.toBeNull();
    expect(active?.textContent).toContain("2");
  });

  it("[F5-R3] a stopped route drops the bridge ETA, which is now a promise nobody will keep", () => {
    const plan = realProvisioningPlan();
    const keys = buildPlanView(plan, { railSteps: planRailSteps(plan) }).rows.map((row) => row.key);
    const [first] = keys;
    if (!first) throw new Error("fixture has no rows");

    // Alive: the forecast stands.
    const { unmount } = renderRunning({});
    expect(screen.getByText(/about 3 minutes/)).toBeInTheDocument();
    unmount();

    // Stopped: "we'll continue as soon as your funds arrive" under the line explaining why the
    // transfer stopped is the same still-in-flight lie [F5-R2] removed from "Waiting".
    renderRunning({ [first]: "error" }, { routeFailed: true, errorKind: "userRejected" });
    expect(screen.queryByText(/about 3 minutes/)).not.toBeInTheDocument();
  });

  it("[F5-R1] the fees line belongs to Confirm, not to execution", () => {
    renderRunning({});

    expect(screen.queryByText("Fees included.")).not.toBeInTheDocument();
  });

  it("plan mode is untouched by any of it", () => {
    renderCard();

    expect(screen.getByText("Fees included.")).toBeInTheDocument();
    expect(screen.queryByText("Waiting")).not.toBeInTheDocument();
  });
});

describe("ProvisioningPlanCard — the fiat buy row (POO-1136)", () => {
  const buyStep = {
    type: "buy" as const,
    key: "buy",
    labelKey: "provisioning.steps.buy",
    fromToken: "USD",
    toToken: "USDC",
    toChainId: 8453,
    amountUsd: 120,
    poweredBy: "paybis" as const,
  };
  const opStep = REAL_STEPS[2] as (typeof REAL_STEPS)[number];

  function renderFiatBuy(status: "active" | "done", options: PlanViewOptions = {}) {
    const plan = realProvisioningPlan({ steps: [buyStep, opStep] });
    const view = buildPlanView(plan, {
      railSteps: planRailSteps(plan),
      statusByKey: { buy: status },
      ...options,
    });
    return renderWithProviders(
      <ProvisioningPlanCard view={view} opLabel="Invest in Stable Yield" mode="running" />,
    );
  }

  it("a done fiat buy is a leg WITH no tx hash: it mines no on-chain transaction", () => {
    renderFiatBuy("done");
    const row = screen.getByTestId("wallet-step-buy");
    expect(row).toHaveAttribute("data-status", "done");
    // The invariant the e2e harness hash-exempts: a done buy row carries NO hash, and that is correct.
    expect(row).not.toHaveAttribute("data-tx-hash");
  });

  // @rule POO-1136 — the row REFUSES a hash rather than merely never being handed one. `data-tx-hash`
  // is what the e2e harness verifies receipts from, so a fabricated hash (mock mode's settle used to
  // hand one to every row, this one included) would send it looking for a transaction that does not
  // exist. A card payment inside the widget mines nothing, on any chain, ever.
  it("refuses a supplied hash on the buy row, and renders no explorer link for it", () => {
    renderFiatBuy("done", { txHashByKey: { buy: TX_HASH } });

    expect(screen.getByTestId("wallet-step-buy")).not.toHaveAttribute("data-tx-hash");
    expect(screen.queryByRole("link", { name: "View on explorer" })).not.toBeInTheDocument();
  });

  it("an active fiat buy points at the embedded widget, not the wallet", () => {
    renderFiatBuy("active");
    expect(screen.getByText("Complete your purchase")).toBeInTheDocument();
    expect(screen.queryByText("Continue in your wallet")).not.toBeInTheDocument();
  });

  /**
   * POO-1927 [R2], the buyer-facing half: what the plan row actually SAYS on each rail.
   *
   * `provisioningView.test.ts` pins which key the row carries; this pins that the key reaches the
   * caption and reads as intended once resolved, which is the only assertion a buyer would
   * recognise. `mode="plan"` because that is the screen the attribution is read on: while running,
   * the caption is replaced by the execution copy ([F5-R2]).
   */
  function renderBuyCaption(options: PlanViewOptions = {}) {
    const plan = realProvisioningPlan({ steps: [buyStep, opStep] });
    const rendered = renderWithProviders(
      <ProvisioningPlanCard view={buildPlanView(plan, options)} opLabel="Invest in Stable Yield" />,
    );
    // The Confirm list is collapsed behind a disclosure (POO-1381 [R1]), so expand it the way a
    // buyer would before reading the row.
    expandSteps();
    return rendered;
  }

  // @rule R2: the defect, a Privy-brokered charge naming a counterparty with no part in it.
  it("[R2] names NO vendor on the Privy rail", () => {
    renderBuyCaption({ onRampRail: "privy" });

    expect(screen.getByText(/Secure checkout/)).toBeInTheDocument();
    // The load-bearing negative, and deliberately over the WHOLE screen rather than the one row:
    // [R2] is that nothing a buyer reads on this rail names Paybis, so a stray credit anywhere on
    // the card fails it. A blanket find-and-replace would satisfy the line above and still leave one.
    expect(document.body.textContent).not.toMatch(/paybis/i);
  });

  // @rule R2: and the Paybis rail's own copy is honest, so it is unchanged while that rail lives.
  it("[R2] still credits Paybis on the Paybis rail", () => {
    renderBuyCaption({ onRampRail: "paybis" });

    expect(screen.getByText(/Powered by Paybis/)).toBeInTheDocument();
  });
});

/**
 * POO-1381 rules v1 — the Confirm step list collapses by default.
 *
 * The clutter being fixed is the Confirm screen: five steps with sub-lines sit above the amount and
 * the CTA on a phone. So the list collapses in `plan` mode ONLY. Running and failed screens keep the
 * full list: a collapsed card that hides "what is happening right now" mid-purchase is a regression,
 * not a cleanup, which is why [R3] is the first test here.
 */
describe("ProvisioningPlanCard — collapsible step list (POO-1381)", () => {
  const RUNNING_TOGGLE = /show steps|hide steps/i;

  // @rule POO-1381 R3 — while running, the active step stays visible with nothing to expand.
  it("[R3] keeps the active step visible while running, with no disclosure to hide it", () => {
    const plan = realProvisioningPlan();
    const keys = buildPlanView(plan, { railSteps: planRailSteps(plan) }).rows.map((row) => row.key);
    const [first, second] = keys;
    if (!first || !second) throw new Error("fixture has too few rows");
    const view = buildPlanView(plan, {
      railSteps: planRailSteps(plan),
      statusByKey: { [first]: "done", [second]: "active" },
    });

    renderWithProviders(
      <ProvisioningPlanCard view={view} opLabel="Invest in Stable Yield" mode="running" />,
    );

    // The active row's live sub-line is on screen without any interaction.
    expect(screen.getByText("Continue in your wallet")).toBeVisible();
    // And there is no toggle standing between the user and the step that is running.
    expect(screen.queryByRole("button", { name: RUNNING_TOGGLE })).not.toBeInTheDocument();
  });

  // @rule POO-1381 R3 — a failed route (also `mode="running"`) shows the whole list, no disclosure.
  it("[R3] keeps the whole list visible on a failed route", () => {
    const plan = realProvisioningPlan();
    const keys = buildPlanView(plan, { railSteps: planRailSteps(plan) }).rows.map((row) => row.key);
    const [first] = keys;
    if (!first) throw new Error("fixture has no rows");
    const view = buildPlanView(plan, {
      railSteps: planRailSteps(plan),
      statusByKey: { [first]: "error" },
    });

    renderWithProviders(
      <ProvisioningPlanCard
        view={view}
        opLabel="Invest in Stable Yield"
        mode="running"
        execution={{ routeFailed: true, errorKind: "slippage", slippagePct: 2 }}
      />,
    );

    expect(screen.getByText("Move to Arbitrum")).toBeVisible();
    expect(screen.queryByRole("button", { name: RUNNING_TOGGLE })).not.toBeInTheDocument();
  });

  // @rule POO-1381 R1 — the Confirm list is collapsed by default, behind a button that says so.
  it("[R1] collapses the step list by default on the Confirm screen", () => {
    renderCard();

    const toggle = screen.getByRole("button", { name: "Show steps" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Rows stay in the DOM so aria-controls resolves, but they are off-screen (hidden).
    expect(screen.getByText("Move to Arbitrum")).not.toBeVisible();
    // The Confirm-only fees footnote collapses with the list it belongs to ([R5]).
    expect(screen.getByText("Fees included.")).not.toBeVisible();
  });

  // @rule POO-1381 R2 — the disclosure is a real button with aria state that reveals the list.
  it("[R2] the disclosure is a real button that reveals the list when pressed", () => {
    renderCard();

    const toggle = screen.getByRole("button", { name: "Show steps" });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    // It names the list it controls, so assistive tech ties the two together.
    expect(toggle.getAttribute("aria-controls")).toBeTruthy();

    fireEvent.click(toggle);

    const expanded = screen.getByRole("button", { name: "Hide steps" });
    expect(expanded).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Move to Arbitrum")).toBeVisible();
    // @rule POO-1381 R5 — the fees footnote rides with the list, visible once expanded.
    expect(screen.getByText("Fees included.")).toBeVisible();
  });

  // @rule POO-1509 R34 — OVERTURNS the second half of POO-1381 [R1] (rules v2), which kept a plan
  // carrying the inline gas selector expanded so the control the CTA hung on was never hidden. There
  // is no such control in this flow any more, so a gas row collapses like every other row and the
  // carve-out would only make one plan behave differently for no reason a user can see.
  it("[R34] collapses a Confirm plan with a gas row, since no control hangs off it", () => {
    const plan = realProvisioningPlan();
    const view = buildPlanView(plan, { railSteps: planRailSteps(plan) });
    const withGas = {
      ...view,
      rows: view.rows.map((row, index) =>
        index === 0 ? { ...row, isGas: true, amountUsd: 10 } : row,
      ),
    };

    renderWithProviders(<ProvisioningPlanCard view={withGas} opLabel="Invest in Stable Yield" />);

    expect(screen.getByRole("button", { name: "Show steps" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /gas amount/i })).not.toBeInTheDocument();
  });
});

/**
 * POO-1511 (spec §8, "App defects found while measuring") — the status badge's colour must be a
 * token the stylesheet actually defines.
 *
 * The badge column shipped with `bg-danger/15 text-danger` on the `error` state, and `danger` is
 * defined nowhere: the app's error colour is `destructive`. Tailwind emits no rule for an unknown
 * token and fails silently, so the ONE row that reports a failure was the ONE row rendering with no
 * background and a plain white X. The defect is invisible to `typecheck`, `lint` and every existing
 * assertion here, because a className is just a string to all three.
 *
 * So this asserts the property rather than the literal: whatever colour classes the badge carries,
 * their token is declared in `globals.css`. That fails on the shipped `danger`, passes on
 * `destructive`, and keeps failing for the next token someone invents in this column.
 */
describe("ProvisioningPlanCard — status badge colour tokens (POO-1511)", () => {
  /**
   * Every `--color-<name>` the app declares, gathered from the whole token layer rather than one
   * file: POO-1460 moved `@theme` out of `globals.css` into `src/app/tokens/*.css`, and hard-coding
   * either location would make this test silently stop testing the next time they move.
   */
  const CSS_DIR = join(__dirname, "../../../../app");
  const DEFINED_TOKENS = new Set(
    [
      join(CSS_DIR, "globals.css"),
      // The public repository pre-dates POO-1460: its tokens still live in `globals.css` and there
      // is no `tokens/` layer yet, so the layer is read when present and skipped when absent.
      ...(existsSync(join(CSS_DIR, "tokens"))
        ? readdirSync(join(CSS_DIR, "tokens")).map((f) => join(CSS_DIR, "tokens", f))
        : []),
    ]
      .filter((file) => file.endsWith(".css"))
      .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/--color-([a-z0-9-]+)\s*:/g)])
      .map(([, name]) => name),
  );

  /**
   * `text-` is overloaded in Tailwind: `text-xs` is a font size, `text-center` an alignment. Only
   * the colour senses are under test here, so the type-scale and alignment words are excluded by
   * name rather than by guessing from shape.
   */
  const NOT_A_COLOUR = new Set([
    "xs",
    "sm",
    "base",
    "lg",
    "xl",
    "2xl",
    "3xl",
    "4xl",
    "5xl",
    "6xl",
    "7xl",
    "8xl",
    "9xl",
    "left",
    "center",
    "right",
    "justify",
    "start",
    "end",
    "wrap",
    "nowrap",
    "balance",
    "pretty",
    "ellipsis",
    "clip",
  ]);

  /** `bg-foo/15` and `text-foo` on the badge, reduced to the token names they reference. */
  function colourTokensOf(element: Element): string[] {
    return [...element.classList]
      .map((cls) => /^(?:bg|text|border)-([a-z0-9][a-z0-9-]*?)(?:\/\d+)?$/.exec(cls)?.[1])
      .filter((token): token is string => Boolean(token) && !NOT_A_COLOUR.has(token as string));
  }

  /** The badge is the decorative status mark that replaces the step number ([F5-R1]). */
  function badgeOfFirstRow(container: HTMLElement): Element {
    const badge = container.querySelector('span[aria-hidden="true"].size-7');
    if (!badge) throw new Error("no status badge rendered");
    return badge;
  }

  it.each([
    "done",
    "error",
    "active",
    "idle",
  ] as const)("the %s badge uses a colour token the token layer defines", (status) => {
    const plan = realProvisioningPlan();
    const keys = buildPlanView(plan, { railSteps: planRailSteps(plan) }).rows.map((row) => row.key);
    const [first] = keys;
    if (!first) throw new Error("fixture has no rows");
    const view = buildPlanView(plan, {
      railSteps: planRailSteps(plan),
      statusByKey: { [first]: status },
    });

    const { container } = renderWithProviders(
      <ProvisioningPlanCard
        view={view}
        opLabel="Invest in Stable Yield"
        mode="running"
        execution={status === "error" ? { routeFailed: true } : {}}
      />,
    );

    const tokens = colourTokensOf(badgeOfFirstRow(container));
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(DEFINED_TOKENS, `badge colour token "${token}" (status: ${status})`).toContain(token);
    }
  });
});

// --- POO-1575 rules v2: the buy caption names the methods the buyer can actually use -------------

describe("the buy row's payment methods (POO-1575)", () => {
  /**
   * The mock plan whose first row is the fiat `buy` (Paybis), expanded so the rows are readable.
   *
   * The currencies default to AGREEING, which is [R8]'s pass case; `chargedCurrency` is passed
   * explicitly by the mismatch case.
   */
  function renderBuyCard(names?: readonly string[], chargedCurrency = "EUR") {
    const view = buildPlanView(
      mockComputePlan(SCENARIOS.usdcOnly, { nowIso: "2026-06-30T12:00:00.000Z" }),
      {
        ...(names === undefined
          ? {}
          : {
              buyPaymentMethods: {
                names,
                listedForCurrency: "EUR",
                // POO-1596: the mock plan's buy step mints `USDC-BASE`, so the PAIR half of [R8]
                // agrees and these cases stay about the currency half they were written for.
                listedForPair: "USDC-BASE",
                chargedCurrency,
              },
            }),
      },
    );
    const rendered = renderWithProviders(
      <ProvisioningPlanCard view={view} opLabel="Invest in Stable Yield" />,
    );
    expandSteps();
    return rendered;
  }

  /** The whole card's text, so a broken interpolation cannot hide behind a role query. */
  function cardText(): string {
    return document.body.textContent ?? "";
  }

  it("[R1][R2] names the resolved methods, joined with the locale's own disjunction", () => {
    renderBuyCard(["Credit Card", "Pix"]);

    expect(screen.getByText(/Pay with Credit Card or Pix/)).toBeVisible();
  });

  it("[R1] a buyer whose currency offers no Pix is never told about Pix", () => {
    renderBuyCard(["SEPA transfer"]);

    expect(screen.getByText(/Pay with SEPA transfer/)).toBeVisible();
    expect(cardText()).not.toMatch(/Pix/);
  });

  it("[R3] promises nothing specific when no method resolved", () => {
    renderBuyCard();

    expect(screen.getByText(/Payment options shown at checkout/)).toBeVisible();
    expect(cardText()).not.toMatch(/Pix/);
  });

  // POO-1131: the attribution hangs off the caption KEY existing. A dynamic caption that dropped it
  // would quietly remove a required provider attribution, which is why both branches are asserted.
  it("[R4] keeps the Powered by Paybis attribution in BOTH branches", () => {
    const { unmount } = renderBuyCard(["Pix"]);
    expect(screen.getByText(/Powered by Paybis/)).toBeVisible();
    unmount();

    renderBuyCard();
    expect(screen.getByText(/Powered by Paybis/)).toBeVisible();
  });

  // [R8] (POO-1575 review): the list is resolved per currency, and a leg pinned to another one opens
  // a widget that offers none of these rails. The caption falls back rather than naming them.
  it("[R8] never captions the buyer's own rails over a leg charged in another currency", () => {
    renderBuyCard(["SEPA transfer", "Bizum"], "USD");

    expect(screen.getByText(/Payment options shown at checkout/)).toBeVisible();
    expect(cardText()).not.toMatch(/SEPA|Bizum/);
    expect(screen.getByText(/Powered by Paybis/)).toBeVisible();
  });
});

/**
 * POO-1779 [R1] — "Paid from your {stable}", rendered end to end.
 *
 * The chain-to-ticker mapping (`networkStableSymbol`) and the slug the row carries
 * (`provisioningView.test.ts`) are unit-tested either side of this; what only a render catches is
 * the join between them going wrong in a way that still produces a screen: `captionValues` reading
 * the wrong field, the caption key losing its placeholder, or a literal "USDC" coming back into the
 * copy. On Robinhood Chain the user's dollar is USDG, and a card that calls it USDC is naming an
 * asset the wallet does not hold.
 */
describe("ProvisioningPlanCard — the gas caption names the chain's own stable (POO-1779 [R1])", () => {
  function renderGasCard(stable: ProvisioningLegToken) {
    const plan = realProvisioningPlan({ steps: [gasTopUpStep(stable)] });
    const rendered = renderWithProviders(
      <ProvisioningPlanCard view={buildPlanView(plan)} opLabel="Invest in Stable Yield" />,
    );
    expandSteps();
    return rendered;
  }

  it("[R1] says USDG for a gas top-up paid on Robinhood Chain", () => {
    renderGasCard(USDG_ROBINHOOD);

    expect(screen.getByText("Paid from your USDG")).toBeVisible();
    // The literal the caption carried before the rule: naming it here is the regression guard.
    expect(document.body.textContent ?? "").not.toMatch(/USDC/);
  });

  it("[R1] still says USDC for the same top-up on a launch chain", () => {
    renderGasCard(USDC_ARBITRUM);

    expect(screen.getByText("Paid from your USDC")).toBeVisible();
    expect(document.body.textContent ?? "").not.toMatch(/USDG/);
  });

  // [R2] next-intl THROWS on a placeholder with no value, so an unresolvable chain must still hand
  // the caption a ticker. A card that renders at all is the assertion; the degraded value is the
  // documented default rather than a raw `{stable}`.
  it("[R2] degrades to the default ticker rather than rendering a raw placeholder", () => {
    const offChain = gasTopUpStep({ ...USDC_ARBITRUM, chainId: 1 });
    renderWithProviders(
      <ProvisioningPlanCard
        view={buildPlanView(realProvisioningPlan({ steps: [offChain] }))}
        opLabel="Invest in Stable Yield"
      />,
    );
    expandSteps();

    expect(screen.getByText("Paid from your USDC")).toBeVisible();
    expect(document.body.textContent ?? "").not.toMatch(/\{stable\}/);
  });
});
