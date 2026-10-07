/**
 * @supports PP-MGR-LIB-059 (POO-2262)
 * @name Solana bootstrap test-only fixture
 * @implements-rules-version DEC-200, DEC-201 (founder rulings, unversioned)
 */
import type { SolanaBootstrapAuthorization } from "./binding";
import type { SolanaBootstrapManifest } from "./bootstrap";
import { SOLANA_SPOKE_PROGRAM } from "./release";

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
  program: SOLANA_SPOKE_PROGRAM,
  fundPda: "F7fwcaDdYUzGdF4tqextZqynGGYHce3SuFKVbtoy666s",
  usdcAta: "6n7j2WD2Ydx4tdCsDguzrPRSiWzvYTNVZRsqNQoa7DFJ",
  tslaxAta: "D1EzC79expdRrjPcWCa1k4DvZL1T8FxS1irhwhPcpWso",
  nvdaxAta: "Cobx7xWobwmhh3KXE8f9Mb2CHojM5C32Fj18jJG5naGL",
  wsolAta: "HFJ6LuzV7Q9yrMCv9CCL2bS4Yk1aZ29TD1sVntG2CSBc",
  fundId: `0x${"00".repeat(31)}01`,
};
