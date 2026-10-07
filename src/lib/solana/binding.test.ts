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
  fundPda: "DtJ3wso5NbkQNWoeFrdYa4cv4Mb78coXkcV879zSf1vU",
  usdcAta: "BXAvfHQx19AN9D7HFw9i8G23oCgg313YsJkvf6YNx4Hx",
  tslaxAta: "f5HWTsoDVkawoGaRDv7SH1ery1stbJ3XKkTocsKfzR7",
  nvdaxAta: "5BvREnYaFNQfTxNKk2rP56wUUDPq2oHSPjLQGGhv39sT",
  wsolAta: "6u3DQCQw6LhfAgxeTacCM3ntvN9VhK3WzWws7RNAD5ef",
};

it("matches #47/#48 Rust fixture bootstrap using independent Solidity ABI words", () => {
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
        "0x9c4f8416484d86c2d7a6d9cb5746f4289926c7d7bc61a5caa0f296b438ed5fcb",
        "0x09c0ea5663bc4af78d751afbbb3ec31b37ca50130e95f9620856208400fb668a",
        "0x3e3af4a212d25668a7ec6963d097580ec5ca12dd0c600fc8711d06fc7175466e",
        "0x579f23ccf99a178122b56905dffdddf7aa776cfd8230d154ca3254a06f1c41a8",
        authorization.nativeMandateHash,
        bootstrapAuthorization.fundId,
        BigInt(9),
        BigInt(2000000000),
      ],
    ),
  );
  const digest = keccak256(concatHex(["0x1901", domain, message]));
  expect(digest).toBe("0x05405ee3cbacda4303d6ed3404afc02f852fd0ffa09cb9c7e44ac3bb66249092");
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
  "program",
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
