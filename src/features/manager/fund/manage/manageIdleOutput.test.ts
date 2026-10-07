/**
 * @id PP-MGR-LIB-066 (POO-2275)
 * @name manageIdleOutput tests
 * @implements-rules-version v1
 * @analytics-events none, pure projection tests.
 */
import { describe, expect, it } from "vitest";
import {
  type IdleQueueAmounts,
  type ManageIdleOutputOrigin,
  type ManageIdleOutputRead,
  projectManageIdleOutput,
} from "./manageIdleOutput";

const token = {
  chainId: 42161,
  address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  symbol: "USDC",
  decimals: 6,
};
const origin: ManageIdleOutputOrigin = { core: `0x${"a".repeat(40)}`, hubChainId: 42161, token };
function amounts(
  requested: string | null = "25000000000",
  reserved: string | null = "10000000000",
  stillNeeded: string | null = "15000000000",
  cohortId = "queue-eligible",
): IdleQueueAmounts {
  const quantity = (raw: string | null) => (raw === null ? null : { raw, cohortId });
  return {
    cohortId,
    requested: quantity(requested),
    reserved: quantity(reserved),
    stillNeeded: quantity(stillNeeded),
  };
}
function read(): ManageIdleOutputRead {
  return {
    core: origin.core,
    hubChainId: 42161,
    status: "ready",
    snapshot: {
      token,
      asOf: "2026-10-07T09:00:00Z",
      timezone: "UTC",
      freshness: "fresh",
      complete: true,
      confirmedEmpty: false,
      summary: amounts(),
      buckets: [
        {
          id: "today",
          date: "2026-10-07",
          relation: "today",
          deadlines: ["2026-10-07T18:00:00Z"],
          requestStates: ["pending"],
          amounts: amounts("12000000000", "10000000000", "2000000000", "today-cohort"),
        },
      ],
    },
  };
}
function snapshot() {
  const value = read();
  if (!value.snapshot) throw new Error("missing fixture");
  return value.snapshot;
}
function firstBucket() {
  const value = snapshot().buckets[0];
  if (!value) throw new Error("missing bucket");
  return value;
}
describe("POO-2275 injected withdrawal queue", () => {
  // @rule R1: snapshot supplies date/deadline/timezone and cohort quantities.
  it("projects supplied summary and bucket quantities independently", () => {
    const view = projectManageIdleOutput(origin, read());
    expect(view.status).toBe("ready");
    expect(view.summary).toMatchObject({
      requested: "25000",
      reserved: "10000",
      stillNeeded: "15000",
      coverage: "40",
      barPercentage: 40,
    });
    expect(view.buckets[0]).toMatchObject({
      date: "2026-10-07",
      deadlines: ["2026-10-07T18:00:00Z"],
      amounts: { requested: "12000", reserved: "10000", stillNeeded: "2000" },
    });
    expect(view.asOf).toBe("2026-10-07T09:00:00Z");
    expect(view.timezone).toBe("UTC");
  });
  // @rule R2: no missing read falls back to any fixture.
  it.each([
    "loading",
    "error",
    "unavailable",
  ] as const)("preserves %s and hides cached monetary fields", (status) => {
    expect(projectManageIdleOutput(origin, { ...read(), status })).toMatchObject({
      status,
      summary: null,
      buckets: [],
    });
  });
  // @rule R4: freshness is supplied, never inferred from the browser clock.
  it.each([
    "stale",
    "unknown",
  ] as const)("keeps %s freshness distinct without publishing cached totals", (freshness) => {
    expect(
      projectManageIdleOutput(origin, { ...read(), snapshot: { ...snapshot(), freshness } }),
    ).toMatchObject({
      status: freshness,
      summary: null,
      buckets: [],
    });
  });
  // @rule R4: empty requires explicit complete confirmation.
  it("accepts confirmed empty without fabricating zero totals", () => {
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: { ...snapshot(), confirmedEmpty: true, summary: null, buckets: [] },
    });
    expect(view).toMatchObject({ status: "empty", summary: null, buckets: [] });
  });
  it("does not call incomplete or absent buckets confirmed empty", () => {
    expect(
      projectManageIdleOutput(origin, {
        ...read(),
        snapshot: {
          ...snapshot(),
          complete: false,
          confirmedEmpty: true,
          summary: null,
          buckets: [],
        },
      }).status,
    ).toBe("partial");
    expect(projectManageIdleOutput(origin, { ...read(), snapshot: null }).status).toBe(
      "unavailable",
    );
  });
  // @rule R3: no frontend reserve allocation or subtotal calculation.
  it("does not add bucket quantities into the supplied summary", () => {
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: {
        ...snapshot(),
        summary: amounts("99000000", "11000000", "88000000"),
        complete: false,
      },
    });
    expect(view).toMatchObject({
      status: "partial",
      summaryIsSubtotal: true,
      summary: { requested: "99", reserved: "11", stillNeeded: "88" },
    });
  });
  it("preserves known partial amounts and does not infer still needed", () => {
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: { ...snapshot(), summary: amounts("25000000000", null, null) },
    });
    expect(view).toMatchObject({
      status: "partial",
      summary: { requested: "25000", reserved: null, stillNeeded: null, coverage: null },
    });
  });
  it("does not divide or invent a percentage when requested is confirmed zero", () => {
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: { ...snapshot(), summary: amounts("0", "0", "0") },
    });
    expect(view.summary).toMatchObject({
      requested: "0",
      reserved: "0",
      stillNeeded: "0",
      coverage: null,
      barPercentage: null,
    });
    expect(view.status).toBe("ready");
  });
  it("retains excess reserve without inventing a negative still-needed amount", () => {
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: { ...snapshot(), summary: amounts("1000000", "2000000", "0") },
    });
    expect(view.summary).toMatchObject({
      requested: "1",
      reserved: "2",
      stillNeeded: "0",
      coverage: "200",
      barPercentage: 100,
    });
  });
  // @rule R3/R5: a quantity must identify the same cohort as the group.
  it("rejects a reserved quantity from another cohort without erasing requested", () => {
    const summary = { ...amounts(), reserved: { raw: "10000000000", cohortId: "other" } };
    expect(
      projectManageIdleOutput(origin, { ...read(), snapshot: { ...snapshot(), summary } }),
    ).toMatchObject({
      status: "partial",
      summary: { requested: "25000", reserved: null, coverage: null },
    });
  });
  // @rule R4: preserve all groups, multiple deadlines and supplied request states.
  it("keeps overdue, later, same-day multiple deadlines and request states in source order", () => {
    const buckets = [
      {
        ...firstBucket(),
        id: "overdue",
        date: "2026-10-06",
        relation: "overdue" as const,
        deadlines: ["2026-10-06T12:00:00Z", "2026-10-06T18:00:00Z"],
        requestStates: ["partiallyPaid", "canceled", "inFlight"] as const,
      },
      { ...firstBucket(), id: "later", date: "2026-10-21", relation: "later" as const },
    ];
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: {
        ...snapshot(),
        buckets: buckets.map((bucket) => ({ ...bucket, requestStates: [...bucket.requestStates] })),
      },
    });
    expect(view.buckets.map((bucket) => bucket.id)).toEqual(["overdue", "later"]);
    expect(view.buckets[0]?.deadlines).toHaveLength(2);
    expect(view.buckets[0]?.requestStates).toEqual(["partiallyPaid", "canceled", "inFlight"]);
  });
  it("preserves rollover relation and timezone from the next snapshot", () => {
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: {
        ...snapshot(),
        asOf: "2026-10-08T00:10:00+09:00",
        timezone: "Asia/Tokyo",
        buckets: [{ ...firstBucket(), relation: "overdue" }],
      },
    });
    expect(view).toMatchObject({ asOf: "2026-10-08T00:10:00+09:00", timezone: "Asia/Tokyo" });
    expect(view.buckets[0]?.relation).toBe("overdue");
  });
  // @rule R5: verified origin/hub token identity precedes quantities.
  it.each([
    { ...origin, core: "bad" },
    { ...origin, hubChainId: 8453 },
    { ...origin, token: { ...token, decimals: 18 } },
    { ...origin, token: { ...token, address: null } },
  ])("fails closed on identity/metadata mismatch", (invalid) => {
    expect(projectManageIdleOutput(invalid, read())).toMatchObject({
      status: "unavailable",
      summary: null,
      buckets: [],
    });
  });
  it.each([
    "-1",
    "1e6",
    "NaN",
    "",
    "1".repeat(79),
    String(BigInt(2) ** BigInt(256)),
  ])("does not turn invalid raw %s into zero", (raw) => {
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: { ...snapshot(), summary: amounts(raw, "0", "0") },
    });
    expect(view).toMatchObject({
      status: "partial",
      summary: { requested: null, reserved: "0", stillNeeded: "0", coverage: null },
    });
  });
  it("preserves quantities above JS safe integer and ultra-small units exactly", () => {
    const large = "900719925474099312345678";
    expect(
      projectManageIdleOutput(origin, {
        ...read(),
        snapshot: { ...snapshot(), summary: amounts(large, "1", "0") },
      }).summary,
    ).toMatchObject({
      requested: "900719925474099312.345678",
      reserved: "0.000001",
      stillNeeded: "0",
    });
  });
  it("does not round a nonzero coverage ratio to zero or scientific notation", () => {
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: { ...snapshot(), summary: amounts("900719925474099312345678", "1", "0") },
    });
    expect(view.summary?.coverage).not.toBe("0");
    expect(view.summary?.coverage).not.toContain("e");
  });
  it("keeps invalid calendar dates or deadlines partial rather than normalizing them", () => {
    const view = projectManageIdleOutput(origin, {
      ...read(),
      snapshot: {
        ...snapshot(),
        buckets: [{ ...firstBucket(), date: "2026-02-31", deadlines: ["bad"] }],
      },
    });
    expect(view.status).toBe("partial");
    expect(view.buckets[0]).toMatchObject({ date: null, deadlines: [] });
  });
  it("does not publish monetary values without asOf/timezone provenance", () => {
    expect(
      projectManageIdleOutput(origin, {
        ...read(),
        snapshot: { ...snapshot(), asOf: null, timezone: null },
      }),
    ).toMatchObject({ status: "unavailable", summary: null, buckets: [] });
  });
});

// @rule R4: a deadline must not silently roll into another date.
it("rejects a 24-hour deadline instead of converting it to tomorrow", () => {
  const value = read();
  const view = projectManageIdleOutput(origin, {
    ...value,
    snapshot: {
      ...snapshot(),
      buckets: [{ ...firstBucket(), deadlines: ["2026-10-07T24:00:00Z"] }],
    },
  });
  expect(view.status).toBe("partial");
  expect(view.buckets[0]?.deadlines).toEqual([]);
});

// @rule R4: duplicate bucket identity cannot identify reliable groups across refreshes.
it("keeps independent summary but suppresses buckets with duplicated identities", () => {
  const value = read();
  const view = projectManageIdleOutput(origin, {
    ...value,
    snapshot: { ...snapshot(), buckets: [firstBucket(), { ...firstBucket(), relation: "later" }] },
  });
  expect(view).toMatchObject({ status: "partial", summary: { requested: "25000" }, buckets: [] });
});
