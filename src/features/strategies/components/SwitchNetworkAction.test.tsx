/**
 * @id PP-STR-CMP-026 (POO-1385)
 * @name SwitchNetworkAction — tests
 * @implements-rules-version v2 (POO-1385 rules v2)
 *
 * Rules under test (POO-1385 rules v1):
 *   [R6] a "Switch to <Network>" action on the two chain failure kinds, which re-runs the ladder and
 *        retries the failed step on success, and which NEVER renders without a resolvable network
 *   [R8] the blocked intent is reported once, and only when the wallet genuinely cannot reach the chain
 *
 * The negative cases carry the weight here. This component sits inside the error block for EVERY
 * failed transaction in the app, so "renders nothing" is its most common behaviour and the one that
 * would be most expensive to get wrong.
 */
import { arbitrum, base } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TxError } from "@/lib/tx/diagnostics";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({
  ensureChain: vi.fn(async () => ({ request: async () => "0x0" })),
  track: vi.fn(),
  wallets: [{ address: "0xWALLET", switchChain: vi.fn(), getEthereumProvider: vi.fn() }],
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0xWALLET" }) }));
vi.mock("@/lib/tx/useEnsureWalletChain", () => ({
  useEnsureWalletChain: () => mocks.ensureChain,
}));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: mocks.track }) }));

import { isChainFailure, SwitchNetworkAction } from "./SwitchNetworkAction";

const wrongChain = (targetChainId?: number): TxError => ({
  code: "WRONG_CHAIN",
  message: "wallet is on the wrong network",
  kind: "wrongChain",
  ...(targetChainId ? { targetChainId } : {}),
});

const unavailable = (targetChainId?: number): TxError => ({
  code: "CHAIN_UNAVAILABLE",
  message: "wallet cannot reach the chain",
  kind: "chainUnavailable",
  ...(targetChainId ? { targetChainId } : {}),
});

beforeEach(() => {
  mocks.ensureChain.mockReset().mockResolvedValue({ request: async () => "0x0" });
  mocks.track.mockReset();
});

describe("SwitchNetworkAction (POO-1385 [R6])", () => {
  it("offers the switch, named after the target network, on a wrong-chain failure", () => {
    renderWithProviders(
      <SwitchNetworkAction error={wrongChain(arbitrum.id)} onSwitched={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Switch to Arbitrum" })).toBeInTheDocument();
  });

  /**
   * The wallet not HAVING the chain still gets the button. The body copy above it says to enable the
   * network in the wallet app first, and a user who has just done that needs a way to act on it that
   * is not "re-run the whole operation to get back here".
   */
  it("offers the switch on a chain-unavailable failure too", () => {
    renderWithProviders(<SwitchNetworkAction error={unavailable(base.id)} onSwitched={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Switch to Base" })).toBeInTheDocument();
  });

  // [R6] Inherits POO-1026 [R4]: no resolvable network, no button. Never "Switch to undefined".
  it.each([
    ["no target chain at all", wrongChain()],
    ["a chain this app does not support", wrongChain(999999)],
  ])("renders nothing for %s", (_label, error) => {
    const { container } = renderWithProviders(
      <SwitchNetworkAction error={error} onSwitched={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * The common case across the whole app: every OTHER failed transaction renders this component and
   * must get nothing from it. A slippage error offering "Switch to Arbitrum" would be worse than the
   * missing button this issue is about.
   */
  it.each([
    ["a slippage failure", { code: "x", message: "slippage", kind: "slippage" } as TxError],
    ["an unclassified failure", { code: "x", message: "boom" } as TxError],
    ["no error at all", undefined],
  ])("renders nothing for %s", (_label, error) => {
    const { container } = renderWithProviders(
      <SwitchNetworkAction error={error} onSwitched={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // [R6] The point of the button: the ladder runs, and the failed step is retried only after it wins.
  it("runs the ladder for the target chain and retries once it lands", async () => {
    const onSwitched = vi.fn();
    renderWithProviders(
      <SwitchNetworkAction error={wrongChain(arbitrum.id)} onSwitched={onSwitched} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Switch to Arbitrum" }));
    });
    expect(mocks.ensureChain).toHaveBeenCalledWith(mocks.wallets[0], arbitrum.id);
    expect(onSwitched).toHaveBeenCalledTimes(1);
  });

  /**
   * A failed switch must NOT retry. Retrying would re-run the build, produce the same chain failure,
   * and read to the user as the button having done something.
   */
  it("does not retry when the switch fails, and says so", async () => {
    mocks.ensureChain.mockRejectedValueOnce(new Error("wallet cannot reach chain"));
    const onSwitched = vi.fn();
    renderWithProviders(
      <SwitchNetworkAction error={unavailable(arbitrum.id)} onSwitched={onSwitched} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Switch to Arbitrum" }));
    });
    expect(onSwitched).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/didn't switch to Arbitrum/i);
  });
});

describe("SwitchNetworkAction blocked intent (POO-1385 [R8])", () => {
  it("reports the blocked intent once when the wallet cannot reach the chain", () => {
    const { rerender } = renderWithProviders(
      <SwitchNetworkAction error={unavailable(base.id)} onSwitched={vi.fn()} />,
    );
    rerender(<SwitchNetworkAction error={unavailable(base.id)} onSwitched={vi.fn()} />);
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith("wallet_action_blocked", {
      block_reason: "chain_unavailable",
    });
  });

  /**
   * A wallet on the wrong chain is NOT a blocked intent: nothing stopped that user, they are one
   * prompt from proceeding. Counting it would make the blocked-intent rate meaningless, since the
   * wrong-chain case is by far the more common of the two.
   */
  it("does not report a blocked intent for a wallet that is merely on the wrong chain", () => {
    renderWithProviders(<SwitchNetworkAction error={wrongChain(base.id)} onSwitched={vi.fn()} />);
    expect(mocks.track).not.toHaveBeenCalled();
  });
});

/**
 * The MOUNT gate, tested directly (POO-1385 [R6]).
 *
 * `isChainFailure` decides whether a wallet-reading component is mounted inside the shared error
 * block, which renders for every failed transaction in the app including on surfaces with no wallet
 * provider in the tree. The component tests above render it directly and so never exercise this
 * seam, and `TransactionErrorActions.test.tsx` runs in mock mode where the component returns null.
 * A regression here is either a missing button or a crashed error dialog on an unrelated failure.
 */
describe("isChainFailure, the mount gate (POO-1385 [R6])", () => {
  it.each([["wrongChain"], ["chainUnavailable"]] as const)("mounts for %s", (kind) => {
    expect(isChainFailure({ code: "x", message: "m", kind })).toBe(true);
  });

  it.each([
    ["slippage"],
    ["deadlineExpired"],
    ["insufficientFunds"],
    ["userRejected"],
    ["unauthorized"],
    ["alreadyBroadcast"],
    ["upstreamUnavailable"],
    ["gasBlocked"],
    ["unknown"],
  ] as const)("does not mount for %s", (kind) => {
    expect(isChainFailure({ code: "x", message: "m", kind })).toBe(false);
  });

  it.each([
    ["an unclassified error", { code: "x", message: "m" } as TxError],
    ["no error at all", undefined],
    ["null", null],
  ])("does not mount for %s", (_label, error) => {
    expect(isChainFailure(error)).toBe(false);
  });
});
