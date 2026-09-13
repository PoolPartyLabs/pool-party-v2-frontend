/**
 * @id PP-CORE (SETUP-014 / POO-82)
 * @name analytics events — multi-value param encoding tests (POO-1882, rules-v1)
 *
 * The encoding convention every multi-valued GA4 param in this repo uses, pinned by test because it
 * is a WIRE format: once a series exists in GA4, changing the separator, the ordering or the
 * empty-set spelling forks one dimension into two with no historical bridge.
 */
import { describe, expect, it } from "vitest";
import { assetTagSchema } from "@/lib/schemas";
import { ANALYTICS_MULTI_VALUE_EMPTY, joinAnalyticsMultiValue } from "./events";

describe("joinAnalyticsMultiValue (POO-1882 [R4] [R6])", () => {
  // @rule R6: a comma-joined string of the identifiers, no spaces. GA4 event params accept only
  // scalars (string / number / boolean), so an array would reach the dataLayer and be dropped or
  // stringified unpredictably at the GTM boundary.
  it("[R6] joins with a bare comma and no spaces", () => {
    expect(joinAnalyticsMultiValue(["bitcoin", "ethereum"])).toBe("bitcoin,ethereum");
  });

  // @rule R4: a stable canonical order, so one selection is one value. Without the sort,
  // {bitcoin, equities} and {equities, bitcoin} are two GA4 rows and the cardinality of the
  // dimension doubles for every additional chip.
  it("[R4] sorts, so click order does not fork the value", () => {
    expect(joinAnalyticsMultiValue(["ethereum", "bitcoin"])).toBe(
      joinAnalyticsMultiValue(["bitcoin", "ethereum"]),
    );
    expect(joinAnalyticsMultiValue(["meme", "altcoins", "bitcoin"])).toBe("altcoins,bitcoin,meme");
  });

  it("[R4] does not mutate the caller's array", () => {
    const selection = ["ethereum", "bitcoin"];
    joinAnalyticsMultiValue(selection);
    expect(selection).toEqual(["ethereum", "bitcoin"]);
  });

  // @rule R2: an empty selection is a meaningful "filter cleared" signal, not an absence of data.
  // An empty STRING would be reported by GA4 as `(not set)`, which is indistinguishable from the
  // param never having been sent — exactly the absence [R2] refuses. Hence an explicit sentinel.
  it("[R2] spells the empty set with an explicit sentinel, never an empty string", () => {
    expect(joinAnalyticsMultiValue([])).toBe(ANALYTICS_MULTI_VALUE_EMPTY);
    expect(joinAnalyticsMultiValue([])).not.toBe("");
  });

  it("[R2] the sentinel can never collide with a joined selection", () => {
    // No canonical identifier is the sentinel, so a non-empty join never produces it.
    expect(joinAnalyticsMultiValue(["bitcoin"])).not.toBe(ANALYTICS_MULTI_VALUE_EMPTY);
  });

  // @rule R6: "check GA4's per-event parameter limits before committing to an encoding". A GA4 text
  // parameter value is capped at 100 characters and is TRUNCATED past it, which would silently
  // corrupt the widest selection into a distinct, wrong value. The whole tag set must fit, read
  // from `assetTagSchema` so an eighth tag widens this guard instead of slipping past it.
  it("[R6] the widest possible selection fits inside GA4's 100-character value limit", () => {
    const everyTag = [...assetTagSchema.options];
    expect(joinAnalyticsMultiValue(everyTag).length).toBeLessThanOrEqual(100);
  });
});
