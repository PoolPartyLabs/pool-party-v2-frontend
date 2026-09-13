/**
 * @id PP-CORE-CMP-046 (POO-1570)
 * @name ProvisioningPanel — the buy route never flashes step 2 while its quote is in flight
 * @implements-rules-version v1 (POO-1570 rules v1)
 * @analytics-events none (this file pins render branches and host header signals; the funding funnel
 *   has its own suite in `ProvisioningPanel.analytics.test.tsx`)
 *
 * Deliberately carries no Universal Funding epic provenance tag: this is a post-hackathon defect
 * fix, not one of that epic's artifacts, and `tests/hackathonDocs.test.ts` asserts a file count over
 * the epic's tree. `ProvisioningPanel.headerSignals.test.tsx` (POO-1528) made the same call. Note
 * that the count matches the tag as a bare SUBSTRING of the whole file, so even naming it in prose
 * here would enrol this file in the epic and break that count.
 *
 * Reported from live QA (Murilo, 2026-08-13): tapping `Buy $52.50, Recommended` on screen 1 showed
 * the tokens/swap-bridge selector ("Choose tokens to convert") for 1 to 2 seconds before the buy
 * flow started. The buy route has no step 2 at all, so that screen should never appear for it.
 *
 * Why the suite never caught it, and what this file changes. The buy branch of the route handler
 * deliberately does NOT move `phase` (`ProvisioningPanel.tsx:1952-1955`), because the POO-1503 start
 * effect uses `phase === "sources"` as its idempotence guard. `pickingSources` had no term for "a
 * route is chosen and its quote is in flight", so it stayed true for the whole `computePlan` round
 * trip, which is exactly what that tap unblocks (`routeSettled` flips the hook's `enabled`). Every
 * sibling suite resolves `computePlan` on a microtask, which makes the window zero-width — the flash
 * is invisible to a test that cannot hold the quote open. So this file stubs the seam with a
 * DEFERRED promise and asserts on the window itself, which is the assertion the suite was missing
 * regardless of which mechanism was chosen to close it.
 *
 * Rules under test (POO-1570 rules v1):
 *   [R1] the `buy` route never renders step 2, at any point between the tap and the run, on a first
 *        pass through the picker or a later one
 *   [R2] the window is `routeChoice === "buy" && startRequested && (planLoading || !quotedPlanFallsShort)`,
 *        i.e. it opens at the tap and closes only when step 2 is genuinely behind the panel: while the
 *        quote answering THIS tap is out (a plan kept from a previous route is not that answer), and
 *        then until the re-pick condition itself says otherwise
 *   [R3] it renders the existing quote-in-flight skeleton, plus one "Preparing your purchase" line
 *   [R4] the two mobile-host header signals agree with the body for the whole window
 *   [R5] nothing from step 2 is reachable during the window — not the rendered controls and not the
 *        `goBack` handle a host can call — so the buy cannot be silently cancelled
 *   [R6] a failed quote surfaces the planner error, not the skeleton and not step 2
 *   [R7] scope is buy-only: the token routes still land on step 2
 *   [R9] the window's exit condition IS the re-pick's own condition, so a buy whose quoted plan falls
 *        short still returns to step 2 with the real figure
 */
import { type AnchorHTMLAttributes, createRef, type ReactNode, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import type { GasFeasibility, ProvisioningPlan } from "@/lib/provisioning";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ProvisioningPanel, type ProvisioningPanelHandle } from "./ProvisioningPanel";

// The cost breakdown's buy-crypto peer option renders the locale-aware Link, whose factory reaches
// for app-router navigation at import time. Stubbed as in every sibling suite.
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

/**
 * The ONE plan seam (POO-1023), stubbed so each case can hold the quote OPEN.
 *
 * Nothing calls it before the tap: with more than one route on screen `routeSettled` is false, which
 * suspends `useProvisioningPlan` entirely (`enabled`, `useProvisioningPlan.ts:113`). That is what
 * makes "the first call is the buy tap's" a fact rather than an assumption.
 */
const computePlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/provisioning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provisioning")>()),
  computePlan,
}));

const POLYGON = 137;
const ARBITRUM = 42161;
const ONRAMP_CHAIN_ID = 8453;

function noop() {}

