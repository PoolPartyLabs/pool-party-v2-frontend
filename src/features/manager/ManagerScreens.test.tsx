/**
 * @name ManagerScreens.test
 * Behavior: the onboarding renders its hero + how-it-works steps and routes to the builder; the
 * console shows the first-run empty state when there are no strategies and the Overview dashboard
 * otherwise; the builder placeholder renders.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDevOverridesForTests,
  clearOverrides,
  setOverride,
} from "@/lib/features/devOverrides";
import type { ManagerStrategy } from "@/lib/schemas";
import {
  DEV_MANAGER_ADDRESS,
  managerDashboard,
  managerFeePolicy,
  managerProfiles,
  managerStrategies,
  managerStrategyDetails,
} from "@/mocks/data/manager";
import { uniswapPools } from "@/mocks/data/pools";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { setupVirtualizationLayout } from "../../../tests/virtualizationLayout";
import { BecomeManagerScreen } from "./BecomeManagerScreen";
import { ManagerConsoleScreen } from "./ManagerConsoleScreen";
import { StrategyBuilderScreen } from "./StrategyBuilderScreen";

const push = vi.fn();
const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// POO-847 R3: the measured lg split gates the manage deep link; desktop by default so every
// pre-existing console test keeps its behavior (jsdom has no matchMedia).
const isDesktopRef = vi.hoisted(() => ({ current: true as boolean | null }));
vi.mock("@/hooks/useIsDesktop", () => ({ useIsDesktop: () => isDesktopRef.current }));

// Pin the dashboard greeting to "morning" so its assertions are clock-independent.
vi.mock("@/lib/utils/timeOfDay", () => ({ timeOfDay: () => "morning" }));
// POO-650: control the connected wallet address + mock-mode signal per test so the greeting's
// own-profile link target is deterministic. `address: undefined` reproduces the mock runtime (useAuth
// has no shared session), where the fallback must keep the greeting a link; a populated address
// reproduces real mode. Reset to the populated real-mode default after each test.
const REAL_ADDRESS = "0x3655C34c9A1BA3Ab523EC72f6C39549F6fCA3F77" as `0x${string}`;
// The labeled mock-viewer sentinel the console falls back to in mock mode (mirrors the constant in
// ManagerConsoleScreen); truncates to `0x0000…0c96` and is valid 0x+40-hex so /m/<addr> accepts it.
const MOCK_VIEWER_ADDRESS = "0x0000000000000000000000000000000000000c96";
const authCfg = vi.hoisted(() => ({
  address: "0x3655C34c9A1BA3Ab523EC72f6C39549F6fCA3F77" as `0x${string}` | undefined,
  mockMode: true,
}));
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: authCfg.address, isLoading: false }),
}));
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  get isMockMode() {
    return authCfg.mockMode;
  },
}));
// The console reads its active tab + deep-link from the URL (POO-341); default to none → Overview.
// A mutable holder lets a test simulate navigation (e.g. the "Manager Console" entry → bare /manager)
// by swapping the value and re-rendering; it resets to empty after each test.
const searchParamsRef = vi.hoisted(() => ({ current: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

afterEach(() => {
  push.mockClear();
  searchParamsRef.current = new URLSearchParams();
  clearOverrides();
  __resetDevOverridesForTests();
  authCfg.address = REAL_ADDRESS;
  authCfg.mockMode = true;
});

// POO-627: a >THRESHOLD (500) owned active book so the Overview list windows under the flag + shim,
// used to prove the manage detail is parent-owned and rendered OUTSIDE the virtualized list ([R3]).
const seedStrategy = managerStrategies[0] as ManagerStrategy;
function makeManyOwned(n: number): ManagerStrategy[] {
  return Array.from({ length: n }, (_, i) => ({
    ...seedStrategy,
    id: `owned-${i}`,
    name: `Owned ${i}`,
    status: "active" as const,
  }));
}

// POO-659: the dev-login manager is the unfilled, ADDRESS-based identity (no "carlos" handle). Find
// it by its stable id (the wallet address) rather than by handle. The console only passes it through
// as the `profile` prop; none of these tests assert on its (now empty) name/handle.
const devManagerProfile = managerProfiles.find(
  (profile) => profile.address === DEV_MANAGER_ADDRESS,
);
if (!devManagerProfile) throw new Error("expected the dev-manager mock profile");

describe("BecomeManagerScreen", () => {
  it("renders the onboarding (hero + how-it-works) and routes to the builder from the CTA", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BecomeManagerScreen />);
    expect(screen.getByRole("heading", { name: "Become a manager", level: 1 })).toBeInTheDocument();
    for (const step of ["Build a strategy", "People invest", "You earn fees"]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Create your first strategy" }));
    expect(push).toHaveBeenCalledWith("/manager/new");
  });
});

describe("ManagerConsoleScreen", () => {
  it("shows the first-run empty state when the manager has no strategies", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={[]}
        profile={devManagerProfile}
      />,
    );
    expect(screen.getByText("No strategies yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create your first strategy" }));
    expect(push).toHaveBeenCalledWith("/manager/new");
  });

  it("shows the Overview dashboard when the manager has strategies", () => {
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
      />,
    );
    expect(screen.getByRole("heading", { name: /Good morning/ })).toBeInTheDocument();
    expect(screen.queryByText("No strategies yet")).toBeNull();
  });

  // POO-650: clicking the greeting goes to the viewer's OWN address profile (identity=address),
  // matching the connected wallet it displays — NOT the mock handle (/m/carlos).
  it("[POO-650] links the greeting to the connected address profile, not the mock handle", () => {
    authCfg.address = REAL_ADDRESS;
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
      />,
    );
    const link = screen.getByRole("link", { name: /Good morning/ });
    expect(link).toHaveAttribute("href", `/m/${REAL_ADDRESS}`);
  });

  // POO-650 (mock runtime): useAuth().address is undefined in the mock harness (no shared session), so
  // the greeting would collapse to plain text. With mock mode on, the console must fall back to the
  // labeled MOCK_VIEWER_ADDRESS so the greeting STAYS a link — never plain text, never /m/carlos.
  it("[POO-650] keeps the greeting a link via the mock-viewer fallback when the address is undefined", () => {
    authCfg.address = undefined;
    authCfg.mockMode = true;
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
      />,
    );
    const link = screen.getByRole("link", { name: /Good morning/ });
    expect(link).toHaveAttribute("href", `/m/${MOCK_VIEWER_ADDRESS}`);
    expect(link).not.toHaveAttribute("href", "/m/carlos");
  });

  it("drives the console tabs via the URL and opens/closes a manage detail (POO-341 / POO-180)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
      />,
    );
    // Tab switches are URL-driven now: clicking a tab navigates to `?tab=` (the plain `/manager`
    // entry then resets the console to Overview).
    await user.click(screen.getByRole("button", { name: "My strategies" }));
    expect(push).toHaveBeenCalledWith("/manager?tab=strategies");
    // Opening a strategy from the Overview opens its manage detail (local) + reflects the tab in the URL.
    const firstName = managerStrategies[0]?.name;
    if (!firstName) throw new Error("expected a mock manager strategy");
    await user.click(screen.getAllByRole("button", { name: firstName })[0] as HTMLElement);
    expect(await screen.findByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/manager?tab=strategies");
    // Back closes the detail.
    await user.click(screen.getByRole("button", { name: "All strategies" }));
    expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();
  });

  // @rule R1 (POO-451): the shared ConsoleShell keeps the "Create new strategy" CTA on every tab.
  it("shows the 'Create new strategy' CTA on every console tab (POO-451)", async () => {
    const user = userEvent.setup();
    // Overview (no tab param): the CTA is present and routes to the builder.
    const { rerender } = renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Create new strategy/ }));
    expect(push).toHaveBeenCalledWith("/manager/new");
    // My strategies tab: still present.
    searchParamsRef.current = new URLSearchParams("tab=strategies");
    rerender(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
      />,
    );
    expect(screen.getByRole("button", { name: /Create new strategy/ })).toBeInTheDocument();
    // Profile tab: still present.
    searchParamsRef.current = new URLSearchParams("tab=profile");
    rerender(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
      />,
    );
    expect(screen.getByRole("button", { name: /Create new strategy/ })).toBeInTheDocument();
  });

  it("resets to Overview when the 'Manager Console' entry navigates to a bare /manager (POO-341)", async () => {
    const manageId = managerStrategies[0]?.id;
    if (!manageId) throw new Error("expected a mock manager strategy");
    const getStrategyDetail = vi.fn(async () => managerStrategyDetails[0] ?? null);
    // Start on a deep-linked manage detail: the URL carries ?manage=<id> and the detail is open.
    searchParamsRef.current = new URLSearchParams(`manage=${manageId}`);
    const { rerender } = renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
        initialManageId={manageId}
        getStrategyDetail={getStrategyDetail}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Operations" })).toBeInTheDocument();

    // Clicking "Manager Console" navigates to a bare /manager (no ?tab, no ?manage). The console must
    // drop the open detail and return to a clean Overview — even from a deep-linked detail / real mode,
    // where the server-passed initialManageId no longer guards the reset.
    searchParamsRef.current = new URLSearchParams();
    rerender(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
        initialManageId={undefined}
        getStrategyDetail={getStrategyDetail}
      />,
    );
    expect(await screen.findByRole("heading", { name: /Good morning/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();
  });

  // @rule POO-847 R3 (Murilo 2026-07-11): the managed surface is desktop-only — below lg the
  // manage deep link degrades to the INVESTOR detail and the manage reader never runs.
  it("[POO-847 R3] below lg the manage deep link degrades to the investor detail", async () => {
    isDesktopRef.current = false;
    replace.mockClear();
    try {
      const manageId = managerStrategies[0]?.id;
      if (!manageId) throw new Error("expected a mock manager strategy");
      const getStrategyDetail = vi.fn(async () => managerStrategyDetails[0] ?? null);
      renderWithProviders(
        <ManagerConsoleScreen
          dashboard={managerDashboard}
          strategies={managerStrategies}
          profile={devManagerProfile}
          initialManageId={manageId}
          getStrategyDetail={getStrategyDetail}
        />,
      );
      await waitFor(() => expect(replace).toHaveBeenCalledWith(`/strategies/${manageId}`));
      expect(getStrategyDetail).not.toHaveBeenCalled();
    } finally {
      isDesktopRef.current = true;
    }
  });

  // @rule POO-847 R3 (review finding): an in-console Manage tap below lg degrades to the INVESTOR
  // detail and never opens the desktop manage view / runs the manage reader.
  it("[POO-847 R3] an in-console Manage tap below lg opens the investor detail, not Operations", async () => {
    isDesktopRef.current = false;
    push.mockClear();
    try {
      const user = userEvent.setup();
      const getStrategyDetail = vi.fn(async () => managerStrategyDetails[0] ?? null);
      renderWithProviders(
        <ManagerConsoleScreen
          dashboard={managerDashboard}
          strategies={managerStrategies}
          profile={devManagerProfile}
          getStrategyDetail={getStrategyDetail}
        />,
      );
      const firstName = managerStrategies[0]?.id;
      if (!firstName) throw new Error("expected a mock manager strategy");
      await user.click(
        screen.getAllByRole("button", { name: managerStrategies[0]?.name })[0] as HTMLElement,
      );
      expect(push).toHaveBeenCalledWith(`/strategies/${firstName}`);
      expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();
      expect(getStrategyDetail).not.toHaveBeenCalled();
    } finally {
      isDesktopRef.current = true;
    }
  });

  // @rule POO-847 R3 (review finding): an UNMEASURED viewport (`null`, SSR / first client render) is
  // NOT yet desktop — a Manage tap must degrade to the investor detail, never fall through to the
  // desktop manage view (the `isDesktop === false`-only guard let `null` slip through).
  it("[POO-847 R3] a Manage tap while the viewport is unmeasured (null) degrades to the investor detail", async () => {
    isDesktopRef.current = null;
    push.mockClear();
    try {
      const user = userEvent.setup();
      const getStrategyDetail = vi.fn(async () => managerStrategyDetails[0] ?? null);
      renderWithProviders(
        <ManagerConsoleScreen
          dashboard={managerDashboard}
          strategies={managerStrategies}
          profile={devManagerProfile}
          getStrategyDetail={getStrategyDetail}
        />,
      );
      const firstId = managerStrategies[0]?.id;
      if (!firstId) throw new Error("expected a mock manager strategy");
      await user.click(
        screen.getAllByRole("button", { name: managerStrategies[0]?.name })[0] as HTMLElement,
      );
      expect(push).toHaveBeenCalledWith(`/strategies/${firstId}`);
      expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();
      expect(getStrategyDetail).not.toHaveBeenCalled();
    } finally {
      isDesktopRef.current = true;
    }
  });

  it("opens a strategy's manage view on mount from initialManageId (deep link, POO-224)", async () => {
    const manageId = managerStrategies[0]?.id;
    if (!manageId) throw new Error("expected a mock manager strategy");
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
        initialManageId={manageId}
      />,
    );
    // The manage detail opens directly (no clicks); the Overview greeting never shows.
    expect(await screen.findByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Good morning/ })).toBeNull();
  });

  it("does not open the manage view from initialManageId for an unowned strategy (PP-SECURITY)", async () => {
    // The deep-link reader matches by catalog id + pool/network only, with no ownership check, so a
    // wallet could deep-link `?manage=<any public strategy id>`. The screen must gate on the OWNED
    // set (`strategies`) and refuse to even read the detail of an id outside it.
    const unownedId = "not-mine";
    if (managerStrategies.some((strategy) => strategy.id === unownedId)) {
      throw new Error("the unowned id collided with a mock owned strategy");
    }
    const getStrategyDetail = vi.fn(async () => managerStrategyDetails[0] ?? null);
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
        initialManageId={unownedId}
        getStrategyDetail={getStrategyDetail}
      />,
    );
    // The not-found alert shows, no manager detail (Operations) renders, and the unowned id is never
    // read — the guard short-circuits before the reader runs.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();
    expect(getStrategyDetail).not.toHaveBeenCalled();
  });

  it("opens the manage view from initialManageId for an owned strategy (PP-SECURITY)", async () => {
    const manageId = managerStrategies[0]?.id;
    if (!manageId) throw new Error("expected a mock manager strategy");
    const getStrategyDetail = vi.fn(async () => managerStrategyDetails[0] ?? null);
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
        initialManageId={manageId}
        getStrategyDetail={getStrategyDetail}
      />,
    );
    // An owned id flows through the reader and renders the manager detail.
    expect(await screen.findByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect(getStrategyDetail).toHaveBeenCalledWith(manageId);
  });

  // @rule POO-520 R1: returning from a manager-origin Deposit & invest top-up
  // (/manager?manage=<id>&invest=<amount>), the console opens the manage view AND re-arms the
  // add-liquidity invest modal with the preserved amount (POO-494 resume rules). POO-598 R6 (the
  // build→review→sign handshake): the resume lands on the AMOUNT step with the amount prefilled and
  // must NOT auto-trigger the wallet, so the modal shows the "Invest" CTA (the user then goes through
  // build → review → sign), not the old direct "Confirm & sign" step.
  it("arms the add-liquidity modal from ?manage=<id>&invest=<amount> (POO-520 R1)", async () => {
    const manageId = managerStrategies[0]?.id;
    if (!manageId) throw new Error("expected a mock manager strategy");
    const getStrategyDetail = vi.fn(async () => managerStrategyDetails[0] ?? null);
    searchParamsRef.current = new URLSearchParams(`manage=${manageId}&invest=250`);
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
        initialManageId={manageId}
        getStrategyDetail={getStrategyDetail}
      />,
    );
    // POO-598 R6: the invest modal resumed on the AMOUNT step with the amount (250) prefilled, NOT
    // auto-armed at "Confirm & sign" — the handshake requires build → review before the wallet signs.
    // The mock manager balance ($50) is below the resumed amount, so the amount-step CTA reads
    // "Deposit & invest" (needsDeposit); the point is the amount was preserved and no money-move armed.
    expect(
      await screen.findByRole("button", { name: "Deposit & invest" }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("250")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm & sign" })).toBeNull();
    // The manage view is mounted beneath the dialog (Radix marks it aria-hidden while open).
    expect(screen.getByRole("heading", { name: "Operations", hidden: true })).toBeInTheDocument();
  });

  // @rule POO-627 R3 — the manage detail is PARENT-owned (console-level `detail` state, keyed by id)
  // and renders OUTSIDE the virtualized Overview list, so it does NOT unmount when its trigger row
  // scrolls out of the window. With a >THRESHOLD owned book, the flag on and the layout shim, the
  // Overview list windows; a deep-linked detail must still open and stay mounted, decoupled from the
  // list's window.
  it("[R3] opens the manage detail OUTSIDE the virtualized Overview list (parent-owned, keyed by id)", async () => {
    setupVirtualizationLayout();
    setOverride("virtualize", true);
    const bigBook = makeManyOwned(600);
    const manageId = bigBook[590]?.id;
    if (!manageId) throw new Error("expected a deep-owned strategy");
    const getStrategyDetail = vi.fn(async () => managerStrategyDetails[0] ?? null);
    // The trigger row (index 590) is far outside the initial window, yet the detail opens: the console
    // owns it, not the list. The manage view fully replaces the list body (no list windowing beneath).
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={bigBook}
        profile={devManagerProfile}
        initialManageId={manageId}
        getStrategyDetail={getStrategyDetail}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect(getStrategyDetail).toHaveBeenCalledWith(manageId);
    // The manage detail is the sole body — the windowed list is not mounted beneath it, so no
    // list-window spacer/card can unmount the detail's trigger.
    expect(screen.queryByRole("table")).toBeNull();
  });

  // @rule POO-520 R1 (validation): a non-numeric invest param arms nothing; the manage view opens
  // plain, exactly as a bare ?manage= deep link.
  it("ignores an invalid invest param on the manage deep link (POO-520 R1)", async () => {
    const manageId = managerStrategies[0]?.id;
    if (!manageId) throw new Error("expected a mock manager strategy");
    const getStrategyDetail = vi.fn(async () => managerStrategyDetails[0] ?? null);
    searchParamsRef.current = new URLSearchParams(`manage=${manageId}&invest=abc`);
    renderWithProviders(
      <ManagerConsoleScreen
        dashboard={managerDashboard}
        strategies={managerStrategies}
        profile={devManagerProfile}
        initialManageId={manageId}
        getStrategyDetail={getStrategyDetail}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm & sign" })).toBeNull();
  });
});

describe("StrategyBuilderScreen", () => {
  it("renders the builder wizard with the Mandate step and pool list", () => {
    renderWithProviders(
      <StrategyBuilderScreen pools={uniswapPools} feePolicy={managerFeePolicy} />,
    );
    expect(
      screen.getByRole("heading", { name: "Create new strategy", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mandate", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByText("ETH/USDC").length).toBeGreaterThan(0);
  });

  it("scrolls to the top of the page on each step transition (POO-335)", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderWithProviders(
      <StrategyBuilderScreen pools={uniswapPools} feePolicy={managerFeePolicy} />,
    );
    // The step effect runs on mount and on every subsequent step change.
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockRestore();
  });
});
