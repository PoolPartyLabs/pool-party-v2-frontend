/**
 * @id PP-CORE-LIB-122
 * @name experimentAccess
 * @implements-rules-version v1 (POO-2281)
 * @analytics-events none, an unmounted access contract with no product entry point.
 */
import { z } from "zod";

export const SOLANA_PREVIEW_EXPERIMENT = "solana-preview" as const;
const capabilitySchema = z.enum(["preview", "catalog", "execute"]);
export type ExperimentCapability = z.infer<typeof capabilitySchema>;

/**
 * Proposed API contract (POO-2282). Strict objects prevent identity/credential fields from
 * accidentally crossing this seam. A parsed DTO is NOT proof of authentication on the client.
 */
export const experimentAccessSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        schemaVersion: z.literal(1),
        experiment: z.literal(SOLANA_PREVIEW_EXPERIMENT),
        status: z.literal("denied"),
        capabilities: z.tuple([]),
        expiresAt: z.null(),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(1),
        experiment: z.literal(SOLANA_PREVIEW_EXPERIMENT),
        status: z.literal("allowed"),
        capabilities: z.array(capabilitySchema).min(1).max(3),
        expiresAt: z.string().datetime(),
      })
      .strict(),
  ])
  .superRefine((access, context) => {
    if (access.status !== "allowed") return;
    if (
      !access.capabilities.includes("preview") ||
      new Set(access.capabilities).size !== access.capabilities.length
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid experiment capabilities" });
    }
  });

export type ExperimentAccess = z.infer<typeof experimentAccessSchema>;

/** Fresh denial object, with no remembered account or earlier grant. */
export function deniedExperimentAccess(): ExperimentAccess {
  return {
    schemaVersion: 1,
    experiment: SOLANA_PREVIEW_EXPERIMENT,
    status: "denied",
    capabilities: [],
    expiresAt: null,
  };
}

/** Fail closed for drift, denial, invalid clocks or an elapsed grant. */
export function resolveExperimentAccess(value: unknown, now = Date.now()): ExperimentAccess {
  const result = experimentAccessSchema.safeParse(value);
  if (
    !result.success ||
    result.data.status === "denied" ||
    !Number.isFinite(now) ||
    Date.parse(result.data.expiresAt) <= now
  ) {
    return deniedExperimentAccess();
  }
  return result.data;
}

/**
 * A presentation check, never a server authorization substitute. Every later operation must
 * read a fresh server grant; a client can manufacture any object this helper receives.
 */
export function hasExperimentCapability(
  access: unknown,
  capability: ExperimentCapability,
  now = Date.now(),
): boolean {
  const current = resolveExperimentAccess(access, now);
  return current.status === "allowed" && current.capabilities.includes(capability);
}
