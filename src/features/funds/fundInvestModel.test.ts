import { describe, expect, it } from "vitest";
import { validateDepositPreview, validateFundDepositBuild } from "./fundInvestModel";

const wallet = `0x${"1".repeat(40)}`;
const core = `0x${"2".repeat(40)}`;
const preview = {
  sharesMinted: "1000000000000000000",
  usdcCharged: "1005000",
  flowFee: "5000",
  refundToCaller: "995000",
  sharePrice: "1000000000000000000000000",
};
describe("POO-2248 deposit boundary", () => {
  it("[R5] requires all fields, whole shares and coherent exact budget", () => {
    expect(validateDepositPreview(preview, "2000000")).toEqual(preview);
    expect(() => validateDepositPreview({ ...preview, flowFee: undefined }, "2000000")).toThrow();
    expect(() => validateDepositPreview({ ...preview, sharesMinted: "1" }, "2000000")).toThrow();
    expect(() => validateDepositPreview(preview, "1999999")).toThrow();
  });
  it("[R4,R5] permits only exact core deposit intent or exact token approval", () => {
    expect(() =>
      validateFundDepositBuild({ transactions: [], preview }, core, wallet, wallet, "2000000", "0"),
    ).toThrow();
  });
});

it("[R4,R5] validates exact raw deposit protection and approval spender", async () => {
  const { encodeFunctionData, erc20Abi } = await import("viem");
  const { depositAbi } = await import("./fundInvestModel");
  const tx = {
    protocolVersion: "v2" as const,
    to: core,
    from: wallet,
    chainId: 42161 as const,
    value: "0",
    data: encodeFunctionData({
      abi: depositAbi,
      functionName: "deposit",
      args: [2000000n, 1000000000000000000n],
    }),
  };
  expect(
    validateFundDepositBuild(
      { protocolVersion: "v2", transactions: [tx], preview },
      core,
      wallet,
      wallet,
      "2000000",
      "1000000000000000000",
    ),
  ).toEqual(preview);
  expect(() =>
    validateFundDepositBuild(
      { protocolVersion: "v2", transactions: [tx], preview },
      core,
      wallet,
      wallet,
      "2000000",
      "0",
    ),
  ).toThrow();
  const approval = {
    ...tx,
    to: wallet,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [core as `0x${string}`, 2000000n],
    }),
  };
  expect(
    validateFundDepositBuild(
      { protocolVersion: "v2", transactions: [approval], preview: null, nextAction: "approve" },
      core,
      wallet,
      wallet,
      "2000000",
      "0",
    ),
  ).toBeNull();
});
