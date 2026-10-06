import { address, getAddressEncoder } from "@solana/kit";
import { type Address, type Hex, type TypedDataDefinition, verifyTypedData } from "viem";

export interface ManagerSolanaBinding {
  manager: Address;
  solanaAddress: string;
  fundContext: string;
  evmSignature: Hex;
  acceptance: number[];
}

export interface BindingCodec {
  typedData(manager: Address, solanaAddress: string, fundContext: string): TypedDataDefinition;
  acceptanceMessage(binding: Omit<ManagerSolanaBinding, "acceptance">): Uint8Array;
}

/** DEC-190: verify both signatures; linking wallets in Privy is not Fund authorization. */
export async function verifyManagerSolanaBinding(
  binding: ManagerSolanaBinding,
  codec: BindingCodec,
): Promise<boolean> {
  const validEvm = await verifyTypedData({
    ...codec.typedData(binding.manager, binding.solanaAddress, binding.fundContext),
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

/** TODO(interface): T2a must supply the exact EIP-712 domain, fields and acceptance bytes. */
export async function signManagerSolanaBinding(input: {
  manager: Address;
  solanaAddress: string;
  fundContext: string;
  codec: BindingCodec;
  signTypedData: (data: TypedDataDefinition) => Promise<Hex>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<ManagerSolanaBinding> {
  address(input.solanaAddress);
  const evmSignature = await input.signTypedData(
    input.codec.typedData(input.manager, input.solanaAddress, input.fundContext),
  );
  const partial = {
    manager: input.manager,
    solanaAddress: input.solanaAddress,
    fundContext: input.fundContext,
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
