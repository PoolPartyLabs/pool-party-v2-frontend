import type { Hex } from "viem";

export interface SolanaBootstrapManifest {
  policyHash: Hex;
  /** TODO(interface): authenticated builder supplies complete signed creation bytes, not just SwapPolicy. */
  payload: Hex;
}

export interface SolanaBootstrapChunk {
  policyHash: Hex;
  totalLength: number;
  offset: number;
  chunk: Hex;
  seal: boolean;
}

/** DEC-200, DEC-201: #48 write-once staging seals with the last nonempty append. */
export function bootstrapChunks(manifest: SolanaBootstrapManifest): SolanaBootstrapChunk[] {
  if (
    !manifest ||
    !/^0x[0-9a-fA-F]{64}$/.test(manifest.policyHash) ||
    /^0x0{64}$/.test(manifest.policyHash) ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(manifest.payload) ||
    manifest.payload.length > 8194
  )
    throw new Error("SOLANA_BOOTSTRAP_INVALID");
  const totalLength = (manifest.payload.length - 2) / 2;
  const chunks: SolanaBootstrapChunk[] = [];
  for (let offset = 0; offset < totalLength; offset += 600) {
    const end = Math.min(offset + 600, totalLength);
    chunks.push({
      policyHash: manifest.policyHash,
      totalLength,
      offset,
      chunk: `0x${manifest.payload.slice(2 + offset * 2, 2 + end * 2)}`,
      seal: end === totalLength,
    });
  }
  return chunks;
}
