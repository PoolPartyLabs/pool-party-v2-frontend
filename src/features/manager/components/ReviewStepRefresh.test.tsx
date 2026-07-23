/**
 * @id PP-MGR-SCR-002 (POO-453)
 * @name ReviewStep post-write-refresh tests
 * @implements-rules-version v1
 *
 * [R8] A mock create (live launch OR draft) must call `usePostWriteRefresh` so the new strategy shows
 * on the Manage-strategies list + Explore immediately, mirroring the real path. `usePostWriteRefresh`
 * is mocked to a spy and we assert it fires on each mock create outcome.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { managerFeePolicy } from "@/mocks/data/manager";
import { uniswapPools } from "@/mocks/data/pools";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { deriveMandate } from "../lib/deriveMandate";
import type { MandateResult } from "./MandateStep";
import { ReviewStep } from "./ReviewStep";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const refreshSpy = vi.fn();
vi.mock("@/lib/tx/usePostWriteRefresh", () => ({
  usePostWriteRefresh: () => refreshSpy,
}));

const pool = uniswapPools[0];

function makeMandate(): MandateResult {
  if (!pool) throw new Error("expected at least one mock pool");
  return {
    selection: {
      name: "My Stable Yield",
      description: "Earns steady stablecoin yield from blue-chip pools.",
      logoUrl: null,
      network: pool.network,
      query: "",
      poolId: pool.id,
      full: false,
      activePreset: 10,
      minPrice: "0.99",
      maxPrice: "1.01",
    },
    pool,
    derived: deriveMandate(pool, 10),
    rangeWidthPct: 10,
  };
}

afterEach(() => refreshSpy.mockClear());

describe("ReviewStep post-write refresh (mock create, POO-453 R8)", () => {
  it("[R8] a live launch refreshes the catalog/list views", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Launch strategy" }));
    const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
    if (!confirm) throw new Error("expected the modal confirm button");
    await user.click(confirm);
    // POO-599: approve on the built-figures Review to send; the mock create + refresh fire on success.
    await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Launch strategy" }));
    // Settles to the live state; the refresh fires on that success.
    await screen.findByText("Your strategy is live", undefined, { timeout: 3000 });
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("[R8] saving a draft refreshes the catalog/list views", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Save as draft" }));
    await screen.findByText("Draft saved");
    expect(refreshSpy).toHaveBeenCalled();
  });
});
