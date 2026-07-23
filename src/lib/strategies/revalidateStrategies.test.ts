/**
 * @id PP-STR (POO-298) · PP-STR-LIB-008 (POO-579)
 * @name revalidateStrategiesAction tests
 * @implements-rules-version v1
 *
 * Post-write catalog freshness (POO-638 convergence + the usePostWriteRefresh contract): a confirmed
 * write must bust the catalog the UI actually renders. After the POO-579 swap the discovery list is
 * served from the v2 data-cache, so the action busts BOTH the v2 tag (discovery + getStrategyById) and
 * the v1 tag (holdings resolver + the v1 fallback). Dropping only one would leave the other stale under
 * its revalidate window after every invest/withdraw/collect/create.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revalidateTag: vi.fn() }));

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("./fetchStrategies", () => ({ STRATEGIES_CACHE_TAG: "strategies" }));
vi.mock("./v2/fetchStrategiesV2", () => ({ STRATEGIES_V2_CACHE_TAG: "strategies-v2" }));

import { revalidateStrategiesAction } from "./revalidateStrategies";

describe("revalidateStrategiesAction", () => {
  beforeEach(() => mocks.revalidateTag.mockReset());

  it("busts BOTH the v2 discovery cache and the v1 holdings/fallback cache", async () => {
    await revalidateStrategiesAction();
    // The rendered Explore/discovery catalog is v2-tagged post-POO-579 — it MUST be invalidated.
    expect(mocks.revalidateTag).toHaveBeenCalledWith("strategies-v2");
    // The v1 tag still backs the holdings resolver + the fallback path — kept.
    expect(mocks.revalidateTag).toHaveBeenCalledWith("strategies");
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(2);
  });
});
