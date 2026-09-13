/**
 * @id PP-STR-MOD-001 (POO-1043)
 * @name InvestModal — any-token any-chain invest (the flagship)
 * @implements-rules-version v11 (POO-1043 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The whole epic, end to end, from the one surface it was built for: a wallet that is short on the
 * operation's chain funds the invest from what it already holds elsewhere, and then the ORIGINAL
 * invest runs.
 *
 * Rules under test (POO-1043 rules v1):
 *   [R1] the invest resumes with its original parameters (amount, slippage)
 *   [R2] the invest stays a FRESH, user-signed transaction: provisioning never pre-authorises it
 *   [R4] a provisioning wait longer than the built-tx freshness window cannot produce a stale send
 *   [R5] post-write refresh runs on completion
 *   [R6] cancelling mid-provisioning preserves the entered amount
 *
 * The invest steps and the provisioning rail are both stubbed, because both sign and broadcast.
 * Everything between them (the gate, the panel, the phase machine, the pause-at-Review handshake) is
 * the real code.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import type { InvestCtx } from "../hooks/useInvest";
import { type FlowStep, MAX_BUILT_TX_AGE_MS } from "../hooks/useWalletSignFlow";
import { InvestModal } from "./InvestModal";

/** Wall clock the flow's freshness window is measured against. Frozen so [R4] can move it. */
const T0 = Date.parse("2026-07-25T12:00:00.000Z");

const { railHolder } = vi.hoisted(() => {
  let open: () => void = () => {};
  const holder = {
    openJournal: vi.fn(),
    closeJournal: vi.fn(),
    /** Non-null while every provisioning leg is held, so a test owns how long the wait lasts. */
    gate: null as Promise<void> | null,
    /** Non-null makes every provisioning leg FAIL with it, so [R6] can reach the failure exit. */
    failWith: null as Error | null,
    hold() {
      holder.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release() {
      holder.gate = null;
      open();
    },
  };
  return { railHolder: holder };
});

// The dark-launched gate, forced on. Mock mode's own short-wallet scenario is the demo case: no
// USDC, wrong network, no gas.
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: (key: string) => key === "provisioning", flags: {} }),
}));

// The rail signs and broadcasts, so it is the one dependency a test must replace. Every leg settles
// immediately unless a test holds the gate, which is what lets [R4] stretch the wait past the window.
vi.mock("../hooks/useProvisioningRail", () => ({
  useProvisioningRail: () => ({
    buildSteps: (plan: { steps: { type: string; key: string }[] }) =>
      plan.steps
        .filter((step) => step.type !== "op")
        .map((step) => ({
          key: step.key,
          run: async () => {
            if (railHolder.gate) await railHolder.gate;
            if (railHolder.failWith) throw railHolder.failWith;
            return { txHash: `0x${step.key}` };
          },
        })),
    openJournal: railHolder.openJournal,
    closeJournal: railHolder.closeJournal,
  }),
}));

vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: vi.fn(async () => {}),
}));
vi.mock("@/features/rewards/hooks/useReferralOperationLog", () => ({
  useReferralOperationLog: () => vi.fn(),
}));
vi.mock("@/features/rewards/actions", () => ({ applyReferralCodeAction: vi.fn(async () => {}) }));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

const strategy = {
  id: "s1",
  name: "Stable Yield",
  network: "arbitrum",
  pool: "0xpool",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 50,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY",
  status: "active",
  detail: { lockupDays: 0, managerVerified: true, about: "x", composition: [] },
} as unknown as Strategy;

interface Recorder {
  /** Every `(amountUsd, slippage)` pair the modal asked for steps with. */
  asked: [number, number][];
  /** The step keys that actually ran, in order. */
  ran: string[];
  /** `Date.now()` at each build. */
  builtAt: number[];
  /** The build marker the send signed, so a stale reuse is visible. */
  sentBuild: number | null;
}

/**
 * A real-shaped invest step list: approve → Permit2 → build → send, with the build MARKED so the send
 * can say which build it signed. The modal pauses after `build`, which is the Review.
 */
function investStepsFor(recorder: Recorder) {
  return (amountUsd: number, slippage: number): FlowStep<InvestCtx>[] => {
    recorder.asked.push([amountUsd, slippage]);
    return [
      {
        key: "approve:USDC",
        run: async () => {
          recorder.ran.push("approve:USDC");
          return {};
        },
      },
      {
        key: "permit",
        run: async () => {
          recorder.ran.push("permit");
          return {};
        },
      },
      {
        key: "build",
        run: async () => {
          recorder.ran.push("build");
          const marker = Date.now();
          recorder.builtAt.push(marker);
          return {
            built: {
              tx: { to: "0xc", from: "0xo", data: "0xd", value: "0" },
              marker,
            } as unknown as InvestCtx["built"],
          };
        },
      },
      {
        key: "confirm:invest",
        run: async (ctx) => {
          recorder.ran.push("confirm:invest");
          recorder.sentBuild = (ctx.built as unknown as { marker?: number })?.marker ?? null;
          return { txHash: `0x${"1c".repeat(32)}` };
        },
      },
    ];
  };
}

function newRecorder(): Recorder {
  return { asked: [], ran: [], builtAt: [], sentBuild: null };
}

/** Open the dialog with a wallet that CANNOT cover the amount on the strategy's chain. */
function renderShortWallet(recorder: Recorder, onInvested?: () => void) {
  renderWithProviders(
    <InvestModal
      open
      onOpenChange={vi.fn()}
      strategy={strategy}
      // $40 spendable on Arbitrum against a $100 invest: the exact case that used to deep-link the
      // user to /deposit to buy more fiat while they held funds on another chain.
      balance={40}
      buildInvestSteps={investStepsFor(recorder)}
      {...(onInvested ? { onInvested } : {})}
    />,
  );
  fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value: "100" } });
}

