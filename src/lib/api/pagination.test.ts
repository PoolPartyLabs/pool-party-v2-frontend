/**
 * @id PP-CORE-LIB-032 (POO-666, POO-668)
 * @name pagination primitives tests
 * @implements-rules-version v1
 *
 * The two client-safe "Load more" hasMore derivations:
 * - {@link computeHasMore} (total-based): the next page's first index is still below the grand total.
 * - {@link computeHasMoreShortPage} (POO-668): SHORT-PAGE termination — there is more only while the
 *   last page returned was exactly full; a short/empty page is the end. Used where the backend total
 *   is a phantom (portfolio `totalPositions` over-counts a `closed`-filtered read), so the grand total
 *   cannot drive the per-list stop.
 */
import { describe, expect, it } from "vitest";
import { computeHasMore, computeHasMoreShortPage } from "./pagination";

describe("computeHasMore (total-based)", () => {
  it("is true while the next page's first row is below the total", () => {
    expect(computeHasMore(0, 5, 12)).toBe(true);
    expect(computeHasMore(1, 5, 12)).toBe(true);
  });

  it("is false on the last (exactly-full or short) page and for an empty set", () => {
    expect(computeHasMore(2, 5, 12)).toBe(false); // page 2 covers rows 10..12
    expect(computeHasMore(1, 5, 10)).toBe(false); // served === total (exact multiple)
    expect(computeHasMore(0, 5, 0)).toBe(false); // empty
  });
});

describe("computeHasMoreShortPage (POO-668)", () => {
  // @rule R1 @rule R2: a full last page (length === limit) means another page MAY exist → more.
  it("is true when the last page was exactly full", () => {
    expect(computeHasMoreShortPage(5, 5)).toBe(true);
  });

  // @rule R1 @rule R2: a SHORT page (fewer than limit) is the end of the feed.
  it("is false when the last page was short", () => {
    expect(computeHasMoreShortPage(4, 5)).toBe(false);
    expect(computeHasMoreShortPage(1, 5)).toBe(false);
  });

  // @rule R1 @rule R2: an empty page (length 0) is the end.
  it("is false for an empty page", () => {
    expect(computeHasMoreShortPage(0, 5)).toBe(false);
  });

  // Degenerate guard: a zero page size never claims "more" (would loop forever otherwise).
  it("is false when the page size is zero", () => {
    expect(computeHasMoreShortPage(0, 0)).toBe(false);
  });
});
