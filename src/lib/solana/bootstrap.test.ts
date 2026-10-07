/**
 * @tests PP-MGR-LIB-059 (POO-2262)
 * @name Solana bootstrap manifest regressions
 * @implements-rules-version DEC-200, DEC-201 (founder rulings, unversioned)
 */

import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getProgramDerivedAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { type Hex, hexToBytes } from "viem";
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
          {
            blockhash: blockhash("11111111111111111111111111111111"),
            lastValidBlockHeight: BigInt(1),
          },
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

async function validBootstrapFixture(init = false) {
  const manager = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const encoder = getAddressEncoder();
  const authorization = {
    ...bootstrapAuthorizationFixture,
    fundPda: "DtJ3wso5NbkQNWoeFrdYa4cv4Mb78coXkcV879zSf1vU",
  };
  const [stage] = await getProgramDerivedAddress({
    programAddress: address(authorization.program),
    seeds: [
      new TextEncoder().encode("swap_policy_stage"),
      encoder.encode(address(authorization.fundPda)),
      encoder.encode(manager),
    ],
  });
  const chunk = bootstrapChunks(manifest)[0];
  if (!chunk) throw new Error("FIXTURE_MISSING");
  const discriminator = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`global:${init ? "initialize_fund" : "stage_swap_policy"}`),
    ),
  ).slice(0, 8);
  const data = init
    ? new Uint8Array([...discriminator, 1, 0, 0, 0, 2])
    : new Uint8Array(12 + 41 + 600);
  if (!init) {
    data.set(discriminator);
    const view = new DataView(data.buffer);
    view.setUint32(8, 641, true);
    data.set(hexToBytes(chunk.policyHash), 12);
    view.setUint16(44, 1250, true);
    view.setUint16(46, 0, true);
    view.setUint32(48, 600, true);
    data.set(hexToBytes(chunk.chunk), 52);
  }
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(manager, message),
      (message) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash("11111111111111111111111111111111"),
            lastValidBlockHeight: BigInt(1),
          },
          message,
        ),
      (message) =>
        appendTransactionMessageInstruction(
          {
            programAddress: address(authorization.program),
            accounts: [
              { address: manager, role: 3 },
              { address: address(authorization.fundPda), role: 1 },
              { address: stage, role: 1 },
              { address: address("11111111111111111111111111111111"), role: 0 },
            ],
            data,
          },
          message,
        ),
    ),
  );
  return {
    bytes: new Uint8Array(getTransactionEncoder().encode(transaction)),
    manager,
    authorization,
    chunk: init ? undefined : chunk,
  };
}

it.each([false, true])("accepts matching pinned staged bootstrap (initialize=%s)", async (init) => {
  await expect(
    validateBootstrapTransaction(await validBootstrapFixture(init)),
  ).resolves.toBeUndefined();
});

it.each([
  "program",
  "account",
  "data",
  "lookup",
  "compute",
])("rejects bootstrap %s substitution", async (mutation) => {
  const fixture = await validBootstrapFixture();
  const transaction = getTransactionDecoder().decode(fixture.bytes);
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const instruction = message.instructions[0];
  if (!instruction) throw new Error("FIXTURE_MISSING");
  if (mutation === "program") instruction.programAddressIndex = 0;
  if (mutation === "account") instruction.accountIndices = [0];
  if (mutation === "data") instruction.data = new Uint8Array([1]);
  if (mutation === "lookup")
    Object.assign(message, {
      addressTableLookups: [
        { lookupTableAddress: fixture.manager, readonlyIndexes: [0], writableIndexes: [] },
      ],
    });
  if (mutation === "compute") {
    message.staticAccounts.push(address("ComputeBudget111111111111111111111111111111"));
    message.instructions.push({
      programAddressIndex: message.staticAccounts.length - 1,
      accountIndices: [],
      data: new Uint8Array([1]),
    });
  }
  fixture.bytes = new Uint8Array(
    getTransactionEncoder().encode({
      ...transaction,
      messageBytes: getCompiledTransactionMessageEncoder().encode(message),
    }),
  );
  await expect(validateBootstrapTransaction(fixture)).rejects.toThrow("UNSAFE_SOLANA_TRANSACTION");
});
