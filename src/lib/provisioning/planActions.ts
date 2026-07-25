/**
 * @id PP-CORE-LIB-016 (POO-1024)
 * @name provisioning plan server actions
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The server side of the provisioning planner, and the only place plan computation may touch a
 * secret or the network.
 *
 * Why this file exists. `src/lib/provisioning/index.ts` is imported by `"use client"` components, so
 * everything reachable from it ships to the browser. The real planner (POO-1034) calls the Uniswap
 * Trading API with `UNISWAP_API_KEY`, which is server-only (ADR 0003). Putting the planner directly
 * in `planner.ts` would either break the Next build on the `server-only` import, or, if the key were
 * ever given a `NEXT_PUBLIC_` prefix, silently ship a credential to every browser. Neither
 * `typecheck`, `lint`, `test` nor `i18n:check` catches that; only `pnpm build` does, plus the
 * import-graph guard in `serverBoundary.test.ts`.
 *
 * A `"use server"` module is a boundary rather than an edge: Next compiles it to an RPC stub on the
 * client, so a client component may import it freely and the implementation never reaches the bundle.
 *
 * Following the house action contract (`investActions.ts`): the action never throws across the RSC
 * boundary. It returns `{ ok: true, plan } | { ok: false, code, message }`, so a failure code lands
 * where callers can act on it instead of surfacing as an opaque rejection.
 *
 * PP-INTEGRATION-POINT (POO-1042): the real planner EXISTS — `./buildPlan.ts` (POO-1034) decomposes
 * a requirement into ordered legs and prices each one through `POST /quote`. What is still missing
 * is the assembly in front of it, and it is deliberately not built here:
 *
 *   `ProvisioningNeedInput` is USD-only. It carries no token addresses and no base-unit amounts, so
 *   it cannot drive a real quote. `buildPlan` needs the funding inventory (POO-1031, read
 *   server-side from the SIWE wallet, never from a client-supplied address) and the per-chain gas
 *   verdicts (POO-1032). Assembling those is the live gate's job (POO-1042), which also owns the
 *   selection order this action would otherwise have to invent.
 *
 * Filling this in with a guessed input would produce a plan priced against amounts nobody chose,
 * which is worse than the honest failure below.
 */
"use server";

import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "./types";

/** The action result. Mirrors `BuildTxResult` in `@/lib/tx/actionResult`. */
export type ProvisioningPlanResult =
  | { ok: true; plan: ProvisioningPlan }
  | { ok: false; code: string; message: string };

/**
 * Compute a provisioning plan server-side.
 *
 * Not wired yet: `buildPlan` exists (POO-1034) but the input it needs is assembled by the live gate
 * (POO-1042), see the PP-INTEGRATION-POINT above. Until then this returns a typed failure rather
 * than throwing, so the seam is exercisable end to end and a caller sees a real error contract
 * instead of an unhandled rejection.
 */
export async function computePlanAction(
  _input: ProvisioningNeedInput,
  _gasChoice?: GasChoice,
): Promise<ProvisioningPlanResult> {
  return {
    ok: false,
    code: "PROVISIONING_PLANNER_UNAVAILABLE",
    message: "The provisioning planner is not wired to live balances yet (POO-1042).",
  };
}
