/**
 * @tests PP-MGR-LIB-059 (POO-2262)
 * @name Solana bootstrap manifest regressions
 * @implements-rules-version DEC-200, DEC-201 (founder rulings, unversioned)
 */

import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import type { Hex } from "viem";
import { expect, it } from "vitest";
import {
  bootstrapChunks,
  type SolanaBootstrapManifest,
  validateBootstrapTransaction,
} from "./bootstrap";
import { bootstrapAuthorizationFixture } from "./bootstrap.fixture";

const manifest: SolanaBootstrapManifest = {
  policyHash: `0x${"01".repeat(32)}`,
  payload: `0x${"ab".repeat(1250)}`,
};

it("stages contiguous packet-safe chunks and seals only the final nonempty chunk", () => {
  const chunks = bootstrapChunks(manifest);
  expect(chunks.map(({ offset, totalLength, seal }) => ({ offset, totalLength, seal }))).toEqual([
    { offset: 0, totalLength: 1250, seal: false },
    { offset: 600, totalLength: 1250, seal: false },
    { offset: 1200, totalLength: 1250, seal: true },
  ]);
  expect(chunks.map((chunk) => chunk.chunk.slice(2)).join("")).toBe(manifest.payload.slice(2));
});

it.each([
  "0x",
  "0x1",
  "0xzz",
  `0x${"ab".repeat(4097)}`,
])("refuses malformed or oversized payload %s", (payload) =>
  expect(() => bootstrapChunks({ ...manifest, payload: payload as Hex })).toThrow(
    "SOLANA_BOOTSTRAP_INVALID",
  ));

it("requires a nonzero full-width committed policy hash", () => {
  expect(() => bootstrapChunks({ ...manifest, policyHash: `0x${"00".repeat(32)}` })).toThrow(
    "SOLANA_BOOTSTRAP_INVALID",
  );
});

it("refuses an unrelated System transfer before any wallet signature", async () => {
  const manager = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(manager, message),
      (message) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: BigInt(1) },
          message,
        ),
      (message) =>
        appendTransactionMessageInstruction(
          {
            programAddress: address("11111111111111111111111111111111"),
            accounts: [{ address: manager, role: 3 }],
            data: new Uint8Array(12),
          },
          message,
        ),
    ),
  );
  await expect(
    validateBootstrapTransaction({
      bytes: new Uint8Array(getTransactionEncoder().encode(transaction)),
      manager,
      authorization: bootstrapAuthorizationFixture,
      chunk: bootstrapChunks(manifest)[0],
    }),
  ).rejects.toThrow("UNSAFE_SOLANA_TRANSACTION");
});
