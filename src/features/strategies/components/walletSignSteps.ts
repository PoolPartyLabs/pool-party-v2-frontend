/**
 * @id PP-CORE-MOD-009 (POO-295)
 * @name walletSignSteps
 * @implements-rules-version v1
 *
 * Builds the variable-length wallet-signing step list (POO-295) for a transaction from a declarative
 * spec: one ERC-20 approve per token, an optional Permit2/message signature, then the terminal
 * confirm for the operation. Centralizes the "different number of steps per situation" logic
 * (permit2 · approve · add/remove liquidity · collect · compound …) so each flow declares what it
 * needs instead of hand-rolling the array. Pure + i18n-free: labels are resolved by the consumer
 * (e.g. {@link WalletSignModal}) so this stays trivially testable and reusable.
 */

/** The terminal confirm action of a transaction (its i18n label lives under `strategies.sign.steps`). */
export type WalletConfirmKind =
  | "invest"
  | "addLiquidity"
  | "withdraw"
  | "removeLiquidity"
  | "collect"
  | "compound"
  | "moveRange"
  | "closePosition";

/** Declarative description of what a transaction needs the user to sign in their wallet. */
export interface WalletSignSpec {
  /** Tokens needing an ERC-20 approve, one step each, in order (e.g. ["USDC", "WETH"]). */
  approvals?: string[];
  /** Whether a Permit2 / message signature step is required before the confirm. */
  permit2?: boolean;
  /**
   * Whether a server build/orchestration step runs before the confirm (e.g. create-pool computes mint
   * mins + gas; move-range optimizes + routes). Nothing is signed; it covers real wallet-idle latency.
   */
  build?: boolean;
  /** The terminal confirm action (always produces the final step). */
  confirm: WalletConfirmKind;
}

/** A resolved, i18n-free step descriptor: its kind + the data needed to label it. */
export interface WalletStepDescriptor {
  /** Stable React/integration key. */
  key: string;
  /** Which signing interaction this step is. */
  kind: "approve" | "permit" | "build" | "confirm";
  /** Token symbol for an `approve` step. */
  token?: string;
  /** Confirm action for a `confirm` step. */
  confirm?: WalletConfirmKind;
}

/**
 * Build the ordered signing steps for a transaction: `approve TOKEN` (×N) → `sign permit` →
 * `build` (optional, no signature) → `confirm <operation>`. Always ends with the confirm step, so the
 * minimum is a 1-step transaction.
 */
export function buildWalletSignSteps(spec: WalletSignSpec): WalletStepDescriptor[] {
  const steps: WalletStepDescriptor[] = [];
  for (const token of spec.approvals ?? []) {
    steps.push({ key: `approve:${token}`, kind: "approve", token });
  }
  if (spec.permit2) {
    steps.push({ key: "permit", kind: "permit" });
  }
  if (spec.build) {
    steps.push({ key: "build", kind: "build" });
  }
  steps.push({ key: `confirm:${spec.confirm}`, kind: "confirm", confirm: spec.confirm });
  return steps;
}