/**
 * Walk from the amount step into the gate. POO-1503: the mock Confirm screen is deleted, so the
 * seeded start runs provisioning on its own once the plan resolves.
 */
function startProvisioning() {
  fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));
}

/**
 * Press the state button, which is what resumes the operation once the run has settled.
 *
 * @rule POO-1504 R27 — the run no longer hands the operation back on its own. The bottom button IS the
 * run's state: `Processing` while the rail works, `Done` and enabled once every leg has settled, and
 * pressing it is the handoff. The completion EVENT is unmoved and still fires on settlement (premise
 * 11); only the resume waits.
 */
async function pressDone() {
  const done = await screen.findByTestId("provisioning-exec-state", undefined, { timeout: 3000 });
  await waitFor(() => expect(done).toBeEnabled(), { timeout: 3000 });
  fireEvent.click(done);
}

async function provision() {
  startProvisioning();
  await pressDone();
}

beforeEach(() => {
  railHolder.openJournal.mockClear();
  railHolder.closeJournal.mockClear();
  railHolder.gate = null;
  railHolder.failWith = null;
  vi.spyOn(Date, "now").mockReturnValue(T0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InvestModal — the flagship route (POO-1043)", () => {
  it("[R1] a short wallet reaches provisioning instead of a deep link to buy fiat", async () => {
    // Hold the legs so the provisioning surface can be observed rather than raced: the mock Confirm
    // screen is deleted (POO-1503) and the seeded start would otherwise finish in a microtask.
    railHolder.hold();
    renderShortWallet(newRecorder());
    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));

    expect(await screen.findByText("Working on it")).toBeInTheDocument();
    // The route ends on the operation itself: provisioning is a prefix, never a replacement.
    expect(screen.getByText("Invest in Stable Yield")).toBeInTheDocument();
    railHolder.release();
  });

  it("[R1] resumes the invest with the amount and slippage the user entered", async () => {
    const recorder = newRecorder();
    renderShortWallet(recorder);
    await provision();

    await waitFor(() => expect(recorder.ran).toContain("build"));
    // 2% is the investor default from the settings gear; 100 is what was typed. Neither is re-derived
    // from what provisioning delivered, which is the failure this rule exists to prevent.
    expect(recorder.asked.at(-1)).toEqual([100, 2]);
  });

  it("[R1] the Review the user approves is for the original amount", async () => {
    renderShortWallet(newRecorder());
    await provision();

    expect(await screen.findByRole("button", { name: "Confirm investment" })).toBeInTheDocument();
    expect(screen.getByText("100 USDC")).toBeInTheDocument();
  });

  it("[R2] provisioning does not send the invest: the wallet send waits for the user", async () => {
    const recorder = newRecorder();
    renderShortWallet(recorder);
    await provision();

    await screen.findByRole("button", { name: "Confirm investment" });
    // Everything up to the build has run; the money-moving step has not.
    expect(recorder.ran).toEqual(["approve:USDC", "permit", "build"]);
  });

  it("[R2] the send runs only when the user approves the Review", async () => {
    const recorder = newRecorder();
    renderShortWallet(recorder);
    await provision();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm investment" }));

    await waitFor(() => expect(recorder.ran).toContain("confirm:invest"));
  });

  it("[R4] a provisioning wait past the freshness window still signs a build taken after it", async () => {
    const recorder = newRecorder();
    railHolder.hold();
    renderShortWallet(recorder);
    // Not `provision()`: with the rail HELD the run has not settled, so [R27]'s state button still
    // reads `Processing` and there is nothing to press yet. The press comes after the release below,
    // which is the ordering this rule is about.
    startProvisioning();

    // The transfer took five minutes, which is past MAX_BUILT_TX_AGE_MS and past the server's own
    // 5-minute Permit2 sigDeadline. Nothing was built before this point.
    const late = T0 + MAX_BUILT_TX_AGE_MS + 60_000;
    expect(recorder.builtAt).toEqual([]);
    vi.spyOn(Date, "now").mockReturnValue(late);
    railHolder.release();
    await pressDone();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm investment" }));
    await waitFor(() => expect(recorder.ran).toContain("confirm:invest"));

    // Exactly one build, taken AFTER the wait, and that is the build the send signed. A build that
    // predated the wait would be past its deadline and would revert on-chain.
    expect(recorder.builtAt).toEqual([late]);
    expect(recorder.sentBuild).toBe(late);
  });

  it("[R5] refreshes balances and positions the moment the invest confirms", async () => {
    const onInvested = vi.fn();
    renderShortWallet(newRecorder(), onInvested);
    await provision();

    fireEvent.click(await screen.findByRole("button", { name: "Confirm investment" }));

    await waitFor(() => expect(onInvested).toHaveBeenCalled());
  });

  it("[R6] leaving the gate mid-provisioning keeps the amount the user entered", async () => {
    // POO-1503: the pre-run Cancel left with the mock Confirm screen, so the mock-reachable exit is
    // the failure screen's Back. The rule is unchanged: leaving the gate lands back on the amount
    // step with the entered figure intact and the invest untouched.
    railHolder.failWith = new Error("the wallet rejected the request");
    renderShortWallet(newRecorder());
    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));

    expect(screen.getByLabelText("Amount to invest")).toHaveValue("100");
    expect(screen.getByRole("button", { name: "Deposit & invest" })).toBeInTheDocument();
  });
});
