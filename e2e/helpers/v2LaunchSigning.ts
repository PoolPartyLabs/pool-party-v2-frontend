/**
 * @id PP-E2E-V2-003
 * @name v2 launch signing boundary
 * @implements-rules-version v1
 */
import { rehearsalSignInAllowed } from "./rehearsalSignIn";

export type V2LaunchMode = "dry" | "dry-launch" | "signed";

export function v2LaunchMode(dry: string | undefined): V2LaunchMode {
  return dry === "1" ? "dry" : dry === "launch" ? "dry-launch" : "signed";
}

const signingMethods = new Set([
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "personal_sign",
]);

const readMethods = new Set([
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "net_version",
  "wallet_requestPermissions",
  "wallet_getPermissions",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_watchAsset",
  "eth_call",
  "eth_getBalance",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getLogs",
]);

export async function safeV2WalletCall<Result>(callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch {
    throw new Error("V2_WALLET_REQUEST_FAILED");
  }
}

export function v2LaunchFailure(hasUiError: boolean): { error: string; uiError?: string } {
  return hasUiError
    ? { error: "V2_LAUNCH_FAILED", uiError: "V2_LAUNCH_UI_ERROR" }
    : { error: "V2_LAUNCH_FAILED" };
}

export function assertV2LaunchSigningAllowed(
  request: { method: string; params?: unknown[] },
  address: string,
  mode: V2LaunchMode,
  armed: boolean,
  optedIn: string | undefined,
): boolean {
  if (!signingMethods.has(request.method)) {
    if (!readMethods.has(request.method)) throw new Error("Wallet method is not allowlisted");
    return false;
  }
  const authentication =
    request.method === "personal_sign" &&
    rehearsalSignInAllowed(String(request.params?.[0] ?? ""), address);
  if (authentication) {
    if (String(request.params?.[1] ?? "").toLowerCase() !== address.toLowerCase())
      throw new Error("Unauthorized personal_sign signer");
    return false;
  }
  if (mode !== "signed" || !armed || optedIn !== "1")
    throw new Error("Launch signing is disarmed (dry mode never signs transactions)");
  if (request.method === "eth_sendRawTransaction")
    throw new Error("Only Node-side eth_sendTransaction signing is permitted");
  if (
    request.method === "personal_sign" &&
    String(request.params?.[1] ?? "").toLowerCase() !== address.toLowerCase()
  )
    throw new Error("Unauthorized personal_sign signer");
  return true;
}