interface StubPlan {
  steps: { type: string; key: string }[];
}

/** Steps that settle immediately, so a started run reaches `pending` without the mock delay. */
const immediateSteps = (plan: StubPlan) =>
  plan.steps
    .filter((step) => step.type !== "op")
    .map((step) => ({ key: step.key, run: async () => ({ txHash: `0x${step.key}` }) }));

function verdict(chainId: number): GasFeasibility {
  return {
    chainId,
    verdict: "OK",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0,
    surplusUsd: 1,
    reasonKey: "provisioning.gasVerdict.ok",
  };
}

function fundingSource(over: Partial<FundingSource> = {}): FundingSource {
  return {
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    chainId: POLYGON,
    symbol: "WETH",
    decimals: 18,
    amount: "400000000000000000",
    usd: 50,
    reachableChainIds: [POLYGON, ARBITRUM],
    isNative: false,
    logoUrl: "",
    ...over,
  } as FundingSource;
}

/**
 * Under-funded on purpose ($50 against a $200 requirement, on-ramp on), which is what makes
 * `shouldPickRoute` see a genuine choice so screen 1 leads. Mirrors the analytics suite's context.
 */
const CONTEXT: ProvisioningGateContext = {
  targetChainId: ARBITRUM,
  sources: [fundingSource()],
  gasByChain: { [POLYGON]: verdict(POLYGON), [ARBITRUM]: verdict(ARBITRUM) },
  balancesByChain: {
    [POLYGON]: { nativeUsd: 5, tokenUsd: 50 },
    [ARBITRUM]: { nativeUsd: 0, tokenUsd: 0 },
  },
  gasEstimateUsd: 0.075,
};

const INPUT = {
  currentChainId: ARBITRUM,
  targetChainId: ARBITRUM,
  opRequiredUsdc: 200,
  gasEstimateUsd: 0.075,
};

/**
 * A pure-buy plan: the card covers the whole requirement, so `sourcesMustCoverUsd` nets to zero and
 * the plan does not fall short of an empty selection (POO-1135). That is the plan the buy tap asks
 * for, and the one whose arrival is supposed to start the run.
 */
const BUY_PLAN: ProvisioningPlan = {
  needed: true,
  reason: ["usdc"],
  variant: "multi",
  steps: [
    {
      type: "buy",
      key: "buy",
      labelKey: "provisioning.steps.buy",
      fromToken: "USD",
      toToken: "USDC",
      toChainId: ONRAMP_CHAIN_ID,
      amountUsd: 210,
      amountToken: "210.00",
      poweredBy: "paybis",
    },
    { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 200 },
  ],
  quote: {
    shortfallUsd: 200,
    bufferUsd: 4,
    feesUsd: 1.02,
    totalPayUsd: 205.02,
    quotedAt: "2026-08-13T12:00:00.000Z",
    // Long enough that no TTL countdown fires mid-test.
    ttlMs: 600_000,
  },
  slippagePct: 2,
};

/**
 * The plan a TOKEN route quotes for this context: one bridge leg off the Polygon holding, which the
 * $50 source cannot cover on its own. Its only job in this file is to be a plan that EXISTS — the
 * re-entry case below turns on `plan` surviving a route change, and a short one is what a
 * deliberately under-funded context actually quotes.
 */
const TOKEN_PLAN: ProvisioningPlan = {
  needed: true,
  reason: ["usdc"],
  variant: "multi",
  steps: [
    {
      type: "bridge",
      key: "bridge",
      labelKey: "provisioning.steps.bridge",
      fromToken: "WETH",
      toToken: "USDC",
      fromChainId: POLYGON,
      toChainId: ARBITRUM,
      amountUsd: 50,
      amountToken: "50.00",
    },
    { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 200 },
  ],
  quote: {
    shortfallUsd: 200,
    bufferUsd: 4,
    feesUsd: 1.02,
    totalPayUsd: 205.02,
    quotedAt: "2026-08-13T12:00:00.000Z",
    ttlMs: 600_000,
  },
  slippagePct: 2,
};

/**
 * A buy plan that does NOT cover the requirement: the card leg is sized at $100 against a $205.02
 * total, so $105.02 is left for the on-chain sources and the empty selection covers none of it.
 * This is the POO-1042 [R7] re-pick, on the buy route, and it is the one case where step 2 SHOULD
 * appear for a chosen buy — which is exactly what keeps the suppression from being a blanket.
 */
