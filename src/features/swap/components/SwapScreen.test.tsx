/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name SwapScreen — tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The standalone swap/bridge surface. Two rules carry the weight here:
 *
 *   [R2] one unified flow. The user says WHERE and HOW MUCH; nothing on screen picks "swap" or
 *        "bridge", and no branch in this component decides one either. The route is the planner's
 *        answer, which is why the assertions below are about what is handed DOWN, not about which
 *        of two paths was taken.
 *   [R3] no parallel execution path. Everything after "Continue" is the shipped
 *        {@link ProvisioningPanel} — the same plan card, cost breakdown and rail every operation
 *        modal runs. It is mocked here so this suite tests the handoff rather than re-testing the
 *        panel's own covered behaviour.
 */
import { describe, expect, it, vi } from "vitest";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";

const ARBITRUM = 42161;
const BASE = 8453;
const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  panelProps: [] as Record<string, unknown>[],
}));

// The screen's real path. Mock mode has no session and no key, so it never reads the wallet at all
// (the `useProvisioningGate` precedent); these tests are about the path that does.
vi.mock("@/lib/services", () => ({ isMockMode: false }));

vi.mock("@/lib/provisioning/planActions", () => ({
  getProvisioningContextAction: mocks.getContext,
}));

// [R3] The shipped provisioning body. Stubbed to expose its props and its two exits, so the handoff
// is asserted without dragging the planner, the wallet and the rail into a screen test.
vi.mock("@/features/strategies/components/ProvisioningPanel", () => ({
  ProvisioningPanel: (props: Record<string, unknown>) => {
    mocks.panelProps.push(props);
    return (
      <div data-testid="provisioning-panel">
        <button type="button" onClick={props.onDone as () => void}>
          panel-done
        </button>
        <button type="button" onClick={props.onCancel as () => void}>
          panel-cancel
        </button>
      </div>
    );
  },
}));

import { SwapScreen } from "./SwapScreen";

const liveContext: ProvisioningGateContext = {
  targetChainId: ARBITRUM,
  sources: [
    {
      address: ARBITRUM_USDC,
      chainId: ARBITRUM,
      symbol: "USDC",
      decimals: 6,
      amount: "25000000",
      usd: 25,
      reachableChainIds: [ARBITRUM, BASE],
      isNative: false,
      logoUrl: "",
    },
    {
      address: "0x4200000000000000000000000000000000000006",
      chainId: BASE,
      symbol: "WETH",
      decimals: 18,
      amount: "1000000000000000000",
      usd: 3000,
      reachableChainIds: [ARBITRUM, BASE],
      isNative: false,
      logoUrl: "",
    },
  ],
  gasByChain: {},
  balancesByChain: {
    [BASE]: { nativeUsd: 4, tokenUsd: 3000 },
    [ARBITRUM]: { nativeUsd: 0.9, tokenUsd: 25 },
  },
  gasEstimateUsd: 0.42,
};

function setup() {
  mocks.panelProps.length = 0;
  mocks.getContext.mockReset();
  mocks.getContext.mockResolvedValue({ ok: true, context: liveContext });
  renderWithProviders(<SwapScreen />);
  return userEvent.setup();
}

/**
 * Wait for the wallet read to land. The screen reads balances on mount, so a test that asserts and
 * returns before it resolves updates state outside `act` and, worse, asserts against a screen the
 * user never sees.
 */
async function settleWalletRead() {
  await screen.findByText(/right now/);
}

/** Type an amount and open the plan, waiting for the wallet read the CTA gates on. */
async function continueWith(user: ReturnType<typeof userEvent.setup>, amount: string) {
  await user.type(screen.getByRole("textbox"), amount);
  const cta = screen.getByRole("button", { name: "Continue" });
  await waitFor(() => expect(cta).toBeEnabled());
  await user.click(cta);
}

/** The last props the stubbed panel was rendered with. */
function lastPanelProps() {
  return mocks.panelProps[mocks.panelProps.length - 1] as {
    input: { targetChainId: number; opRequiredUsdc: number };
    context: ProvisioningGateContext | null;
    opLabel: string;
  };
}

describe("SwapScreen (POO-1046)", () => {
  it("[R2] offers every supported network as a destination, and no swap-or-bridge choice", async () => {
    setup();
    await settleWalletRead();

    expect(screen.getByRole("button", { name: "Arbitrum" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Base" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Polygon" })).toBeInTheDocument();
    // Nothing asks the user to classify their own transfer.
    expect(screen.queryByRole("tab", { name: /bridge/i })).not.toBeInTheDocument();
  });

  it("holds the CTA closed until the amount is a real figure", async () => {
    const user = setup();
    const cta = screen.getByRole("button", { name: "Continue" });
    expect(cta).toBeDisabled();

    await user.type(screen.getByRole("textbox"), "0");
    expect(cta).toBeDisabled();

    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "120");
    expect(cta).toBeEnabled();
  });

  it("[R2][R3] hands the destination and the amount to the shipped provisioning panel", async () => {
    const user = setup();
    await waitFor(() => expect(mocks.getContext).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Arbitrum" }));
    await continueWith(user, "120");

    expect(screen.getByTestId("provisioning-panel")).toBeInTheDocument();
    const props = lastPanelProps();
    expect(props.input.targetChainId).toBe(ARBITRUM);
    expect(props.input.opRequiredUsdc).toBe(120);
  });

  it("[R2] does not offer the destination's own USDC as something to move there", async () => {
    const user = setup();
    await waitFor(() => expect(mocks.getContext).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Arbitrum" }));
    await continueWith(user, "120");

    const sources = lastPanelProps().context?.sources ?? [];
    expect(sources.map((source) => source.chainId)).toEqual([BASE]);
  });

  it("re-reads the wallet for the destination the user actually picked", async () => {
    const user = setup();

    await user.click(screen.getByRole("button", { name: "Arbitrum" }));
    await waitFor(() => expect(mocks.getContext).toHaveBeenCalledWith(ARBITRUM));

    await user.click(screen.getByRole("button", { name: "Polygon" }));
    await waitFor(() => expect(mocks.getContext).toHaveBeenCalledWith(137));
  });

  it("returns to the form with the amount intact when the user backs out", async () => {
    const user = setup();
    await continueWith(user, "120");
    await user.click(screen.getByRole("button", { name: "panel-cancel" }));

    expect(screen.queryByTestId("provisioning-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("120");
  });

  it("confirms the funds landed once the rail reports success", async () => {
    const user = setup();
    await continueWith(user, "120");
    await user.click(screen.getByRole("button", { name: "panel-done" }));

    expect(await screen.findByText(/Your funds are on/)).toBeInTheDocument();
  });

  it("[R3] never renders the panel before there is an amount to plan for", async () => {
    setup();
    await settleWalletRead();
    expect(screen.queryByTestId("provisioning-panel")).not.toBeInTheDocument();
  });
});
