import { address, getAddressEncoder } from "@solana/kit";
import {
  type Address,
  bytesToHex,
  type Hex,
  hashTypedData,
  type TypedDataDefinition,
  verifyTypedData,
} from "viem";

export interface SolanaBindingAuthorization {
  hubChainId: number;
  factory: Address;
  fund: Address;
  spokeAddress: string;
  spokeChainId: string;
  nativeMandateHash: Hex;
  nonce: string;
  expiry: string;
}

export const MANAGER_SOLANA_BINDING_TYPES = {
  ManagerSolanaBinding: [
    { name: "solanaKey", type: "bytes32" },
    { name: "fund", type: "address" },
    { name: "spoke", type: "bytes32" },
    { name: "spokeChainId", type: "uint256" },
    { name: "nativeMandateHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

function uint256(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("SOLANA_BINDING_INVALID");
  const parsed = BigInt(value);
  if (parsed >= BigInt(2) ** BigInt(256)) throw new Error("SOLANA_BINDING_INVALID");
  return parsed;
}

/** DEC-190: matches FundFactoryV6 and SolanaDeploymentV6, not a draft-id signature. */
export function managerSolanaBindingTypedData(
  solanaAddress: string,
  authorization: SolanaBindingAuthorization,
) {
  if (
    authorization.hubChainId !== 42161 ||
    !/^0x[0-9a-fA-F]{64}$/.test(authorization.nativeMandateHash)
  )
    throw new Error("SOLANA_BINDING_INVALID");
  return {
    domain: {
      name: "PoolParty Solana Fund",
      version: "6",
      chainId: authorization.hubChainId,
      verifyingContract: authorization.factory,
    },
    primaryType: "ManagerSolanaBinding",
    types: MANAGER_SOLANA_BINDING_TYPES,
    message: {
      solanaKey: bytesToHex(new Uint8Array(getAddressEncoder().encode(address(solanaAddress)))),
      fund: authorization.fund,
      spoke: bytesToHex(
        new Uint8Array(getAddressEncoder().encode(address(authorization.spokeAddress))),
      ),
      spokeChainId: uint256(authorization.spokeChainId),
      nativeMandateHash: authorization.nativeMandateHash,
      nonce: uint256(authorization.nonce),
      expiry: uint256(authorization.expiry),
    },
  } as const;
}

export function managerSolanaBindingDigest(
  solanaAddress: string,
  authorization: SolanaBindingAuthorization,
): Hex {
  return hashTypedData(managerSolanaBindingTypedData(solanaAddress, authorization));
}

export interface ManagerSolanaBinding {
  manager: Address;
  solanaAddress: string;
  fundContext: string;
  authorization: SolanaBindingAuthorization;
  evmSignature: Hex;
  acceptance: number[];
}

export interface BindingCodec {
  /** TODO(interface): API/program owner must define off-chain Solana acceptance bytes. */
  acceptanceMessage(binding: Omit<ManagerSolanaBinding, "acceptance">): Uint8Array;
}

/** DEC-190: verify both signatures; linking wallets in Privy is not Fund authorization. */
export async function verifyManagerSolanaBinding(
  binding: ManagerSolanaBinding,
  codec: BindingCodec,
): Promise<boolean> {
  const validEvm = await verifyTypedData({
    ...managerSolanaBindingTypedData(binding.solanaAddress, binding.authorization),
    address: binding.manager,
    signature: binding.evmSignature,
  });
  if (!validEvm || binding.acceptance.length !== 64) return false;
  const publicKey = getAddressEncoder().encode(address(binding.solanaAddress));
  const key = await crypto.subtle.importKey("raw", new Uint8Array(publicKey), "Ed25519", false, [
    "verify",
  ]);
  return crypto.subtle.verify(
    "Ed25519",
    key,
    new Uint8Array(binding.acceptance),
    new Uint8Array(codec.acceptanceMessage(binding)),
  );
}

/** DEC-190: fixed Hub consent plus Solana countersign; acceptance codec remains explicit. */
export async function signManagerSolanaBinding(input: {
  manager: Address;
  solanaAddress: string;
  fundContext: string;
  authorization: SolanaBindingAuthorization;
  codec: BindingCodec;
  signTypedData: (data: TypedDataDefinition) => Promise<Hex>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<ManagerSolanaBinding> {
  address(input.solanaAddress);
  const evmSignature = await input.signTypedData(
    managerSolanaBindingTypedData(input.solanaAddress, input.authorization),
  );
  const partial = {
    manager: input.manager,
    solanaAddress: input.solanaAddress,
    fundContext: input.fundContext,
    authorization: input.authorization,
    evmSignature,
  };
  const binding = {
    ...partial,
    acceptance: Array.from(await input.signMessage(input.codec.acceptanceMessage(partial))),
  };
  if (!(await verifyManagerSolanaBinding(binding, input.codec)))
    throw new Error("SOLANA_BINDING_INVALID");
  return binding;
}
