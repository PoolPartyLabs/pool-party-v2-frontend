/** @id PP-CP-LIB-006 @name Cash+ direct chain client @implements-rules-version v1 */
import {
  type Address,
  createPublicClient,
  defineChain,
  http,
  keccak256,
  type PublicClient,
} from "viem";
import { arbitrum } from "viem/chains";
import type { CashPlusDeployment } from "./config/deployments";

export function cashPlusChain(deployment: CashPlusDeployment) {
  return defineChain({
    ...arbitrum,
    id: deployment.chainId,
    name: deployment.networkName,
    rpcUrls: { default: { http: [deployment.rpcUrl] } },
    blockExplorers: deployment.explorerUrl
      ? { default: { name: "Explorer", url: deployment.explorerUrl } }
      : undefined,
  });
}

export function createCashPlusClient(deployment: CashPlusDeployment): PublicClient {
  // PP-INTEGRATION-POINT: public or loopback RPC, with no Cash+ API/backend or signing key.
  return createPublicClient({
    chain: cashPlusChain(deployment),
    transport: http(deployment.rpcUrl, { timeout: 12_000, retryCount: 1 }),
    batch: { multicall: true },
  });
}

const verified = new WeakMap<PublicClient, string>();
export async function verifyCashPlusDeployment(
  client: PublicClient,
  deployment: CashPlusDeployment,
): Promise<void> {
  const key = `${deployment.runId}:${deployment.vault}:${deployment.deploymentBlockHash}`;
  const [chainId, block] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockNumber: BigInt(deployment.deploymentBlock) }),
  ]);
  if (
    chainId !== deployment.chainId ||
    block.hash?.toLowerCase() !== deployment.deploymentBlockHash.toLowerCase()
  )
    throw new Error("DEPLOYMENT_MISMATCH");
  if (verified.get(client) === key) return;
  for (const item of deployment.codeHashes) {
    const code = await client.getCode({ address: item.address as Address });
    if (!code || code === "0x" || keccak256(code).toLowerCase() !== item.hash.toLowerCase())
      throw new Error("DEPLOYMENT_MISMATCH");
  }
  verified.set(client, key);
}
