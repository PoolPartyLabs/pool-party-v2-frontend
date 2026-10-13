import {
  AccountRole,
  type Address,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import {
  isSolanaNotSubmitted,
  LIGHTHOUSE_PROGRAM,
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

describe("a wallet-recompiled message (Phantom Lighthouse assertions)", () => {
  const at = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
  const manager = at(9);
  const spoke = at(200);
  const unitLimit = (units: number): Instruction => {
    const data = new Uint8Array(5);
    data[0] = 2;
    new DataView(data.buffer).setUint32(1, units, true);
    return { programAddress: address("ComputeBudget111111111111111111111111111111"), data };
  };
  const spokeCall = (data = [7, 7], readonly = at(100)): Instruction => ({
    programAddress: spoke,
    accounts: [
      { address: manager, role: AccountRole.WRITABLE_SIGNER },
      { address: at(150), role: AccountRole.WRITABLE },
      { address: readonly, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(data),
  });
  const assertion = (
    accounts = [{ address: at(50), role: AccountRole.READONLY }],
    program: Address = address(LIGHTHOUSE_PROGRAM),
  ): Instruction => ({ programAddress: program, accounts, data: new Uint8Array([1, 2, 3]) });
  /** A v0 wire transaction; `signature` fills every signer slot as a wallet would. */
  function wire(instructions: Instruction[], signature = 0, hash = lifetime.blockhash) {
    const compiled = compileTransaction(
      pipe(
        createTransactionMessage({ version: 0 }),
        (message) => setTransactionMessageFeePayer(manager, message),
        (message) =>
          setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: hash, lastValidBlockHeight: BigInt(100) },
            message,
          ),
        (message) => appendTransactionMessageInstructions(instructions, message),
      ),
    );
    const signatures = Object.fromEntries(
      Object.keys(compiled.signatures).map((key) => [
        key,
        signature ? new Uint8Array(64).fill(signature) : null,
      ]),
    );
    return new Uint8Array(
      getTransactionEncoder().encode({ ...compiled, signatures } as typeof compiled),
    );
  }
  const built = [unitLimit(200_000), spokeCall()];
  function walletReturns(signed: Uint8Array<ArrayBuffer>, original = built) {
    const options = input();
    options.build.mockResolvedValue({ bytes: wire(original), lifetime });
    options.sign.mockResolvedValue(signed);
    return { ...options, walletAddress: manager as string };
  }
  async function refused(signed: Uint8Array<ArrayBuffer>, original = built) {
    const options = walletReturns(signed, original);
    const failure = await sendSolanaTransaction(options).catch((error: unknown) => error);
    expect((failure as Error).message).toBe("UNSAFE_SOLANA_TRANSACTION");
    expect(isSolanaNotSubmitted(failure)).toBe(true);
    expect(options.sign).toHaveBeenCalled();
    expect(options.persist).not.toHaveBeenCalled();
    expect(options.rpc.send).not.toHaveBeenCalled();
  }
  const signatureOf = (fill: number) => getBase58Decoder().decode(new Uint8Array(64).fill(fill));

  it("(a) still accepts a byte-identical signed message", async () => {
    const options = walletReturns(wire(built, 7));
    await expect(sendSolanaTransaction(options)).resolves.toBe(signatureOf(7));
  });
  it("(b) accepts appended Lighthouse assertions that renumber the accounts, and sends them", async () => {
    const signed = wire([...built, assertion()], 7);
    const decode = (bytes: Uint8Array) =>
      getCompiledTransactionMessageDecoder().decode(
        getTransactionDecoder().decode(bytes).messageBytes,
      );
    // The new readonly account sorts before the spoke's readonly one: indices differ, addresses do not.
    expect(decode(signed).instructions[1]?.accountIndices).not.toEqual(
      decode(wire(built)).instructions[1]?.accountIndices,
    );
    const options = walletReturns(signed);
    await expect(sendSolanaTransaction(options)).resolves.toBe(signatureOf(7));
    expect(options.persist).toHaveBeenCalledWith(signatureOf(7));
    expect(options.rpc.send).toHaveBeenCalledWith(signed);
  });
  it("(b) accepts an assertion on the fee payer and a raised unit limit up to the 1.4M cap", async () => {
    const payerAssertion = assertion([{ address: manager, role: AccountRole.READONLY }]);
    const options = walletReturns(wire([unitLimit(1_400_000), spokeCall(), payerAssertion], 7));
    await expect(sendSolanaTransaction(options)).resolves.toBe(signatureOf(7));
  });
  it("(c) refuses an appended instruction of any other program", async () => {
    await refused(wire([...built, assertion(undefined, at(77))], 7));
  });
  it("(d) refuses a changed built instruction: data, account or a lowered or uncapped unit limit", async () => {
    await refused(wire([unitLimit(200_000), spokeCall([7, 8]), assertion()], 7));
    await refused(wire([unitLimit(200_000), spokeCall(undefined, at(101))], 7));
    await refused(wire([unitLimit(150_000), spokeCall(), assertion()], 7));
    await refused(wire([unitLimit(1_400_001), spokeCall(), assertion()], 7));
    await refused(wire([spokeCall(), unitLimit(200_000), assertion()], 7));
  });
  it("(e) refuses a changed blockhash", async () => {
    await refused(
      wire([...built, assertion()], 7, blockhash("SysvarRent111111111111111111111111111111111")),
    );
  });
  it("(f) refuses an added signer, or an assertion touching a signer other than the fee payer", async () => {
    await refused(
      wire([...built, assertion([{ address: at(60), role: AccountRole.READONLY_SIGNER }])], 7),
    );
    const mint = { address: at(170), role: AccountRole.WRITABLE_SIGNER };
    const withMint = [
      unitLimit(200_000),
      { ...spokeCall(), accounts: [...(spokeCall().accounts ?? []), mint] },
    ];
    await refused(
      wire([...withMint, assertion([{ address: mint.address, role: AccountRole.READONLY }])], 7),
      withMint,
    );
  });
});
