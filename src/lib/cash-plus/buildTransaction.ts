/** @id PP-CP-LIB-005 @name Cash+ transaction intents @implements-rules-version v1 */
import { encodeFunctionData, erc20Abi, isAddress } from "viem";
import { cashPlusVaultAbi } from "./abi/CashPlusVault";
import type { CashPlusIntent, CashPlusUnsignedTransaction } from "./types";

export function buildCashPlusTransaction(intent: CashPlusIntent): CashPlusUnsignedTransaction {
  if (
    !isAddress(intent.owner) ||
    !isAddress(intent.vault) ||
    !isAddress(intent.token) ||
    intent.amount <= BigInt("0") ||
    intent.amount >= BigInt("1") << BigInt("256") ||
    intent.minOutput < BigInt("0") ||
    intent.deadline < BigInt("0") ||
    intent.deadline >= BigInt("1") << BigInt("64") ||
    intent.policyVersion <= BigInt("0") ||
    ![31337, 42161].includes(intent.chainId)
  )
    throw new Error("AMOUNT_INVALID");
  let data: CashPlusUnsignedTransaction["data"];
  let to = intent.vault;
  switch (intent.kind) {
    case "approve":
      to = intent.token;
      data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [intent.vault, intent.amount],
      });
      break;
    case "deposit":
      data = encodeFunctionData({
        abi: cashPlusVaultAbi,
        functionName: "deposit",
        args: [intent.amount, intent.minOutput, intent.deadline, intent.policyVersion],
      });
      break;
    case "redeem":
      data = intent.redeemAll
        ? encodeFunctionData({
            abi: cashPlusVaultAbi,
            functionName: "redeemAll",
            args: [intent.minOutput, intent.deadline, intent.policyVersion],
          })
        : encodeFunctionData({
            abi: cashPlusVaultAbi,
            functionName: "redeem",
            args: [intent.amount, intent.minOutput, intent.deadline, intent.policyVersion],
          });
      break;
    case "proportional":
      if (
        intent.minimumComponents.length !== 4 ||
        intent.minimumComponents.some((amount) => amount < BigInt("0"))
      )
        throw new Error("AMOUNT_INVALID");
      data = encodeFunctionData({
        abi: cashPlusVaultAbi,
        functionName: "redeemProportional",
        args: [intent.amount, intent.minimumComponents, intent.deadline],
      });
      break;
    default:
      throw new Error("TX_INTENT_MISMATCH");
  }
  return { chainId: intent.chainId, from: intent.owner, to, value: BigInt("0"), data };
}

export function validateCashPlusTransaction(
  transaction: CashPlusUnsignedTransaction,
  intent: CashPlusIntent,
  now: bigint,
): void {
  if (intent.deadline < now) throw new Error("QUOTE_EXPIRED");
  const expected = buildCashPlusTransaction(intent);
  if (
    transaction.chainId !== expected.chainId ||
    transaction.value !== BigInt("0") ||
    transaction.from.toLowerCase() !== expected.from.toLowerCase() ||
    transaction.to.toLowerCase() !== expected.to.toLowerCase() ||
    transaction.data.toLowerCase() !== expected.data.toLowerCase()
  )
    throw new Error("TX_INTENT_MISMATCH");
}
