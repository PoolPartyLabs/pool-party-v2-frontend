/**
 * @id PP-MGR-LIB-066 (POO-2275)
 * @name manageIdleOutput
 * @implements-rules-version v1
 * @analytics-events none, pure injected queue projection; mounted host owns events.
 * Presentation contract only. POO-2230 must confirm the real queue DTO before wiring.
 */
import Decimal from "decimal.js";
import { formatUnits } from "viem";
import type { ManageToken } from "./manageModel";
export type IdleOutputToken = Pick<ManageToken, "chainId" | "address" | "symbol" | "decimals">;
export interface ManageIdleOutputOrigin {
  core: string;
  hubChainId: number;
  token: IdleOutputToken;
}
export interface IdleQueueQuantity {
  raw: string;
  cohortId: string;
}
export interface IdleQueueAmounts {
  cohortId: string;
  requested: IdleQueueQuantity | null;
  reserved: IdleQueueQuantity | null;
  stillNeeded: IdleQueueQuantity | null;
}
export type IdleQueueRelation = "today" | "tomorrow" | "dayAfterTomorrow" | "overdue" | "later";
export type IdleQueueRequestState = "pending" | "partiallyPaid" | "canceled" | "inFlight";
export interface IdleQueueBucket {
  id: string;
  date: string | null;
  relation: IdleQueueRelation;
  deadlines: string[];
  requestStates: IdleQueueRequestState[];
  amounts: IdleQueueAmounts;
}
export interface ManageIdleOutputSnapshot {
  token: IdleOutputToken;
  asOf: string | null;
  timezone: string | null;
  freshness: "fresh" | "stale" | "unknown";
  complete: boolean;
  confirmedEmpty: boolean;
  summary: IdleQueueAmounts | null;
  buckets: IdleQueueBucket[];
}
export interface ManageIdleOutputRead {
  core: string;
  hubChainId: number;
  status: "loading" | "ready" | "error" | "unavailable";
  snapshot: ManageIdleOutputSnapshot | null;
}
export interface IdleOutputAmountsView {
  cohortId: string;
  requested: string | null;
  reserved: string | null;
  stillNeeded: string | null;
  coverage: string | null;
  barPercentage: number | null;
}
export interface IdleOutputBucketView extends Omit<IdleQueueBucket, "amounts"> {
  amounts: IdleOutputAmountsView;
}
export interface ManageIdleOutputView {
  status: "loading" | "ready" | "empty" | "partial" | "error" | "unavailable" | "stale" | "unknown";
  reason?: "identity" | "metadata" | "missing";
  token: IdleOutputToken | null;
  asOf: string | null;
  timezone: string | null;
  summary: IdleOutputAmountsView | null;
  summaryIsSubtotal: boolean;
  buckets: IdleOutputBucketView[];
}
/** Validate identity and source provenance before exposing independent queue fields. */
export function projectManageIdleOutput(
  origin: ManageIdleOutputOrigin,
  read: ManageIdleOutputRead,
): ManageIdleOutputView {
  const blank: ManageIdleOutputView = {
    status: "unavailable",
    token: null,
    asOf: null,
    timezone: null,
    summary: null,
    summaryIsSubtotal: false,
    buckets: [],
  };
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(origin.core) ||
    read.core.toLowerCase() !== origin.core.toLowerCase() ||
    origin.hubChainId !== read.hubChainId
  )
    return { ...blank, reason: "identity" };
  if (!validToken(origin.token, origin.hubChainId)) return { ...blank, reason: "metadata" };
  const identified = { ...blank, token: origin.token };
  if (read.status !== "ready") return { ...identified, status: read.status };
  const snapshot = read.snapshot;
  if (!snapshot) return { ...identified, reason: "missing" };
  if (
    !validToken(snapshot.token, origin.hubChainId) ||
    snapshot.token.address?.toLowerCase() !== origin.token.address?.toLowerCase() ||
    snapshot.token.symbol !== origin.token.symbol ||
    snapshot.token.decimals !== origin.token.decimals
  )
    return { ...blank, reason: "metadata" };
  if (snapshot.freshness !== "fresh") return { ...identified, status: snapshot.freshness };
  if (!validTimestamp(snapshot.asOf) || !validTimezone(snapshot.timezone))
    return { ...identified, reason: "missing" };
  const source = { ...identified, asOf: snapshot.asOf, timezone: snapshot.timezone };
  const summary = snapshot.summary ? projectAmounts(snapshot.summary, origin.token.decimals) : null;
  let partial = !snapshot.complete;
  const buckets = snapshot.buckets.map((bucket): IdleOutputBucketView => {
    const date = validDate(bucket.date) ? bucket.date : null;
    const deadlines = bucket.deadlines.filter(validTimestamp);
    if (!date || deadlines.length !== bucket.deadlines.length) partial = true;
    const amounts = projectAmounts(bucket.amounts, origin.token.decimals);
    if (incomplete(amounts)) partial = true;
    return { ...bucket, date, deadlines, requestStates: [...bucket.requestStates], amounts };
  });
  if (
    snapshot.confirmedEmpty &&
    snapshot.complete &&
    buckets.length === 0 &&
    (!summary ||
      [summary.requested, summary.reserved, summary.stillNeeded].every((value) => value === "0"))
  )
    return { ...source, status: "empty", summary, buckets: [] };
  if (!summary || incomplete(summary)) partial = true;
  return {
    ...source,
    status: partial ? "partial" : "ready",
    summary,
    summaryIsSubtotal: !snapshot.complete,
    buckets,
  };
}
function validToken(token: IdleOutputToken, hubChainId: number): boolean {
  return (
    token.chainId === hubChainId &&
    token.address !== null &&
    /^0x[0-9a-fA-F]{40}$/.test(token.address) &&
    token.symbol.trim().length > 0 &&
    Number.isInteger(token.decimals) &&
    token.decimals >= 0 &&
    token.decimals <= 36
  );
}
function projectAmounts(amounts: IdleQueueAmounts, decimals: number): IdleOutputAmountsView {
  const quantity = (value: IdleQueueQuantity | null): string | null => {
    if (
      !amounts.cohortId.trim() ||
      !value ||
      value.cohortId !== amounts.cohortId ||
      !/^\d{1,78}$/.test(value.raw) ||
      BigInt(value.raw) >= BigInt(2) ** BigInt(256)
    )
      return null;
    return formatUnits(BigInt(value.raw), decimals);
  };
  const requested = quantity(amounts.requested),
    reserved = quantity(amounts.reserved),
    stillNeeded = quantity(amounts.stillNeeded);
  let coverage: string | null = null,
    barPercentage: number | null = null;
  if (requested !== null && reserved !== null && !new Decimal(requested).isZero()) {
    // Ratio only, from this group's authoritative cohort. No reserve assignment or total math.
    const ratio = new Decimal(reserved).div(requested).mul(100);
    coverage = ratio.toSignificantDigits(6).toFixed();
    // Number is strictly a clamped decorative CSS width, never a monetary quantity.
    barPercentage = Decimal.min(ratio, 100).toNumber();
  }
  return { cohortId: amounts.cohortId, requested, reserved, stillNeeded, coverage, barPercentage };
}
function incomplete(value: IdleOutputAmountsView): boolean {
  return value.requested === null || value.reserved === null || value.stillNeeded === null;
}
function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validTimestamp(value: string | null): value is string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !validDate(value.slice(0, 10))
  )
    return false;
  const clock = value.slice(11, 19).split(":").map(Number);
  if ((clock[0] ?? 24) > 23 || (clock[1] ?? 60) > 59 || (clock[2] ?? 60) > 59) return false;
  return Number.isFinite(new Date(value).getTime());
}
function validTimezone(value: string | null): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
