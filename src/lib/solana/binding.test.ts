// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { address, getAddressDecoder, getAddressEncoder } from "@solana/kit";
import { bytesToHex, concatHex, encodeAbiParameters, hexToBytes, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { expect, it } from "vitest";
import {
  managerSolanaBindingDigest,
  managerSolanaBindingTypedData,
  type SolanaBindingAuthorization,
  signManagerSolanaBinding,
  solanaBootstrapDigest,
  verifyManagerSolanaBinding,
} from "./binding";
import { bootstrapAuthorizationFixture } from "./bootstrap.fixture";

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

const bootstrapAuthorization = {
  ...bootstrapAuthorizationFixture,
  ...authorization,
  spokeIndex: 0,
  policyHash: toHex(BigInt(11), { size: 32 }),
  fundPda: "9qHz9JpvLwuv9VothPFmCPShQQ75BdhhcZiV3bHXXaJM",
  usdcAta: "AK5xYTKS5P3biopu9YqQ8eihLbpFCBp8crcJg7DX82F1",
  tslaxAta: "H7H2QZbeCkQ1SBdVp2szcsuySbpKgoHpfoAR8gAoCT8C",
  nvdaxAta: "5t1Ww84P9VJptFAeHqNd8RbLxq6j1iLLipYvg6jU4YZ8",
  wsolAta: "4RKx6vBrBFXzWP1Z6yiP7Pv6bZ7SCfF9R3sX9Rwp6ECG",
};

it("matches production bootstrap using independent Solidity ABI words", () => {
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
  const typeHash = keccak256(
    toHex(
      "SolanaBootstrap(uint256 hubChain,address core,bytes32 mandateHash,bytes32 policyHash,uint16 spokeIndex,bytes32 program,bytes32 fundPda,bytes32 solanaKey,bytes32 usdcAta,bytes32 tslaxAta,bytes32 nvdaxAta,bytes32 wsolAta,bytes32 nativeMandateHash,bytes32 fundId,uint256 nonce,uint256 expiry)",
    ),
  );
  const message = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint16" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        typeHash,
        BigInt(42161),
        authorization.fund,
        bootstrapAuthorization.mandateHash,
        bootstrapAuthorization.policyHash,
        0,
        bytesToHex(
          new Uint8Array(getAddressEncoder().encode(address(bootstrapAuthorization.program))),
        ),
        bytesToHex(
          new Uint8Array(getAddressEncoder().encode(address(bootstrapAuthorization.fundPda))),
        ),
        `0x${"04".repeat(32)}`,
        "0x8a5b3e14e0cbe95aba0d465d82a95fbb883af06d2c021072ec3b646c46709cc8",
        "0xef56982735ad049bc6cf11a2172d499d6d8e09843378c3071bd260b197a849c1",
        "0x487ff3d7c8c990b90aeb07a77fbf7709e9288dc7dd4d24ecfde5adb6755c41cb",
        "0x32ce6d546d3efe2e7da2da777bbda0b0f62b7b70d4afa5ff27d6d3e8ebf889d9",
        authorization.nativeMandateHash,
        bootstrapAuthorization.fundId,
        BigInt(9),
        BigInt(2000000000),
      ],
    ),
  );
  const digest = keccak256(concatHex(["0x1901", domain, message]));
  expect(digest).toBe("0xa8cd16b93992f6b5199098ea80787725d3182a00cfd2f579f5949e1bbc400fb7");
  expect(solanaBootstrapDigest(solanaAddress, bootstrapAuthorization)).toBe(digest);
});

it.each([
  "policyHash",
  "mandateHash",
  "fundId",
  "fundPda",
  "usdcAta",
  "tslaxAta",
  "nvdaxAta",
  "wsolAta",
  "spokeIndex",
] as const)("binds bootstrap member %s independently of legacy consent", (field) => {
  const value =
    field === "spokeIndex"
      ? 1
      : field.endsWith("Hash") || field === "fundId"
        ? toHex(BigInt(99), { size: 32 })
        : solanaAddress;
  expect(
    solanaBootstrapDigest(solanaAddress, { ...bootstrapAuthorization, [field]: value }),
  ).not.toBe(solanaBootstrapDigest(solanaAddress, bootstrapAuthorization));
});

it("refuses a substituted program before requesting bootstrap consent", () => {
  expect(() =>
    solanaBootstrapDigest(solanaAddress, { ...bootstrapAuthorization, program: solanaAddress }),
  ).toThrow("SOLANA_PROGRAM_MISMATCH");
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

it("verifies both EVM consents and rejects a substituted bootstrap policy", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const walletAddress = getAddressDecoder().decode(
    publicKey.export({ type: "spki", format: "der" }).subarray(-32),
  );
  const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const binding = await signManagerSolanaBinding({
    manager: account.address,
    solanaAddress: walletAddress,
    fundContext: "draft",
    authorization,
    bootstrapAuthorization,
    codec: {
      acceptanceMessage: (value) => {
        if (!value.bootstrapAuthorization) throw new Error("FIXTURE_MISSING");
        return hexToBytes(solanaBootstrapDigest(value.solanaAddress, value.bootstrapAuthorization));
      },
    },
    signTypedData: (data) => account.signTypedData(data),
    signMessage: async (message) => new Uint8Array(sign(null, message, privateKey)),
  });
  const codec = {
    acceptanceMessage: (value: typeof binding) => {
      if (!value.bootstrapAuthorization) throw new Error("FIXTURE_MISSING");
      return hexToBytes(solanaBootstrapDigest(value.solanaAddress, value.bootstrapAuthorization));
    },
  };
  expect(await verifyManagerSolanaBinding(binding, codec)).toBe(true);
  expect(
    await verifyManagerSolanaBinding(
      {
        ...binding,
        bootstrapAuthorization: {
          ...bootstrapAuthorization,
          policyHash: toHex(BigInt(12), { size: 32 }),
        },
      },
      codec,
    ),
  ).toBe(false);
  expect(
    await verifyManagerSolanaBinding({ ...binding, bootstrapSignature: undefined }, codec),
  ).toBe(false);
});

it.each([
  "-1",
  "1.5",
  "01",
  "",
  "9".repeat(79),
  (BigInt(2) ** BigInt(256)).toString(),
])("rejects invalid nonce %s", (nonce) => {
  expect(() => managerSolanaBindingTypedData(solanaAddress, { ...authorization, nonce })).toThrow(
    "SOLANA_BINDING_INVALID",
  );
});

it("rejects numeric JSON integers instead of coercing them", () => {
  expect(() =>
    managerSolanaBindingTypedData(solanaAddress, {
      ...authorization,
      nonce: 9 as unknown as string,
    }),
  ).toThrow("SOLANA_BINDING_INVALID");
});

it("preserves full-width unsigned integers without JSON bigint storage", () => {
  const nonce = (BigInt(2) ** BigInt(256) - BigInt(1)).toString();
  expect(
    managerSolanaBindingTypedData(solanaAddress, { ...authorization, nonce }).message.nonce,
  ).toBe(BigInt(nonce));
  expect(JSON.parse(JSON.stringify({ ...authorization, nonce })).nonce).toBe(nonce);
});
