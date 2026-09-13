/**
 * @id PP-CORE-CMP-046 (POO-1041)
 * @name ProvisioningPanel — real-step execution tests
 * @implements-rules-version v4 (POO-1041 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The panel driving a REAL plan. A mock plan cannot reach any of this: it carries no legs, so the
 * rail expands it into nothing, and no rail-only row ever appears.
 *
 * A separate file from `ProvisioningPanel.test.tsx`, deliberately: that suite is the mock-mode
 * behavioural proof and stubs the plan seam not at all, while this one has to replace it to inject
 * a plan the mock planner will never produce.
 *
 * Rules under test (POO-1041 rules v1):
 *   [R1] per-step status comes from the rail
 *   [R2] a running bridge shows its ETA AND a link to the transaction, the instant it broadcasts
 *   [R6] the rail expands one plan step into an approval PLUS the leg, so the row labels,
 *        statuses and hashes are matched by KEY. Matched by index, the bridge's status would land
 *        on a different row entirely.
 *
 * POO-1088 rules v2 moved the execution surface from `WalletSteps` to the plan card in `running`
 * mode, so the copy these assertions read changed with it: the active step is the row marked
 * `aria-current="step"` carrying its own sub-line, rather than a centred "Step X of Y". What is
 * under test did not change, and deliberately so: [F5-R4] makes key-matching a requirement of that
 * issue rather than an implementation detail, because approvals shift positions in the rail and the
 * identity of a leg does not.
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
  within,
} from "../../../../tests/utils/renderWithProviders";
import { planRailSteps } from "../lib/buildPlanSteps";
import { ProvisioningPanel } from "./ProvisioningPanel";

// Two mounted surfaces render the locale-aware Link: POO-1043 [R9]'s cost breakdown in the plan phase
// (its buy-crypto peer option) and POO-1044 [R3]'s buy-crypto escape on the blocked error branch. It
// resolves Next's app-router navigation, which does not exist under jsdom, so it is stood in for, as
// in every other suite in this folder that mounts a navigating component.
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

const TX_HASH = "0x9f2c1d4a6b8e0f3c5a7d9e1b2c4f6a8d0e2b4c6f8a0d2e4b6c8f0a2d4e6b8c0f";

// The plan seam is async and resolves the MOCK planner in tests; this replaces it with the shape the
// real planner emits, which is what the whole issue is about.
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
 * The rail as the real one behaves: each leg runs after its approval, and the bridge reports its
 * hash the instant it has one and then stays open for the settlement wait.
 */
const realRail = (plan: ProvisioningPlan, rail: { onLegBroadcast: (event: never) => void }) =>
  planRailSteps(plan).map((step) => ({
    key: step.key,
    run: async () => {
      if (step.kind === "leg" && step.leg?.kind === "bridge") {
        (rail.onLegBroadcast as (event: unknown) => void)({
          leg: step.leg,
          txHash: TX_HASH,
          at: Date.now(),
        });
        // A bridge leg does not return for minutes: its hash exists long before its result does.
        return new Promise<never>(() => {});
      }
      return { txHash: `0x${step.key}` };
    },
  }));

