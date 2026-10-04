/**
 * @id PP-STR-LIB-037
 * @name fundDetailsActions
 * @implements-rules-version v1 (POO-2216)
 * PP-INTEGRATION-POINT: independent public fund and verified holder reads
 */
"use server";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { readFund, readHolder } from "@/lib/api/v2/funds";
import { addressSchema } from "@/lib/api/v2/schemas";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/features";
import { isMockMode } from "@/lib/services";
import { mockFund, mockHolder, mockWallet } from "@/mocks/data/v2Funds";
export async function loadPublicFundDetailsAction(core: string) {
  try {
    addressSchema.parse(core);
    if (!isFeatureEnabled("fundContracts")) return { ok: false as const, code: "V2_UNAVAILABLE" };
    const fund = isMockMode
      ? { ...mockFund, coreVault: core as typeof mockFund.coreVault }
      : await readFund(core);
    if (fund.coreVault.toLowerCase() !== core.toLowerCase())
      return { ok: false as const, code: "V2_INVALID_RESPONSE" };
    return { ok: true as const, fund };
  } catch {
    return { ok: false as const, code: "V2_UNAVAILABLE" };
  }
}
export async function loadPersonalFundDetailsAction(core: string) {
  try {
    addressSchema.parse(core);
    if (!isFeatureEnabled("fundContracts"))
      return { ok: false as const, error: { code: "V2_UNAVAILABLE" } };
    const wallet = isMockMode ? mockWallet : await getSessionWallet();
    if (!wallet || !addressSchema.safeParse(wallet).success)
      return { ok: false as const, error: { code: "V2_SESSION" } };
    if (!isMockMode) {
      const owner = await apiFetch("users/me", {
        schema: z.object({ walletAddress: addressSchema }),
        headers: await getAuthHeader(),
      });
      if (owner?.walletAddress.toLowerCase() !== wallet.toLowerCase())
        return { ok: false as const, error: { code: "V2_SESSION" } };
    }
    const holder = isMockMode ? mockHolder : await readHolder(core, wallet);
    return { ok: true as const, data: { holder, wallet } };
  } catch {
    return { ok: false as const, error: { code: "V2_UNAVAILABLE" } };
  }
}
