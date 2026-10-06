import {
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from "@solana/kit";

export interface SolanaLifetime {
  blockhash: string;
  lastValidBlockHeight: bigint;
}
export interface SolanaTransactionRpc {
  genesisHash(): Promise<string>;
  latestBlockhash(): Promise<SolanaLifetime>;
  send(bytes: Uint8Array): Promise<string>;
  status(signature: string): Promise<"success" | "reverted" | "unknown">;
}

/** DEC-190: persist the signed identifier BEFORE sending; never rebuild an uncertain send. */
export async function sendSolanaTransaction(input: {
  walletAddress: string;
  rpc: SolanaTransactionRpc;
  build: (lifetime: SolanaLifetime) => Promise<Uint8Array>;
  sign: (bytes: Uint8Array) => Promise<Uint8Array>;
  persist: (signature: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  if ((await input.rpc.genesisHash()) !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")
    throw new Error("SOLANA_CLUSTER_MISMATCH");
  if (input.signal?.aborted) throw new Error("LAUNCH_CANCELLED");
  const lifetime = await input.rpc.latestBlockhash();
  const unsignedBytes = await input.build(lifetime);
  const unsigned = getTransactionDecoder().decode(unsignedBytes);
  const message = getCompiledTransactionMessageDecoder().decode(unsigned.messageBytes);
  if (
    message.staticAccounts[0] !== input.walletAddress ||
    message.lifetimeToken !== lifetime.blockhash
  )
    throw new Error("UNSAFE_SOLANA_TRANSACTION");
  const signedBytes = await input.sign(unsignedBytes);
  const signed = getTransactionDecoder().decode(signedBytes);
  if (
    unsigned.messageBytes.length !== signed.messageBytes.length ||
    unsigned.messageBytes.some((byte, index) => byte !== signed.messageBytes[index])
  )
    throw new Error("UNSAFE_SOLANA_TRANSACTION");
  const signature = getSignatureFromTransaction(signed);
  input.persist(signature);
  if (input.signal?.aborted) return signature;
  const broadcastSignature = await input.rpc.send(signedBytes);
  if (broadcastSignature !== signature) throw new Error("SOLANA_SIGNATURE_MISMATCH");
  return signature;
}

export const solanaSignatureBytes = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);
