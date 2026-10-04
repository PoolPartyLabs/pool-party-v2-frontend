import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft, tokenKey } from "../mandateDraft";
import type { FundLaunchDraft } from "./contracts";
import { createJournal, saveJournal } from "./journal";
import { persistJourney } from "./journey";
import { deriveLaunchSteps } from "./plan";
import { useV2Launch } from "./useV2Launch";

const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  catalog: vi.fn(),
  manager: `0x${"34".repeat(20)}`,
}));
vi.mock("./useV2LaunchBinding", () => ({ useV2LaunchBinding: mocks.binding }));
vi.mock("./useV2LaunchWallet", () => ({
  useV2LaunchWallet: () => ({ manager: mocks.manager, wallet: {} }),
}));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogTokensAction: mocks.catalog,
  getCatalogReservesAction: mocks.catalog,
}));
vi.mock("../v2Mandate", () => ({
  buildRealCatalog: vi.fn(),
  toV2MandateSelection: () => ({
    chains: [{ chainId: 42161, tokens: [`0x${"34".repeat(20)}`], uniswapV4PoolIds: [] }],
    aaveV3Reserves: [],
    spokeCapPercent: null,
  }),
}));
const manager = `0x${"34".repeat(20)}`;
const permitted = {
  network: "arbitrum" as const,
  address: manager,
  symbol: "WETH",
  name: "Wrapped Ether",
  logoUrl: null,
  locked: false,
};
const draft: FundLaunchDraft = {
  ...createEmptyDraft("2026-10-04", "hook"),
  tokens: [permitted],
  caps: {
    networks: {},
    protocols: {},
    tokens: { [tokenKey(permitted)]: { noCap: true, pct: 100 } },
  },
  review: {
    name: "Income fund demo",
    description: "",
    imageUrl: "",
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 200,
    minimum: "100",
    seed: "100",
  },
  plan: {
    version: 1,
    hub: {
      chains: [
        {
          id: "leaf",
          sharePct: 100,
          steps: [
            {
              id: "aave",
              family: "position",
              kind: "aaveSupply",
              config: { assetKey: `arbitrum:${manager}` },
            },
          ],
        },
      ],
    },
    spokes: [],
  },
};
describe("public launch hook seam [R3, R4, R6]", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.manager = manager;
    mocks.catalog.mockResolvedValue({ ok: true, data: { tokens: [], reserves: [] } });
    mocks.binding.mockReturnValue({
      steps: [{ id: "create", kind: "create", chain: 42161 }],
      checkpoints: {
        create: { status: "submitted", txHash: `0x${"ab".repeat(32)}`, receiptStatus: "unknown" },
      },
      sign: vi.fn(),
      retry: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
      status: "running",
    });
  });
  it("reads frozen journal on reload and exposes broadcast explorer links without catalog I/O", async () => {
    const frozen = { plan: draft.plan, review: draft.review, request: { manager } };
    saveJournal(
      localStorage,
      createJournal(draft.id, manager, frozen, deriveLaunchSteps(draft.plan, {}, true, false)),
    );
    const journey = persistJourney(draft, manager);
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.current?.explorerUrl).toBe(`https://arbiscan.io/tx/0x${"ab".repeat(32)}`);
    expect(result.current.current?.receiptStatus).toBe("unknown");
    expect(mocks.binding).toHaveBeenLastCalledWith(expect.objectContaining({ frozen }));
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it("refuses a different wallet and reports a missing journey as failed", async () => {
    saveJournal(
      localStorage,
      createJournal(draft.id, manager, {}, deriveLaunchSteps(draft.plan, {}, true, false)),
    );
    const journey = persistJourney(draft, manager);
    mocks.manager = `0x${"56".repeat(20)}`;
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.journey).not.toBeNull());
    expect(result.current.ready).toBe(false);
    expect(mocks.binding).toHaveBeenLastCalledWith(
      expect.objectContaining({ manager: null, wallet: null }),
    );
    const missing = renderHook(() => useV2Launch("missing"));
    await waitFor(() => expect(missing.result.current.outcome).toBe("failed"));
  });
  it("prepares a legacy journey without a checkpoint and exposes explicit actions", async () => {
    const journey = persistJourney(draft, manager);
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(mocks.binding).toHaveBeenLastCalledWith(
      expect.objectContaining({
        frozen: expect.objectContaining({
          request: expect.objectContaining({ seedAmount: "100000000" }),
        }),
      }),
    );
    await result.current.sign();
    expect(mocks.binding.mock.results.at(-1)?.value.sign).toHaveBeenCalled();
    result.current.cancel();
    expect(mocks.binding.mock.results.at(-1)?.value.pause).toHaveBeenCalled();
  });
  it("reports failed catalog hydration without requesting signatures", async () => {
    mocks.catalog.mockResolvedValue({ ok: false });
    const journey = persistJourney(draft, manager);
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.outcome).toBe("failed"));
    await result.current.sign();
    expect(mocks.binding.mock.results.at(-1)?.value.sign).not.toHaveBeenCalled();
  });
  it("rejects a legacy unfrozen journey that bypasses Limits", async () => {
    const journey = persistJourney({ ...draft, tokens: [] }, manager);
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.outcome).toBe("failed"));
    await result.current.sign();
    expect(mocks.binding.mock.results.at(-1)?.value.sign).not.toHaveBeenCalled();
  });
});
