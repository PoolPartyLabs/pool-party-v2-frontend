import type { SolanaBootstrapAuthorization } from "./binding";
import type { SolanaBootstrapManifest } from "./bootstrap";

export const bootstrapManifestFixture: SolanaBootstrapManifest = {
  policyHash: `0x${"03".repeat(32)}`,
  payload: `0x${"ab".repeat(1250)}`,
};

export const bootstrapAuthorizationFixture: SolanaBootstrapAuthorization = {
  hubChainId: 42161,
  factory: `0x${"03".repeat(20)}`,
  fund: `0x${"02".repeat(20)}`,
  spokeAddress: "11111111111111111111111111111111",
  spokeChainId: "1",
  nativeMandateHash: `0x${"00".repeat(31)}07`,
  nonce: "9",
  expiry: "2000000000",
  mandateHash: `0x${"00".repeat(31)}02`,
  policyHash: bootstrapManifestFixture.policyHash,
  spokeIndex: 1,
  program: "Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHGfVNLusVw",
  fundPda: "11111111111111111111111111111111",
  usdcAta: "11111111111111111111111111111111",
  tslaxAta: "11111111111111111111111111111111",
  nvdaxAta: "11111111111111111111111111111111",
  wsolAta: "11111111111111111111111111111111",
  fundId: `0x${"00".repeat(31)}01`,
};
