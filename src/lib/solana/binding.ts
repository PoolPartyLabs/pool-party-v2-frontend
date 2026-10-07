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

export interface SolanaBootstrapAuthorization extends SolanaBindingAuthorization {
  mandateHash: Hex;
  policyHash: Hex;
  spokeIndex: number;
  program: string;
  fundPda: string;
  usdcAta: string;
  tslaxAta: string;
  nvdaxAta: string;
  wsolAta: string;
  fundId: Hex;
}

export const SOLANA_BOOTSTRAP_TYPES = {
  SolanaBootstrap: [
    { name: "hubChain", type: "uint256" },
    { name: "core", type: "address" },
    { name: "mandateHash", type: "bytes32" },
    { name: "policyHash", type: "bytes32" },
    { name: "spokeIndex", type: "uint16" },
    { name: "program", type: "bytes32" },
    { name: "fundPda", type: "bytes32" },
    { name: "solanaKey", type: "bytes32" },
    { name: "usdcAta", type: "bytes32" },
    { name: "tslaxAta", type: "bytes32" },
    { name: "nvdaxAta", type: "bytes32" },
    { name: "wsolAta", type: "bytes32" },
    { name: "nativeMandateHash", type: "bytes32" },
    { name: "fundId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

function publicKeyWord(value: string): Hex {
  return bytesToHex(new Uint8Array(getAddressEncoder().encode(address(value))));
}

/** DEC-190, DEC-200: #47/#48 bootstrap consent, separate from legacy Hub binding. */
export function solanaBootstrapTypedData(
  solanaAddress: string,
  authorization: SolanaBootstrapAuthorization,
) {
  const legacy = managerSolanaBindingTypedData(solanaAddress, authorization);
  if (
    !Number.isInteger(authorization.spokeIndex) ||
    authorization.spokeIndex < 0 ||
    authorization.spokeIndex > 65535 ||
    [authorization.mandateHash, authorization.policyHash, authorization.fundId].some(
      (value) => !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value),
    )
  )
    throw new Error("SOLANA_BOOTSTRAP_INVALID");
  return {
    domain: legacy.domain,
    primaryType: "SolanaBootstrap",
    types: SOLANA_BOOTSTRAP_TYPES,
    message: {
      hubChain: BigInt(authorization.hubChainId),
      core: authorization.fund,
      mandateHash: authorization.mandateHash,
      policyHash: authorization.policyHash,
      spokeIndex: authorization.spokeIndex,
      program: publicKeyWord(authorization.program),
      fundPda: publicKeyWord(authorization.fundPda),
      solanaKey: publicKeyWord(solanaAddress),
      usdcAta: publicKeyWord(authorization.usdcAta),
      tslaxAta: publicKeyWord(authorization.tslaxAta),
      nvdaxAta: publicKeyWord(authorization.nvdaxAta),
      wsolAta: publicKeyWord(authorization.wsolAta),
      nativeMandateHash: authorization.nativeMandateHash,
      fundId: authorization.fundId,
      nonce: uint256(authorization.nonce),
      expiry: uint256(authorization.expiry),
    },
  } as const;
}

export function solanaBootstrapDigest(
  solanaAddress: string,
  authorization: SolanaBootstrapAuthorization,
): Hex {
  return hashTypedData(solanaBootstrapTypedData(solanaAddress, authorization));
}

function uint256(value: string): bigint {
  if (typeof value !== "string" || value.length > 78 || !/^(0|[1-9]\d*)$/.test(value))
    throw new Error("SOLANA_BINDING_INVALID");
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
  bootstrapAuthorization?: SolanaBootstrapAuthorization;
  bootstrapSignature?: Hex;
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
  if (binding.bootstrapAuthorization || binding.bootstrapSignature) {
    if (!binding.bootstrapAuthorization || !binding.bootstrapSignature) return false;
    if (
      Object.entries(binding.authorization).some(
        ([field, value]) =>
          binding.bootstrapAuthorization?.[field as keyof SolanaBindingAuthorization] !== value,
      ) ||
      !(await verifyTypedData({
        ...solanaBootstrapTypedData(binding.solanaAddress, binding.bootstrapAuthorization),
        address: binding.manager,
        signature: binding.bootstrapSignature,
      }))
    )
      return false;
  }
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
  bootstrapAuthorization?: SolanaBootstrapAuthorization;
  codec: BindingCodec;
  signTypedData: (data: TypedDataDefinition) => Promise<Hex>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<ManagerSolanaBinding> {
  address(input.solanaAddress);
  const evmSignature = await input.signTypedData(
    managerSolanaBindingTypedData(input.solanaAddress, input.authorization),
  );
  const bootstrapSignature = input.bootstrapAuthorization
    ? await input.signTypedData(
        solanaBootstrapTypedData(input.solanaAddress, input.bootstrapAuthorization),
      )
    : undefined;
  const partial = {
    manager: input.manager,
    solanaAddress: input.solanaAddress,
    fundContext: input.fundContext,
    authorization: input.authorization,
    evmSignature,
    bootstrapAuthorization: input.bootstrapAuthorization,
    bootstrapSignature,
  };
  const binding = {
    ...partial,
    acceptance: Array.from(await input.signMessage(input.codec.acceptanceMessage(partial))),
  };
  if (!(await verifyManagerSolanaBinding(binding, input.codec)))
    throw new Error("SOLANA_BINDING_INVALID");
  return binding;
}
