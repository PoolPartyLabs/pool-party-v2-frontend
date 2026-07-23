/**
 * @id PP-TX (POO-303)
 * @name Permit2 helpers tests
 * @implements-rules-version v1
 *
 * Pure helpers: PermitSingle construction, serialization, and the approve calldata.
 */
import { describe, expect, it } from "vitest";
import {
  buildPermit2ApproveTx,
  buildPermitBatch,
  buildPermitSingle,
  permitBatchTypedData,
  permitTypedData,
  serializePermit,
  serializePermitBatch,
} from "./permit2";

const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1" as const;
const POOL = "0x1111111111111111111111111111111111111111" as const;
const MANAGER = "0x2222222222222222222222222222222222222222" as const;
const ARBITRUM = 42161;

/** True when any nested value is a native bigint — the shape JSON.stringify rejects. */
function hasBigInt(value: unknown): boolean {
  if (typeof value === "bigint") return true;
  if (Array.isArray(value)) return value.some(hasBigInt);
  if (value && typeof value === "object") return Object.values(value).some(hasBigInt);
  return false;
}

describe("buildPermitSingle", () => {
  it("sets the token/amount/nonce/spender with future expiry + deadline", () => {
    const now = Math.floor(Date.now() / 1000);
    const permit = buildPermitSingle(USDC, POOL, BigInt(1_000_000), 7);
    expect(permit.details.token).toBe(USDC);
    expect(permit.details.amount).toBe(BigInt(1_000_000));
    expect(permit.details.nonce).toBe(BigInt(7));
    expect(permit.spender).toBe(POOL);
    expect(Number(permit.details.expiration)).toBeGreaterThan(now);
    expect(Number(permit.sigDeadline)).toBeGreaterThan(now);
  });
});

describe("serializePermit", () => {
  it("stringifies every bigint for transport", () => {
    const serialized = serializePermit(buildPermitSingle(USDC, POOL, BigInt(250_000), 2));
    expect(serialized.details.amount).toBe("250000");
    expect(serialized.details.nonce).toBe("2");
    expect(typeof serialized.sigDeadline).toBe("string");
    expect(serialized.spender).toBe(POOL);
  });
});

describe("buildPermit2ApproveTx", () => {
  it("targets the token with the ERC-20 approve selector", () => {
    const tx = buildPermit2ApproveTx(42161, USDC);
    expect(tx.tx.to).toBe(USDC);
    expect(tx.tx.value).toBe("0");
    // approve(address,uint256) selector
    expect(tx.tx.data.startsWith("0x095ea7b3")).toBe(true);
  });
});

describe("buildPermitBatch + serializePermitBatch", () => {
  it("builds a two-token batch with the manager spender and future deadline", () => {
    const now = Math.floor(Date.now() / 1000);
    const batch = buildPermitBatch(
      { token: WETH, amount: BigInt(1_000_000), nonce: 2 },
      { token: USDC, amount: BigInt(5_000_000), nonce: 7 },
      MANAGER,
    );
    expect(batch.details).toHaveLength(2);
    expect(batch.spender).toBe(MANAGER);
    expect(Number(batch.sigDeadline)).toBeGreaterThan(now);
  });

  it("serializes amounts to strings and expiration/nonce to numbers", () => {
    const serialized = serializePermitBatch(
      buildPermitBatch(
        { token: WETH, amount: BigInt(1_000_000), nonce: 2 },
        { token: USDC, amount: BigInt(5_000_000), nonce: 7 },
        MANAGER,
      ),
    );
    expect(serialized.details[0]).toMatchObject({ token: WETH, amount: "1000000", nonce: 2 });
    expect(serialized.details[1]).toMatchObject({ token: USDC, amount: "5000000", nonce: 7 });
    expect(typeof serialized.details[0]?.expiration).toBe("number");
    expect(serialized.spender).toBe(MANAGER);
    expect(typeof serialized.sigDeadline).toBe("string");
  });
});

// POO-1001: Privy's embedded (social-login) wallet signer JSON.stringifies the typed data before
// dispatching to its signing service. A native bigint anywhere in domain/message throws
// "Do not know how to serialize a BigInt" (INVEST_FAILED), while external/injected wallets tolerate
// it via a different serialization path. The typed-data builders must therefore emit a fully
// JSON-safe payload for BOTH wallet types.
describe("permitTypedData (POO-1001)", () => {
  it("[R1] emits no bigint anywhere; uints are decimal strings, chainId a number", () => {
    const typedData = permitTypedData(
      buildPermitSingle(USDC, POOL, BigInt(1_000_000), 7),
      ARBITRUM,
    );
    const message = typedData.message as {
      details: { token: string; amount: unknown; expiration: unknown; nonce: unknown };
      spender: string;
      sigDeadline: unknown;
    };
    expect(hasBigInt(typedData)).toBe(false);
    expect(message.details.amount).toBe("1000000");
    expect(message.details.nonce).toBe("7");
    expect(typeof message.details.expiration).toBe("string");
    expect(typeof message.sigDeadline).toBe("string");
    expect(typeof (typedData.domain as { chainId: unknown }).chainId).toBe("number");
    expect(message.details.token).toBe(USDC);
    expect(message.spender).toBe(POOL);
    expect(typedData.primaryType).toBe("PermitSingle");
  });

  it("[R1] the payload survives JSON.stringify (the exact embedded-wallet failure)", () => {
    const typedData = permitTypedData(
      buildPermitSingle(USDC, POOL, BigInt(1_000_000), 7),
      ARBITRUM,
    );
    expect(() => JSON.stringify(typedData)).not.toThrow();
  });

  it("[R4] serializes amount=0 and nonce=0 as exact decimal strings", () => {
    const typedData = permitTypedData(buildPermitSingle(USDC, POOL, BigInt(0), 0), ARBITRUM);
    const message = typedData.message as { details: { amount: unknown; nonce: unknown } };
    expect(hasBigInt(typedData)).toBe(false);
    expect(message.details.amount).toBe("0");
    expect(message.details.nonce).toBe("0");
  });
});

describe("permitBatchTypedData (POO-1001)", () => {
  const batch = () =>
    buildPermitBatch(
      { token: WETH, amount: BigInt(1_000_000), nonce: 2 },
      { token: USDC, amount: BigInt(5_000_000), nonce: 7 },
      MANAGER,
    );

  it("[R1] emits no bigint anywhere; every leg's uints are decimal strings", () => {
    const typedData = permitBatchTypedData(batch(), ARBITRUM);
    const message = typedData.message as {
      details: { token: string; amount: unknown; expiration: unknown; nonce: unknown }[];
      spender: string;
      sigDeadline: unknown;
    };
    expect(hasBigInt(typedData)).toBe(false);
    expect(message.details[0]).toMatchObject({ token: WETH, amount: "1000000", nonce: "2" });
    expect(message.details[1]).toMatchObject({ token: USDC, amount: "5000000", nonce: "7" });
    expect(typeof message.details[0]?.expiration).toBe("string");
    expect(typeof message.sigDeadline).toBe("string");
    expect(message.spender).toBe(MANAGER);
    expect(typedData.primaryType).toBe("PermitBatch");
  });

  it("[R1] the batch payload survives JSON.stringify", () => {
    expect(() => JSON.stringify(permitBatchTypedData(batch(), ARBITRUM))).not.toThrow();
  });
});
