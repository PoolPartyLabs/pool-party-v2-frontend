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
import {
  isSolanaNotSubmitted,
  SOLANA_MAINNET_GENESIS_HASH,
  SolanaNotSubmittedError,
  sendSolanaTransaction,
} from "./transaction";

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
    genesisHash: vi.fn(async () => SOLANA_MAINNET_GENESIS_HASH),
    blockHeight: vi.fn(async () => {
      events.push("height");
      return BigInt(50);
    }),
    send: vi.fn(async () => {
      events.push("broadcast");
      return persisted;
    }),
    status: vi.fn(async () => "unknown" as const),
  };
  return {
    walletAddress: payer as string,
    rpc,
    events,
    build: vi.fn(async () => {
      events.push("build");
      return { bytes: new Uint8Array(getTransactionEncoder().encode(transaction())), lifetime };
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

it("pins the real mainnet genesis hash, not the CAIP-2 reference (sweep F1)", () => {
  expect(SOLANA_MAINNET_GENESIS_HASH).toBe("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
  expect(SOLANA_MAINNET_GENESIS_HASH).toHaveLength(44);
});
it("signs the API's bytes with the API's blockhash, persists and only then broadcasts", async () => {
  const options = input();
  const signature = await sendSolanaTransaction(options);
  expect(options.events).toEqual(["build", "height", "sign", "persist", "broadcast"]);
  expect(options.persist).toHaveBeenCalledWith(signature);
});
it("refuses bytes whose blockhash is not the builder's declared lifetime (sweep F4)", async () => {
  const options = input();
  options.build.mockResolvedValue({
    bytes: new Uint8Array(getTransactionEncoder().encode(transaction())),
    lifetime: {
      blockhash: blockhash("SysvarRent111111111111111111111111111111111"),
      lastValidBlockHeight: BigInt(100),
    },
  });
  await expect(sendSolanaTransaction(options)).rejects.toThrow("UNSAFE_SOLANA_TRANSACTION");
  expect(options.sign).not.toHaveBeenCalled();
});
it("refuses an expired API lifetime before asking for a signature, as not submitted", async () => {
  const options = input();
  options.rpc.blockHeight.mockResolvedValue(BigInt(100));
  const failure = await sendSolanaTransaction(options).catch((error: unknown) => error);
  expect((failure as Error).message).toBe("SOLANA_BLOCKHASH_EXPIRED");
  expect(isSolanaNotSubmitted(failure)).toBe(true);
  expect(options.sign).not.toHaveBeenCalled();
});
it("does not broadcast if durable storage fails", async () => {
  const options = input();
  options.persist.mockImplementation(() => {
    throw new Error("STORAGE_FAILED");
  });
  await expect(sendSolanaTransaction(options)).rejects.toThrow("STORAGE_FAILED");
  expect(options.rpc.send).not.toHaveBeenCalled();
});
it("retains the signature when the network fails after broadcast (uncertain, not unsent)", async () => {
  const options = input();
  options.rpc.send.mockRejectedValue(new Error("NETWORK_ERROR"));
  const failure = await sendSolanaTransaction(options).catch((error: unknown) => error);
  expect((failure as Error).message).toBe("NETWORK_ERROR");
  expect(isSolanaNotSubmitted(failure)).toBe(false);
  expect(options.persist).toHaveBeenCalledTimes(1);
});
it("classifies a preflight refusal as never submitted", async () => {
  const options = input();
  options.rpc.send.mockRejectedValue(
    Object.assign(new Error("rpc"), { context: { __code: -32002 } }),
  );
  const failure = await sendSolanaTransaction(options).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(SolanaNotSubmittedError);
  expect((failure as Error).message).toBe("SOLANA_PREFLIGHT_REJECTED");
});
it("rejects another cluster before building or signing", async () => {
  const options = input();
  options.rpc.genesisHash.mockResolvedValue("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  const failure = await sendSolanaTransaction(options).catch((error: unknown) => error);
  expect((failure as Error).message).toBe("SOLANA_CLUSTER_MISMATCH");
  expect(isSolanaNotSubmitted(failure)).toBe(true);
  expect(options.build).not.toHaveBeenCalled();
  expect(options.sign).not.toHaveBeenCalled();
});
it("rejects a different fee payer", async () => {
  const options = input();
  await expect(sendSolanaTransaction({ ...options, walletAddress: "other" })).rejects.toThrow(
    "UNSAFE_SOLANA_TRANSACTION",
  );
  expect(options.sign).not.toHaveBeenCalled();
});
it("maps a refused wallet prompt to a not-submitted USER_REJECTED (sweep F5)", async () => {
  const options = input();
  options.sign.mockRejectedValue(new Error("USER_REJECTED"));
  const failure = await sendSolanaTransaction(options).catch((error: unknown) => error);
  expect((failure as Error).message).toBe("USER_REJECTED");
  expect(isSolanaNotSubmitted(failure)).toBe(true);
  expect(options.persist).not.toHaveBeenCalled();
});
it("applies extra local signers after the wallet signature", async () => {
  const options = input();
  const cosign = vi.fn(async (bytes: Uint8Array) => {
    options.events.push("cosign");
    return bytes;
  });
  await sendSolanaTransaction({ ...options, cosign });
  expect(options.events).toEqual(["build", "height", "sign", "cosign", "persist", "broadcast"]);
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
