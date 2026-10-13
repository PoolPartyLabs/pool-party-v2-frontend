import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { hexToBytes } from "viem";
import type { SolanaBootstrapAuthorization } from "./binding";
import type { PpSpoke } from "./generated/pp_spoke";
import idl from "./generated/pp_spoke.json";

export const SOLANA_SPOKE_PROGRAM = address(
  "7PptZ653uyn5eoAFKqs4DXR1ijxH6sf49f2YAGMLTfCx" satisfies PpSpoke["address"],
);

export const SOLANA_SPOKE_RELEASE = Object.freeze({
  sourceCommit: "f40f0106ffd1cc0273c58cf99466efb889456f11",
  upstreamIdlSha256: "305cc4d5d38667fe2c6353123b7fd0ae0df3f078d8c435dc168dc223143ec24b",
  copiedIdlSha256: "e82538e0acd6e4da6cc744b4aaa059872c785fa05075a47c7e131ddedeed1d2e",
  copiedTypesSha256: "5c4e1869ebdc4c4742c7febf6da9a84712ccda5bd3d64de25a84d39cc4dc2923",
  scopeEnabled: false,
});

export function requireSolanaSpokeProgram(program: string): void {
  if (program !== SOLANA_SPOKE_PROGRAM || idl.address !== SOLANA_SPOKE_PROGRAM)
    throw new Error("SOLANA_PROGRAM_MISMATCH");
}

export function solanaBootstrapDiscriminator(instruction: "stage_swap_policy" | "initialize_fund") {
  const definition = idl.instructions.find((entry) => entry.name === instruction);
  if (definition?.discriminator.length !== 8) throw new Error("SOLANA_IDL_MISMATCH");
  return new Uint8Array(definition.discriminator);
}

/** DEC-190, DEC-200: match f40f010 Fund/vault/staging namespaces, never cached scaffold PDAs. */
export async function deriveSolanaBootstrapPdas(
  authorization: SolanaBootstrapAuthorization,
  manager: string,
) {
  requireSolanaSpokeProgram(authorization.program);
  if (
    authorization.hubChainId !== 42161 ||
    !Number.isInteger(authorization.spokeIndex) ||
    authorization.spokeIndex < 0 ||
    authorization.spokeIndex > 65535 ||
    !/^0x[0-9a-fA-F]{40}$/.test(authorization.fund) ||
    !/^0x[0-9a-fA-F]{64}$/.test(authorization.policyHash) ||
    /^0x0{64}$/.test(authorization.policyHash)
  )
    throw new Error("SOLANA_BOOTSTRAP_INVALID");
  const hubChain = new Uint8Array(8);
  new DataView(hubChain.buffer).setBigUint64(0, BigInt(authorization.hubChainId), true);
  const spokeIndex = new Uint8Array(2);
  new DataView(spokeIndex.buffer).setUint16(0, authorization.spokeIndex, true);
  const [fund] = await getProgramDerivedAddress({
    programAddress: SOLANA_SPOKE_PROGRAM,
    seeds: [
      new TextEncoder().encode("fund"),
      hubChain,
      hexToBytes(authorization.fund),
      spokeIndex,
      hexToBytes(authorization.policyHash),
    ],
  });
  const encoder = getAddressEncoder();
  const [vault] = await getProgramDerivedAddress({
    programAddress: SOLANA_SPOKE_PROGRAM,
    seeds: [new TextEncoder().encode("vault"), encoder.encode(fund)],
  });
  const [stage] = await getProgramDerivedAddress({
    programAddress: SOLANA_SPOKE_PROGRAM,
    seeds: [
      new TextEncoder().encode("swap_policy_stage"),
      encoder.encode(fund),
      encoder.encode(address(manager)),
    ],
  });
  return { fund, vault, stage };
}
