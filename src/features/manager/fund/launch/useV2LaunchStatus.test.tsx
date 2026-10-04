import { act, renderHook } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";
import { createEmptyDraft } from "../mandateDraft";
import type { FundLaunchDraft } from "./contracts";
import { FundLaunchJourneysList } from "./FundLaunchJourneysList";
import { createJournal, saveJournal } from "./journal";
import { journeyKey, listLaunchJourneys, persistJourney } from "./journey";
import { useV2LaunchStatus } from "./useV2LaunchStatus";

const mocks = vi.hoisted(() => ({ address: `0x${"3".repeat(40)}` as string | undefined }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.address }) }));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
const wallet = `0x${"3".repeat(40)}`;
const draft: FundLaunchDraft = {
  ...createEmptyDraft("2026-10-04", "status"),
  review: {
    name: "Wallet-local income",
    description: "",
    imageUrl: "",
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 0,
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
              config: { assetKey: `arbitrum:${wallet}` },
            },
          ],
        },
      ],
    },
    spokes: [],
  },
};
describe("wallet-local launch status POO-2181", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.address = wallet;
    vi.restoreAllMocks();
  });
  it("R8 returns null without a journey and updates on journal completion", async () => {
    const { result } = renderHook(() => useV2LaunchStatus(draft.id));
    expect(result.current).toBeNull();
    act(() => {
      persistJourney(draft, wallet);
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current?.status).toBe("paused"));
    const journal = createJournal(draft.id, wallet, {}, [
      { id: "create", kind: "create", chain: 42161, dependencies: [] },
    ]);
    journal.checkpoints.create = { stepId: "create", chain: 42161, status: "confirmed" };
    act(() => saveJournal(localStorage, journal));
    expect(result.current).toMatchObject({
      status: "complete",
      current: null,
      outcome: "completed",
    });
  });
  it("R8 hides status immediately when the wallet or draft changes", () => {
    persistJourney(draft, wallet);
    const { result, rerender } = renderHook(({ draftId }) => useV2LaunchStatus(draftId), {
      initialProps: { draftId: draft.id },
    });
    expect(result.current).not.toBeNull();
    mocks.address = undefined;
    rerender({ draftId: draft.id });
    expect(result.current).toBeNull();
    mocks.address = wallet;
    rerender({ draftId: "other" });
    expect(result.current).toBeNull();
  });
  it("R4 renders resume then completed journey and fund links", async () => {
    const journey = persistJourney(draft, wallet);
    renderWithProviders(<FundLaunchJourneysList manager={wallet} />);
    expect(screen.getByRole("link", { name: "Resume launch" })).toHaveAttribute(
      "href",
      `/manager/fund-launch/${encodeURIComponent(journey.journeyId)}`,
    );
    const journal = createJournal(draft.id, wallet, {}, [
      { id: "create", kind: "create", chain: 42161, dependencies: [] },
    ]);
    journal.addresses.coreVault = wallet;
    journal.checkpoints.create = { stepId: "create", chain: 42161, status: "confirmed" };
    act(() => saveJournal(localStorage, journal));
    expect(await screen.findByRole("link", { name: "View journey" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      `/funds/${wallet}`,
    );
  });
  it("R4 skips malformed matching entries and reports inaccessible browser storage", () => {
    localStorage.setItem(
      journeyKey(`${wallet}:corrupt`),
      JSON.stringify({
        version: 1,
        journeyId: `${wallet}:corrupt`,
        draftId: "corrupt",
        manager: wallet,
        createdAt: "2026-10-04",
        draft: { id: "corrupt", review: { name: "broken" } },
      }),
    );
    expect(listLaunchJourneys(wallet).journeys).toEqual([]);
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("blocked storage");
    });
    renderWithProviders(<FundLaunchJourneysList manager={wallet} />);
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be read");
  });
  it("R4 isolates wallet changes in the list", () => {
    persistJourney(draft, wallet);
    const { rerender } = renderWithProviders(<FundLaunchJourneysList manager={wallet} />);
    expect(screen.getByText(/Wallet-local income/)).toBeInTheDocument();
    rerender(<FundLaunchJourneysList manager={`0x${"4".repeat(40)}`} />);
    expect(screen.queryByText(/Wallet-local income/)).not.toBeInTheDocument();
    fireEvent(window, new Event("storage"));
  });
});
