import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required server env var ${name}. Set it in .env.local; never commit it.`,
    );
  }
  return value;
}

export function arbitrumRpcUrl(): string {
  return process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc";
}

/**
 * The taker bot's key. Separate from the manager key by rule (BOT-R4): the manager key is
 * held by a human and never reaches this process.
 */
export function takerPrivateKey(): `0x${string}` {
  const key = required("TAKER_BOT_PRIVATE_KEY");
  if (!key.startsWith("0x")) throw new Error("TAKER_BOT_PRIVATE_KEY must be 0x-prefixed");
  return key as `0x${string}`;
}

/** True when the process may send transactions. Read-only paths must not require a key. */
export function hasTakerKey(): boolean {
  return Boolean(process.env.TAKER_BOT_PRIVATE_KEY);
}