const SHORT_BUY_PLAN: ProvisioningPlan = {
  ...BUY_PLAN,
  steps: BUY_PLAN.steps.map((step) =>
    step.type === "buy" ? { ...step, amountUsd: 100, amountToken: "100.00" } : step,
  ),
};

/** A quote held open, so the flash window has a real width instead of a microtask's. */
function deferQuote() {
  let settle!: (plan: ProvisioningPlan) => void;
  let fail!: (error: Error) => void;
  const pending = new Promise<ProvisioningPlan>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  computePlan.mockReturnValue(pending);
  return { settle, fail, pending };
}

/**
 * Every `data-phase` this panel has rendered, in order.
 *
 * OLD VALUES, not live reads, and that distinction is the whole reliability of this file. Every
 * branch here returns a `<div className="flex flex-col gap-4">` at the same position, so React
 * REUSES the node and MUTATES `data-phase` in place rather than swapping the element. A
 * MutationObserver callback is delivered at a microtask checkpoint, by which time the live node
 * already carries the LAST value of the batch — so an observer that re-reads the node can never see
 * the intermediate phases it exists to catch, and `not.toContain("sources")` would pass over its own
 * counterexample. `attributeOldValue` is what makes each replaced value observable: the record
 * carries the string that was there before the mutation, in mutation order.
 *
 * `childList` stays observed because a phase can also arrive on a newly inserted node (nothing in
 * this file's paths does, but an absent record is a silent hole); those are covered by the live
 * sample at the end of each batch, which is also what appends the value the last record replaced.
 */
function recordPhases(container: HTMLElement): { phases: () => string[]; stop: () => void } {
  const seen: string[] = [];
  const push = (phase: string | null | undefined) => {
    if (phase && seen[seen.length - 1] !== phase) seen.push(phase);
  };
  const sample = () => push(container.querySelector("[data-phase]")?.getAttribute("data-phase"));
  sample();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") push(record.oldValue);
    }
    sample();
  });
  observer.observe(container, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["data-phase"],
  });
  return {
    phases: () => {
      sample();
      return [...seen];
    },
    stop: () => observer.disconnect(),
  };
}

interface HostSignals {
  onSourcesActiveChange?: (active: boolean) => void;
  onCanGoBackChange?: (canGoBack: boolean) => void;
  /** The imperative handle a mobile host's own header drives (POO-1528 [R20]). */
  ref?: RefObject<ProvisioningPanelHandle | null>;
}

async function renderRoutes(signals: HostSignals = {}) {
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
  const view = renderWithProviders(
    <ProvisioningPanel
      input={INPUT}
      context={CONTEXT}
      operation={{ kind: "invest" }}
      opLabel="Invest in Stable Yield"
      onDone={noop}
      onCancel={noop}
      buildPlanSteps={immediateSteps}
      {...(signals.ref ? { ref: signals.ref } : {})}
      {...(signals.onSourcesActiveChange
        ? { onSourcesActiveChange: signals.onSourcesActiveChange }
        : {})}
      {...(signals.onCanGoBackChange ? { onCanGoBackChange: signals.onCanGoBackChange } : {})}
    />,
  );
  expect(await screen.findByTestId("provisioning-panel")).toHaveAttribute("data-phase", "routes");
  return view;
}

const buyRow = () => screen.findByRole("button", { name: /^Buy \$/ });

/**
 * Let React and the microtask queue drain WITHOUT resolving the quote.
 *
 * This is the whole point of the file: it is the beat the user spent looking at the wrong screen.
 * `act` is what makes the assertions after it deterministic rather than load-dependent (POO-1545).
 */
async function holdTheWindowOpen() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  __resetDevOverridesForTests();
  computePlan.mockReset();
});
afterEach(() => {
  __resetDevOverridesForTests();
  vi.unstubAllEnvs();
});

