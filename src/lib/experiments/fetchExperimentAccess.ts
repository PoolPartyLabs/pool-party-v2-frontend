/**
 * @id PP-CORE-LIB-123
 * @name fetchExperimentAccess
 * @implements-rules-version v1 (POO-2281)
 * @analytics-events none, an unmounted read seam with no product entry point.
 */
import "server-only";

import { apiFetch } from "@/lib/api/client";
import { getSessionToken } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/features";
import { isMockMode } from "@/lib/services";
import {
  deniedExperimentAccess,
  type ExperimentAccess,
  experimentAccessSchema,
  resolveExperimentAccess,
} from "./access";

/**
 * No wallet parameter or decoded JWT claim is trusted here. POO-2282's endpoint must verify
 * the Bearer cryptographically and check live cohort membership before returning a grant.
 * Missing endpoint/support denies access. No public-profile or stale-grant fallback.
 */
export async function loadSolanaPreviewAccess(): Promise<ExperimentAccess> {
  if (isMockMode || !isFeatureEnabled("fundContracts") || !isFeatureEnabled("solanaSpoke")) {
    return deniedExperimentAccess();
  }
  try {
    const token = await getSessionToken();
    if (!token) return deniedExperimentAccess();
    // PP-INTEGRATION-POINT: POO-2282, authenticated multi-account experiment grants.
    const response = await apiFetch("experiments/solana-preview/access", {
      schema: experimentAccessSchema,
      headers: { Authorization: `Bearer ${token}` },
      revalidate: 0,
    });
    // Defense in depth if this request's token source changes. Next cookies are request snapshots:
    // a future client host must also discard late results using its session/account generation.
    if ((await getSessionToken()) !== token) return deniedExperimentAccess();
    return resolveExperimentAccess(response);
  } catch {
    // No sensitive upstream error text or session data is exposed through this preview seam.
    return deniedExperimentAccess();
  }
}
