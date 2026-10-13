/**
 * @id PP-MGR-ACT-013 (POO-2177)
 * @name v2LaunchAuth
 * @implements-rules-version v1
 * Session and Manager checks shared by the launch server actions (moved out of launchActions.ts for
 * the Solana launch, POO-2262). No secrets or upstream errors cross this boundary.
 */
import "server-only";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/features";
import { ApiError } from "../errors";
import { V2DiscoveryPendingError } from "./discovery";
import { launchFetch } from "./launch";
import { versionedRecordSchema } from "./launchSchemas";
import { addressSchema } from "./schemas";

/** Optional structured fields an upstream refusal may carry (never its message). */
export interface LaunchErrorDetail {
  retryAfterSeconds?: number;
  jobId?: string;
  revert?: string;
}

export async function launchResult<ResponseData>(work: () => Promise<ResponseData>) {
  try {
    return { ok: true as const, data: await work() };
  } catch (error) {
    const detail = (error as { detail?: LaunchErrorDetail }).detail;
    return {
      ok: false as const,
      error: {
        status: error instanceof ApiError ? error.status : 400,
        code: error instanceof ApiError ? error.code : "V2_INVALID_REQUEST",
        ...(error instanceof V2DiscoveryPendingError
          ? {
              ...(error.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: error.retryAfterSeconds }
                : {}),
              ...(error.progress ? { progress: error.progress } : {}),
            }
          : {}),
        ...(error instanceof ApiError && detail ? detail : {}),
      },
    };
  }
}

/** The SIWE session wallet, verified against the API's own view of the bearer token. */
export async function launchSession(from?: string): Promise<string> {
  if (!isFeatureEnabled("fundContracts"))
    throw new ApiError(404, "V2_UNAVAILABLE", "not available");
  const wallet = await getSessionWallet();
  if (!wallet || (from && wallet !== from.toLowerCase()))
    throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  const headers = await getAuthHeader();
  if (!headers.Authorization) throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  try {
    const owner = await apiFetch("users/me", {
      headers,
      schema: z.object({ walletAddress: addressSchema }),
    });
    if (!owner || owner.walletAddress.toLowerCase() !== wallet)
      throw new Error("identity mismatch");
  } catch {
    throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  }
  return wallet;
}

/** The session wallet, required to be the Fund's Manager. */
export async function launchManager(core: string): Promise<string> {
  addressSchema.parse(core);
  const wallet = await launchSession();
  const fund = await launchFetch(
    `/funds/${core}`,
    "GET",
    versionedRecordSchema.extend({ manager: addressSchema }),
  );
  if (fund.manager.toLowerCase() !== wallet)
    throw new ApiError(403, "V2_NOT_MANAGER", "not manager");
  return wallet;
}
