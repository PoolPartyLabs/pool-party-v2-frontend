import type { PrivyClientConfig } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

export const SOLANA_CHAIN = "solana:mainnet" as const;

/** DEC-190: Solana is an additional signer, never the canonical EVM account. */
export function solanaPrivyConfig(enabled: boolean): Pick<PrivyClientConfig, "solana"> & {
  connectors?: ReturnType<typeof toSolanaWalletConnectors>;
} {
  if (!enabled) return {};
  return {
    connectors: toSolanaWalletConnectors(),
    solana: {
      rpcs: {
        [SOLANA_CHAIN]: {
          rpc: createSolanaRpc("https://api.mainnet-beta.solana.com"),
          rpcSubscriptions: createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com"),
        },
      },
    },
  };
}
