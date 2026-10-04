/**
 * @id PP-MGR-LIB-050 (POO-2222)
 * @name launchSubmissionReconciliation
 * @implements-rules-version v1 (POO-2222)
 */
import { decodeEventLog, parseAbi, type TransactionReceipt } from "viem";
import type { LaunchStep } from "./plan";
import { decodeLaunchReceipt } from "./receipt";

const events = parseAbi([
  "event AllocatedToHubSpokeVault(uint256 amount)",
  "event SentToSpoke(bytes32 indexed transitId, uint256 indexed spokeIndex, (uint256 destinationChainId, address bridgeAdapter, address escrow, address inputToken, address outputToken, uint256 amountSent, uint256 amountToArrive, bytes32 bridgeRef, uint64 sentAt, uint32 fillDeadline, uint8 kind, uint8 state) transit, uint256 hubChainId)",
  "event Swapped(address indexed adapter, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 spotOut, uint16 maxLossBps, uint256 minOut)",
  "event PositionOpened(address indexed adapter, bytes32 indexed positionKey, bytes32 indexed poolKey, uint256 used0, uint256 used1)",
  "event SpokeCreated(bytes32 indexed fundId, uint256 indexed chainId, address indexed manager, bytes32 mandateHash, (uint256 chainId, address spokeVault, address uniswapV4Adapter, address aaveV3Adapter, address acrossBridgeAdapter, address uniswapV3SwapAdapter) addresses)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event FundSeeded(address indexed manager, uint256 usdcAmount, uint256 flowFee, uint256 shares)",
]);
function same(left: string | undefined | null, right: string | undefined) {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

export interface SubmissionIdentity {
  vault: string;
  manager: string;
  fromBlock: bigint;
  amount?: string;
  adapter?: string;
  tokenIn?: string;
  tokenOut?: string;
  poolKey?: string;
  fundId?: string;
  mandateHash?: string;
  core?: string;
  spender?: string;
}
export function matchLaunchSubmission(
  step: LaunchStep,
  receipt: TransactionReceipt,
  identity: SubmissionIdentity,
): Record<string, unknown> | null {
  if (
    receipt.status !== "success" ||
    !same(receipt.from, identity.manager) ||
    receipt.blockNumber < identity.fromBlock ||
    !same(receipt.to, identity.vault)
  )
    return null;
  const matches: Record<string, unknown>[] = [];
  for (const log of receipt.logs) {
    if (!same(log.address, step.kind === "create" ? identity.core : identity.vault)) continue;
    try {
      const event = decodeEventLog({ abi: events, data: log.data, topics: log.topics });
      let matched = false;
      if (step.kind === "allocate" && event.eventName === "AllocatedToHubSpokeVault")
        matched = event.args.amount.toString() === identity.amount;
      if (step.kind === "bridge" && event.eventName === "SentToSpoke")
        matched =
          event.args.spokeIndex === BigInt(0) &&
          event.args.hubChainId === BigInt(42161) &&
          event.args.transit.destinationChainId === BigInt(4663) &&
          event.args.transit.kind === 0 &&
          event.args.transit.amountSent.toString() === identity.amount;
      if (step.kind === "swap" && event.eventName === "Swapped")
        matched =
          same(event.args.adapter, identity.adapter) &&
          same(event.args.tokenIn, identity.tokenIn) &&
          same(event.args.tokenOut, identity.tokenOut) &&
          event.args.amountIn.toString() === identity.amount &&
          event.args.amountOut > BigInt(0);
      if (step.kind === "open" && event.eventName === "PositionOpened")
        matched =
          same(event.args.adapter, identity.adapter) &&
          same(event.args.poolKey, identity.poolKey) &&
          (event.args.used0 > BigInt(0) || event.args.used1 > BigInt(0));
      if (step.kind === "spoke" && event.eventName === "SpokeCreated")
        matched =
          event.args.chainId === BigInt(4663) &&
          event.args.addresses.chainId === BigInt(4663) &&
          same(event.args.manager, identity.manager) &&
          same(event.args.fundId, identity.fundId) &&
          same(event.args.mandateHash, identity.mandateHash) &&
          same(event.args.addresses.spokeVault, identity.core);
      if (step.kind === "approve" && event.eventName === "Approval")
        matched =
          same(event.args.owner, identity.manager) &&
          same(event.args.spender, identity.spender) &&
          event.args.value.toString() === identity.amount;
      if (step.kind === "create" && event.eventName === "FundSeeded")
        matched = same(event.args.manager, identity.manager) && event.args.usdcAmount > BigInt(0);
      if (matched) matches.push(decodeLaunchReceipt({ ...receipt, logs: [log] }));
    } catch {}
  }
  return matches.length === 1 ? matches[0]! : null;
}
