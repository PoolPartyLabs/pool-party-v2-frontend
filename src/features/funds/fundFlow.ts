/**
 * @id PP-STR-LIB-030 (POO-2175)
 * @name fundFlow
 * @implements-rules-version v2
 * Cancellable accepted-report state machine and approve/receipt/rebuild flow.
 */
import type { FundBuild, FundView } from "@/lib/api/v2/fundSchemas";
import { reportFreshness } from "./fundModel";
export interface FreshnessPorts {
  read: () => Promise<FundView>;
  start: () => Promise<string>;
  poll: (jobId: string) => Promise<"pending" | "delivered" | "failed">;
  wait: () => Promise<void>;
  active: () => boolean;
  refreshing: () => void;
}
export async function ensureFreshValuation(ports: FreshnessPorts) {
  const fund = await ports.read();
  if (!ports.active()) throw new Error("V2_CANCELED");
  if (
    fund.mandate.spokes.length === 0 ||
    reportFreshness(fund.lastReport?.ageSeconds ?? null, fund.mandate.spokes[0]?.maxReportAge ?? 0)
  )
    return fund;
  ports.refreshing();
  const jobId = await ports.start();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (!ports.active()) throw new Error("V2_CANCELED");
    await ports.wait();
    if (!ports.active()) throw new Error("V2_CANCELED");
    const state = await ports.poll(jobId);
    if (state === "failed") throw new Error("V2_UNAVAILABLE");
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
  if (!build.nextAction) return build;
  await send(build);
  if (!active()) throw new Error("V2_CANCELED");
  const next = await rebuild();
  if (!active()) throw new Error("V2_CANCELED");
  if (next.nextAction) throw new Error("V2_UNAVAILABLE");
  return next;
}
