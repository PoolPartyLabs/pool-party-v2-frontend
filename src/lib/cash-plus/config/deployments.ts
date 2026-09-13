/** @id PP-CP-LIB-004 @name Cash+ deployment binding @implements-rules-version v1 */
import { z } from "zod";
import type { CashPlusMode } from "../types";
import generatedDeployment from "./deployment.generated.json";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((value) => !/^0x0{40}$/.test(value));
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const token = z.object({
  address,
  symbol: z.string().min(1).max(20),
  decimals: z.number().int().min(0).max(18),
});
export const cashPlusDeploymentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    runId: z.string().min(1),
    mode: z.enum(["fork", "live"]),
    chainId: z.number().int().positive(),
    networkName: z.string().min(1),
    rpcUrl: z.string().url(),
    deploymentBlock: z.string().regex(/^[1-9]\d*$/),
    deploymentBlockHash: hash,
    vault: address,
    aqua: address,
    router: address,
    aavePool: address,
    usdc: token,
    secondary: token,
    usdcAdapter: address,
    secondaryAdapter: address.nullable(),
    usdcAToken: address,
    secondaryAToken: address.nullable(),
    pricing: address,
    programFactory: address,
    oracle: address,
    usdcFeed: address,
    secondaryFeed: address,
    sequencerFeed: address,
    explorerUrl: z.string().url().nullable(),
    codeHashes: z.array(z.object({ address, hash })).min(5),
    source: z.object({
      chainId: z.literal(42161),
      blockNumber: z.string().regex(/^\d+$/),
      swapVmCommit: z.string().regex(/^[0-9a-f]{40}$/),
    }),
  })
  .strict();

export type CashPlusDeployment = z.infer<typeof cashPlusDeploymentSchema>;

export function parseCashPlusDeployment(input: unknown): CashPlusDeployment {
  const parsed = cashPlusDeploymentSchema.safeParse(input);
  if (!parsed.success) throw new Error("DEPLOYMENT_INVALID");
  const value = parsed.data;
  const rpc = new URL(value.rpcUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname);
  if (
    rpc.username ||
    rpc.password ||
    rpc.search ||
    rpc.hash ||
    value.usdc.decimals !== 6 ||
    value.usdc.address.toLowerCase() === value.secondary.address.toLowerCase()
  )
    throw new Error("DEPLOYMENT_INVALID");
  if (
    value.mode === "fork" &&
    (value.chainId !== 31337 || !loopback || rpc.protocol !== "http:" || value.explorerUrl !== null)
  )
    throw new Error("DEPLOYMENT_INVALID");
  if (value.mode === "live" && (value.chainId !== 42161 || loopback || rpc.protocol !== "https:"))
    throw new Error("DEPLOYMENT_INVALID");
  if (!value.codeHashes.some((item) => item.address.toLowerCase() === value.vault.toLowerCase()))
    throw new Error("DEPLOYMENT_INVALID");
  return value;
}

export function cashPlusMode(): CashPlusMode {
  const value = process.env.NEXT_PUBLIC_CASH_PLUS_MODE ?? "preview";
  if (value !== "preview" && value !== "fork" && value !== "live")
    throw new Error("DEPLOYMENT_INVALID");
  return value;
}

export function getCashPlusDeployment(): CashPlusDeployment | null {
  if (cashPlusMode() === "preview") return null;
  const deployment = parseCashPlusDeployment(generatedDeployment);
  if (deployment.mode !== cashPlusMode()) throw new Error("DEPLOYMENT_MISMATCH");
  return deployment;
}
