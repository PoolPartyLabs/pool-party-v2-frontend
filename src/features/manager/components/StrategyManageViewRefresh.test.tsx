/**
 * @id PP-MGR-SCR-004 (POO-453)
 * @name StrategyManageView post-write-refresh tests
 * @implements-rules-version v2
 *
 * [R8] Every manage op's success path must call `usePostWriteRefresh` in MOCK mode too, so the
 * Explore catalog, the Manage-strategies list and the investor portfolio refresh, not just the open
 * detail. Before POO-453 the mock branch updated only local detail state and the list views went
 * stale. Here `usePostWriteRefresh` is mocked to a spy; each op is driven through its real UI flow
 * and we assert the spy fires. (Real-mode wiring is covered by StrategyManageViewRealMode.test.tsx.)
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagerStrategyDetail } from "@/lib/schemas";
import { resetMockManagerState } from "@/lib/services";
import { managerStrategyDetails } from "@/mocks/data/manager";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { StrategyManageView } from "./StrategyManageView";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn() } }));

// The post-write refresh is the thing under test: mock it to a stable spy so we can assert every op
// reaches it. The hook returns a stable callback, so a single module-level spy is correct.
const refreshSpy = vi.fn();
vi.mock("@/lib/tx/usePostWriteRefresh", () => ({
  usePostWriteRefresh: () => refreshSpy,
}));

/** Looks up a detail fixture by id (throws on typos so tests fail loudly). */
function fixture(id: string): ManagerStrategyDetail {
  const found = managerStrategyDetails.find((detail) => detail.id === id);
  if (!found) throw new Error(`missing fixture ${id}`);
  return structuredClone(found);
}

/** Stateful harness mirroring the console: mutations re-render the view. */
function Harness({ initial }: { initial: ManagerStrategyDetail }) {
  const [detail, setDetail] = useState(initial);
  return <StrategyManageView detail={detail} onBack={vi.fn()} onDetailChange={setDetail} />;
}

beforeEach(() => resetMockManagerState());
afterEach(() => refreshSpy.mockClear());

describe("StrategyManageView post-write refresh (mock mode, POO-453 R8)", () => {
  // POO-738: the Show-in-Strategies toggle and Pause deposits are now disabled (coming soon, no
  // backend), so they no longer mutate or trigger a refresh. R8 stays covered by the Collect + Close
  // ops below.
  it("[R8] Collect fees refreshes the list views", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    await user.click(screen.getByRole("button", { name: "Collect fees" }));
    // POO-615: the CTA starts the build → a Review pause → approve → signing.
    await user.click(await screen.findByRole("button", { name: "Collect $312.40" }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Collect $312.40" }));
    // POO-802 R8: the balance body is gone; the receipt labels the figure "Amount Received".
    await screen.findByText("Amount Received", undefined, { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(refreshSpy).toHaveBeenCalled());
  });

  it("[R8] Closing the strategy refreshes the list views", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const modal = await screen.findByRole("dialog");
    // POO-596 handshake: the Review CTA renders after the async build; await it.
    await user.click(await within(modal).findByRole("button", { name: "Close strategy" }));
    await within(modal).findByText(/on the way/);
    await user.click(within(modal).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(refreshSpy).toHaveBeenCalled());
  });
});
