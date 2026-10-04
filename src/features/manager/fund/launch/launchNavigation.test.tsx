/**
 * @id PP-MGR-CMP-081 (POO-2191)
 * @name launchNavigationTests
 * @implements-rules-version v1
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogReserve, CatalogToken } from "@/lib/api/v2/schemas";
import {
  cleanup,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { createEmptyDraft, depositTokenRefFor, tokenKey, withProtocols } from "../mandateDraft";
import { buildRealCatalog, toV2MandateSelection } from "../v2Mandate";
import type { FundLaunchDraft } from "./contracts";
import type { FrozenLaunch } from "./driver";
import { FundLaunchJourney } from "./FundLaunchJourney";
import { createJournal, journalKey, loadJournal, saveJournal } from "./journal";
import { journeyKey, journeyPath, persistJourney } from "./journey";
import { deriveLaunchSteps } from "./plan";

const mocks = vi.hoisted(() => ({
  manager: null as string | null,
  tokens: vi.fn(),
  reserves: vi.fn(),
  build: vi.fn(),
  send: vi.fn(),
  receipt: vi.fn(),
  reconcile: vi.fn(),
  complete: vi.fn(),
  walletSend: vi.fn(),
  walletSign: vi.fn(),
  walletReceipt: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: (feature: string) => feature === "fundContracts" }),
}));
vi.mock("@/lib/analytics/useAnalytics", () => ({
  useAnalytics: () => ({ track: mocks.track }),
}));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogTokensAction: mocks.tokens,
  getCatalogReservesAction: mocks.reserves,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./useV2LaunchWallet", () => ({
  useV2LaunchWallet: () => ({
    manager: mocks.manager,
    wallet: mocks.manager
      ? { send: mocks.walletSend, sign: mocks.walletSign, receipt: mocks.walletReceipt }
      : null,
  }),
}));
vi.mock("./lock", () => ({
  withLaunchLock: async (_key: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("./driver", () => ({
  createLaunchDriver: () => ({
    build: mocks.build,
    send: mocks.send,
    receipt: mocks.receipt,
    reconcile: mocks.reconcile,
    complete: mocks.complete,
  }),
}));

const checksumManager = "0x52908400098527886E0F7030069857D2E4169EE7";
const lowerManager = checksumManager.toLowerCase();
const otherManager = `0x${"34".repeat(20)}`;
const hash = `0x${"ab".repeat(32)}`;
const core = `0x${"12".repeat(20)}`;
const usdc = depositTokenRefFor("arbitrum");
if (!usdc) throw new Error("missing base token fixture");
const token: CatalogToken = {
  protocolVersion: "v2",
  chainId: "42161",
  address: usdc.address,
  symbol: usdc.symbol,
  name: usdc.name,
  decimals: 6,
  logoUrl: null,
  hubPriced: true,
  priceUsd: "1",
  priceUpdatedAt: null,
  priceSource: usdc.address,
  priceProvenance: "fixed-1:1",
  priceUnavailableReason: null,
};
const permitted = {
  network: "arbitrum" as const,
  address: core,
  symbol: "WETH",
  name: "Wrapped Ether",
  logoUrl: null,
  locked: false,
};
const additionalToken: CatalogToken = { ...token, address: core, symbol: "WETH" };
const reserve: CatalogReserve = {
  protocolVersion: "v2",
  chainId: "42161",
  adapterKind: "aave-v3",
  mode: "supply",
  token,
  poolKey: `0x${usdc.address.slice(2).padStart(64, "0")}`,
  poolAddress: usdc.address,
  dataProviderAddress: usdc.address,
  aTokenAddress: usdc.address,
  supplyApy: "3.22",
  supplyRateRay: "1",
  supplyCap: "0",
  currentSupply: { protocolVersion: "v2", raw: "1", decimal: "0.000001" },
  active: true,
  frozen: false,
  paused: false,
  supplyCapReached: false,
  available: true,
  mandateRequired: true,
};
const draft: FundLaunchDraft = {
  ...withProtocols(
    {
      ...createEmptyDraft("2026-10-04", "navigation-draft"),
      dataMode: "real",
      catalogVersion: "v2-catalog-v1",
    },
    ["aave-v3"],
  ),
  tokens: [usdc, permitted],
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
          id: "hub",
          sharePct: 100,
          steps: [
            {
              id: "aave",
              family: "position",
              kind: "aaveSupply",
              config: { assetKey: `arbitrum:${usdc.address}` },
            },
          ],
        },
      ],
    },
    spokes: [],
  },
};
const steps = deriveLaunchSteps(draft.plan, {}, true, false);
const frozen: FrozenLaunch = {
  plan: draft.plan,
  review: draft.review,
  request: {
    ...toV2MandateSelection(draft, buildRealCatalog([token, additionalToken], [reserve])),
    manager: lowerManager,
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 200,
    minFirstDeposit: "100000000",
    seedAmount: "100000000",
  },
};
const rowLabels = [
  "Approve USDC · Arbitrum",
  "Create and seed fund · Arbitrum",
  "Discover deployed addresses · Arbitrum",
  "Sign fund profile · Arbitrum",
  "Allocate to hub · Arbitrum",
  "Open position · Arbitrum",
];

function savedLaunch(createStatus: "confirmed" | "submitted" | "completed" = "confirmed") {
  const journal = createJournal(draft.id, checksumManager, frozen, steps);
  const confirmed = createStatus === "completed" ? steps : steps.slice(0, 2);
  for (const step of confirmed) {
    journal.checkpoints[step.id] = { stepId: step.id, chain: step.chain, status: "confirmed" };
  }
  journal.checkpoints.create = {
    stepId: "create",
    chain: 42161,
    status: createStatus === "submitted" ? "submitted" : "confirmed",
    txHash: hash,
    receiptStatus: createStatus === "submitted" ? "unknown" : "success",
    data: { provision: { coreVault: core } },
  };
  if (createStatus !== "submitted") journal.addresses.coreVault = core;
  saveJournal(localStorage, journal);
  return persistJourney(draft, checksumManager);
}

function encodedRouteId(journeyId: string) {
  const routeId = journeyPath(journeyId, "en").split("/").at(-1);
  if (!routeId) throw new Error("missing route id");
  expect(routeId).toContain("%3A");
  expect(localStorage.getItem(journeyKey(routeId))).toBeNull();
  expect(localStorage.getItem(journeyKey(journeyId))).not.toBeNull();
  return routeId;
}

function expectRows() {
  const rows = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(rows).toHaveLength(steps.length);
  expect(rows.map((row) => within(row).getByRole("heading").textContent)).toEqual(rowLabels);
  return rows;
}

function expectNoFinancialIO() {
  expect(mocks.build).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.walletSend).not.toHaveBeenCalled();
  expect(mocks.walletSign).not.toHaveBeenCalled();
}

function storedEntries() {
  return Object.entries(localStorage).sort(([first], [second]) => first.localeCompare(second));
}

describe("real launch navigation component regressions (POO-2191)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    mocks.manager = checksumManager;
    mocks.tokens.mockImplementation(async () => ({
      ok: true,
      data: { tokens: [token, additionalToken] },
    }));
    mocks.reserves.mockResolvedValue({ ok: true, data: { reserves: [reserve] } });
    mocks.build.mockResolvedValue({ complete: true });
    mocks.send.mockResolvedValue(hash);
    mocks.receipt.mockResolvedValue({ status: "unknown" });
    mocks.reconcile.mockResolvedValue(false);
    mocks.complete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("R1 connects the checksum wallet to the lowercase persisted journey without signing on mount", async () => {
    const journey = persistJourney(draft, checksumManager);
    expect(journey.manager).toBe(lowerManager);
    expect(journey.journeyId).toBe(`${lowerManager}:${draft.id}`);
    renderWithProviders(<FundLaunchJourney journeyId={journey.journeyId} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign next step" })).toBeEnabled(),
    );
    expectRows();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.tokens).toHaveBeenCalledWith(42161);
    expect(mocks.tokens).toHaveBeenCalledWith(4663);
    expect(mocks.reserves).toHaveBeenCalledTimes(1);
    expectNoFinancialIO();
    expect(localStorage.getItem(journalKey(draft.id, checksumManager))).toBeNull();
  });

  it("R1 renders every real derived row and enables Sign for Next's once-encoded colon id", async () => {
    const journey = persistJourney(draft, checksumManager);
    const before = storedEntries();
    renderWithProviders(<FundLaunchJourney journeyId={encodedRouteId(journey.journeyId)} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign next step" })).toBeEnabled(),
    );
    expectRows();
    expect(screen.getByText(draft.review.name)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(storedEntries()).toEqual(before);
    expectNoFinancialIO();
  });

  it("R2 preserves rows through a late wallet connection and hydrates confirmed steps before Sign", async () => {
    const journey = savedLaunch();
    mocks.manager = null;
    const routeId = encodedRouteId(journey.journeyId);
    const view = renderWithProviders(<FundLaunchJourney journeyId={routeId} />);
    await screen.findByText(draft.review.name);
    const disconnectedRows = expectRows();
    expect(screen.getByRole("button", { name: "Sign next step" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Connect the original manager wallet");
    mocks.manager = checksumManager;
    view.rerender(<FundLaunchJourney journeyId={routeId} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign next step" })).toBeEnabled();
      expect(screen.getByRole("link", { name: hash })).toBeInTheDocument();
    });
    expect(expectRows()).toEqual(disconnectedRows);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.tokens).not.toHaveBeenCalled();
    expect(mocks.reserves).not.toHaveBeenCalled();
    expectNoFinancialIO();
  });

  it("R5 reloads confirmed creation and Resume completes only unfinished work without another create or send", async () => {
    const user = userEvent.setup();
    const journey = savedLaunch();
    const routeId = encodedRouteId(journey.journeyId);
    const first = renderWithProviders(<FundLaunchJourney journeyId={routeId} />);
    await screen.findByRole("link", { name: hash });
    expectNoFinancialIO();
    first.unmount();
    renderWithProviders(<FundLaunchJourney journeyId={routeId} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resume journey" })).toBeEnabled(),
    );
    expect(screen.getByRole("link", { name: core })).toHaveAttribute(
      "href",
      `https://arbiscan.io/address/${core}`,
    );
    await user.click(screen.getByRole("button", { name: "Resume journey" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Launch completed"));
    expect(mocks.build.mock.calls.map(([step]) => step.id)).toEqual(
      steps.slice(2).map((step) => step.id),
    );
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.walletSend).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(loadJournal(localStorage, draft.id, checksumManager)?.checkpoints.create).toMatchObject({
      status: "confirmed",
      txHash: hash,
      receiptStatus: "success",
    });
  });

  it("R5 reloads an unresolved create hash and Resume checks its unknown receipt without rebuilding or sending", async () => {
    const user = userEvent.setup();
    const journey = savedLaunch("submitted");
    const routeId = encodedRouteId(journey.journeyId);
    const first = renderWithProviders(<FundLaunchJourney journeyId={routeId} />);
    await screen.findByRole("link", { name: hash });
    expectNoFinancialIO();
    first.unmount();
    renderWithProviders(<FundLaunchJourney journeyId={routeId} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resume journey" })).toBeEnabled(),
    );
    expect(screen.getByText("Receipt: Not yet confirmed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume journey" }));
    await waitFor(() => {
      expect(mocks.receipt).toHaveBeenCalledWith(42161, hash);
      expect(screen.getByText("Waiting for verification")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Pause journey" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resume journey" })).toBeEnabled(),
    );
    expectNoFinancialIO();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: hash })).toHaveAttribute(
      "href",
      `https://arbiscan.io/tx/${hash}`,
    );
    expect(loadJournal(localStorage, draft.id, checksumManager)?.checkpoints.create).toMatchObject({
      status: "waiting",
      txHash: hash,
      receiptStatus: "unknown",
    });
  });

  it("R5 reloads a completed journal without offering Resume or repeating builders and sends", async () => {
    const journey = savedLaunch("completed");
    const routeId = encodedRouteId(journey.journeyId);
    const before = storedEntries();
    const first = renderWithProviders(<FundLaunchJourney journeyId={routeId} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Launch completed"));
    first.unmount();
    renderWithProviders(<FundLaunchJourney journeyId={routeId} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Launch completed"));
    expectRows();
    expect(screen.queryByRole("button", { name: "Resume journey" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign next step" })).not.toBeInTheDocument();
    expect(storedEntries()).toEqual(before);
    expectNoFinancialIO();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });

  it.each([
    "journey",
    "journal",
  ] as const)("R3 fails closed on a corrupt %s without replacing saved data or sending", async (corrupt) => {
    const journey = savedLaunch();
    const routeId = encodedRouteId(journey.journeyId);
    const key =
      corrupt === "journey" ? journeyKey(journey.journeyId) : journalKey(draft.id, checksumManager);
    localStorage.setItem(key, "{");
    const before = storedEntries();
    renderWithProviders(<FundLaunchJourney journeyId={routeId} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connect the original manager wallet",
    );
    expect(screen.getByRole("button", { name: "Sign next step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume journey" })).toBeDisabled();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(storedEntries()).toEqual(before);
    expectNoFinancialIO();
  });

  it("R3 refuses another wallet while preserving the original journal and derived rows", async () => {
    const journey = savedLaunch();
    mocks.manager = otherManager;
    const before = storedEntries();
    renderWithProviders(<FundLaunchJourney journeyId={encodedRouteId(journey.journeyId)} />);
    await screen.findByText(draft.review.name);
    expectRows();
    expect(screen.getByRole("alert")).toHaveTextContent("Connect the original manager wallet");
    expect(screen.getByRole("button", { name: "Sign next step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume journey" })).toBeDisabled();
    expect(storedEntries()).toEqual(before);
    expect(localStorage.getItem(journalKey(draft.id, otherManager))).toBeNull();
    expectNoFinancialIO();
  });
});
