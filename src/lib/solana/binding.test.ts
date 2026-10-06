// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { getAddressDecoder } from "@solana/kit";
import { bytesToHex, concatHex, encodeAbiParameters, hexToBytes, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { expect, it } from "vitest";
import {
  managerSolanaBindingDigest,
  managerSolanaBindingTypedData,
  type SolanaBindingAuthorization,
  signManagerSolanaBinding,
  verifyManagerSolanaBinding,
} from "./binding";

const solanaAddress = getAddressDecoder().decode(new Uint8Array(32).fill(4));
const authorization: SolanaBindingAuthorization = {
  hubChainId: 42161,
  factory: `0x${"03".repeat(20)}`,
  fund: `0x${"02".repeat(20)}`,
  spokeAddress: getAddressDecoder().decode(
    hexToBytes("0x07f093b39a102fb41eb5f221512e72f5af084d7db72b1a5158313f7db556efbd"),
  ),
  spokeChainId: "1",
  nativeMandateHash: toHex(BigInt(7), { size: 32 }),
  nonce: "9",
  expiry: "2000000000",
};

it("matches the independent Hub/Rust golden digest with Solidity ABI encoding", () => {
  const domain = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(
          toHex(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
          ),
        ),
        keccak256(toHex("PoolParty Solana Fund")),
        keccak256(toHex("6")),
        BigInt(42161),
        authorization.factory,
      ],
    ),
  );
  const message = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        keccak256(
          toHex(
            "ManagerSolanaBinding(bytes32 solanaKey,address fund,bytes32 spoke,uint256 spokeChainId,bytes32 nativeMandateHash,uint256 nonce,uint256 expiry)",
          ),
        ),
        `0x${"04".repeat(32)}`,
        authorization.fund,
        "0x07f093b39a102fb41eb5f221512e72f5af084d7db72b1a5158313f7db556efbd",
        BigInt(1),
        authorization.nativeMandateHash,
        BigInt(9),
        BigInt(2000000000),
      ],
    ),
  );
  const digest = keccak256(concatHex(["0x1901", domain, message]));
  expect(digest).toBe("0x7f0d0fe3056003fb4654f099f5bf8831906d1f6837fd70f880e0980f6d924dc4");
  expect(managerSolanaBindingDigest(solanaAddress, authorization)).toBe(digest);
});

it("verifies real EOA and Ed25519 signatures and rejects tuple tampering", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const walletAddress = getAddressDecoder().decode(key);
  const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const codec = {
    acceptanceMessage: (binding: Parameters<typeof verifyManagerSolanaBinding>[0]) =>
      hexToBytes(managerSolanaBindingDigest(binding.solanaAddress, binding.authorization)),
  };
  const binding = await signManagerSolanaBinding({
    manager: account.address,
    solanaAddress: walletAddress,
    fundContext: "local-draft",
    authorization,
    codec,
    signTypedData: (data) => account.signTypedData(data),
    signMessage: async (message) => new Uint8Array(sign(null, message, privateKey)),
  });
  expect(await verifyManagerSolanaBinding(binding, codec)).toBe(true);
  expect(
    await verifyManagerSolanaBinding(
      { ...binding, authorization: { ...authorization, nonce: "10" } },
      codec,
    ),
  ).toBe(false);
  expect(
    await verifyManagerSolanaBinding({ ...binding, acceptance: Array(64).fill(0) }, codec),
  ).toBe(false);
  expect(bytesToHex(key)).toBe(
    managerSolanaBindingTypedData(walletAddress, authorization).message.solanaKey,
  );
});

it.each([
  "-1",
  "1.5",
  "01",
  "",
  (BigInt(2) ** BigInt(256)).toString(),
])("rejects invalid nonce %s", (nonce) => {
  expect(() => managerSolanaBindingTypedData(solanaAddress, { ...authorization, nonce })).toThrow(
    "SOLANA_BINDING_INVALID",
  );
});

it("preserves full-width unsigned integers without JSON bigint storage", () => {
  const nonce = (BigInt(2) ** BigInt(256) - BigInt(1)).toString();
  expect(
    managerSolanaBindingTypedData(solanaAddress, { ...authorization, nonce }).message.nonce,
  ).toBe(BigInt(nonce));
  expect(JSON.parse(JSON.stringify({ ...authorization, nonce })).nonce).toBe(nonce);
});
