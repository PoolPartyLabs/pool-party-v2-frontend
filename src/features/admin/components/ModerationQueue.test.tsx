/**
 * @id PP-ADM-CMP-012
 * @name ModerationQueue.test
 * @implements-rules-version v1
 *
 * Covers the image-moderation grid (POO-590):
 *  - the Approve / Remove actions are gated on the `canApprove` / `canRemove` capability props;
 *  - the Remove flow opens the free-text {@link RemoveImageDialog}; Approve opens a ConfirmDialog;
 *  - POO-670 client-side "Load more" reveal (replaces the POO-628 windowing on this queue, which is
 *    mock/thin-backed with NO backend paging): [R1] the grid renders the first 5 cards and reveals
 *    the next 5 per "Load more" click from the already-loaded set; a queue of <= 5 shows no button.
 *    [R2] the DRAIN + DO-NOT-RESET contract (POO-628) still holds: a `router.refresh()` re-render
 *    that returns the same set (server re-renders one fewer pending card) must not reset the revealed
 *    count. This grid has NO filter, so the reveal count only ever grows (no reset-on-filter).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { type ReactElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { type ModerationImageRow, ModerationQueue } from "./ModerationQueue";

// The grid calls the server actions and refreshes the route on confirm. Neither runs in these
// UI/reveal tests, but the imports must resolve under vitest.
vi.mock("@/features/admin/moderationActions", () => ({
  approveImageAction: vi.fn(async () => {}),
  removeImageAction: vi.fn(async () => {}),
}));

// `@/i18n/navigation` pulls next-intl's ESM navigation entry (no exports map) which cannot load under
// vitest's native Node ESM. Stub the single hook the component uses.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// The exact `admin.imageModeration` + `admin.loadMore` copy the component renders (mirrors
// src/i18n/messages/en/admin).
const messages = {
  admin: {
    loadMore: "Load more",
    imageModeration: {
      empty: "No images to review.",
      listLabel: "Pending images",
      kindStrategy: "Strategy image",
      kindAvatar: "Profile photo",
      kindBanner: "Banner",
      approve: "Approve",
      remove: "Remove",
      cancel: "Cancel",
      approveTitle: "Approve image?",
      approveBody: "Keep {subject}'s image on the platform.",
      thumbAlt: "{subject}'s uploaded image",
      removeTitle: "Remove image?",
      removeBody: "{subject}'s image will be hidden from the platform. This is reversible.",
      reasonLabel: "Reason (optional)",
      reasonPlaceholder: "Why is this being removed?",
    },
  },
};

function makeItems(n: number): ModerationImageRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `img${i}`,
    kind: "strategy" as const,
    subjectName: `Subject ${i}`,
    subjectId: `sub${i}`,
    uploaded: "2026-07-01",
  }));
}

function renderQueue(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ModerationQueue", () => {
  describe("capability gating + dialogs", () => {
    it("hides Remove when canRemove is false and hides Approve when canApprove is false", () => {
      renderQueue(<ModerationQueue items={makeItems(1)} canApprove={false} canRemove={true} />);
      expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    });

    it("opens the approve confirmation copy when Approve is clicked", async () => {
      const user = userEvent.setup();
      renderQueue(<ModerationQueue items={makeItems(1)} canApprove={true} canRemove={true} />);
      await user.click(screen.getByRole("button", { name: "Approve" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("Approve image?")).toBeInTheDocument();
      expect(
        within(dialog).getByText("Keep Subject 0's image on the platform."),
      ).toBeInTheDocument();
    });

    it("opens the remove dialog with a reason field when Remove is clicked", async () => {
      const user = userEvent.setup();
      renderQueue(<ModerationQueue items={makeItems(1)} canApprove={true} canRemove={true} />);
      await user.click(screen.getByRole("button", { name: "Remove" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("Remove image?")).toBeInTheDocument();
      expect(within(dialog).getByPlaceholderText("Why is this being removed?")).toBeInTheDocument();
    });
  });

  describe("empty + grid layout", () => {
    it("empty queue renders the empty state, never a card grid or a Load-more button", () => {
      renderQueue(<ModerationQueue items={[]} canApprove={true} canRemove={true} />);
      expect(screen.getByText("No images to review.")).toBeInTheDocument();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("keeps the responsive grid columns on the <ul> (sm:2 / lg:3, not a single column)", () => {
      renderQueue(<ModerationQueue items={makeItems(3)} canApprove={true} canRemove={true} />);
      expect(screen.getByRole("list", { name: "Pending images" })).toHaveClass(
        "grid",
        "sm:grid-cols-2",
        "lg:grid-cols-3",
      );
    });
  });

  // -- POO-670 client-side "Load more" reveal ----------------------------------------------------

  describe("[R1] Load-more reveal (first 5, +5 per click)", () => {
    // @rule R1 — the first page shows exactly 5 cards and a "Load more" button below.
    it("renders the first 5 cards and a Load-more button for a queue longer than 5", () => {
      renderQueue(<ModerationQueue items={makeItems(12)} canApprove={true} canRemove={true} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(5);
      expect(screen.getByText("Subject 0")).toBeInTheDocument();
      expect(screen.getByText("Subject 4")).toBeInTheDocument();
      expect(screen.queryByText("Subject 5")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    });

    // @rule R1 — each "Load more" click reveals the next 5 cards from the already-loaded set.
    it("reveals the next 5 cards per Load-more click", async () => {
      const user = userEvent.setup();
      renderQueue(<ModerationQueue items={makeItems(12)} canApprove={true} canRemove={true} />);

      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(10);
      expect(screen.getByText("Subject 9")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Load more" }));
      // Clamps to the 12 available; no phantom cards past the end.
      expect(screen.getAllByRole("listitem")).toHaveLength(12);
      expect(screen.getByText("Subject 11")).toBeInTheDocument();
      // Fully revealed: the button is gone.
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    // @rule R1 — a queue of exactly the page size shows every card and NO button.
    it("shows no Load-more button when the queue is exactly 5 (exact length)", () => {
      renderQueue(<ModerationQueue items={makeItems(5)} canApprove={true} canRemove={true} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(5);
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    // @rule R1 — a queue shorter than the page size shows every card and NO button.
    it("shows no Load-more button when the queue is shorter than 5", () => {
      renderQueue(<ModerationQueue items={makeItems(2)} canApprove={true} canRemove={true} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });
  });

  describe("[R2] DRAIN + DO-NOT-RESET on router.refresh()", () => {
    // @rule R2 — a same-set refetch (router.refresh re-renders with a NEW items array, same set) must
    // NOT reset the revealed count. This grid has no filter, so the reveal only grows; a refresh keeps
    // everything the operator had revealed (POO-628 DO-NOT-RESET).
    it("preserves the revealed count across a same-set re-render (refresh returns the same 12 items)", async () => {
      const user = userEvent.setup();
      function Harness() {
        const [, setTick] = useState(0);
        return (
          <>
            <button type="button" data-testid="refresh" onClick={() => setTick((t) => t + 1)}>
              refresh
            </button>
            <ModerationQueue items={makeItems(12)} canApprove={true} canRemove={true} />
          </>
        );
      }
      renderQueue(<Harness />);

      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(10);

      // A same-set refresh: the revealed count must survive (not snap back to 5).
      await user.click(screen.getByTestId("refresh"));
      expect(screen.getAllByRole("listitem")).toHaveLength(10);
      await user.click(screen.getByTestId("refresh"));
      expect(screen.getAllByRole("listitem")).toHaveLength(10);
    });

    // @rule R2 — DRAIN: an approve/remove decision drops one card. The revealed slice clamps to the
    // shorter set (`slice(0, count)`), never a phantom card past the new end, and does not reset.
    it("drains one card without resetting the reveal or rendering a phantom card", async () => {
      const user = userEvent.setup();
      function Harness() {
        const [n, setN] = useState(12);
        return (
          <>
            <button type="button" data-testid="drain" onClick={() => setN((c) => c - 1)}>
              drain
            </button>
            <ModerationQueue items={makeItems(n)} canApprove={true} canRemove={true} />
          </>
        );
      }
      renderQueue(<Harness />);

      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(10);

      // Drain one card: 12 -> 11. Still >= 10 revealed, so the slice stays at 10 (count preserved),
      // no phantom card.
      await user.click(screen.getByTestId("drain"));
      expect(screen.getAllByRole("listitem")).toHaveLength(10);
      expect(screen.queryByText("Subject 11")).not.toBeInTheDocument();
      expect(screen.getByText("Subject 9")).toBeInTheDocument();
    });
  });
});
