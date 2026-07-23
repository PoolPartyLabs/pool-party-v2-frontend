/**
 * @id PP-STR (POO-453)
 * @name revalidatePositionsAction
 * @implements-rules-version v1
 *
 * Server Action that invalidates the cached positions read for the signed-in wallet. [R2] Call it
 * after a confirmed write (invest / withdraw / collect) so the next read reflects the change instead
 * of waiting out the short `revalidate` window of {@link fetchPositions}. The wallet is derived
 * server-side from the SIWE session (never trusted from the client), so a write busts only that
 * wallet's positions cache. The browser invokes it; `revalidateTag` must run server-side.
 *
 * Mirrors {@link revalidateStrategiesAction}. Cheap (marks the tag stale, no upstream fetch), so it
 * is safe to call before each post-write refetch tick — unlike the catalog revalidate, which storms
 * the backend if re-run per tick (POO-377).
 */
"use server";

import { revalidateTag } from "next/cache";
import { getSessionWallet } from "@/lib/auth/session";
import { positionsTag } from "./fetchPositions";

/** Drop the signed-in wallet's cached positions so the next read re-fetches from pool-party-api. */
export async function revalidatePositionsAction(): Promise<void> {
  const wallet = await getSessionWallet();
  if (!wallet) return;
  revalidateTag(positionsTag(wallet));
}
