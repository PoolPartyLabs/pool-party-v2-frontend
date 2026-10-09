/**
 * @id PP-MGR-LIB-044 (POO-2177)
 * @name FundLaunchContracts
 * @implements-rules-version v1
 */
import type { MandateDraft } from "../mandateDraft";
import type { LaunchJournal } from "./journal";
import type { CanvasPlan, ExecutionConfig, LaunchStep } from "./plan";
import type { ReviewDraft } from "./review";

// Replace the drawing plan instead of intersecting its local descriptor union with execution.
export type FundLaunchDraft = Omit<MandateDraft, "plan"> & {
  plan: CanvasPlan;
  review: ReviewDraft;
  launchExecution?: Record<string, ExecutionConfig>;
};
export interface LaunchStepPreview {
  id: string;
  chainId: 42161 | 4663;
  kind: LaunchStep["kind"];
  label: string;
  signer: "manager-wallet" | "manager-message" | "server";
  countsAsSignature: boolean;
}
export interface LaunchJourney {
  version: 1;
  journeyId: string;
  draftId: string;
  manager: string;
  createdAt: string;
  draft: FundLaunchDraft;
  journal?: LaunchJournal;
}
export type { ReviewDraft } from "./review";
