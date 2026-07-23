/**
 * @id PP-REW-LIB-002 (POO-661, POO-853)
 * @name Referral API schemas
 * @implements-rules-version v1
 *
 * Zod for the deployed pool-party-api referral surface. The read `GET /api/v1/referral/:wallet`
 * (ReferralController.getByWallet -> ReferralService.getByReferrerWallet) returns the referrer record
 * for a wallet: its `code`, its `referees[]`, whether the wallet is itself a referee, and who referred
 * it. The endpoint returns `null` (200 with an empty body) when the wallet has no referral record at
 * all, so the CALLER handles null; the schema pins only the object shape.
 *
 * Only the fields the FE consumes are constrained tightly; timestamps and the `referredBy`/`isReferee`
 * signals are accepted permissively (string OR number, nullish) so a benign backend change never fails
 * the read. Unknown keys are stripped, not rejected.
 *
 * PP-INTEGRATION-POINT: response contract for pool-party-api `GET /referral/:wallet` (POO-584). A
 * richer per-referee projection (display name, invest/earn status, invested USD) needs a backend
 * extension (POO-652) — today `/referral` carries only `wallet` + `createdAt` per referee.
 */
import { z } from "zod";

/**
 * The referred-wallet operation types logged to `POST /api/v1/referral/operation` (POO-853 [R6]).
 * Mirrors the backend enum: an investor's add-liquidity, fee-collect, and remove-liquidity txs.
 */
export const REFERRAL_OPERATIONS = ["ADD_LIQUIDITY", "COLLECT_FEES", "REMOVE_LIQUIDITY"] as const;
export type ReferralOperation = (typeof REFERRAL_OPERATIONS)[number];

/** A loose timestamp: ISO string or epoch number, optional/nullable. Not consumed by the FE today. */
const looseTimestamp = z.union([z.string(), z.number()]).nullish();

/** One referred wallet as returned by pp-api `GET /referral/:wallet`. */
export const apiRefereeSchema = z.object({
  /** The referee's wallet address. */
  wallet: z.string(),
  /** When the referee was recorded. */
  createdAt: looseTimestamp,
});
export type ApiReferee = z.infer<typeof apiRefereeSchema>;

/** The pp-api referral read shape. `null` (handled by the caller) when the wallet has no record. */
export const apiReferralSchema = z.object({
  /** The queried wallet (echoed back). */
  wallet: z.string().nullish(),
  /** The referrer code, or `""` when the wallet is not a referrer. */
  code: z.string().nullish(),
  /** The wallets this referrer has referred. */
  referees: z.array(apiRefereeSchema).nullish(),
  /** Whether the queried wallet was itself used as a referee. */
  isReferee: z.boolean().nullish(),
  /** Who referred the queried wallet, when it is a referee. */
  referredBy: z
    .object({
      wallet: z.string().nullish(),
      code: z.string().nullish(),
      referredAt: looseTimestamp,
    })
    .nullish(),
  /** When the referrer record was created. */
  createdAt: looseTimestamp,
});
export type ApiReferral = z.infer<typeof apiReferralSchema>;
