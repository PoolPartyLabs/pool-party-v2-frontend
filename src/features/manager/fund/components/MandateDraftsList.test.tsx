/**
 * @id PP-MGR-CMP-044
 * @name MandateDraftsList tests
 * @implements-rules-version v3 (POO-2127 rules v1, POO-2167 rules v3)
 * @analytics-events none, the names are ASSERTED here rather than emitted; a test is never an
 *   emitter, so a screen cannot count as instrumented by being tested
 *
 * The Console's drafts card (POO-2127 [D1], handoff blast radius item 1): the only way back into a
 * parked mandate, and the only way to throw one away.
 *
 * Fixtures are written as the STORE'S OWN PAYLOAD rather than through `upsertDraft`, because
 * `upsertDraft` stamps `updatedAt` with the wall clock on every write (deliberately: "when was this
 * last touched" means "when did it last reach storage"). A row whose whole job is to print how long
 * ago that was therefore cannot be set up through the writer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import {
  createEmptyDraft,
  type MandateDraft,
  REQUIRED_PROTOCOLS,
  withProtocols,
} from "../mandateDraft";
import { getDraft, MANDATE_DRAFTS_KEY, MANDATE_DRAFTS_VERSION } from "../mandateDraftStore";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/manager",
}));

const analytics = vi.hoisted(() => ({ track: vi.fn(), trackFailure: vi.fn() }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => analytics }));

const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { toast };
});
vi.mock("@/components/ui/Toast", () => ({ toast: toasts.toast }));

import { MandateDraftsList } from "./MandateDraftsList";

/** Hours ago, as an ISO stamp. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Write drafts straight into the payload the store reads, keeping the stamps the test needs. */
function seedPayload(...drafts: MandateDraft[]): void {
  const byId: Record<string, MandateDraft> = {};
  for (const draft of drafts) byId[draft.id] = draft;
  window.localStorage.setItem(
    MANDATE_DRAFTS_KEY,
    JSON.stringify({ version: MANDATE_DRAFTS_VERSION, drafts: byId }),
  );
}

/** A saved draft: named, stamped, parked on a step. */
function saved(id: string, over: Partial<MandateDraft> = {}): MandateDraft {
  return {
    ...createEmptyDraft("2026-10-01T00:00:00.000Z", id),
    name: `Draft ${id}`,
    savedAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
    ...over,
  };
}

