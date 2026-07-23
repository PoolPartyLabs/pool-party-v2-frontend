/**
 * @id PP-REW (POO-210)
 * @name Rewards write submitters
 * @implements-rules-version v1
 *
 * Server-side POSTs to the analytics indexer for the two Rubber Rush write
 * actions. Each returns a discriminated outcome the UI maps to a state, rather
 * than throwing, so the component does not need to know error codes.
 *
 * PP-INTEGRATION-POINT: Rubber Rush writes (daily quack + duck-shoot play) → analytics indexer.
 */
import "server-only";

import { AnalyticsError, analyticsFetch } from "@/lib/analytics-api/client";
import type { DuckShootResult } from "@/lib/services";
import {
  duckShootPlayResponseSchema,
  grantDuckShootTryResponseSchema,
  quackResponseSchema,
} from "./analyticsSchemas";
import { mapDuckShootResult } from "./mapDuckShootResult";

/** Outcome of a daily Say Quack check-in. */
export type SayQuackOutcome =
  | {
      status: "awarded";
      quacksAwarded: number;
      /** Updated streak after the check-in, when the backend returns it (POO-763 R3). */
      streak?: { days: number; multiplier: number };
    }
  | { status: "already_claimed" }
  | { status: "invalid_signature" }
  | { status: "error" };

/** Outcome of a Duck Shoot play. */
export type DuckShootOutcome =
  | { status: "played"; result: DuckShootResult }
  | { status: "no_tries" }
  | { status: "already_played_recently" }
  | { status: "error" };

/** Outcome of granting a Duck Shoot try for a confirmed protocol transaction (POO-764). */
export type GrantDuckShootTryOutcome =
  | { status: "granted"; triesRemaining: number; weeklyTriesLeft: number }
  | { status: "tx_already_used" }
  | { status: "tx_not_found" }
  | { status: "weekly_cap_reached" }
  | { status: "error" };

/** [R1] POST the signed daily check-in. The message is signed client-side. */
export async function submitDailyQuack(input: {
  wallet: string;
  signature: string;
  date: string;
}): Promise<SayQuackOutcome> {
  try {
    const res = await analyticsFetch("points/quacks/daily", {
      method: "POST",
      body: input,
      schema: quackResponseSchema,
    });
    if (!res) return { status: "error" };
    return { status: "awarded", quacksAwarded: res.pointsAwarded, streak: res.streak };
  } catch (error) {
    if (error instanceof AnalyticsError) {
      if (error.code === "ALREADY_CLAIMED") return { status: "already_claimed" };
      if (error.code === "INVALID_SIGNATURE") return { status: "invalid_signature" };
    }
    return { status: "error" };
  }
}

/** [R3] POST a Duck Shoot play and map the weighted outcome. */
export async function submitDuckShootPlay(wallet: string): Promise<DuckShootOutcome> {
  try {
    const res = await analyticsFetch("points/duck-shoot/play", {
      method: "POST",
      body: { wallet },
      schema: duckShootPlayResponseSchema,
    });
    if (!res) return { status: "error" };
    return { status: "played", result: mapDuckShootResult(res) };
  } catch (error) {
    if (error instanceof AnalyticsError) {
      if (error.code === "NO_TRIES") return { status: "no_tries" };
      if (error.code === "ALREADY_PLAYED_RECENTLY" || error.status === 429) {
        return { status: "already_played_recently" };
      }
    }
    return { status: "error" };
  }
}

/**
 * [R1] Grant one Duck Shoot try for a confirmed protocol transaction. The backend validates the tx
 * belongs to the wallet (`TX_NOT_FOUND_FOR_WALLET` — often just indexer lag, retried client-side),
 * that it was not already used (`TX_ALREADY_USED`), and that the weekly cap is not reached
 * (`WEEKLY_CAP_REACHED`). The tx TYPE is the backend's concern, so the client may call this on any
 * mined hash and let the backend decide eligibility.
 */
export async function submitGrantDuckShootTry(input: {
  wallet: string;
  txHash: string;
}): Promise<GrantDuckShootTryOutcome> {
  try {
    const res = await analyticsFetch("points/duck-shoot/grant-try", {
      method: "POST",
      body: input,
      schema: grantDuckShootTryResponseSchema,
    });
    if (!res) return { status: "error" };
    return {
      status: "granted",
      triesRemaining: res.triesRemaining,
      weeklyTriesLeft: res.weeklyTriesLeft,
    };
  } catch (error) {
    if (error instanceof AnalyticsError) {
      if (error.code === "TX_ALREADY_USED") return { status: "tx_already_used" };
      if (error.code === "TX_NOT_FOUND_FOR_WALLET") return { status: "tx_not_found" };
      if (error.code === "WEEKLY_CAP_REACHED") return { status: "weekly_cap_reached" };
    }
    return { status: "error" };
  }
}
