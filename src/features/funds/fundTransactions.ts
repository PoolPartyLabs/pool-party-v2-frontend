/**
 * @id PP-STR-LIB-032 (POO-2179)
 * @name fundTransactions
 * @implements-rules-version v1
 * PP-INTEGRATION-POINT: chain-checked broadcast, receipt observation and safe contract-error decoding.
 */
import { decodeErrorResult, erc20Abi, type Hex, parseAbi } from "viem";
import type { FundBuild } from "@/lib/api/v2/fundSchemas";
import {
  type Eip1193Provider,
  sendBuiltTransaction,
  waitForReceipt,
} from "@/lib/tx/sendTransaction";
import { withTimeout } from "@/lib/utils/withTimeout";
import { fundErrorKey } from "./fundModel";

const errors = parseAbi([
  "error AlreadySeeded()",
  "error BalanceChangeMismatch(uint256 expected, uint256 actual)",
  "error BelowMinFirstDeposit(uint256 amount, uint256 minFirstDeposit)",
  "error BpsAboveMax(uint256 bps, uint256 maxBps)",
  "error BpsBelowMin(uint256 bps, uint256 minBps)",
  "error BridgeAdapterCodehashMismatch(address bridgeAdapter)",
  "error BridgeAdapterSideInvalid(uint256 spokeChainId, uint256 chainId)",
  "error BridgeAdapterUnavailable(address bridgeAdapter)",
  "error BridgeCallMismatch(address bridgeAdapter)",
  "error BridgeTargetUnset(address bridgeAdapter)",
  "error ClosingDeadlineNotReached(uint256 deadline)",
  "error ClosureNotReady()",
  "error DepositBelowOneShare(uint256 usdcNet, uint256 sharePrice)",
  "error DuplicateAdapter(uint256 chainId, address adapter)",
  "error DuplicateOperatingCashChain(uint256 chainId)",
  "error DuplicatePool(uint256 chainId, address adapter, bytes32 poolKey)",
  "error DuplicateSpoke(uint256 chainId, uint16 wormholeChainId)",
  "error DuplicateToken(uint256 chainId, address token)",
  "error EmptyAdapters()",
  "error EmptyPools()",
  "error ExpiryNotProvable(bytes32 transitId)",
  "error FillDeadlineNotReached(bytes32 transitId, uint32 fillDeadline)",
  "error FlowFeeAboveCap(uint16 bps)",
  "error FlowFeeAboveCap(uint256 bps)",
  "error FundNotClosed(uint8 state)",
  "error FundNotClosing(uint8 state)",
  "error FundNotOpen(uint8 state)",
  "error FundNotSeeded()",
  "error HubWormholeChainIdMismatch(uint16 coreChainId, uint16 hubWormholeChainId)",
  "error IncomeCollectionPending(uint64 round)",
  "error InsufficientFreeIdle(uint256 requested, uint256 available)",
  "error InvalidSpoke(uint256 chainId)",
  "error InvalidTransitState(bytes32 transitId, uint8 state)",
  "error ManagerFeeBelowMinimum(uint16 bps, uint16 minBps)",
  "error ManagerFeeNotDecreasing()",
  "error ManagerMustCloseFund(uint256 peakShares, uint256 balanceAfter)",
  "error MessageFeeNotUsed(uint256 value)",
  "error MissingBaseToken(uint256 chainId, address token)",
  "error MissingBridgeAdapter(uint256 spokeChainId, uint256 chainId)",
  "error MissingSwapAdapter(uint256 chainId)",
  "error NoIncomeWithdrawalRequest(address shareholder)",
  "error NoOpenPayoutRequest(address shareholder)",
  "error NoRefund(bytes32 transitId)",
  "error NoShares(address shareholder)",
  "error NotAcrossSpokePool(address caller)",
  "error NotFactory(address caller)",
  "error NotHubSpokeVault(address caller)",
  "error NotManager(address caller)",
  "error NotOnHubChain(uint256 chainId, uint256 hubChainId)",
  "error NotReportReceiver(address caller)",
  "error NotWholeShares(uint256 shares)",
  "error NothingToRecover(bytes32 transitId)",
  "error OperatingCashNotSupported()",
  "error PayoutAwaitingSettlement(address shareholder)",
  "error PayoutBelowOneShare(uint256 usdcAmount, uint256 sharePrice)",
  "error PayoutMessageFeeNotUsed(uint256 amount)",
  "error PayoutRequestAlreadyOpen(address shareholder)",
  "error PayoutTermNotEnded(uint64 termEndsAt)",
  "error PoolAdapterNotListed(uint256 chainId, address adapter)",
  "error RecoveryNotReady(bytes32 transitId, uint256 builtAfter)",
  "error ReentrancyGuardReentrantCall()",
  "error SafeERC20FailedOperation(address token)",
  "error SharePriceBelowOneUnit(uint256 sharePrice)",
  "error SharesBelowMinimum(uint256 shares, uint256 minShares)",
  "error SpokeCapExceeded(uint256 spokeIndex, uint256 used, uint256 amount, uint256 spokeCap)",
  "error SpokeIsHubChain(uint256 chainId)",
  "error SpokeNotReporting(uint256 spokeIndex)",
  "error SpokeUnwindNotCredited(uint256 spokeIndex, bytes32 transitId)",
  "error SpokeUnwindNotReported(uint256 spokeIndex)",
  "error StalePrice(address token, uint256 updatedAt)",
  "error StaleSpokeReport(uint256 spokeIndex)",
  "error TokenNotPriced(uint256 chainId, address token)",
  "error TooManyTokens(uint256 count, uint256 maxTokens)",
  "error UnbackedCredit(address token, uint256 amount, uint256 unledgered)",
  "error UnexpectedToken(address token)",
  "error UnknownChain(uint256 chainId)",
  "error UnknownIncomeSource(uint256 source)",
  "error UnknownSpoke(uint256 spokeIndex)",
  "error UnknownSpokeChain(uint256 spokeChainId)",
  "error UnknownTransit(bytes32 transitId)",
  "error UnsupportedTransitMessageVersion(uint256 version)",
  "error UsdcMismatch(address configured, address mandateUsdc)",
  "error WrongFund(bytes32 fundId)",
  "error WrongMandate(bytes32 mandateHash)",
  "error ZeroAdapter()",
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error ZeroHubChainId()",
  "error ZeroHubWormholeChainId()",
  "error ZeroManager()",
  "error ZeroSharePrice()",
  "error ZeroToken()",
  "error ZeroUsdc()",
  "error BpsAboveMax(uint256 bps)",
  "error CollectionLengthMismatch()",
  "error FailedDeployment()",
  "error HolderNotSettled(address holder)",
  "error IncomeTokenAlreadyAdded(address token)",
  "error IncomeTokenListFull()",
  "error IncomeTokenZero()",
  "error InconsistentCollection(address token)",
  "error InsufficientBalance(uint256 balance, uint256 needed)",
  "error InvalidOrderFraction(uint256 fracNum, uint256 fracDen)",
  "error InvalidPayoutMode(uint8 payoutMode)",
  "error SafeCastOverflowedIntDowncast(uint8 bits, int256 value)",
  "error SafeCastOverflowedUintToInt(uint256 value)",
  "error UnknownOrderKind(uint8 kind)",
  "error AdapterCodehashMismatch(address adapter, bytes32 expected, bytes32 actual)",
  "error AdapterHasNoCode(address adapter)",
  "error AdapterNotInMandate(address adapter)",
  "error AdapterUsedAboveInput(address adapter, address token, uint256 sent, uint256 used)",
  "error BaseTokenMismatch(address baseToken, address expected)",
  "error BridgeFeeAboveMax(uint256 fee, uint256 maxFee)",
  "error IncomeSentOnlyByCollection()",
  "error InsufficientCollectedIncome(address token, uint256 available, uint256 requested)",
  "error InsufficientUnallocatedBalance(address token, uint256 available, uint256 requested)",
  "error LedgerExceedsBalance(address token, uint256 balance, uint256 ledger)",
  "error NotCoreVault(address caller)",
  "error NotOnHubChain()",
  "error NotOnSpokeChain()",
  "error OpenPositionLimit(uint256 limit)",
  "error OrderKindNotSupported(uint8 kind)",
  "error PoolNotInMandate(address adapter, bytes32 poolKey)",
  "error PoolTokenNotInMandate(address adapter, bytes32 poolKey, address token)",
  "error PositionAlreadyRegistered(address adapter, bytes32 positionKey)",
  "error SpokeClosed()",
  "error TokenNotInMandate(address token)",
  "error TooManyIncomeResults()",
  "error UnexpectedOriginChain(uint256 originChainId)",
  "error UnexpectedWormholeCore(address wormholeCore)",
  "error UnknownIncomeResult(uint64 resultId)",
  "error UnknownPosition(address adapter, bytes32 positionKey)",
  "error UnwindProceedsReserved()",
  "error UnwindStepNotSelf(address caller)",
  "error WrongChain(uint256 configured, uint256 actual)",
  "error ZeroBridgeTarget(address bridgeAdapter)",
  "error ZeroFundId()",
  "error BridgeAmountMismatch(uint256 amountSent, uint256 amountToArrive)",
  "error BridgeDeadlineNotInFuture(uint32 fillDeadline)",
  "error BridgeDebitMismatch(uint256 expected, uint256 debited)",
  "error BridgeTargetMismatch(address bridgeAdapter, address pinned, address built)",
  "error HubBoundInFlightLimit(uint256 limit)",
  "error InvalidOrderVaa(string reason)",
  "error InvalidTransitOutcome()",
  "error OrderAlreadyExecuted(bytes32 orderId)",
  "error OrderEmitterChainMismatch(uint16 emitterChainId)",
  "error OrderEmitterMismatch(bytes32 emitterAddress)",
  "error OrderExpired(uint64 deadline)",
  "error OrderFundMismatch(bytes32 fundId)",
  "error OrderPayloadTooShort(uint256 length)",
  "error OrderResultCapacity()",
  "error OrderSequenceTooLow(uint64 minSequence, uint64 sequence)",
  "error RefundReleaseMismatch(uint256 held, uint256 received)",
  "error ReportPayloadTooShort(uint256 length)",
  "error SwapDebitMismatch(uint256 expected, uint256 debited)",
  "error SwapOutputNotReceived(uint256 amountOut, uint256 received)",
  "error UnknownBridgeRank(uint256 bridgeRank)",
  "error UnsupportedOrderVersion(uint256 version)",
  "error UnsupportedReportVersion(uint256 version)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidSpender(address spender)",
  "error NotWholeShares(uint256 amount)",
  "error ShareTransfersDisabled()",
  "error ZeroCoreVault()",
]);
export interface FundTransactionRecord {
  chainId: number;
  hash: string;
  action: string;
  status: "pending" | "confirmed" | "reverted";
  blockNumber?: number | null;
  reason?: string;
  uncertain?: boolean;
  errorName?: string;
}
export function fundTransactionCode(failure: unknown): string {
  let current = failure;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && typeof current.code === "string") return current.code;
    if ("cause" in current) current = current.cause;
    else break;
  }
  return failure instanceof Error ? failure.message : "V2_UNAVAILABLE";
}
export function decodeFundErrorName(failure: unknown): string | undefined {
  let current = failure;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("data" in current) {
      if (typeof current.data === "string" && /^0x[0-9a-fA-F]+$/.test(current.data)) {
        try {
          const decoded = decodeErrorResult({
            abi: [...errors, ...erc20Abi],
            data: current.data as Hex,
          });
          return decoded.errorName;
        } catch {}
      } else if (current.data && typeof current.data === "object") {
        current = current.data;
        continue;
      }
    }
    if ("cause" in current) current = current.cause;
    else break;
  }
  return undefined;
}
export function decodeFundRevert(failure: unknown): string {
  const name = decodeFundErrorName(failure);
  if (!name) return "revertUnknown";
  const key = fundErrorKey(name);
  return key === "unavailable" ? "revertUnknown" : key;
}
export async function sendFundTransaction(
  provider: Eip1193Provider,
  transaction: FundBuild["transactions"][number],
  wallet: string,
  action: string,
  observe: (record: FundTransactionRecord) => void,
) {
  const hash = await sendBuiltTransaction(
    provider,
    { tx: transaction, chainId: transaction.chainId },
    wallet,
    transaction.chainId,
  );
  const record: FundTransactionRecord = {
    hash,
    chainId: transaction.chainId,
    action,
    status: "pending",
  };
  observe(record);
  try {
    const receipt = await withTimeout(waitForReceipt(provider, hash), 5 * 60 * 1000);
    observe({ ...record, status: "confirmed", blockNumber: receipt.blockNumber });
  } catch (failure) {
    const code = fundTransactionCode(failure);
    if (code === "TX_REVERTED") {
      let reason = decodeFundRevert(failure);
      let errorName = decodeFundErrorName(failure);
      let blockNumber: number | null = null;
      observe({ ...record, status: "reverted", reason, ...(errorName ? { errorName } : {}) });
      try {
        const receipt = await withTimeout(
          provider.request({
            method: "eth_getTransactionReceipt",
            params: [hash],
          }),
          5000,
        );
        if (
          receipt &&
          typeof receipt === "object" &&
          "blockNumber" in receipt &&
          typeof receipt.blockNumber === "string"
        ) {
          const block = Number(BigInt(receipt.blockNumber));
          if (Number.isSafeInteger(block)) blockNumber = block;
          try {
            await withTimeout(
              provider.request({
                method: "eth_call",
                params: [
                  {
                    from: wallet,
                    to: transaction.to,
                    data: transaction.data,
                    value: `0x${BigInt(transaction.value).toString(16)}`,
                  },
                  receipt.blockNumber,
                ],
              }),
              5000,
            );
          } catch (revert) {
            const decoded = decodeFundErrorName(revert);
            if (decoded) {
              errorName = decoded;
              reason = decodeFundRevert(revert);
            }
          }
        }
      } catch {}
      observe({
        ...record,
        status: "reverted",
        blockNumber,
        reason,
        ...(errorName ? { errorName } : {}),
      });
    } else observe({ ...record, uncertain: true });
    throw new Error(code === "TX_REVERTED" ? "TX_REVERTED" : "TX_CONFIRMATION_UNKNOWN");
  }
}
