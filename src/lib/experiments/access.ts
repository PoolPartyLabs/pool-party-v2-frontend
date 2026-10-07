/**
 * @id PP-CORE-LIB-122
 * @name experimentAccess
 * @implements-rules-version v1 (POO-2281)
 * @analytics-events none, an unmounted access contract with no product entry point.
 */
import { z } from "zod";

export const SOLANA_PREVIEW_EXPERIMENT = "solana-preview" as const;
export type ExperimentCapability = "preview" | "catalog" | "execute";
export type ExperimentAccess =
  | {
      schemaVersion: 1;
      experiment: typeof SOLANA_PREVIEW_EXPERIMENT;
      status: "denied";
      capabilities: ExperimentCapability[];
      expiresAt: null;
    }
  | {
      schemaVersion: 1;
      experiment: typeof SOLANA_PREVIEW_EXPERIMENT;
      status: "allowed";
      capabilities: ExperimentCapability[];
      expiresAt: string;
    };

export const experimentAccessSchema = z.object({}).strict();

export function deniedExperimentAccess(): ExperimentAccess {
  return {
    schemaVersion: 1,
    experiment: SOLANA_PREVIEW_EXPERIMENT,
    status: "denied",
    capabilities: [],
    expiresAt: null,
  };
}

export function resolveExperimentAccess(_value: unknown, _now = Date.now()): ExperimentAccess {
  return deniedExperimentAccess();
}

export function hasExperimentCapability(
  _access: unknown,
  _capability: ExperimentCapability,
  _now = Date.now(),
): boolean {
  return false;
}
