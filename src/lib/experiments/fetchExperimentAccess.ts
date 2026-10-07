/**
 * @id PP-CORE-LIB-123
 * @name fetchExperimentAccess
 * @implements-rules-version v1 (POO-2281)
 * @analytics-events none, an unmounted read seam with no product entry point.
 */
import "server-only";
import { deniedExperimentAccess, type ExperimentAccess } from "./access";

export async function loadSolanaPreviewAccess(): Promise<ExperimentAccess> {
  return deniedExperimentAccess();
}
