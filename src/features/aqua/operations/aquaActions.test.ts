// @vitest-environment node
import { decodeFunctionData, erc20Abi } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PARTY_VAULT_WRITE_ABI } from "@/lib/aqua/abis/partyVault";
import { TOKENS } from "@/lib/aqua/config/addresses";

const VAULT = "0xec870a6A9E8EE41B349FD0766b8f295D6EDC6610";
const OWNER = "0x67Fd51e5082205AF0bD97039a6124Ff3368aD0da";

/** Chain reads are stubbed per test so each guard can be driven to its failing branch. */
const reads = vi.hoisted(() => ({
  seeded: true,
  totalAssets: BigInt(10_000_000),
  maxTvl: BigInt(200_000_000),
  sharesOf: BigInt(1_000_000_000),
  convertToAssets: BigInt(5_000_000),
  liquidUsdc: BigInt(9_000_000),
}));

vi.mock("@/lib/aqua/chain/clients", () => ({
  arbitrumPublicClient: () => ({
    readContract: ({ functionName }: { functionName: keyof typeof reads }) =>
      Promise.resolve(reads[functionName]),
  }),
}));

let actions: typeof import("./aquaActions");

beforeEach(async () => {
  vi.stubEnv("AQUA_VAULT_ADDRESS", VAULT);
  reads.seeded = true;
  reads.totalAssets = BigInt(10_000_000);
  reads.maxTvl = BigInt(200_000_000);
  reads.sharesOf = BigInt(1_000_000_000);
  reads.convertToAssets = BigInt(5_000_000);
  reads.liquidUsdc = BigInt(9_000_000);
  actions = await import("./aquaActions");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("approve build", () => {
  it("approves the VAULT for the exact amount, not an infinite allowance", async () => {
    const result = await actions.buildAquaApproveTx({ owner: OWNER, amountUsdc: "2500000" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tx.tx.to).toBe(TOKENS.USDC);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: result.tx.tx.data as `0x${string}` });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args?.[0]).toBe(VAULT);
    // The exactness is the point: an unaudited vault can never pull more than this deposit.
    expect(decoded.args?.[1]).toBe(BigInt(2_500_000));
  });

  it("carries the Arbitrum chain id so the client refuses to broadcast elsewhere", async () => {
    const result = await actions.buildAquaApproveTx({ owner: OWNER, amountUsdc: "1" });
    expect(result.ok && result.tx.chainId).toBe(42161);
  });
});

describe("deposit build", () => {
  it("encodes deposit(assets) against the vault", async () => {
    const result = await actions.buildAquaDepositTx({ owner: OWNER, amountUsdc: "2500000" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tx.tx.to).toBe(VAULT);
    const decoded = decodeFunctionData({
      abi: PARTY_VAULT_WRITE_ABI,
      data: result.tx.tx.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("deposit");
    expect(decoded.args?.[0]).toBe(BigInt(2_500_000));
  });

  it("refuses before the manager has seeded (VLT-R2), with a sentence not a revert", async () => {
    reads.seeded = false;
    const result = await actions.buildAquaDepositTx({ owner: OWNER, amountUsdc: "1000000" });
    expect(result).toMatchObject({ ok: false, code: "NOT_SEEDED" });
  });

  it("refuses a deposit that would breach maxTvl, and says how much room is left", async () => {
    reads.totalAssets = BigInt(199_000_000);
    const result = await actions.buildAquaDepositTx({ owner: OWNER, amountUsdc: "5000000" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MAX_TVL_EXCEEDED");
    expect(result.message).toContain("$1.00");
  });

  it("says the cap is reached when there is no room at all", async () => {
    reads.totalAssets = BigInt(200_000_000);
    const result = await actions.buildAquaDepositTx({ owner: OWNER, amountUsdc: "1000000" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/at its deposit cap/);
  });

  it("allows a deposit that lands exactly on the cap", async () => {
    reads.totalAssets = BigInt(199_000_000);
    const result = await actions.buildAquaDepositTx({ owner: OWNER, amountUsdc: "1000000" });
    expect(result.ok).toBe(true);
  });
});

describe("redeem build", () => {
  it("encodes redeem(shares) against the vault", async () => {
    const result = await actions.buildAquaRedeemTx({ owner: OWNER, shares: "500000000" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const decoded = decodeFunctionData({
      abi: PARTY_VAULT_WRITE_ABI,
      data: result.tx.tx.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("redeem");
    expect(decoded.args?.[0]).toBe(BigInt(500_000_000));
  });

  it("refuses more shares than the investor holds", async () => {
    const result = await actions.buildAquaRedeemTx({ owner: OWNER, shares: "9000000000" });
    expect(result).toMatchObject({ ok: false, code: "INSUFFICIENT_SHARES" });
  });

  /**
   * FE-R5 in one test: the honest illiquid state. The money is not lost, it is committed to a
   * live band, and the message has to say so rather than surface a bare revert.
   */
  it("names the temporarily-illiquid state and how much IS available", async () => {
    reads.convertToAssets = BigInt(9_500_000);
    reads.liquidUsdc = BigInt(9_000_000);
    const result = await actions.buildAquaRedeemTx({ owner: OWNER, shares: "500000000" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("TEMPORARILY_ILLIQUID");
    expect(result.message).toContain("$9.00");
    expect(result.message).toMatch(/committed to a buy band/);
  });
});

describe("input validation, before any chain read", () => {
  it.each(["0", "", "-1", "1.5", "abc", "1e6"])("rejects the amount %s", async (amount) => {
    const result = await actions.buildAquaDepositTx({ owner: OWNER, amountUsdc: amount });
    expect(result).toMatchObject({ ok: false, code: "BAD_AMOUNT" });
  });

  it("rejects a malformed owner", async () => {
    const result = await actions.buildAquaDepositTx({ owner: "0xnope", amountUsdc: "1000000" });
    expect(result).toMatchObject({ ok: false, code: "BAD_OWNER" });
  });

  it("refuses every build when no vault is configured", async () => {
    vi.stubEnv("AQUA_VAULT_ADDRESS", "");
    const fresh = await import("./aquaActions");
    for (const result of [
      await fresh.buildAquaApproveTx({ owner: OWNER, amountUsdc: "1" }),
      await fresh.buildAquaDepositTx({ owner: OWNER, amountUsdc: "1" }),
      await fresh.buildAquaRedeemTx({ owner: OWNER, shares: "1" }),
    ]) {
      expect(result).toMatchObject({ ok: false, code: "VAULT_NOT_CONFIGURED" });
    }
  });
});
