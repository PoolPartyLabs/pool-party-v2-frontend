/**
 * @id PP-STR-LIB-030 (POO-2175)
 * @name fundFlow
 * @implements-rules-version v2 (POO-2175); v1 (POO-2179 explorer records); v1 (POO-2262 v6 report gate)
 * Cancellable accepted-report state machine and approve/receipt/rebuild flow.
 *
 * POO-2262 (API contract §3.9): a v6 Fund (Hub + Robinhood + Solana) gates a deposit, payout
 * request or claim on `reportsUsable`. While it is false the flow asks for a fresh Solana report
 * when the Solana spoke is the stale one (keeper-paid, never the admin report route) and polls the
 * detail; a stale Robinhood report is refreshed by the keeper on its own cycle, so it only polls.
 * A builder's 409 report wait is retried after its hint. An EVM-only Fund keeps the single-report gate.
 */
import { type FundBuild, type FundView, reportWaitCodes } from "@/lib/api/v2/fundSchemas";
import { reportFreshness, v6ReportGate } from "./fundModel";
/** Default and bounds of one report wait, in seconds, and the total a flow waits (§3.9). */
export const REPORT_POLL_SECONDS = 15;
export const REPORT_WAIT_LIMIT_SECONDS = 600;
export function reportWaitSeconds(hint: number | null | undefined): number {
  return typeof hint === "number" && Number.isFinite(hint)
    ? Math.min(Math.max(Math.ceil(hint), 5), 60)
    : REPORT_POLL_SECONDS;
}
export interface FreshnessPorts {
  read: () => Promise<FundView>;
  start: () => Promise<string>;
  poll: (jobId: string) => Promise<"pending" | "delivered" | "expired" | "failed">;
  wait: (seconds: number) => Promise<void>;
  active: () => boolean;
  refreshing: () => void;
  /** v6: `POST .../solana/reports/fresh`; resolves the API's retry hint (null when it has none). */
  refreshSolana?: () => Promise<number | null>;
}
async function awaitUsableReports(first: FundView, ports: FreshnessPorts): Promise<FundView> {
  let fund = first;
  let waited = 0;
  for (;;) {
    const gate = v6ReportGate(fund);
    if (!gate || gate.usable) return fund;
    if (waited >= REPORT_WAIT_LIMIT_SECONDS) throw new Error("SPOKE_REPORT_STALE");
    ports.refreshing();
    let seconds = REPORT_POLL_SECONDS;
    if (gate.solanaUsable !== true && ports.refreshSolana) {
      seconds = reportWaitSeconds(await ports.refreshSolana());
      if (!ports.active()) throw new Error("V2_CANCELED");
    }
    await ports.wait(seconds);
    waited += seconds;
    if (!ports.active()) throw new Error("V2_CANCELED");
    fund = await ports.read();
    if (!ports.active()) throw new Error("V2_CANCELED");
  }
}
export async function ensureFreshValuation(ports: FreshnessPorts) {
  const fund = await ports.read();
  if (!ports.active()) throw new Error("V2_CANCELED");
  if (v6ReportGate(fund)) return awaitUsableReports(fund, ports);
  if (
    fund.mandate.spokes.length === 0 ||
    reportFreshness(fund.lastReport?.ageSeconds ?? null, fund.mandate.spokes[0]?.maxReportAge ?? 0)
  )
    return fund;
  ports.refreshing();
  const jobId = await ports.start();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (!ports.active()) throw new Error("V2_CANCELED");
    await ports.wait(REPORT_POLL_SECONDS);
    if (!ports.active()) throw new Error("V2_CANCELED");
    const state = await ports.poll(jobId);
    if (!ports.active()) throw new Error("V2_CANCELED");
    if (state === "failed" || state === "expired") throw new Error("V2_UNAVAILABLE");
    if (state === "delivered") {
      const refreshed = await ports.read();
      if (!ports.active()) throw new Error("V2_CANCELED");
      if (
        reportFreshness(
          refreshed.lastReport?.ageSeconds ?? null,
          refreshed.mandate.spokes[0]?.maxReportAge ?? 0,
        )
      )
        return refreshed;
      throw new Error("StaleSpokeReport");
    }
  }
  throw new Error("V2_UNAVAILABLE");
}
export async function approveAndRebuild(
  build: FundBuild,
  send: (build: FundBuild) => Promise<void>,
  rebuild: () => Promise<FundBuild>,
  active: () => boolean,
) {
  if (!active()) throw new Error("V2_CANCELED");
  if (!build.nextAction) return build;
  await send(build);
  if (!active()) throw new Error("V2_CANCELED");
  const next = await rebuild();
  if (!active()) throw new Error("V2_CANCELED");
  if (next.nextAction) throw new Error("V2_UNAVAILABLE");
  return next;
}
type ActionReply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; retryAfterSeconds?: number } };
/**
 * Runs a build, and while it answers a §3.9 report wait (409 `SOLANA_REPORT_REFRESHING` /
 * `SPOKE_REPORT_STALE`) waits the API's hint and runs it again, at most ~10 minutes in all. Any
 * other refusal throws its stable code, as before.
 */
export async function retryReportWaits<T>(
  attempt: () => Promise<ActionReply<T>>,
  ports: Pick<FreshnessPorts, "wait" | "active" | "refreshing">,
): Promise<T> {
  let waited = 0;
  for (;;) {
    const reply = await attempt();
    if (!ports.active()) throw new Error("V2_CANCELED");
    if (reply.ok) return reply.data;
    const code = reply.error.code;
    if (
      !(reportWaitCodes as readonly string[]).includes(code) ||
      waited >= REPORT_WAIT_LIMIT_SECONDS
    )
      throw new Error(code);
    ports.refreshing();
    const seconds = reportWaitSeconds(reply.error.retryAfterSeconds);
    await ports.wait(seconds);
    waited += seconds;
    if (!ports.active()) throw new Error("V2_CANCELED");
  }
}
type RefreshReply =
  | { ok: true; data: { retryAfterSeconds: number | null } }
  | { ok: false; error: { status: number; code: string; retryAfterSeconds?: number } };
/** The `refreshSolana` port over the server action: a throttle or a hinted refusal is one more wait. */
export function solanaRefreshPort(refresh: () => Promise<RefreshReply>) {
  return async (): Promise<number | null> => {
    const reply = await refresh();
    if (reply.ok) return reply.data.retryAfterSeconds;
    if (reply.error.status === 429 || reply.error.retryAfterSeconds !== undefined)
      return reply.error.retryAfterSeconds ?? null;
    throw new Error(reply.error.code);
  };
}
