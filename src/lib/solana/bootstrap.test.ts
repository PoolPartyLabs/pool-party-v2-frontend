import type { Hex } from "viem";
import { expect, it } from "vitest";
import { bootstrapChunks, type SolanaBootstrapManifest } from "./bootstrap";

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
