import "server-only";

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { arbitrumRpcUrl, takerPrivateKey } from "../config/env";

/**
 * viem clients for the Aqua module. Server-only (SRV-R4): keys and RPC URLs never reach the
 * browser, and the public client is separate from the signing one so read paths cannot
 * accidentally require a key.
 */

let publicClient: ReturnType<typeof createPublicClient> | undefined;

export function arbitrumPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({ chain: arbitrum, transport: http(arbitrumRpcUrl()) });
  }
  return publicClient;
}

/**
 * The taker bot's signer. BOT-R4: this wallet holds only its own working capital and is
 * never the manager or keeper key. Manager transactions are returned as BuiltTx payloads for
 * a human wallet to sign (SRV-R5), never signed here.
 */
export function takerWalletClient() {
  return createWalletClient({
    account: privateKeyToAccount(takerPrivateKey()),
    chain: arbitrum,
    transport: http(arbitrumRpcUrl()),
  });
}
