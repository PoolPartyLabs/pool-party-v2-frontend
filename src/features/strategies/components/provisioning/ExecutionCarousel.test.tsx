/**
 * @id PP-CORE-CMP-071
 * @name ExecutionCarousel — tests
 * @implements-rules-version v2 (POO-1786 rules v1) · v1 (POO-1504 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1504 rules v1, epic POO-1498):
 *   [R21] one step visible at a time; the box expands to the full list and collapses again.
 *   [R22] `Step N of M`, always present, because it is what makes the collapse legible.
 *   [R23] the progress fraction is `(done + 0.5) / total`, and the bar is on the BOX.
 *   [R24] tense follows state: past, gerund, plain.
 *   [R25] a subtitle only when the user must act or there is a real warning.
 *   [R26] the signing disclosure sits below the window.
 *   [R33] neighbours are not partially visible at rest.
 *   [R58] after 10s on the same step, the taking-longer line appears and nothing else changes.
 *
 * The load-bearing one is the POO-1109 e2e contract: the harness maps `[data-testid^="wallet-step-"]`
 * to legs and polls `data-status`. Two tests pin that the collapse does not hide it and that the window
 * copy does not duplicate it.
 */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProvisioningStepStatus } from "@/lib/provisioning";
import { CatchBoundary, translateLikeChrome } from "../../../../../tests/utils/chromeTranslate";
import {
  fireEvent,
  renderWithProviders,
  screen,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import {
  DOTS_PERIOD_MS,
  ExecutionCarousel,
  ProcessingDots,
  SPINNER_PERIOD_MS,
  TAKING_LONGER_MS,
  TICKER_MS,
} from "./ExecutionCarousel";
import type { PlanRow, PlanView } from "./provisioningView";

function row(over: Partial<PlanRow> & Pick<PlanRow, "key" | "type" | "index">): PlanRow {
  return {
    labelKey: "provisioning.steps.swapToken",
    isOp: false,
    isGas: false,
    isApproval: false,
    status: "idle",
    tokenSymbol: "WETH",
    ...over,
  } as PlanRow;
}

/** A three-leg route plus the op anchor, with each leg's status set by the caller. */
function view(
  statuses: [ProvisioningStepStatus, ProvisioningStepStatus, ProvisioningStepStatus],
): PlanView {
  return {
    titleKey: "provisioning.plan.title",
    rows: [
      row({
        key: "swap-0",
        type: "swap-token",
        index: 1,
        status: statuses[0],
        tokenSymbol: "WETH",
      }),
      row({
        key: "bridge-0",
        type: "bridge",
        index: 2,
        status: statuses[1],
        labelKey: "provisioning.steps.bridge",
        networkName: "Arbitrum",
      }),
      row({
        key: "swap-1",
        type: "swap-token",
        index: 3,
        status: statuses[2],
        tokenSymbol: "USDT",
      }),
      row({
        key: "op",
        type: "op",
        index: 4,
        status: "idle",
        isOp: true,
        labelKey: "provisioning.steps.op",
      }),
    ],
  } as PlanView;
}

function render(v: PlanView, disclosure?: React.ReactNode) {
  return renderWithProviders(
    <ExecutionCarousel
      view={v}
      opLabel="Invest in Stable Yield"
      {...(disclosure ? { disclosure } : {})}
    />,
  );
}

describe("ExecutionCarousel (POO-1504)", () => {
  // @rule POO-1504 R21 — one step visible at a time. The window is what a person sees, and it holds the
  // step in flight; every other row is in the collapsed list, which is hidden from layout and from the
  // accessibility tree.
  it("[R21] shows exactly one step in the window, the one in flight", () => {
    render(view(["done", "active", "idle"]));

    const window = within(screen.getByTestId("provisioning-exec-window"));
    expect(window.getByText("Moving to Arbitrum")).toBeInTheDocument();
    expect(window.queryByText("Converted WETH")).not.toBeInTheDocument();
    expect(window.queryByText("Convert USDT")).not.toBeInTheDocument();
  });

  // @rule POO-1504 R21 — the box is the only click target, and it toggles both ways. There is no
  // chevron: [R22]'s count is what makes the collapse visible, which is why it is never removed.
  it("[R21] expands to the full list on the box, and collapses on it again", () => {
    render(view(["done", "active", "idle"]));

    const box = screen.getByRole("button", { expanded: false });
    expect(screen.getByTestId("provisioning-exec-list")).not.toBeVisible();

    fireEvent.click(box);
    expect(screen.getByTestId("provisioning-exec-list")).toBeVisible();
    // Every row, including the op anchor, which is the PLAN rather than a step the rail runs.
    const list = within(screen.getByTestId("provisioning-exec-list"));
    expect(list.getByText("Converted WETH")).toBeInTheDocument();
    expect(list.getByText("Convert USDT")).toBeInTheDocument();
    expect(list.getByText("Invest in Stable Yield")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.getByTestId("provisioning-exec-list")).not.toBeVisible();
  });

  // @rule POO-1504 R33 — at rest the neighbours are not partially visible. The `hidden` attribute is
  // what enforces it, and the reason it is not opacity: text at 12% measures about 1.1:1 here and fails
  // the contrast premise outright.
  it("[R33] leaves no neighbouring row partially visible at rest", () => {
    render(view(["done", "active", "idle"]));

    expect(screen.getByTestId("provisioning-exec-list")).toHaveAttribute("hidden");
  });

  // @rule POO-1504 R22 — the count is always there, and it counts the LEGS. The op anchor is excluded
  // because the rail never runs it: counting it would say `Step 2 of 4` on a three-leg route and leave
  // the bar short of full when everything had finished.
  it("[R22] counts the legs and not the op anchor", () => {
    render(view(["done", "active", "idle"]));

    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
  });

  // @rule POO-1504 R23 — `(done + 0.5) / total`. One of three done with one in flight is 50%. Without
  // the half the bar would read 33% for the whole of that leg, and 0% on the first one, which are the
  // two moments a user is deciding whether the app is working.
  it("[R23] puts the half-step into the progress fraction", () => {
    const { container } = render(view(["done", "active", "idle"]));

    const bar = container.querySelector("span[aria-hidden='true'][style*='width']");
    expect(bar).toHaveStyle({ width: "50%" });
  });

  it("[R23] fills the bar completely once every leg has settled, with no half left over", () => {
    const { container } = render(view(["done", "done", "done"]));

    const bar = container.querySelector("span[aria-hidden='true'][style*='width']");
    expect(bar).toHaveStyle({ width: "100%" });
  });

  // @rule POO-1504 R24 — tense follows state, and a not-started step is never written as if it were
  // happening. All three forms, on one route, in one assertion set.
  it("[R24] conjugates each row by its state: past, gerund, plain", () => {
    render(view(["done", "active", "idle"]));
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    const list = within(screen.getByTestId("provisioning-exec-list"));
    expect(list.getByText("Converted WETH")).toBeInTheDocument();
    expect(list.getByText("Moving to Arbitrum")).toBeInTheDocument();
    expect(list.getByText("Convert USDT")).toBeInTheDocument();
  });

  // @rule POO-1504 R25 — `Done` and `Waiting` never appear as subtitles: they are the mark repeated in
  // words. Only a step asking for something gets one.
  it("[R25] gives the running step a subtitle and the settled one none", () => {
    render(view(["done", "active", "idle"]));

    const window = within(screen.getByTestId("provisioning-exec-window"));
    expect(window.getByText("Continue in your wallet")).toBeInTheDocument();
    expect(screen.queryByText("Waiting")).not.toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  // @rule POO-1504 R26 — below the window, so every carousel row keeps one height and the window does
  // not jump when a signature step comes up.
  it("[R26] renders the signing disclosure outside the window", () => {
    render(view(["done", "active", "idle"]), <p>What am I signing?</p>);

    const disclosure = screen.getByText("What am I signing?");
    expect(disclosure).toBeInTheDocument();
    expect(screen.getByTestId("provisioning-exec-window")).not.toContainElement(disclosure);
  });

  /**
   * @rule POO-1109 R3/R5 — THE contract in this file.
   *
   * The e2e harness maps every `[data-testid^="wallet-step-"]` to a leg and POLLS `data-status` to
   * follow a bridge to completion rather than sleeping. Two ways this surface could have broken it:
   * rendering only the visible step (the harness sees a one-leg route and reports "nothing to verify on
   * chain" for a bridge that really ran), or emitting the attributes from the window copy AS WELL (it
   * sees every leg twice). Both are asserted.
   */
  it("keeps one addressable node per leg, collapsed, and none for the op anchor", () => {
    const { container } = render(view(["done", "active", "idle"]));

    const nodes = container.querySelectorAll("[data-testid^='wallet-step-']");
    expect(nodes).toHaveLength(3);
    expect(container.querySelector("[data-testid='wallet-step-swap-0']")).toHaveAttribute(
      "data-status",
      "done",
    );
    // `idle` is reported as `pending`, which is the harness's vocabulary.
    expect(container.querySelector("[data-testid='wallet-step-swap-1']")).toHaveAttribute(
      "data-status",
      "pending",
    );
    expect(container.querySelector("[data-testid='wallet-step-op']")).toBeNull();
  });

  // @rule POO-1504 R58 — additive after 10s on the same step: the line appears and nothing else
  // changes, no state flips.
  it("[R58] adds the taking-longer line after 10s on the same step", async () => {
    vi.useFakeTimers();
    try {
      render(view(["done", "active", "idle"]));
      expect(screen.queryByText(/taking longer than usual/i)).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(TAKING_LONGER_MS + 100);
      });

      expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
      // Nothing else moved: the step is still the same one, still running, still `Step 2 of 3`.
      expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
      expect(
        within(screen.getByTestId("provisioning-exec-window")).getByText("Moving to Arbitrum"),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * @rule POO-1504 R31 — the ticker.
   *
   * The step leaving travels up and out while the arriving one comes in from below, over one 320ms
   * curve. Asserted on the classes rather than on computed style, because jsdom runs no animations: what
   * can be proven here is that BOTH halves are mounted for the length of one ticker, that the departing
   * copy is hidden from the accessibility tree (for those 320ms there are two rows in the DOM and a
   * screen reader must hear the arriving one), and that the departing row LEAVES afterwards rather than
   * piling up inside the window. The curve, the distance and the reduced-motion cross-fade live in one
   * place in `globals.css`, which is what keeps the two halves in step.
   */
  it("[R31] runs both halves of the ticker when the step changes, then drops the old row", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = renderWithProviders(
        <ExecutionCarousel
          view={view(["active", "idle", "idle"])}
          opLabel="Invest in Stable Yield"
        />,
      );
      expect(container.querySelector(".pp-ticker-out")).toBeNull();

      rerender(
        <ExecutionCarousel
          view={view(["done", "active", "idle"])}
          opLabel="Invest in Stable Yield"
        />,
      );

      const outgoing = container.querySelector(".pp-ticker-out");
      expect(outgoing).not.toBeNull();
      expect(outgoing).toHaveAttribute("aria-hidden", "true");
      // The arriving row runs the other half, so the two are one movement rather than a swap.
      expect(container.querySelector(".pp-ticker-in")).not.toBeNull();
      // And the row that left is the one that was running before, not the new one.
      expect(outgoing?.textContent).toContain("Converting WETH");

      act(() => {
        vi.advanceTimersByTime(TICKER_MS + 20);
      });

      expect(container.querySelector(".pp-ticker-out")).toBeNull();
      expect(container.querySelector(".pp-ticker-in")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("[R58] says nothing while a step is still inside the window", () => {
    vi.useFakeTimers();
    try {
      render(view(["done", "active", "idle"]));
      act(() => {
        vi.advanceTimersByTime(TAKING_LONGER_MS - 500);
      });
      expect(screen.queryByText(/taking longer than usual/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // @rule POO-1504 R57 — the liveness loops never stop. A frozen indicator on a 60-second on-chain
  // step is indistinguishable from a hung app. The dots advance on their own interval (they are text,
  // so no CSS keyframe can drive them and a screen reader hears the label, not the animation), and the
  // spinner's one turn is the SAME constant the component declares, not a string that can drift.
  it("[R57] advances the processing dots on their interval and turns the spinner at its constant", () => {
    vi.useFakeTimers();
    try {
      const { container: dots } = renderWithProviders(<ProcessingDots label="Processing" />);
      expect(dots.textContent).toBe("Processing.");
      act(() => {
        vi.advanceTimersByTime(DOTS_PERIOD_MS);
      });
      expect(dots.textContent).toBe("Processing..");
      act(() => {
        vi.advanceTimersByTime(DOTS_PERIOD_MS);
      });
      expect(dots.textContent).toBe("Processing...");
      act(() => {
        vi.advanceTimersByTime(DOTS_PERIOD_MS);
      });
      // The cycle WRAPS rather than stopping: indefinitely is the rule, not three ticks.
      expect(dots.textContent).toBe("Processing.");

      const { container } = render(view(["done", "active", "idle"]));
      const spinner = container.querySelector(".animate-spin");
      expect(spinner).not.toBeNull();
      expect(spinner).toHaveStyle({ animationDuration: `${SPINNER_PERIOD_MS}ms` });
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * @rule POO-1786 R1 R2 (S10). The dots render inside every host that later swaps them for plain
   * text (InvestModal's CTA once the parked press settles, ProvisioningPanel's state button on
   * `runFinished`, WalletSteps on `awaitingUser`). Chrome page translation replaces the label's text
   * node with `<font>` wrappers while React keeps the old one, so unmounting the dots ran
   * `removeChild(detachedTextNode)` and threw `NotFoundError` into the route error boundary (the
   * POO-1762 crash shape). The label is an element React owns now, so the removal targets it.
   */
  it("[POO-1786 R1 R2] unmounting the dots after Chrome translated the label does not throw", () => {
    // React logs the boundary-caught error; that log IS the failure under test, not noise to fix.
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const caught: Error[] = [];
      // The ProvisioningPanel shape: text replaces the dots inside a button that stays mounted.
      const ui = (finished: boolean) => (
        <CatchBoundary onError={(error) => caught.push(error)}>
          <button type="button">{finished ? "Done" : <ProcessingDots label="Processing" />}</button>
        </CatchBoundary>
      );
      const { rerender } = renderWithProviders(ui(false));
      translateLikeChrome(screen.getByRole("button"));
      // The replay must have rewritten a node, or the case passes vacuously.
      expect(screen.getByRole("button").querySelector("font")).not.toBeNull();

      rerender(ui(true));

      expect(caught.map((error) => error.name)).toEqual([]);
      expect(screen.getByRole("button")).toHaveTextContent("Done");
    } finally {
      errorLog.mockRestore();
    }
  });

  // @rule POO-1786 R3 (S10): invisible. The label span carries no attribute, so in a flex host it is
  // one item where the anonymous text item was, and the dots stay the aria-hidden decoration.
  it("[POO-1786 R3] renders the label in a bare span beside the hidden dots", () => {
    const { container } = renderWithProviders(<ProcessingDots label="Processing" />);
    const [label, dots] = Array.from(container.children);
    expect(label?.tagName).toBe("SPAN");
    expect(label?.attributes).toHaveLength(0);
    expect(label?.textContent).toBe("Processing");
    expect(dots).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).toBe("Processing.");
  });

  /**
   * @rule POO-1037 R2 — every hashed row keeps its explorer link, and a user can verify a leg that
   * settled two steps ago from the expanded list. The anchors are legal there (a plain `<ol>` outside
   * any button) and ILLEGAL inside the window: the window lives in the toggle `<button>`, an anchor
   * inside a button is invalid HTML the keyboard cannot reach, and tapping it would also toggle the
   * expand. So the running row's link renders below the box, the way the [R26] disclosure does.
   */
  it("[R1] links every hashed row in the EXPANDED list only, never below the collapsed window", () => {
    const v = view(["done", "active", "idle"]);
    v.rows = v.rows.map((r) =>
      r.status === "done" || r.status === "active" ? { ...r, txHash: `0x${r.key}` } : r,
    );
    const { container } = renderWithProviders(
      <ExecutionCarousel
        view={v}
        opLabel="Invest in Stable Yield"
        rowLink={(row) =>
          row.txHash ? <a href={`https://scan.test/tx/${row.txHash}`}>View transaction</a> : null
        }
      />,
    );

    // POO-1568 [R1]: collapsed, the carousel renders NO link of its own. The running leg's link is
    // the state button's secondary action now, so the panel renders it inside the sticky footer
    // BELOW that button; a second copy here would put it back above the CTA it belongs to.
    expect(container.querySelector("button a")).toBeNull();
    expect(screen.queryByRole("link", { name: "View transaction" })).toBeNull();

    // Expanded: one link per hashed row, the settled leg's included.
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const list = within(screen.getByTestId("provisioning-exec-list"));
    expect(list.getAllByRole("link", { name: "View transaction" })).toHaveLength(2);
  });
});
