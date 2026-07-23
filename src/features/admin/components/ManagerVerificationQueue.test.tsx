/**
 * @id PP-ADM-CMP-011
 * @name ManagerVerificationQueue.test
 * @implements-rules-version v1
 *
 * Covers the UI logic of the verification queue:
 *  - the Reject action is gated on the `canReject` capability prop (hidden for operators, shown for
 *    admin/master), mirroring `verification.reject` in the RBAC map (POO-587);
 *  - the confirmation dialog copy differs between the approve and reject branches (title + body);
 *  - POO-670 client-side "Load more" reveal (replaces the POO-628 windowing on this queue, which is
 *    mock/thin-backed with NO backend paging): [R1] the queue renders the first 5 rows and reveals
 *    the next 5 per "Load more" click from the already-loaded set; a queue of <= 5 shows no button.
 *    [R2] the DRAIN + DO-NOT-RESET contract (POO-628) still holds: a `router.refresh()` re-render
 *    that returns the same set (server re-renders one fewer pending row) must not reset the revealed
 *    count. This queue has NO status filter, so the reveal count only ever grows (no reset-on-filter).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { type ReactElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ManagerVerificationQueue, type VerificationQueueRow } from "./ManagerVerificationQueue";

// The queue calls the server actions and refreshes the route on confirm. Neither runs in these
// UI-logic tests (no click reaches confirm), but the imports must resolve under vitest.
vi.mock("@/features/admin/verificationActions", () => ({
  approveVerificationAction: vi.fn(async () => {}),
  rejectVerificationAction: vi.fn(async () => {}),
}));

// `@/i18n/navigation` pulls next-intl's ESM navigation entry (no package exports map), which cannot
// load under vitest's native Node ESM. Stub the single hook the component uses.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// The exact `admin.verificationQueue` + `admin.loadMore` copy the component renders (mirrors
// src/i18n/messages/en).
const messages = {
  admin: {
    loadMore: "Load more",
    verificationQueue: {
      empty: "No verification requests to review.",
      colManager: "Manager",
      colSubmitted: "Requested",
      colAum: "AUM",
      colStrategies: "Strategies",
      colActions: "Actions",
      approve: "Approve",
      reject: "Reject",
      cancel: "Cancel",
      approveTitle: "Approve verification?",
      approveBody: "{name} will get the verified badge shown to investors.",
      rejectTitle: "Reject verification?",
      rejectBody: "{name}'s request will be rejected. They can request again later.",
    },
  },
};

const rows: VerificationQueueRow[] = [
  { handle: "alice", name: "Alice Vault", submitted: "2026-07-01", aum: "$1.2M", strategyCount: 3 },
];

/** n synthetic pending-verification rows, `Manager 0` .. `Manager n-1`. */
function makeRows(n: number): VerificationQueueRow[] {
  return Array.from({ length: n }, (_, i) => ({
    handle: `mgr${i}`,
    name: `Manager ${i}`,
    submitted: "2026-07-01",
    aum: "$1.0M",
    strategyCount: 1,
  }));
}

/** Data rows only (excludes the header <tr>), by their per-row @handle cell. */
function dataRowCount(): number {
  // Every data row renders "@<handle>"; the header row does not. Count the handle cells.
  return screen.getAllByText(/^@mgr\d+$/).length;
}

