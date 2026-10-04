/**
 * @id PP-MGR-LIB-043 (POO-2177)
 * @name launchReceipt
 * @implements-rules-version v1
 * Decode authoritative seed, transit and position identities from mined logs.
 */
import { decodeEventLog, parseAbi, type TransactionReceipt } from "viem";

const events = parseAbi([
  "event FundSeeded(address indexed manager, uint256 usdcAmount, uint256 flowFee, uint256 shares)",
  "event SentToSpoke(bytes32 indexed transitId, uint256 indexed spokeIndex, (uint256 destinationChainId, address bridgeAdapter, address escrow, address inputToken, address outputToken, uint256 amountSent, uint256 amountToArrive, bytes32 bridgeRef, uint64 sentAt, uint32 fillDeadline, uint8 kind, uint8 state) transit, uint256 hubChainId)",
  "event PositionOpened(address indexed adapter, bytes32 indexed positionKey, bytes32 indexed poolKey, uint256 used0, uint256 used1)",
]);
export function decodeLaunchReceipt(receipt: TransactionReceipt): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: events, data: log.data, topics: log.topics });
      if (decoded.eventName === "FundSeeded") {
        const principal = (decoded.args.shares / BigInt("1000000000000000000")) * BigInt("1000000");
        if (principal <= BigInt(0)) throw new Error("INVALID_SEED_RECEIPT");
        result.seeded = {
          core: log.address,
          manager: decoded.args.manager,
          principal: principal.toString(),
          flowFee: decoded.args.flowFee.toString(),
          usdcAmount: decoded.args.usdcAmount.toString(),
          shares: decoded.args.shares.toString(),
        };
      } else if (decoded.eventName === "SentToSpoke") result.transitId = decoded.args.transitId;
      else if (decoded.eventName === "PositionOpened")
        result.positionKey = decoded.args.positionKey;
    } catch {}
  }
  return result;
}
