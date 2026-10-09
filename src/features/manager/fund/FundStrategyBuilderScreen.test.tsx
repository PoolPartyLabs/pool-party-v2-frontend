/**
 * @id PP-MGR-SCR-002
 * @name FundStrategyBuilderScreen tests
 * @implements-rules-version v3 (POO-2122 rules v1, POO-2142 rules v2, POO-2167 rules v3,
 *   POO-2157 rules v1, POO-2197 rules v2)
 * @analytics-events none, the names are ASSERTED here rather than emitted; a test is never an
 *   emitter, so a screen cannot count as instrumented by being tested
 *
 * The shell's own behaviour, with the five step bodies as the placeholders they still are:
 * navigation (R6, R9), the skipped Pools step (R29), deep links, Save & exit (R7), completion on
 * settlement rather than on a click (R6), and the funnel, including the two events that only exist
 * because something did NOT happen (blocked and abandoned). The position protocol in these fixtures
 * is Uniswap v4, the one the buildathon scope offers (R20 v3, POO-2167). Since POO-2157 the Build
 * phase is the canvas; this file keeps the shell's half of it (the phase in the URL, the view, the
 * way back, the phase each save records) and `build/BuildScreen.test.tsx` proves the canvas.
 */
import { cleanup } from "@testing-library/react";
import { type ComponentProps, useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSolanaPreviewForTests,
  captureSolanaPreviewExit,
  registerSolanaPreviewHost,
  requestSolanaPreview,
} from "@/lib/experiments/solanaPreviewStore";
import {
  act,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog, type MandateCatalog } from "./mandateCatalog";
import {
  addPool,
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  type MandatePoolRef,
  REQUIRED_PROTOCOLS,
  removeTokenSymbol,
  tokenKey,
  withProtocols,
} from "./mandateDraft";
import { getDraft, MANDATE_DRAFTS_KEY, upsertDraft } from "./mandateDraftStore";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/manager/new",
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params }));

const auth = vi.hoisted(() => ({ address: undefined as string | undefined, isLoading: false }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => auth }));
const catalogOverride = vi.hoisted(() => ({ current: null as MandateCatalog | null }));
vi.mock("./useV2MandateCatalog", async (importOriginal) => {
  const real = await importOriginal<typeof import("./useV2MandateCatalog")>();
  return {
    useV2MandateCatalog: () => {
      const catalog = real.useV2MandateCatalog();
      return catalogOverride.current ?? catalog;
    },
  };
});
const launchStatus = vi.hoisted(() => ({ read: vi.fn((..._args: unknown[]) => null as unknown) }));
vi.mock("./launch/journey", () => ({
  getLaunchStatusForDraft: (...args: unknown[]) => launchStatus.read(...args),
}));
// This shell suite does not execute the real Privy Review, whose focus listeners own browser unload.
vi.mock("./review/ReviewPhase", () => ({ ReviewPhase: () => <p>Real Review launch</p> }));
const analytics = vi.hoisted(() => ({ track: vi.fn(), trackFailure: vi.fn() }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => analytics }));

const localRecovery = vi.hoisted(() => ({
  seed: null as MandateDraft | null,
  failReview: false,
  failBuild: false,
  rerenderBuild: null as (() => void) | null,
}));
vi.mock("./solana-preview/solanaBuilderRuntime", async (importOriginal) => {
  const real = await importOriginal<typeof import("./solana-preview/solanaBuilderRuntime")>();
  return {
    ...real,
    createSolanaBuilderDraft: (now: string, id: string) =>
      localRecovery.seed ?? real.createSolanaBuilderDraft(now, id),
  };
});
vi.mock("./review/ReviewIdentityCard", async (importOriginal) => {
  const real = await importOriginal<typeof import("./review/ReviewIdentityCard")>();
  return {
    ...real,
    ReviewIdentityCard: (props: import("./review/ReviewIdentityCard").ReviewIdentityCardProps) => {
      if (localRecovery.failReview) throw new Error("sensitive local render text");
      return <real.ReviewIdentityCard {...props} />;
    },
  };
});
vi.mock("./build/blocks/BuildPalette", async (importOriginal) => {
  const real = await importOriginal<typeof import("./build/blocks/BuildPalette")>();
  return {
    ...real,
    BuildPalette: (props: ComponentProps<typeof real.BuildPalette>) => {
      const [, rerender] = useReducer((value: number) => value + 1, 0);
      localRecovery.rerenderBuild = rerender;
      if (localRecovery.failBuild) throw new Error("sensitive pending render text");
      return <real.BuildPalette {...props} />;
    },
  };
});

vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, isEnabled: () => false }),
}));

const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast };
});
vi.mock("@/components/ui/Toast", () => ({ toast: toasts.toast }));

/**
 * The Pools step's data adapter. Mocked because the shell renders the real step and the mock
 * adapter's own latency band and 2% failure draw would make every pools case here depend on a
 * coin toss; `mandatePoolSource.test.ts` owns the adapter's behaviour.
 */
const poolSource = vi.hoisted(() => ({
  searchMandatePools: vi.fn(),
  findMandatePoolByAddress: vi.fn(),
}));
vi.mock("./mandatePoolSource", () => poolSource);

import { FundStrategyBuilderScreen } from "./FundStrategyBuilderScreen";

