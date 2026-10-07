/**
 * @id PP-MGR-LIB-059 (POO-2262)
 * @name Solana committed bootstrap manifest and signing guard
 * @implements-rules-version DEC-190, DEC-200, DEC-201 (founder rulings, unversioned)
 */
import {
  address,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  getTransactionDecoder,
} from "@solana/kit";
import type { Hex } from "viem";
import { hexToBytes } from "viem";
import type { SolanaBootstrapAuthorization } from "./binding";

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

export async function validateBootstrapTransaction(input: {
  bytes: Uint8Array;
  manager: string;
  authorization: SolanaBootstrapAuthorization;
  chunk?: SolanaBootstrapChunk;
}): Promise<void> {
  const message = getCompiledTransactionMessageDecoder().decode(
    getTransactionDecoder().decode(input.bytes).messageBytes,
  );
  if (
    ("addressTableLookups" in message && message.addressTableLookups?.length) ||
    message.header.numSignerAccounts !== 1 ||
    message.staticAccounts[0] !== input.manager
  )
    throw new Error("UNSAFE_SOLANA_TRANSACTION");
  const encoder = getAddressEncoder();
  const [stage] = await getProgramDerivedAddress({
    programAddress: address(input.authorization.program),
    seeds: [
      new TextEncoder().encode("swap_policy_stage"),
      encoder.encode(address(input.authorization.fundPda)),
      encoder.encode(address(input.manager)),
    ],
  });
  const discriminator = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`global:${input.chunk ? "stage_swap_policy" : "initialize_fund"}`),
    ),
  ).slice(0, 8);
  let operationCount = 0;
  for (const instruction of message.instructions) {
    const program = message.staticAccounts[instruction.programAddressIndex];
    const data = instruction.data ?? new Uint8Array();
    if (program === "ComputeBudget111111111111111111111111111111") {
      if (
        instruction.accountIndices?.length ||
        !((data[0] === 2 && data.length === 5) || (data[0] === 3 && data.length === 9))
      )
        throw new Error("UNSAFE_SOLANA_TRANSACTION");
      continue;
    }
    if (program !== input.authorization.program || ++operationCount !== 1)
      throw new Error("UNSAFE_SOLANA_TRANSACTION");
    const accounts = (instruction.accountIndices ?? []).map(
      (index) => message.staticAccounts[index],
    );
    if (accounts[0] !== input.manager || accounts[1] !== input.authorization.fundPda)
      throw new Error("UNSAFE_SOLANA_TRANSACTION");
    let expected: Uint8Array;
    if (input.chunk) {
      if (
        accounts.length !== 4 ||
        accounts[2] !== stage ||
        accounts[3] !== "11111111111111111111111111111111"
      )
        throw new Error("UNSAFE_SOLANA_TRANSACTION");
      const chunkBytes = hexToBytes(input.chunk.chunk);
      const request = new Uint8Array(41 + chunkBytes.length);
      request.set(hexToBytes(input.chunk.policyHash));
      const view = new DataView(request.buffer);
      view.setUint16(32, input.chunk.totalLength, true);
      view.setUint16(34, input.chunk.offset, true);
      view.setUint32(36, chunkBytes.length, true);
      request.set(chunkBytes, 40);
      request[request.length - 1] = Number(input.chunk.seal);
      expected = new Uint8Array(12 + request.length);
      expected.set(discriminator);
      new DataView(expected.buffer).setUint32(8, request.length, true);
      expected.set(request, 12);
    } else {
      if (!accounts.includes(stage)) throw new Error("UNSAFE_SOLANA_TRANSACTION");
      expected = new Uint8Array([...discriminator, 1, 0, 0, 0, 2]);
    }
    if (data.length !== expected.length || data.some((byte, index) => byte !== expected[index]))
      throw new Error("UNSAFE_SOLANA_TRANSACTION");
  }
  if (operationCount !== 1) throw new Error("UNSAFE_SOLANA_TRANSACTION");
}