/** Render inside a self-contained next-intl provider carrying the admin copy. */
function renderQueue(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ManagerVerificationQueue", () => {
  it("hides the Reject action when canReject is false (operator)", () => {
    renderQueue(<ManagerVerificationQueue rows={rows} canReject={false} />);

    // Approve is always available.
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    // Reject is gated behind the verification.reject capability.
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("shows the Reject action when canReject is true (admin/master)", () => {
    renderQueue(<ManagerVerificationQueue rows={rows} canReject={true} />);

    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("shows the approve confirmation copy when Approve is clicked", async () => {
    const user = userEvent.setup();
    renderQueue(<ManagerVerificationQueue rows={rows} canReject={true} />);

    await user.click(screen.getByRole("button", { name: "Approve" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Approve verification?")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Alice Vault will get the verified badge shown to investors."),
    ).toBeInTheDocument();
    // The reject branch copy is not shown.
    expect(within(dialog).queryByText("Reject verification?")).not.toBeInTheDocument();
  });

  it("shows the reject confirmation copy when Reject is clicked", async () => {
    const user = userEvent.setup();
    renderQueue(<ManagerVerificationQueue rows={rows} canReject={true} />);

    await user.click(screen.getByRole("button", { name: "Reject" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Reject verification?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Alice Vault's request will be rejected. They can request again later.",
      ),
    ).toBeInTheDocument();
    // The approve branch copy is not shown.
    expect(within(dialog).queryByText("Approve verification?")).not.toBeInTheDocument();
  });

  // -- POO-670 client-side "Load more" reveal ----------------------------------------------------

  describe("[R1] Load-more reveal (first 5, +5 per click)", () => {
    // @rule R1 — the first page shows exactly 5 rows and no more, with a "Load more" button below.
    it("renders the first 5 rows and a Load-more button for a queue longer than 5", () => {
      renderQueue(<ManagerVerificationQueue rows={makeRows(12)} canReject={true} />);
      expect(dataRowCount()).toBe(5);
      expect(screen.getByText("Manager 0")).toBeInTheDocument();
      expect(screen.getByText("Manager 4")).toBeInTheDocument();
      expect(screen.queryByText("Manager 5")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    });

    // @rule R1 — each "Load more" click reveals the next 5 rows from the already-loaded set.
    it("reveals the next 5 rows per Load-more click", async () => {
      const user = userEvent.setup();
      renderQueue(<ManagerVerificationQueue rows={makeRows(12)} canReject={true} />);

      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(dataRowCount()).toBe(10);
      expect(screen.getByText("Manager 9")).toBeInTheDocument();
      // Button remains: 10 revealed < 12 total.
      expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Load more" }));
      // Clamps to the 12 available; no phantom rows past the end.
      expect(dataRowCount()).toBe(12);
      expect(screen.getByText("Manager 11")).toBeInTheDocument();
      // Fully revealed: the button is gone.
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    // @rule R1 — a queue of exactly the page size shows every row and NO button.
    it("shows no Load-more button when the queue is exactly 5 (exact length)", () => {
      renderQueue(<ManagerVerificationQueue rows={makeRows(5)} canReject={true} />);
      expect(dataRowCount()).toBe(5);
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    // @rule R1 — a queue shorter than the page size shows every row and NO button.
    it("shows no Load-more button when the queue is shorter than 5", () => {
      renderQueue(<ManagerVerificationQueue rows={makeRows(3)} canReject={true} />);
      expect(dataRowCount()).toBe(3);
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });
  });

  describe("[R2] DRAIN + DO-NOT-RESET on router.refresh()", () => {
    // @rule R2 — a same-set refetch (router.refresh re-renders the view with a NEW rows array under
    // the SAME queue) must NOT reset the revealed count. This queue has no status filter, so the
    // reveal only grows; a refresh keeps everything the operator had revealed (POO-628 DO-NOT-RESET).
    it("preserves the revealed count across a same-set re-render (refresh returns the same 12 rows)", async () => {
      const user = userEvent.setup();
      function Harness() {
        // A new array instance on every refresh, same 12 rows — exactly what router.refresh() feeds
        // the client component after a 45s/focus/no-op decision.
        const [, setTick] = useState(0);
        return (
          <>
            <button type="button" data-testid="refresh" onClick={() => setTick((t) => t + 1)}>
              refresh
            </button>
            <ManagerVerificationQueue rows={makeRows(12)} canReject={true} />
          </>
        );
      }
      renderQueue(<Harness />);

      // Reveal to 10 rows.
      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(dataRowCount()).toBe(10);

      // A same-set refresh: the revealed count must survive (not snap back to 5).
      await user.click(screen.getByTestId("refresh"));
      expect(dataRowCount()).toBe(10);
      await user.click(screen.getByTestId("refresh"));
      expect(dataRowCount()).toBe(10);
    });

    // @rule R2 — DRAIN: an approve/reject decision drops one row from the set. The revealed slice
    // clamps to the shorter set (`slice(0, count)`), never a phantom row past the new end, and the
    // revealed count itself does not reset.
    it("drains one row without resetting the reveal or rendering a phantom row", async () => {
      const user = userEvent.setup();
      function Harness() {
        const [n, setN] = useState(12);
        return (
          <>
            <button type="button" data-testid="drain" onClick={() => setN((c) => c - 1)}>
              drain
            </button>
            <ManagerVerificationQueue rows={makeRows(n)} canReject={true} />
          </>
        );
      }
      renderQueue(<Harness />);

      await user.click(screen.getByRole("button", { name: "Load more" }));
      expect(dataRowCount()).toBe(10);

      // Drain one row: 12 -> 11. Still >= 10 revealed, so the slice stays at 10 (count preserved),
      // no phantom row.
      await user.click(screen.getByTestId("drain"));
      expect(dataRowCount()).toBe(10);
      // Everything shown is an in-range row of the shrunk set: Manager 10 exists, Manager 11 (the
      // drained tail) is gone.
      expect(screen.queryByText("Manager 11")).not.toBeInTheDocument();
      expect(screen.getByText("Manager 9")).toBeInTheDocument();
    });
  });
});