describe("ProvisioningPanel — the buy route's quote window (POO-1570)", () => {
  it("[R1]/[R2] never renders step 2 between the buy tap and the run", async () => {
    const { settle } = deferQuote();
    const { container } = await renderRoutes();
    const recorder = recordPhases(container);

    fireEvent.click(await buyRow());
    await holdTheWindowOpen();

    // The window itself: the picker is gone and the quote is still out.
    expect(screen.queryByText("Choose tokens to convert")).not.toBeInTheDocument();

    await act(async () => {
      settle(BUY_PLAN);
    });
    await waitFor(() =>
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending"),
    );

    recorder.stop();
    // The assertion the suite was missing: not "it ends up right", but "it is never wrong".
    expect(recorder.phases()).not.toContain("sources");
  });

  it("[R1]/[R5] never renders step 2 on a SECOND pass through the picker either", async () => {
    /**
     * The case every other one here is structurally blind to: they all start from a mount where
     * `computePlan` has never resolved, so any term that reads `plan` is trivially satisfied. A real
     * user gets a plan first — `useProvisioningPlan` keeps it mounted across a route change (it only
     * flips `loading`, deliberately, so the screen does not blank on a re-quote) — and then goes back
     * to screen 1 via the [R20] chevron and taps Buy. On that pass the buy's quote is in flight over a
     * plan that already exists, and a stale plan against a now-empty selection reads as SHORT.
     *
     * Which makes this the damaging one rather than the cosmetic one: step 2 is live, and the token
     * rows on it call `setStartRequested(false)` ([R5]), so one tap during that window cancels the buy
     * the user just chose, silently, and re-quotes as a token route.
     */
    const tokens = deferQuote();
    const { container } = await renderRoutes();

    // Pass 1: a token route, quoted through to a real plan on screen 2.
    fireEvent.click(await screen.findByRole("button", { name: /^Use \$/ }));
    await act(async () => {
      tokens.settle(TOKEN_PLAN);
    });
    expect(await screen.findByText("Choose tokens to convert")).toBeInTheDocument();

    // Back to screen 1 ([R20] chevron / `setRouteChoice(null)`), with that plan still mounted.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "routes"),
    );

    // Pass 2: Buy, with its own quote held open.
    const buy = deferQuote();
    const recorder = recordPhases(container);
    fireEvent.click(await buyRow());
    await holdTheWindowOpen();

    expect(screen.queryByText("Choose tokens to convert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /WETH/ })).not.toBeInTheDocument();

    // And the buy still starts: the window did not hand anyone a way to cancel it.
    await act(async () => {
      buy.settle(BUY_PLAN);
    });
    await waitFor(() =>
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending"),
    );

    recorder.stop();
    expect(recorder.phases()).not.toContain("sources");
  });

  it("[R9] still re-picks when the buy's OWN quote comes back short", async () => {
    // The scope check in the other direction from [R7]: the suppression must not swallow the
    // POO-1042 [R7] re-pick. A buy leg too small to close the gap leaves a remainder for the
    // on-chain sources, and that is a question, so step 2 is the right screen and says the figure.
    const { settle } = deferQuote();
    await renderRoutes();

    fireEvent.click(await buyRow());
    await act(async () => {
      settle(SHORT_BUY_PLAN);
    });

    expect(await screen.findByText("Choose tokens to convert")).toBeInTheDocument();
    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "sources");
    expect(screen.getByText(/The final price came in a little higher/)).toBeInTheDocument();
  });

  it("[R3] holds the quote-in-flight skeleton, with a line saying what is being prepared", async () => {
    const { settle } = deferQuote();
    await renderRoutes();

    fireEvent.click(await buyRow());
    await holdTheWindowOpen();

    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "loading");
    expect(screen.getByText("Preparing your purchase")).toBeInTheDocument();

    await act(async () => {
      settle(BUY_PLAN);
    });
  });

  it("[R3] leaves the same skeleton mute when no route was chosen", async () => {
    // Mock mode's initial load reaches the very same branch with no route behind it, so the copy
    // has to be scoped to the window rather than bolted onto the skeleton.
    deferQuote();
    renderWithProviders(
      <ProvisioningPanel
        input={INPUT}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
      />,
    );
    await holdTheWindowOpen();

    expect(screen.queryByText("Preparing your purchase")).not.toBeInTheDocument();
  });

  it("[R4] tells a mobile host that step 2 is NOT active for the whole window", async () => {
    const { settle } = deferQuote();
    const onSourcesActiveChange = vi.fn();
    const onCanGoBackChange = vi.fn();
    await renderRoutes({ onSourcesActiveChange, onCanGoBackChange });

    /**
     * Scoped to the WINDOW, so the assertion below can be about never rather than about last.
     *
     * `phase` initialises to `sources` (`ProvisioningPanel.tsx:672`), so `onSourcesActiveChange(true)`
     * has already fired at mount, while screen 1 is what is on screen. That is POO-1528 behaviour this
     * file neither introduces nor fixes — the signal reports `phase`, and on the multi-route path
     * `phase` says `sources` before the picker has even been answered. Clearing here draws the line at
     * the tap, which is the only interval [R4] makes a claim about; the mount-time call is recorded in
     * the report on this PR rather than silently absorbed.
     */
    onSourcesActiveChange.mockClear();
    onCanGoBackChange.mockClear();

    fireEvent.click(await buyRow());
    await holdTheWindowOpen();

    // Without this the host header flips to step 2 chrome while the body shows a skeleton.
    //
    // NEVER true, not "false last": the host re-renders on every call it receives, so a signal that
    // flipped true and back INSIDE the window is exactly the flash this file exists to stop, and a
    // last-call assertion passes straight over it.
    expect(onSourcesActiveChange).not.toHaveBeenCalledWith(true);
    expect(onCanGoBackChange).not.toHaveBeenCalledWith(true);

    await act(async () => {
      settle(BUY_PLAN);
    });
  });

  it("[R5] offers nothing from step 2 to tap, so the buy cannot be silently cancelled", async () => {
    const { settle } = deferQuote();
    await renderRoutes();

    fireEvent.click(await buyRow());
    await holdTheWindowOpen();

    // The three controls that rendered during the flash. The token row is the damaging one: it
    // called `setStartRequested(false)` and re-quoted as a token route, with no error shown.
    expect(screen.queryByRole("button", { name: /WETH/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /transaction settings/i })).not.toBeInTheDocument();

    // And the buy still starts, i.e. the intent survived the window intact.
    await act(async () => {
      settle(BUY_PLAN);
    });
    await waitFor(() =>
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending"),
    );
  });

  it("[R5] ignores a host's own `goBack()` for the whole window", async () => {
    // The [R20] handle is step 2's back control, exposed for a mobile host to drive from its own
    // header. `onCanGoBackChange(false)` tells that host to HIDE the control; it does not stop the
    // host CALLING it — a header rendered one commit earlier, a queued tap. Unguarded, that call
    // drops the user back on screen 1 with `startRequested` still true behind them.
    const { settle } = deferQuote();
    const ref = createRef<ProvisioningPanelHandle>();
    await renderRoutes({ ref });

    fireEvent.click(await buyRow());
    await holdTheWindowOpen();

    await act(async () => {
      ref.current?.goBack();
    });
    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "loading");

    // And the run the user committed to still starts.
    await act(async () => {
      settle(BUY_PLAN);
    });
    await waitFor(() =>
      expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "pending"),
    );
  });

  it("[R6] surfaces the planner failure instead of stranding on step 2", async () => {
    const { fail, pending } = deferQuote();
    // The rejection is handled by the hook; keep the runner from seeing it as unhandled.
    pending.catch(() => {});
    await renderRoutes();

    fireEvent.click(await buyRow());
    await act(async () => {
      fail(new Error("quote unavailable"));
    });

    expect(await screen.findByTestId("provisioning-error")).toHaveAttribute("data-phase", "error");
    expect(screen.queryByText("Choose tokens to convert")).not.toBeInTheDocument();
  });

  it("[R7] still sends the token route to step 2", async () => {
    deferQuote();
    const { container } = await renderRoutes();
    const recorder = recordPhases(container);

    fireEvent.click(await screen.findByRole("button", { name: /^Use \$/ }));
    await holdTheWindowOpen();

    recorder.stop();
    // Scope check: the fix suppresses step 2 for `buy` ONLY, and this route still owns it.
    expect(screen.getByTestId("provisioning-panel")).toHaveAttribute("data-phase", "sources");
    expect(screen.queryByText("Preparing your purchase")).not.toBeInTheDocument();
  });
});
