/** @id PP-CP-LIB-020 @name Cash+ canonical CLI encoder @implements-rules-version v1 */
import {
  type Address,
  concatHex,
  encodeAbiParameters,
  type Hex,
  keccak256,
  parseAbiParameters,
  toHex,
} from "viem";
export const B = BigInt;
export const canonicalTraits =
  (B(1) << B(254)) | (B(1) << B(252)) | (B(1) << B(251)) | (B(1) << B(250)) | (B(1) << B(249));
export type ProgramParameters = {
  policyVersion: bigint;
  deadline: bigint;
  salt: Hex;
  usdcVirtualBalance: bigint;
  secondaryVirtualBalance: bigint;
};
export type Order = { maker: Address; traits: bigint; data: Hex };
export function compileOrder(vault: Address, pricing: Address, p: ProgramParameters): Order {
  if (!/^0x[0-9a-fA-F]{64}$/.test(p.salt)) throw new Error("INVALID_CANONICAL_SALT");
  if (
    p.policyVersion < B(1) ||
    p.policyVersion >= B(2) ** B(64) ||
    p.deadline < B(1) ||
    p.deadline >= B(2) ** B(40)
  )
    throw new Error("INVALID_CANONICAL_PARAMETERS");
  return {
    maker: vault,
    traits: canonicalTraits,
    data: concatHex([
      "0x0d05",
      toHex(p.deadline, { size: 5 }),
      "0x201c",
      pricing,
      toHex(p.policyVersion, { size: 8 }),
      "0x1420",
      p.salt,
    ]),
  };
}
export function encodeOrder(order: Order): Hex {
  return encodeAbiParameters(parseAbiParameters("(address maker,uint256 traits,bytes data)"), [
    order,
  ]);
}
export function orderHash(order: Order): Hex {
  return keccak256(encodeOrder(order));
}
export function takerTraits(
  minimumOut: bigint,
  deadline: bigint,
  inputFirst = true,
  exactIn = true,
): Hex {
  if (minimumOut < B(0) || deadline < B(1) || deadline >= B(2) ** B(40))
    throw new Error("INVALID_TAKER_PARAMETERS");
  let offsets = B(32) | (B(32) << B(16));
  for (let i = 2; i < 10; i += 1) offsets |= B(37) << B(16 * i);
  const flags = (exactIn ? 1 : 0) | (inputFirst ? 0x20 : 0) | 0x40;
  return concatHex([
    toHex(offsets, { size: 20 }),
    toHex(flags, { size: 2 }),
    toHex(minimumOut, { size: 32 }),
    toHex(deadline, { size: 5 }),
  ]);
}
export function requireLocalForkUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("LOCAL_FORK_REQUIRED");
  return url.toString();
}