describe("shared local Solana binding", () => {
  // @rule POO-2301 R9: explicit Header exit acknowledges the real owner before it is disposed.
  it("acknowledges confirmed header exit without reporting local abandonment", async () => {
    const dispose = registerSolanaPreviewHost("account-a");
    for (const now of [0, 200, 400]) requestSolanaPreview((proceed) => proceed(), now);
    localRecovery.seed = localReviewDraft();
    const view = renderWithProviders(<FundStrategyBuilderScreen runtime="solana-local" />);
    try {
      await userEvent.type(screen.getByLabelText("Strategy name"), " header exit");
      const beforeAccepted = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(beforeAccepted);
      expect(beforeAccepted.defaultPrevented).toBe(true);
      const exit = captureSolanaPreviewExit();
      act(() => expect(exit()).toBe(true));
      const afterAccepted = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(afterAccepted);
      expect(afterAccepted.defaultPrevented).toBe(false);
      view.unmount();
      expect(emitted("solana_preview_abandoned")).toHaveLength(0);
    } finally {
      view.unmount();
      dispose();
      __resetSolanaPreviewForTests();
    }
  });

  // @rule POO-2301 R9: a cancelled outer navigation cannot disarm future edits or fallback protection.
  it("keeps local changes guarded after an unaccepted exit and a later render failure", async () => {
    localRecovery.seed = localReviewDraft();
    const exit = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = renderWithProviders(
      <FundStrategyBuilderScreen runtime="solana-local" onExitPreview={exit} />,
    );
    try {
      await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
      await waitFor(() => expect(exit).toHaveBeenCalledOnce());
      await userEvent.type(screen.getByLabelText("Strategy name"), " after cancelled exit");
      localRecovery.failReview = true;
      view.rerender(<FundStrategyBuilderScreen runtime="solana-local" onExitPreview={exit} />);
      expect(screen.getByRole("alert")).toHaveTextContent("The preview could not be displayed.");
      const beforeUnload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(beforeUnload);
      expect(beforeUnload.defaultPrevented).toBe(true);
      view.unmount();
      expect(emitted("solana_preview_abandoned")).toEqual([{ has_local_changes: true }]);
    } finally {
      consoleError.mockRestore();
    }
  });

  // @rule POO-2301 R8/R9: pending per-instance edits reach the session owner before disposal.
  it("keeps pending Manage changes visible to abandonment and the render fallback guard", async () => {
    const base = localReviewDraft();
    localRecovery.seed = {
      ...base,
      lastPhase: "build",
      networks: ["arbitrum", "solana"],
      protocols: [...REQUIRED_PROTOCOLS, "kamino"],
      tokens: [
        ...base.tokens,
        {
          address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          network: "solana",
          symbol: "USDC",
          name: "USD Coin",
          logoUrl: null,
          locked: true,
        },
      ],
      caps: {
        ...base.caps,
        networks: { ...base.caps.networks, solana: { noCap: true, pct: 0 } },
        protocols: { kamino: { noCap: true, pct: 0 } },
      },
      plan: {
        version: 1,
        hub: { chains: [] },
        spokes: [
          {
            network: "solana",
            sharePct: 30,
            chains: [
              {
                id: "local-chain",
                sharePct: 30,
                steps: [
                  {
                    id: "local-kamino",
                    family: "position",
                    kind: "solanaKaminoSupply",
                    config: { catalogId: "solana:mainnet-beta:kamino-supply", pair: "USDC / SOL" },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = renderWithProviders(<FundStrategyBuilderScreen runtime="solana-local" />);
    try {
      await userEvent.click(screen.getByRole("button", { name: /^Kamino Lend.*30%/ }));
      await userEvent.click(screen.getByRole("button", { name: "Manage block" }));
      const allocation = screen.getByRole("textbox", { name: "Allocation (%)" });
      await userEvent.clear(allocation);
      await userEvent.type(allocation, "40");
      localRecovery.failBuild = true;
      act(() => localRecovery.rerenderBuild?.());
      expect(screen.getByRole("alert")).toHaveTextContent("The preview could not be displayed.");
      expect(emitted("solana_preview_error")).toEqual([
        {
          error_code: "SOLANA_PREVIEW_RENDER_FAILED",
          error_origin: "app",
          has_local_changes: true,
        },
      ]);
      const beforeUnload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(beforeUnload);
      expect(beforeUnload.defaultPrevented).toBe(true);
      view.unmount();
      expect(emitted("solana_preview_abandoned")).toEqual([{ has_local_changes: true }]);
    } finally {
      consoleError.mockRestore();
    }
  });
  // @rule POO-2301 R8/R9: local exits report actual draft changes, including Review.
  it.each([
    false,
    true,
  ])("reports truthful local Review abandonment when edited=%s", async (edited) => {
    localRecovery.seed = localReviewDraft();
    const view = renderWithProviders(<FundStrategyBuilderScreen runtime="solana-local" />);
    expect(screen.getByLabelText("Strategy name")).toHaveValue("Retained local strategy");
    if (edited) await userEvent.type(screen.getByLabelText("Strategy name"), " edited");
    view.unmount();
    expect(emitted("solana_preview_abandoned")).toEqual([{ has_local_changes: edited }]);
    expect(emitted("builder_mandate_abandoned")).toHaveLength(0);
    expect(emitted("builder_launch_completed")).toHaveLength(0);
  });

  // @rule POO-2301 R9: a clean local session does not claim that draft edits were lost.
  it("reports an untouched local Mandate exit with no local changes", () => {
    const view = renderWithProviders(<FundStrategyBuilderScreen runtime="solana-local" />);
    view.unmount();
    expect(emitted("solana_preview_abandoned")).toEqual([{ has_local_changes: false }]);
  });

  // @rule POO-2301 R8/R9: genuine render retry preserves the applied shared local draft owner.
  it("recovers the local Review draft after a genuine render error without abandonment or leaked text", async () => {
    localRecovery.seed = localReviewDraft();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = renderWithProviders(<FundStrategyBuilderScreen runtime="solana-local" />);
    try {
      await userEvent.type(screen.getByLabelText("Strategy name"), " edited");
      localRecovery.failReview = true;
      view.rerender(<FundStrategyBuilderScreen runtime="solana-local" />);
      expect(screen.getByRole("alert")).toHaveTextContent("The preview could not be displayed.");
      expect(emitted("solana_preview_error")).toEqual([
        {
          error_code: "SOLANA_PREVIEW_RENDER_FAILED",
          error_origin: "app",
          has_local_changes: true,
        },
      ]);
      expect(emitted("solana_preview_abandoned")).toHaveLength(0);
      expect(JSON.stringify(analytics.track.mock.calls)).not.toContain(
        "sensitive local render text",
      );
      localRecovery.failReview = false;
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.getByLabelText("Strategy name")).toHaveValue("Retained local strategy edited");
      expect(emitted("solana_preview_error")).toHaveLength(1);
      expect(emitted("solana_preview_abandoned")).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  // @rule R1/R2/R3/R5/R8: same wizard controls, local descriptor intent and no EVM read/store.
  it("uses the traditional wizard while ignoring EVM deep links, catalog and launch journal", async () => {
    nav.params = new URLSearchParams("draft=evm-deep-link&step=limits&phase=review");
    const catalogRead = vi.fn(() => buildMandateCatalog());
    catalogOverride.current = { ...buildMandateCatalog(), loading: true, retry: catalogRead };
    const write = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    renderWithProviders(<FundStrategyBuilderScreen runtime="solana-local" />);
    expect(
      await screen.findByRole("heading", { name: "Create new strategy", level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save & exit" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Changes are discarded when you leave. Live market data and execution are not available.",
    );
    await user.click(screen.getByRole("checkbox", { name: "Solana" }));
    await user.click(screen.getByRole("button", { name: "Next: Protocols" }));
    expect(screen.getByText("Kamino Lend")).toBeVisible();
    expect(screen.getByText("Jupiter Swap")).toBeVisible();
    expect(screen.getByText("Raydium CLMM")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Orca Whirlpools" }));
    await user.click(screen.getByRole("button", { name: "Next: Tokens" }));
    expect(screen.getByText("WSOL")).toBeVisible();
    expect(screen.getByText("Not available")).toBeVisible();
    const wsol = screen.getByText("WSOL").closest("[data-mandate-row]");
    if (!(wsol instanceof HTMLElement)) throw new Error("WSOL descriptor not rendered");
    await user.click(within(wsol).getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Next: Pools" }));
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Next: Limits" }));
    for (const checkbox of screen.getAllByRole("checkbox", { name: /^No cap for/ }))
      await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Next: Build strategy" }));
    await screen.findByRole("heading", { name: "Name your draft" });
    await user.type(screen.getByRole("textbox", { name: "Draft name" }), "Local Solana strategy");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByTestId("build-palette");
    expect(screen.getByText("Orca Whirlpools")).toBeVisible();
    expect(catalogRead).not.toHaveBeenCalled();
    expect(poolSource.searchMandatePools).not.toHaveBeenCalled();
    expect(launchStatus.read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(
      analytics.track.mock.calls.every((call) => String(call[0]).startsWith("solana_preview_")),
    ).toBe(true);
    const buildHost = document.querySelector("[data-build-screen]");
    await user.click(screen.getByRole("button", { name: "Back: Mandate" }));
    expect(document.querySelector("[data-build-screen]")).toBe(buildHost);
    expect(buildHost).toHaveAttribute("hidden");
    await user.click(screen.getByRole("button", { name: "Next: Build strategy" }));
    expect(document.querySelector("[data-build-screen]")).toBe(buildHost);
    expect(buildHost).not.toHaveAttribute("hidden");
    write.mockRestore();
  });

  // @rule R8/R9: local naming uses the same dialog, while leaving explicitly discards session work.
  it("keeps the local persistence notice and avoids a saved-draft claim on exit", async () => {
    const exit = vi.fn((onAccepted: () => void) => onAccepted());
    const write = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    const view = renderWithProviders(
      <FundStrategyBuilderScreen runtime="solana-local" onExitPreview={exit} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Changes are discarded when you leave.");
    await user.click(screen.getByRole("button", { name: "Save & exit" }));
    await user.type(screen.getByRole("textbox", { name: "Draft name" }), "Local drawing");
    await user.click(screen.getByRole("button", { name: "Save and exit" }));
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
    expect(toasts.toast).toHaveBeenCalledWith("Changes applied to this preview.");
    expect(toasts.toast).not.toHaveBeenCalledWith("Draft saved");
    expect(write).not.toHaveBeenCalled();
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(false);
    view.unmount();
    expect(emitted("solana_preview_abandoned")).toHaveLength(0);
    write.mockRestore();
  });
});

/** Every event of one name the screen pushed, newest last. */
function emitted(event: string): Record<string, unknown>[] {
  return analytics.track.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

function localReviewDraft(): MandateDraft {
  const base = createEmptyDraft("2026-10-09T00:00:00.000Z", "retained-local");
  const token = {
    address: "So11111111111111111111111111111111111111112",
    network: "solana" as const,
    symbol: "WSOL",
    name: "Wrapped SOL",
    logoUrl: null,
    locked: false,
    priced: false,
    visualEligible: true,
  };
  return {
    ...base,
    runtime: "solana-local",
    tokens: [...base.tokens, token],
    caps: { ...base.caps, tokens: { [tokenKey(token)]: { noCap: true, pct: 0 } } },
    name: "Retained local strategy",
    completedAt: "2026-10-09T00:00:00.000Z",
    passedSteps: ["networks", "protocols", "tokens", "limits"],
    lastStep: "limits",
    lastPhase: "review",
  };
}

/**
 * A draft already in storage, resumable by id.
 *
 * `savedAt` is set by hand because that is what `useMandateDraft.save()` stamps: a draft that
 * reached storage any other way would be a fixture the product cannot produce.
 */
function seed(id: string, over: Partial<MandateDraft> = {}): MandateDraft {
  const draft: MandateDraft = {
    ...createEmptyDraft("2026-10-01T00:00:00.000Z", id),
    savedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
  // A fixture that claims a completed mandate must satisfy the current two-token allowance rule.
  if (
    (draft.completedAt ||
      [
        "d-last",
        "d-last-fail",
        "d-unnamed",
        "d-keep",
        "d-phase",
        "d-round",
        "d-complete-phase",
      ].includes(id)) &&
    !["stale-limit", "wallet-arrival"].includes(id) &&
    !draft.tokens.some((token) => !token.locked)
  ) {
    const token = buildMandateCatalog()
      .tokensFor(["arbitrum"], [...REQUIRED_PROTOCOLS])
      .find((entry) => entry.symbol === "ARB");
    if (!token) throw new Error("missing ARB fixture");
    draft.tokens = [...draft.tokens, { ...token, locked: false }];
    draft.caps = {
      ...draft.caps,
      tokens: { ...draft.caps.tokens, [tokenKey(token)]: { noCap: true, pct: 0 } },
    };
  }
  const stored = upsertDraft(draft);
  if (!stored) throw new Error("fixture: seed write failed");
  return stored;
}

/** A hub Uniswap v4 pool the Pools step's adapter could have returned, with USDC on one side. */
function arbPool(over: Partial<MandatePoolRef> = {}): MandatePoolRef {
  return {
    id: "arb-weth-usdc-30",
    address: "0xc6962004f452be9203591991d15f6b388e09e8d0",
    network: "arbitrum",
    protocol: "uniswap-v4",
    token0: {
      address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      symbol: "WETH",
      name: "Wrapped Ether",
      logoUrl: null,
    },
    token1: {
      address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      symbol: "USDC",
      name: "USD Coin",
      logoUrl: null,
    },
    feeBps: 30,
    feeTier: 3000,
    tvlUsd: 145_000_000,
    aprPct: 11.1,
    tierSharePct: null,
    hasHook: false,
    ...over,
  };
}

/**
 * A five-step mandate holding one pool and every cap its rows need: Next on Limits completes it.
 *
 * Built through the reducers rather than written out, so the pool really does carry its second
 * token and the cap rows really are the ones `capRows` derives.
 */
function wholeMandate(id: string): MandateDraft {
  const catalog = buildMandateCatalog();
  const base = withProtocols(createEmptyDraft("2026-10-01T00:00:00.000Z", id), [
    ...REQUIRED_PROTOCOLS,
    "uniswap-v4",
  ]);
  const added = addPool(base, arbPool(), catalog);
  if (isBlocked(added)) throw new Error(`fixture: the pool was refused, ${added.blocked.reason}`);
  const weth = added.tokens.find((token) => !token.locked);
  if (!weth) throw new Error("fixture: the pool brought no token in");
  return seed(id, {
    ...added,
    name: "ETH and BTC on Arbitrum",
    savedAt: "2026-10-01T00:00:00.000Z",
    passedSteps: ["networks", "protocols", "tokens", "pools"],
    lastStep: "limits",
    // The two rows `capRows` derives here: the chosen position protocol and the unlocked token.
    caps: {
      networks: {},
      protocols: { "uniswap-v4": { noCap: true, pct: 0 } },
      tokens: { [tokenKey(weth)]: { noCap: true, pct: 0 } },
    },
  });
}

/**
 * The same mandate after step 3 took its pool away.
 *
 * Removing the token the pool held drops the pool with it, which is existing reducer behaviour, and
 * `passedSteps` keeps Pools in it. So the draft is parked on Limits, every step reads as passed, and
 * the mandate holds a position protocol and no pools at all.
 */
function lostItsPools(id: string): MandateDraft {
  const whole = wholeMandate(id);
  const held = whole.tokens.find((token) => !token.locked);
  if (!held) throw new Error("fixture: the pool brought no token in");
  // By symbol, which is what the remove X on step 3's right card does. The symbol is the catalog's
  // own ("ETH" for wrapped ether, per `canonicalTokenSymbol`), never the pool's raw side label.
  const stripped = removeTokenSymbol(whole, held.symbol);
  if (stripped.pools.length !== 0) throw new Error("fixture: the pool survived its token");
  const stored = upsertDraft({ ...stripped, savedAt: "2026-10-01T00:00:00.000Z" });
  if (!stored) throw new Error("fixture: seed write failed");
  return stored;
}

/** A draft that chose a position protocol, so its mandate has all five steps (R29). */
function withPools(id: string, over: Partial<MandateDraft> = {}): MandateDraft {
  const base = withProtocols(createEmptyDraft("2026-10-01T00:00:00.000Z", id), [
    ...REQUIRED_PROTOCOLS,
    "uniswap-v4",
  ]);
  return seed(id, { ...base, savedAt: "2026-10-01T00:00:00.000Z", ...over });
}

beforeEach(() => {
  localRecovery.seed = null;
  localRecovery.failReview = false;
  localRecovery.failBuild = false;
  localRecovery.rerenderBuild = null;
  auth.address = undefined;
  auth.isLoading = false;
  catalogOverride.current = null;
  launchStatus.read.mockReturnValue(null);
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
  analytics.track.mockClear();
  toasts.toast.mockClear();
  toasts.toast.error.mockClear();
  poolSource.searchMandatePools.mockReset();
  poolSource.searchMandatePools.mockResolvedValue([]);
  poolSource.findMandatePoolByAddress.mockReset();
  poolSource.findMandatePoolByAddress.mockResolvedValue({ pool: null, foundOn: null });
  window.localStorage.clear();
  vi.stubGlobal("scrollTo", vi.fn());
  // jsdom lacks the browser APIs used by the real React Flow dependency.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22 = 1;
    },
  );
});

afterEach(async () => {
  cleanup();
  // Drain the engine's scheduled handle measurement before restoring browser API shims.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FundStrategyBuilderScreen", () => {
  // @rule R1
  it("[R1] the header carries Save & exit and no way back to the console", async () => {
    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(
      await screen.findByRole("heading", { name: "Create new strategy", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save & exit" })).toBeInTheDocument();
    expect(screen.queryByText("Back to console")).not.toBeInTheDocument();
  });

  // @rule R6
  it("[R6] Next walks the steps and records what the draft held when it did", async () => {
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 1 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Next: Protocols" }));

    expect(await screen.findByText("MANDATE · STEP 2 OF 4")).toBeInTheDocument();
    expect(emitted("builder_mandate_step_submitted")).toEqual([
      {
        step: "networks",
        networks_count: 1,
        protocols_count: 2,
        tokens_count: 1,
        pools_count: 0,
      },
    ]);
  });

  // @rule R29
  it("[R29] a mandate with no position protocol never offers Pools", async () => {
    nav.params = new URLSearchParams("draft=d-nopools&step=tokens");
    seed("d-nopools", { passedSteps: ["networks", "protocols"], lastStep: "tokens" });
    renderWithProviders(<FundStrategyBuilderScreen />);

    await screen.findByText("MANDATE · STEP 3 OF 4");
    await userEvent.click(screen.getByRole("button", { name: "Next: Limits" }));

    expect(await screen.findByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
  });

  // @rule R9
  it("[R9] Back returns to the previous step and is not a funnel event", async () => {
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 1 OF 4");
    await userEvent.click(screen.getByRole("button", { name: "Next: Protocols" }));
    await screen.findByText("MANDATE · STEP 2 OF 4");
    analytics.track.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Back: Networks" }));

    expect(await screen.findByText("MANDATE · STEP 1 OF 4")).toBeInTheDocument();
    expect(emitted("builder_mandate_step_submitted")).toHaveLength(0);
    // Revisiting a step IS a visit, which is what makes the per-step denominators add up.
    expect(emitted("builder_mandate_step_viewed")).toEqual([{ step: "networks" }]);
  });

  // @rule R6
  it("[R6] a refused Next does not advance, and the refusal is counted", async () => {
    nav.params = new URLSearchParams("draft=d-pools&step=pools");
    withPools("d-pools", {
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "pools",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 5");

    await userEvent.click(screen.getByRole("button", { name: "Next: Limits" }));

    expect(screen.getByText("MANDATE · STEP 4 OF 5")).toBeInTheDocument();
    expect(emitted("builder_mandate_blocked")).toEqual([
      { step: "pools", block_reason: "nothing_selected" },
    ]);
  });

  /**
   * [B3] A refusal is answered by a SELECTION, and the pool universe count is not one.
   *
   * `update` clears the Next refusal on any write that settles, which is right: a cap set, a pool
   * added, and the notice has served its purpose. But the Pools step publishes its universe count
   * through that same door, from a passive effect, the moment a read it started on open comes back.
   * So a Next refused while the pools were still loading lost its notice a few hundred milliseconds
   * later, with the manager having answered nothing. The count is bookkeeping, so it is written
   * around the wrapper.
   */
  // @rule R6
  // @rule R13
  it("[R6] a Next refused while the pools load keeps its notice when the count arrives", async () => {
    nav.params = new URLSearchParams("draft=d-count&step=pools");
    withPools("d-count", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "pools",
    });
    let release: (pools: MandatePoolRef[]) => void = () => undefined;
    poolSource.searchMandatePools.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 5");

    await userEvent.click(screen.getByRole("button", { name: "Next: Limits" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one to continue.");

    release([arbPool()]);

    // The read landed, the step published its denominator, and the refusal is still unanswered.
    expect(await screen.findByText("1 pool with at least one of your tokens")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one to continue.");

    // A real selection is what clears it.
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  /**
   * A refusal the SHELL raised is answered by the next selection that works.
   *
   * `shellBlock` used to be cleared only by navigation, and it took precedence over the hook's own
   * block, so the notice outlived the problem: a manager stopped on Limits by a missing cap set the
   * cap and still read "Set a cap or tick No cap to continue." until they pressed Next or Back. A
   * notice that stays after the thing it describes is fixed teaches managers to ignore notices.
   */
  // @rule R6
  it("[R6] a refusal clears as soon as a selection answers it, without navigating", async () => {
    nav.params = new URLSearchParams("draft=d-clear&step=limits");
    seed("d-clear", {
      name: "ETH and BTC on Arbitrum",
      networks: ["arbitrum", "robinhood"],
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Set a cap or tick No cap to continue.");

    await userEvent.click(screen.getByRole("checkbox", { name: "No cap for Robinhood Chain" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Still on the step: clearing the notice is not advancing.
    expect(screen.getByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
    expect(emitted("builder_mandate_blocked")).toEqual([
      { step: "limits", block_reason: "cap_missing" },
    ]);
  });

  /**
   * "Keep editing" means the mandate did not close.
   *
   * The stamp used to go on before the dialog opened, so a manager who backed out of naming the
   * draft was left holding a mandate marked finished: no `builder_mandate_completed` ever fired for
   * it, yet the next Save & exit wrote `completedAt` to storage and a `?phase=build` link then opened
   * a Build landing for a mandate nobody completed. The completion is a WRITE, so it is stamped by
   * the write that settles it and by nothing else.
   */
  // @rule R6
  it("[R6] Keep editing leaves the mandate open, and a later save does not call it finished", async () => {
    nav.params = new URLSearchParams("draft=d-keep&step=limits");
    seed("d-keep", { passedSteps: ["networks", "protocols", "tokens"], lastStep: "limits" });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));
    await screen.findByRole("heading", { name: "Name your draft" });
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    // The save that follows is an ordinary Save & exit, and it must write an OPEN mandate.
    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await userEvent.type(screen.getByLabelText("Draft name"), "ETH and BTC on Arbitrum");
    await userEvent.click(screen.getByRole("button", { name: "Save and exit" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));
    expect(getDraft("d-keep")?.completedAt).toBeNull();
    expect(emitted("builder_mandate_completed")).toHaveLength(0);
  });

  // @rule R9
  it("[R9] a deep link into a reached step resumes there", async () => {
    nav.params = new URLSearchParams("draft=d-resume&step=tokens");
    seed("d-resume", { passedSteps: ["networks", "protocols"], lastStep: "protocols" });

    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByText("MANDATE · STEP 3 OF 4")).toBeInTheDocument();
    expect(emitted("builder_mandate_started")).toHaveLength(0);
  });

  /**
   * R20 v3 (POO-2167): a draft parked on Pools whose only position protocol was Uniswap v3 loses the
   * Pools step when it is loaded, while `lastStep` still says "pools". The shell must never draw that
   * step, not even for the one render before the resume moves `lastStep`: the view event and the URL
   * are the two traces such a frame leaves.
   */
  // @rule R9 @rule R20 v3
  it("[R9] never draws a Pools step the stored draft lost on load, and resumes past it", async () => {
    nav.params = new URLSearchParams("draft=d-v3-parked&step=pools");
    seed("d-v3-parked", {
      protocols: [...REQUIRED_PROTOCOLS, "uniswap-v3"],
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "pools",
    });

    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
    expect(emitted("builder_mandate_step_viewed")).toEqual([{ step: "limits" }]);
    expect(nav.replace).not.toHaveBeenCalledWith(
      expect.stringContaining("step=pools"),
      expect.anything(),
    );
    expect(screen.queryByText(/STEP 0 OF/)).not.toBeInTheDocument();
  });

  // @rule R9
  it("[R9] a deep link into a step nobody reached lands on the first unpassed one", async () => {
    nav.params = new URLSearchParams("draft=d-ahead&step=limits");
    seed("d-ahead", { passedSteps: ["networks"], lastStep: "protocols" });

    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByText("MANDATE · STEP 2 OF 4")).toBeInTheDocument();
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(
        "/manager/new?draft=d-ahead&step=protocols",
        expect.objectContaining({ scroll: false }),
      ),
    );
  });

  // @rule R9
  it("[R9] an unknown draft id starts a fresh mandate and cleans the URL", async () => {
    nav.params = new URLSearchParams("draft=gone&step=tokens");

    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByText("MANDATE · STEP 1 OF 4")).toBeInTheDocument();
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith("/manager/new", expect.anything()),
    );
    expect(emitted("builder_mandate_started")).toHaveLength(1);
  });

  // @rule R7
  it("[R7] Save & exit on an unnamed draft asks for a name, then saves, toasts and leaves", async () => {
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 1 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await userEvent.type(screen.getByLabelText("Draft name"), "ETH and BTC on Arbitrum");
    await userEvent.click(screen.getByRole("button", { name: "Save and exit" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));
    expect(toasts.toast).toHaveBeenCalledWith("Draft saved");
    expect(emitted("builder_draft_saved")).toEqual([{ step: "networks", first_save: true }]);
  });

  // @rule R7
  it("[R7] Save & exit on a named draft saves silently", async () => {
    nav.params = new URLSearchParams("draft=d-named&step=networks");
    seed("d-named", { name: "ETH and BTC on Arbitrum" });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 1 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));
    expect(screen.queryByRole("heading", { name: "Name your draft" })).not.toBeInTheDocument();
    expect(emitted("builder_draft_saved")).toEqual([{ step: "networks", first_save: false }]);
  });

  // @rule R7
  it("[R7] a storage failure keeps the manager on the step and reports the error", async () => {
    nav.params = new URLSearchParams("draft=d-fail&step=networks");
    seed("d-fail", { name: "ETH and BTC on Arbitrum" });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 1 OF 4");
    // jsdom's localStorage is a Proxy, so a spy on setItem does nothing: replace it outright.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
    });

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));

    await waitFor(() =>
      expect(emitted("builder_mandate_error")).toEqual([
        { step: "networks", error_code: "DRAFT_SAVE_FAILED", error_origin: "app" },
      ]),
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(toasts.toast.error).toHaveBeenCalledWith(
      "Couldn't save the draft. Your choices are still here; try again.",
    );
  });

  // @rule R6
  it("[R6] completion waits for the draft to reach storage, then opens Build", async () => {
    nav.params = new URLSearchParams("draft=d-last&step=limits");
    seed("d-last", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));

    expect(await screen.findByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
    expect(emitted("builder_mandate_completed")).toEqual([
      {
        step: "limits",
        networks_count: 1,
        protocols_count: 2,
        tokens_count: 2,
        pools_count: 0,
      },
    ]);
  });

  // @rule R6
  it("[R6] a completion whose save failed emits no completion at all", async () => {
    nav.params = new URLSearchParams("draft=d-last-fail&step=limits");
    seed("d-last-fail", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
    });

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));

    await waitFor(() => expect(emitted("builder_mandate_error")).toHaveLength(1));
    expect(emitted("builder_mandate_completed")).toHaveLength(0);
    expect(screen.getByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
  });

  // @rule R6
  it("[R6] the last step with no name asks for one before it will complete", async () => {
    nav.params = new URLSearchParams("draft=d-unnamed&step=limits");
    seed("d-unnamed", {
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));

    expect(await screen.findByRole("heading", { name: "Name your draft" })).toBeInTheDocument();
    // Not completed yet: nothing has been written down.
    expect(emitted("builder_mandate_completed")).toHaveLength(0);

    await userEvent.type(screen.getByLabelText("Draft name"), "ETH and BTC on Arbitrum");
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(await screen.findByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
    expect(emitted("builder_mandate_completed")).toHaveLength(1);
    expect(nav.push).not.toHaveBeenCalled();
  });

  // @rule R7
  it("[R7] abandonment is what a session that neither completed nor saved reports", async () => {
    const view = renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 1 OF 4");
    await userEvent.click(screen.getByRole("button", { name: "Next: Protocols" }));
    await screen.findByText("MANDATE · STEP 2 OF 4");

    view.unmount();

    expect(emitted("builder_mandate_abandoned")).toEqual([
      { step: "protocols", draft_saved: false },
    ]);
  });

  /**
   * POO-2157 (review F3 of PR #41): `draft_saved` says whether everything on screen had reached
   * storage. A draft saved once and edited since, then left, lost the edits: it says false. One
   * left untouched since its save lost nothing: true.
   */
  // @rule R7
  it("[R7] a saved draft left with an unsaved edit reports the work as lost", async () => {
    nav.params = new URLSearchParams("draft=d-left-dirty&step=limits");
    seed("d-left-dirty", {
      name: "ETH and BTC on Arbitrum",
      networks: ["arbitrum", "robinhood"],
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });
    const view = renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");
    await userEvent.click(screen.getByRole("checkbox", { name: "No cap for Robinhood Chain" }));

    view.unmount();

    expect(emitted("builder_mandate_abandoned")).toEqual([{ step: "limits", draft_saved: false }]);
  });

  // @rule R7
  it("[R7] a saved draft left untouched since its save reports it parked", async () => {
    nav.params = new URLSearchParams("draft=d-left-clean&step=limits");
    seed("d-left-clean", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });
    const view = renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");

    view.unmount();

    expect(emitted("builder_mandate_abandoned")).toEqual([{ step: "limits", draft_saved: true }]);
  });

  // @rule R7
  it("[R7] a session that saved and left reports no abandonment", async () => {
    nav.params = new URLSearchParams("draft=d-left&step=networks");
    seed("d-left", { name: "ETH and BTC on Arbitrum" });
    const view = renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 1 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    view.unmount();

    expect(emitted("builder_mandate_abandoned")).toHaveLength(0);
  });

  // @rule R9
  it("[R9] once a draft is saved the URL carries it, so a reload restores it", async () => {
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 1 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    await userEvent.type(screen.getByLabelText("Draft name"), "ETH and BTC on Arbitrum");
    await userEvent.click(screen.getByRole("button", { name: "Save and exit" }));

    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(
        expect.stringMatching(/^\/manager\/new\?draft=.+&step=networks$/),
        expect.objectContaining({ scroll: false }),
      ),
    );
  });

  // @rule R3
  it("[R3] the sub-step header navigates back to a step already passed", async () => {
    nav.params = new URLSearchParams("draft=d-nav&step=tokens");
    seed("d-nav", { passedSteps: ["networks", "protocols"], lastStep: "tokens" });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 3 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Show the mandate steps" }));
    await userEvent.click(screen.getByRole("button", { name: "Networks" }));

    expect(await screen.findByText("MANDATE · STEP 1 OF 4")).toBeInTheDocument();
  });

  /**
   * [B10] The completing Next answers for the whole mandate, not for the step in front of it.
   *
   * A step is validated when it is passed, and `passedSteps` is append-only, so a step can stop
   * being satisfied after it was passed and nothing asks again: removing a token on step 3 drops the
   * pools that held it, and dropping a position protocol drops its pools too. Pools stayed in
   * `passedSteps`, so the sub-step header still jumped to Limits and "Next: Build strategy" closed a
   * mandate that names a position protocol and holds no pools, which the handoff's own per-screen
   * contract and R6's "step 4 with zero pools" both refuse.
   *
   * The refusal names the step that actually failed, and the manager is taken there: a notice on
   * Limits about Pools would be a dead end on a screen with nothing to fix.
   */
  // @rule R6
  it("[R6] the completing Next refuses a mandate whose pools were lost on another step", async () => {
    nav.params = new URLSearchParams("draft=d-lost&step=limits");
    lostItsPools("d-lost");
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 5 OF 5");

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));

    expect(await screen.findByText("MANDATE · STEP 4 OF 5")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one to continue.");
    expect(emitted("builder_mandate_blocked")).toEqual([
      { step: "pools", block_reason: "nothing_selected" },
    ]);
    // Nothing was submitted, nothing was completed, and nothing was written down as finished.
    expect(emitted("builder_mandate_step_submitted")).toHaveLength(0);
    expect(emitted("builder_mandate_completed")).toHaveLength(0);
    expect(getDraft("d-lost")?.completedAt).toBeNull();
  });

  // @rule R6
  it("[R6] the completing Next still closes a mandate that holds up all the way through", async () => {
    nav.params = new URLSearchParams("draft=d-whole&step=limits");
    wholeMandate("d-whole");
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 5 OF 5");

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));

    expect(await screen.findByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
    expect(emitted("builder_mandate_blocked")).toHaveLength(0);
    expect(emitted("builder_mandate_completed")).toHaveLength(1);
    expect(getDraft("d-whole")?.completedAt).not.toBeNull();
  });
});

/**
 * POO-2127 [B3]: the second phase.
 *
 * The Mandate ends and the Build phase begins without a route change, so the phase has to live in
 * the URL alongside the step for a reload to land back where the manager was. The one asymmetry
 * worth pinning is that `phase=build` is NOT trusted on its own: Build exists only for a mandate
 * that closed, and a hand-edited or stale link into it must land on the mandate rather than on a
 * Build canvas planning over a draft that was never finished.
 *
 * POO-2157 replaced the landing with the canvas (`build/BuildScreen.tsx`); the canvas's own rules
 * are proven in `build/BuildScreen.test.tsx`. What stays here is the shell's half of the phase.
 */
describe("FundStrategyBuilderScreen, the Build phase", () => {
  // @rule B3
  it("writes the phase into the URL once the mandate completes", async () => {
    nav.params = new URLSearchParams("draft=d-phase&step=limits");
    seed("d-phase", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));

    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(
        "/manager/new?draft=d-phase&step=limits&phase=build",
        expect.objectContaining({ scroll: false }),
      ),
    );
  });

  // @rule B3
  // @rule AE1 (POO-2157)
  it("records the Build canvas as its own view", async () => {
    nav.params = new URLSearchParams("draft=d-view&step=limits&phase=build");
    seed("d-view", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
    });

    renderWithProviders(<FundStrategyBuilderScreen />);

    await waitFor(() =>
      expect(emitted("builder_build_viewed")).toEqual([{ blocks_count: 0, spokes_count: 0 }]),
    );
    // The Mandate's per-step denominator must not count Build as a step visit.
    expect(emitted("builder_mandate_step_viewed")).toHaveLength(0);
  });

  // @rule B3
  it("resumes a completed draft on the Build canvas when the link says so", async () => {
    nav.params = new URLSearchParams("draft=d-done&step=limits&phase=build");
    seed("d-done", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
    });

    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
    expect(screen.queryByText(/MANDATE · STEP/)).not.toBeInTheDocument();
  });

  // @rule B3
  it("ignores phase=build on a draft whose mandate never closed", async () => {
    nav.params = new URLSearchParams("draft=d-open&step=limits&phase=build");
    seed("d-open", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });

    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Build your strategy" })).not.toBeInTheDocument();
    expect(emitted("builder_build_viewed")).toHaveLength(0);
  });

  // @rule B2
  it("Back: Mandate returns to the last mandate step and counts the revisit", async () => {
    nav.params = new URLSearchParams("draft=d-back&step=limits&phase=build");
    seed("d-back", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByRole("button", { name: "Back: Mandate" });

    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));

    expect(await screen.findByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
    // Coming back from Build IS a visit to Limits: the step the manager is looking at has to appear
    // in the denominator, or the refusal rate of the step they return to reads better than it is.
    expect(emitted("builder_mandate_step_viewed")).toEqual([{ step: "limits" }]);
  });

  // @rule B3
  it("drops the phase from the URL on the way back to the mandate", async () => {
    nav.params = new URLSearchParams("draft=d-url&step=limits&phase=build");
    seed("d-url", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByRole("button", { name: "Back: Mandate" });
    nav.replace.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));

    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(
        "/manager/new?draft=d-url&step=limits",
        expect.objectContaining({ scroll: false }),
      ),
    );
  });

  // @rule B3
  it("the phase stepper's Mandate pill goes back the same way", async () => {
    nav.params = new URLSearchParams("draft=d-pill&step=limits&phase=build");
    seed("d-pill", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByRole("button", { name: "Back: Mandate" });

    await userEvent.click(screen.getByRole("button", { name: "Mandate" }));

    expect(await screen.findByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
  });

  // @rule B2
  it("counts Limits again when a manager completes and then comes back to it", async () => {
    nav.params = new URLSearchParams("draft=d-round&step=limits");
    seed("d-round", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));
    await screen.findByRole("button", { name: "Back: Mandate" });
    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));

    expect(await screen.findByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
    expect(emitted("builder_mandate_step_viewed")).toEqual([
      { step: "limits" },
      { step: "limits" },
    ]);
  });

  // @rule B4 / R2
  it("[R2] keeps the stepper's Review unreachable from the Build canvas", async () => {
    nav.params = new URLSearchParams("draft=d-review&step=limits&phase=build");
    seed("d-review", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
    });

    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByRole("button", { name: "Back: Mandate" });

    // The V1 stepper only makes an EARLIER phase clickable, so Review is text, not a control. The
    // canvas's own "Next: Review" is the bar's button (POO-2157), and it refuses in this batch.
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next: Review" })).toBeInTheDocument();
  });

  // @rule B2
  it("Save & exit still works from the Build canvas", async () => {
    nav.params = new URLSearchParams("draft=d-exit&step=limits&phase=build");
    seed("d-exit", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByRole("button", { name: "Back: Mandate" });

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));
  });

  /**
   * POO-2157 (D24): the mandate summary (and with it R13's Broad notice, which it carries) left the
   * Build phase with the landing. `MandateSummaryCard` stays, with its own tests, for Review.
   */
  // @rule B1 / D24
  it("[D24] Build no longer prints the mandate summary: it waits for Review", async () => {
    nav.params = new URLSearchParams("draft=d-sum&step=limits&phase=build");
    seed("d-sum", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
    });

    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your mandate" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("mandate-summary-networks")).not.toBeInTheDocument();
  });

  /**
   * A mandate edited after it closed is open again.
   *
   * `completedAt` was stamped once and never taken back, so a manager who returned from Build and
   * moved a cap kept a draft that still claimed to be finished: Build summarised a mandate that was
   * no longer the one in the draft, and `?phase=build` kept opening it. Any reducer that changes what
   * was CHOSEN invalidates the completion, and the next Next through Limits closes it again.
   */
  // @rule B2 / R6
  it("[R6] a selection changed after the mandate closed takes the completion back", async () => {
    nav.params = new URLSearchParams("draft=d-reopen&step=limits&phase=build");
    seed("d-reopen", {
      name: "ETH and BTC on Arbitrum",
      networks: ["arbitrum", "robinhood"],
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
      caps: {
        networks: { arbitrum: { noCap: true, pct: 0 }, robinhood: { noCap: false, pct: 40 } },
        protocols: {},
        tokens: {},
      },
    });
    const view = renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByRole("button", { name: "Back: Mandate" });
    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));
    await screen.findByText("MANDATE · STEP 4 OF 4");

    // A cap moved: what the manager completed is not what the draft now holds.
    await userEvent.click(screen.getByRole("checkbox", { name: "No cap for Robinhood Chain" }));
    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));

    await waitFor(() => expect(getDraft("d-reopen")?.completedAt).toBeNull());

    // And the Build canvas is no longer a place that link can reach.
    view.unmount();
    nav.params = new URLSearchParams("draft=d-reopen&step=limits&phase=build");
    renderWithProviders(<FundStrategyBuilderScreen />);

    expect(await screen.findByText("MANDATE · STEP 4 OF 4")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Build your strategy" })).not.toBeInTheDocument();
  });

  // @rule B2 / R9
  it("[R9] moving between steps and phases is not an edit, so the completion survives it", async () => {
    nav.params = new URLSearchParams("draft=d-nav-only&step=limits&phase=build");
    seed("d-nav-only", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "limits",
      completedAt: "2026-10-02T00:00:00.000Z",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByRole("button", { name: "Back: Mandate" });

    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));
    await screen.findByText("MANDATE · STEP 4 OF 4");
    await userEvent.click(screen.getByRole("button", { name: "Back: Tokens" }));
    await screen.findByText("MANDATE · STEP 3 OF 4");

    // [B6] Through a WRITE, because navigation writes nothing. Reading storage straight after the
    // two clicks read back what `seed` had put there, so the assertion held whatever the shell did
    // to the working draft in memory: it would have passed on a shell that cleared the stamp on
    // every Back. Save & exit is the first thing that persists what navigation left behind.
    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));
    expect(getDraft("d-nav-only")?.completedAt).toBe("2026-10-02T00:00:00.000Z");
    // And the step it was parked on is the one the manager walked back to, so the save really did
    // carry the navigation rather than an untouched copy.
    expect(getDraft("d-nav-only")?.lastStep).toBe("tokens");
    // D16 (POO-2157): saved from the Mandate phase after a Back, so it resumes on the Mandate.
    expect(getDraft("d-nav-only")?.lastPhase).toBe("mandate");
  });

  // @rule D16 (POO-2157)
  it("[D16] the completing save records Build, so a manager who leaves right after resumes there", async () => {
    nav.params = new URLSearchParams("draft=d-complete-phase&step=limits");
    seed("d-complete-phase", {
      name: "ETH and BTC on Arbitrum",
      passedSteps: ["networks", "protocols", "tokens"],
      lastStep: "limits",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 4 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));

    await screen.findByRole("heading", { name: "Build your strategy" });
    expect(getDraft("d-complete-phase")?.lastPhase).toBe("build");
  });

  // @rule D16 (POO-2157)
  it("[D16] a Save & exit from the Mandate phase records the Mandate", async () => {
    nav.params = new URLSearchParams("draft=d-mandate-phase&step=networks");
    seed("d-mandate-phase", { name: "ETH and BTC on Arbitrum" });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByText("MANDATE · STEP 1 OF 4");

    await userEvent.click(screen.getByRole("button", { name: "Save & exit" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/manager"));
    expect(getDraft("d-mandate-phase")?.lastPhase).toBe("mandate");
  });
});

describe("Limits revised completion guards (POO-2197)", () => {
  // @rule POO-2197 R3
  it("reveals an earlier invalid Pools step when resumed Limits is also invalid", async () => {
    nav.params = new URLSearchParams("draft=two-blocks&phase=build");
    upsertDraft({ ...lostItsPools("two-blocks"), completedAt: "2026-10-02" });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Next: Build strategy" }));
    expect(screen.getByText("MANDATE · STEP 4 OF 5")).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("Add another token in Tokens");
  });

  // @rule POO-2197 R3
  it.each([
    "loading",
    "error",
  ] as const)("preserves a completed draft while its catalog is %s and exposes retry on failure", async (state) => {
    nav.params = new URLSearchParams("draft=catalog-resume&phase=build");
    upsertDraft({ ...wholeMandate("catalog-resume"), completedAt: "2026-10-02" });
    const retry = vi.fn();
    catalogOverride.current = {
      ...buildMandateCatalog(),
      dataMode: "real",
      loading: state === "loading",
      error: state === "error",
      retry,
    };
    const original = localStorage.getItem(MANDATE_DRAFTS_KEY);
    renderWithProviders(<FundStrategyBuilderScreen />);
    if (state === "loading") {
      expect(await screen.findByRole("status", { name: /loading/i })).toBeInTheDocument();
    } else {
      expect(await screen.findByText("The v2 catalog is unavailable.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(retry).toHaveBeenCalledOnce();
    }
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(localStorage.getItem(MANDATE_DRAFTS_KEY)).toBe(original);
    expect(emitted("builder_mandate_blocked")).toHaveLength(0);
  });

  // @rule POO-2197 R3
  it("keeps a resumed draft on Limits after correcting its token until Next is pressed", async () => {
    nav.params = new URLSearchParams("draft=correct-limit&phase=build");
    const draft = wholeMandate("correct-limit");
    const token = draft.tokens.find((entry) => !entry.locked);
    if (!token) throw new Error("missing extra token");
    upsertDraft({
      ...draft,
      completedAt: "2026-10-02",
      caps: { ...draft.caps, tokens: { [tokenKey(token)]: { noCap: false, pct: 0 } } },
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByRole("button", { name: "Next: Build strategy" });
    await userEvent.click(screen.getByRole("checkbox", { name: /No cap.*Arbitrum/i }));
    expect(screen.getByRole("button", { name: "Next: Build strategy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Build your strategy" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /No cap.*Arbitrum/i })).toBeChecked();
  });

  // @rule POO-2197 R3
  it("refuses a zero second-token allowance with guidance and blocked intent", async () => {
    nav.params = new URLSearchParams("draft=zero-limit&step=limits");
    const draft = wholeMandate("zero-limit");
    const token = draft.tokens.find((entry) => !entry.locked);
    if (!token) throw new Error("missing extra token");
    upsertDraft({
      ...draft,
      caps: { ...draft.caps, tokens: { [tokenKey(token)]: { noCap: false, pct: 0 } } },
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    await screen.findByRole("button", { name: "Next: Build strategy" });
    await userEvent.click(screen.getByRole("button", { name: "Next: Build strategy" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Allow at least one token besides USDC above 0% or select No cap.",
    );
    expect(emitted("builder_mandate_blocked")).toContainEqual({
      step: "limits",
      block_reason: "token_allowance_required",
    });
    expect(emitted("builder_mandate_completed")).toHaveLength(0);
  });
  // @rule POO-2197 R3
  it("resumes newly invalid completed Limits before Build and corrects the URL", async () => {
    nav.params = new URLSearchParams("draft=stale-limit&phase=build");
    seed("stale-limit", {
      completedAt: "2026-10-02",
      passedSteps: ["networks", "protocols", "tokens", "limits"],
      lastStep: "tokens",
    });
    renderWithProviders(<FundStrategyBuilderScreen />);
    expect(await screen.findByRole("button", { name: "Next: Build strategy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Build your strategy" })).not.toBeInTheDocument();
    expect(emitted("builder_mandate_blocked")).toContainEqual({
      step: "limits",
      block_reason: "token_allowance_required",
    });
    expect(getDraft("stale-limit")?.completedAt).toBe("2026-10-02");
    expect(screen.getByRole("alert")).toHaveTextContent("Add another token in Tokens");
    await userEvent.click(screen.getByRole("button", { name: "Back: Tokens" }));
    expect(await screen.findByText("MANDATE · STEP 3 OF 4")).toBeInTheDocument();
  });
});

// @rule POO-2197 R3
it("preserves launch recovery while the wallet loads and restores the existing journey", async () => {
  auth.isLoading = true;
  nav.params = new URLSearchParams("draft=wallet-arrival&phase=build");
  seed("wallet-arrival", {
    completedAt: "2026-10-02",
    passedSteps: ["networks", "protocols", "tokens", "limits"],
    lastStep: "limits",
    lastPhase: "build",
  });
  const original = localStorage.getItem(MANDATE_DRAFTS_KEY);
  const { rerender } = renderWithProviders(<FundStrategyBuilderScreen />);
  await waitFor(() => expect(launchStatus.read).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Next: Build strategy" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(nav.replace).not.toHaveBeenCalled();
  expect(getDraft("wallet-arrival")?.completedAt).toBe("2026-10-02");
  expect(getDraft("wallet-arrival")?.lastPhase).toBe("build");
  expect(emitted("builder_mandate_blocked")).toHaveLength(0);
  auth.address = `0x${"11".repeat(20)}`;
  auth.isLoading = false;
  launchStatus.read.mockReturnValue({ journeyId: "existing", status: "paused" });
  rerender(<FundStrategyBuilderScreen />);
  expect(await screen.findByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
  expect(getDraft("wallet-arrival")?.completedAt).toBe("2026-10-02");
  expect(getDraft("wallet-arrival")?.lastPhase).toBe("build");
  expect(localStorage.getItem(MANDATE_DRAFTS_KEY)).toBe(original);
});
