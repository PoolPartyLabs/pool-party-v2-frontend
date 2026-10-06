import {
  address,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { expect, it, vi } from "vitest";
import { sendSolanaTransaction } from "./transaction";

const payer = address("11111111111111111111111111111111");
const lifetime = {
  blockhash: blockhash("11111111111111111111111111111111"),
  lastValidBlockHeight: BigInt(100),
};
function transaction() {
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(payer, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
    ),
  );
}
function input() {
  const events: string[] = [];
  let persisted = "";
  const rpc = {
    genesisHash: vi.fn(async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
    latestBlockhash: vi.fn(async () => {
      events.push("blockhash");
      return lifetime;
    }),
    send: vi.fn(async () => {
      events.push("broadcast");
      return persisted;
    }),
    status: vi.fn(async () => "unknown" as const),
  };
  return {
    walletAddress: payer,
    rpc,
    events,
    build: vi.fn(async () => {
      events.push("build");
      return new Uint8Array(getTransactionEncoder().encode(transaction()));
    }),
    sign: vi.fn(async () => {
      events.push("sign");
      const compiled = transaction();
      return new Uint8Array(
        getTransactionEncoder().encode({
          ...compiled,
          signatures: { [payer]: new Uint8Array(64).fill(1) },
        } as typeof compiled),
      );
    }),
    persist: vi.fn((signature: string) => {
      events.push("persist");
      persisted = signature;
    }),
  };
}
it("builds with a fresh blockhash, signs, persists and only then broadcasts", async () => {
  const options = input();
  const signature = await sendSolanaTransaction(options);
  expect(options.events).toEqual(["blockhash", "build", "sign", "persist", "broadcast"]);
  expect(options.persist).toHaveBeenCalledWith(signature);
});
it("does not broadcast if durable storage fails", async () => {
  const options = input();
  options.persist.mockImplementation(() => {
    throw new Error("STORAGE_FAILED");
  });
  await expect(sendSolanaTransaction(options)).rejects.toThrow("STORAGE_FAILED");
  expect(options.rpc.send).not.toHaveBeenCalled();
});
it("retains the signature when the network fails after broadcast", async () => {
  const options = input();
  options.rpc.send.mockRejectedValue(new Error("NETWORK_ERROR"));
  await expect(sendSolanaTransaction(options)).rejects.toThrow("NETWORK_ERROR");
  expect(options.persist).toHaveBeenCalledTimes(1);
});
it("rejects another cluster before building or signing", async () => {
  const options = input();
  options.rpc.genesisHash.mockResolvedValue("devnet");
  await expect(sendSolanaTransaction(options)).rejects.toThrow("SOLANA_CLUSTER_MISMATCH");
  expect(options.sign).not.toHaveBeenCalled();
});
it("rejects a different fee payer", async () => {
  const options = input();
  await expect(sendSolanaTransaction({ ...options, walletAddress: "other" })).rejects.toThrow(
    "UNSAFE_SOLANA_TRANSACTION",
  );
  expect(options.sign).not.toHaveBeenCalled();
});
it("rejects a broadcast identifier different from the persisted signature", async () => {
  const options = input();
  options.rpc.send.mockResolvedValue("other");
  await expect(sendSolanaTransaction(options)).rejects.toThrow("SOLANA_SIGNATURE_MISMATCH");
});
it("honors cancellation before requesting a signature", async () => {
  const options = input();
  const controller = new AbortController();
  controller.abort();
  await expect(sendSolanaTransaction({ ...options, signal: controller.signal })).rejects.toThrow(
    "LAUNCH_CANCELLED",
  );
  expect(options.sign).not.toHaveBeenCalled();
});