describe("ProvisioningPanel — real steps (POO-1041)", () => {
  beforeEach(() => {
    planHolder.current = realProvisioningPlan();
  });

  it("[R6] lists what the rail will really run, approvals included", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={realRail}
      />,
    );

    // POO-1503 deleted the pre-run plan screen, so mock mode auto-starts and the surface under test
    // is the carousel's full list mid-run: the bridge holds the rail open, which is what keeps the
    // moment observable. [R6]'s substance is unchanged: the rail's own expansion is what the user is
    // shown, one approval row per ERC-20 leg, each row conjugated by its status (POO-1504 [R24]).
    expect(await screen.findByText("Approved WETH")).toBeInTheDocument();
    expect(screen.getByText("Converted WETH")).toBeInTheDocument();
    expect(screen.getByText("Approved USDC")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("provisioning-exec-window")).getByText("Moving to Arbitrum"),
    ).toBeInTheDocument();
  });

  it("[R1]/[R6] marks the running bridge active by key, not by its position in the plan", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={realRail}
      />,
    );

    // The rail runs approve → swap → approve → bridge. The bridge is rail step 4 and plan step 2:
    // an index-matched surface would light up the wrong row.
    // @rule POO-1504 R24 — and the title is in the GERUND while it runs, which is the other half of
    // "this row is the live one": `Move to Arbitrum` is what a step that has not started says.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("provisioning-exec-window")).getByText("Moving to Arbitrum"),
      ).toBeInTheDocument();
    });
    const window = within(screen.getByTestId("provisioning-exec-window"));
    expect(window.getByText("Moving to Arbitrum").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    // [F5-R2] And the sub-line lands on that SAME row. Asserted as an identity rather than as two
    // separate presence checks, because "somewhere on screen" is exactly what a positional match
    // would also satisfy.
    expect(window.getByText("Continue in your wallet").closest("li")).toBe(
      window.getByText("Moving to Arbitrum").closest("li"),
    );
    // Exactly one live row in the whole surface: [R21] shows one step, and `aria-current` is the
    // window's alone so the hidden list cannot claim to be live as well.
    expect(
      screen
        .getAllByRole("listitem", { hidden: true })
        .filter((li) => li.hasAttribute("aria-current")),
    ).toHaveLength(1);
  });

  it("[R2] shows the running bridge's ETA and a link to the transfer once it broadcasts", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={realRail}
      />,
    );

    expect(await screen.findByText(/about 3 minutes/)).toBeInTheDocument();
    // The gap POO-1037 left open: before this, a bridge only got a link once it had already given
    // up, so a user watching a five-minute transfer had no way to check it was moving.
    //
    // The link is NOT inside the window row: the window lives in the carousel's toggle `<button>`,
    // and a button may not wrap an anchor. Still the bridge's own hash, still the instant it
    // broadcasts, and the only VISIBLE link on the surface, since the full list's per-leg links sit
    // collapsed. POO-1568 [R1] moved WHERE it renders (see the placement test below); that it
    // renders at all, on the running leg's own hash, is this test and did not change.
    const link = await screen.findByRole("link", { name: "View on explorer" });
    expect(link).toHaveAttribute("href", `https://polygonscan.com/tx/${TX_HASH}`);
    expect(link.closest("button")).toBeNull();
  });

  /**
   * @rule POO-1568 R1 — Murilo's live-QA screenshot: the link sat in the carousel's own slot, which
   * is ABOVE the pinned footer, so a bare underlined line floated over the primary CTA and read as
   * an afterthought. It belongs INSIDE the footer, after the state button, as that button's own
   * secondary action.
   *
   * Document order is the assertion, not a class or a testid: "above the Done button" is precisely
   * what was wrong, and containment alone would still pass if the link were rendered first.
   */
  it("[R1] renders the explorer link inside the pinned footer, AFTER the state button", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        buildPlanSteps={realRail}
      />,
    );

    const link = await screen.findByRole("link", { name: "View on explorer" });
    const footer = screen.getByTestId("provisioning-sticky-footer");
    const stateButton = screen.getByTestId("provisioning-exec-state");

    expect(footer).toContainElement(link);
    expect(
      stateButton.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The quiet button-shaped variant, not the bare underlined line it used to be: under a primary
    // CTA, an underlined fragment of copy is what made it read as floating debris.
    expect(link).toHaveClass("w-full");
    expect(link.className).not.toContain("underline");
  });

  /**
   * @rule POO-1568 R1 — one home for the current leg's link, whatever the list is doing (Rafael,
   * 2026-08-13). Moving the link into the footer left the expanded list's copy of it in place, so a
   * user who tapped `Step 4 of 4` open saw `View on explorer` TWICE against the identical
   * transaction: once in the running leg's own row, once under the state button. The footer copy is
   * the unconditional one, so the row is what yields.
   *
   * The assertion is deliberately a COUNT over the current transaction's href rather than a
   * `queryBy` inside the list: what was wrong is that the same link existed twice on the surface,
   * and only counting says so. The other rows are asserted in the same test because "drop the
   * duplicate" and "drop the list's links" are one careless edit apart, and POO-1037 [R2] is exactly
   * the second one: a leg that settled two steps ago is verifiable ONLY from the list.
   */
  it("[R1] renders the current leg's link once, in the footer, with the list EXPANDED", async () => {
    const { container } = renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        // `realRail` settles every earlier step with its own `0x<key>` hash and leaves the bridge
        // broadcast-but-open, which is the shape this is about: several linkable rows behind a
        // current one that is ALSO linkable.
        buildPlanSteps={realRail}
      />,
    );

    // The bridge has broadcast: its hash is on the row, so both surfaces have something to render.
    await screen.findByRole("link", { name: "View on explorer" });
    // The carousel's toggle, found by the list it CONTROLS rather than by `{ expanded: false }`:
    // the signing disclosure below the window is a second collapsed disclosure on this screen.
    const list = screen.getByTestId("provisioning-exec-list");
    const toggle = container.querySelector<HTMLButtonElement>(`button[aria-controls="${list.id}"]`);
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);

    const bridgeHref = `https://polygonscan.com/tx/${TX_HASH}`;
    const currentLinks = screen
      .getAllByRole("link", { name: "View on explorer" })
      .filter((a) => a.getAttribute("href") === bridgeHref);
    expect(currentLinks).toHaveLength(1);
    // Defaulted to `null` rather than indexed: `toContainElement` takes an element or null, and a
    // `null` that slipped through fails the containment check anyway, so the count above stays the
    // assertion that matters.
    const [currentLink = null] = currentLinks;
    expect(screen.getByTestId("provisioning-sticky-footer")).toContainElement(currentLink);

    // ...and the rows the footer is NOT covering keep theirs, inside the list, untouched.
    const listLinks = within(screen.getByTestId("provisioning-exec-list")).getAllByRole("link", {
      name: "View on explorer",
    });
    expect(listLinks.length).toBeGreaterThan(0);
    expect(listLinks.map((a) => a.getAttribute("href"))).not.toContain(bridgeHref);
  });

  /**
   * @rule POO-1568 R1 — the state the screenshot actually shows. Every leg settled, so the button
   * says `Done`, the carousel is idle, and the link under it points at the last leg that ran.
   */
  it("[R1] keeps the link under the button once the run has finished", async () => {
    renderWithProviders(
      <ProvisioningPanel
        input={SCENARIOS.usdcBridge}
        opLabel="Invest in Stable Yield"
        onDone={noop}
        onCancel={noop}
        // Every step settles, unlike `realRail`'s bridge: the all-done screen is what is under test.
        buildPlanSteps={(plan) =>
          planRailSteps(plan).map((step) => ({
            key: step.key,
            run: async () => ({ txHash: TX_HASH }),
          }))
        }
      />,
    );

    const stateButton = await screen.findByTestId("provisioning-exec-state");
    await waitFor(() => expect(stateButton).toBeEnabled());

    const link = screen.getByRole("link", { name: "View on explorer" });
    expect(screen.getByTestId("provisioning-sticky-footer")).toContainElement(link);
    expect(
      stateButton.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