/** Every event of one name the card pushed. */
function emitted(event: string): Record<string, unknown>[] {
  return analytics.track.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

beforeEach(() => {
  nav.push.mockClear();
  analytics.track.mockClear();
  toasts.toast.mockClear();
  toasts.toast.error.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MandateDraftsList", () => {
  // @rule D1
  it("lists every stored draft by name", async () => {
    seedPayload(saved("a"), saved("b"));

    renderWithProviders(<MandateDraftsList />);

    expect(await screen.findByText("Draft a")).toBeInTheDocument();
    expect(screen.getByText("Draft b")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Drafts" })).toBeInTheDocument();
  });

  // @rule D1
  it("says where each draft was parked and how long ago it was touched", async () => {
    seedPayload(
      saved("a", {
        lastStep: "tokens",
        passedSteps: ["networks", "protocols"],
        updatedAt: hoursAgo(2),
      }),
    );

    renderWithProviders(<MandateDraftsList />);

    expect(
      await screen.findByText("Mandate, step 3 of 4 · updated 2 hours ago"),
    ).toBeInTheDocument();
  });

  // @rule D1
  it("counts the steps the draft actually has, so a skipped Pools step is not counted", async () => {
    // R29: a mandate with a position protocol has five steps; one without has four. Uniswap v4,
    // the position protocol the buildathon scope offers (R20 v3, POO-2167).
    const withPools = withProtocols(saved("a", { lastStep: "limits" }), [
      ...REQUIRED_PROTOCOLS,
      "uniswap-v4",
    ]);
    seedPayload({ ...withPools, updatedAt: hoursAgo(3) });

    renderWithProviders(<MandateDraftsList />);

    expect(await screen.findByText(/Mandate, step 5 of 5/)).toBeInTheDocument();
  });

  /**
   * R20 v3 (POO-2167): a draft parked on Pools whose only position protocol was Uniswap v3 loses the
   * protocol, and so the Pools step, when it is loaded, while `lastStep` still says "pools". The row
   * counts from the first step the manager has not passed instead of printing "step 0".
   */
  // @rule D1 @rule R20 v3
  it("counts from the first unpassed step when the parked step no longer exists", async () => {
    seedPayload(
      saved("v3", {
        protocols: [...REQUIRED_PROTOCOLS, "uniswap-v3"],
        passedSteps: ["networks", "protocols", "tokens"],
        lastStep: "pools",
        updatedAt: hoursAgo(2),
      }),
    );

    renderWithProviders(<MandateDraftsList />);

    expect(
      await screen.findByText("Mandate, step 4 of 4 · updated 2 hours ago"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/step 0 of/)).not.toBeInTheDocument();
  });

  // @rule D3 @rule R20 v3
  it("Open resumes a draft whose parked step no longer exists on the first unpassed step", async () => {
    seedPayload(
      saved("v3", {
        protocols: [...REQUIRED_PROTOCOLS, "uniswap-v3"],
        passedSteps: ["networks", "protocols", "tokens"],
        lastStep: "pools",
      }),
    );

    renderWithProviders(<MandateDraftsList />);
    await userEvent.click(await screen.findByRole("button", { name: "Open" }));

    expect(nav.push).toHaveBeenCalledWith("/manager/new?draft=v3&step=limits");
    expect(emitted("builder_draft_opened")).toEqual([{ step: "limits" }]);
  });

  // @rule D1
  it("lists the most recently touched draft first", async () => {
    seedPayload(
      saved("old", { updatedAt: hoursAgo(10) }),
      saved("new", { updatedAt: hoursAgo(1) }),
    );

    renderWithProviders(<MandateDraftsList />);

    await screen.findByText("Draft new");
    const names = screen.getAllByTestId("mandate-draft-name").map((node) => node.textContent);
    expect(names).toEqual(["Draft new", "Draft old"]);
  });

  // @rule D1
  it("falls back to a neutral label for a draft with no name", async () => {
    seedPayload(saved("a", { name: null }));

    renderWithProviders(<MandateDraftsList />);

    expect(await screen.findByText("Unnamed draft")).toBeInTheDocument();
    expect(screen.queryByText(/^a$/)).not.toBeInTheDocument();
  });

  // @rule D3
  it("Open resumes the draft at the step it was parked on", async () => {
    seedPayload(saved("a", { lastStep: "tokens", passedSteps: ["networks", "protocols"] }));

    renderWithProviders(<MandateDraftsList />);
    await userEvent.click(await screen.findByRole("button", { name: "Open" }));

    expect(nav.push).toHaveBeenCalledWith("/manager/new?draft=a&step=tokens");
  });

  // @rule D3
  it("records the resume with the step it resumed on", async () => {
    seedPayload(
      saved("a", { lastStep: "limits", passedSteps: ["networks", "protocols", "tokens"] }),
    );

    renderWithProviders(<MandateDraftsList />);
    await userEvent.click(await screen.findByRole("button", { name: "Open" }));

    expect(emitted("builder_draft_opened")).toEqual([{ step: "limits" }]);
  });

  // @rule D1
  it("asks before deleting, naming the draft it is about to remove", async () => {
    seedPayload(saved("a"));

    renderWithProviders(<MandateDraftsList />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete this draft?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/^Draft a and everything you chose in it will be removed/),
    ).toBeInTheDocument();
    // Not gone yet: the question has not been answered.
    expect(getDraft("a")).not.toBeNull();
  });

  // @rule D1
  it("removes the draft from the store on confirm and stops listing it", async () => {
    seedPayload(saved("a", { updatedAt: hoursAgo(1) }), saved("b", { updatedAt: hoursAgo(5) }));

    renderWithProviders(<MandateDraftsList />);
    const rows = await screen.findAllByTestId("mandate-draft-row");
    // The newest draft is first (the store sorts by `updatedAt`), so this is "a".
    const first = rows[0] as HTMLElement;
    await userEvent.click(within(first).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(getDraft("a")).toBeNull());
    expect(screen.queryByText("Draft a")).not.toBeInTheDocument();
    expect(screen.getByText("Draft b")).toBeInTheDocument();
    expect(emitted("builder_draft_deleted")).toEqual([{ step: "networks" }]);
  });

  /**
   * A delete that did not happen is not reported as one, and IS reported as a failure.
   *
   * The event used to be tracked before `deleteDraft` ran, and the store swallowed a failed write, so
   * a blocked or full storage produced a `builder_draft_deleted` for a draft still sitting there: the
   * funnel counted a deletion, the manager saw no error, and the row came back on the next read.
   *
   * [B8] Not counting it as a deletion left the other half silent: the card showed the manager a
   * toast and the funnel recorded nothing at all, so a storage that refuses every delete looks
   * exactly like nobody pressing Delete. Premise 11 wants the error class, and the shell already
   * reports the mirror-image write failure as `DRAFT_SAVE_FAILED` / `app`.
   */
  // @rule D1
  it("says so and counts nothing when the delete could not be written", async () => {
    seedPayload(saved("a"));
    renderWithProviders(<MandateDraftsList />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    // The read has already happened, so the row exists; only the WRITE is refused from here on.
    const payload = window.localStorage.getItem(MANDATE_DRAFTS_KEY);
    vi.stubGlobal("localStorage", {
      getItem: () => payload,
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
      clear: () => undefined,
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(toasts.toast.error).toHaveBeenCalledWith("Couldn't delete the draft. Try again.");
    expect(emitted("builder_draft_deleted")).toHaveLength(0);
    // The step is where the draft was parked, which is the dimension that makes the failure
    // readable beside the deletions it did not become.
    expect(emitted("builder_mandate_error")).toEqual([
      { step: "networks", error_code: "DRAFT_DELETE_FAILED", error_origin: "app" },
    ]);
  });

  // @rule D1
  it("keeps the draft when the question is cancelled", async () => {
    seedPayload(saved("a"));

    renderWithProviders(<MandateDraftsList />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(getDraft("a")).not.toBeNull();
    expect(screen.getByText("Draft a")).toBeInTheDocument();
    expect(emitted("builder_draft_deleted")).toHaveLength(0);
  });

  // @rule D1
  it("says there are no drafts rather than showing an empty card", async () => {
    renderWithProviders(<MandateDraftsList />);

    expect(
      await screen.findByText("No drafts yet. Start a strategy and use Save & exit to keep one."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });

  // @rule D1
  it("picks up a draft saved elsewhere without a remount", async () => {
    renderWithProviders(<MandateDraftsList />);
    await screen.findByText("No drafts yet. Start a strategy and use Save & exit to keep one.");

    // The store notifies its subscribers on every write, which is how the Console reflects a
    // Save & exit that happened in the builder a moment ago.
    const { upsertDraft } = await import("../mandateDraftStore");
    upsertDraft(saved("late", { name: "Saved from the builder" }));

    expect(await screen.findByText("Saved from the builder")).toBeInTheDocument();
  });
});
