import { encodeAbiParameters, encodeEventTopics, parseAbi, type TransactionReceipt } from "viem";
import { describe, expect, it } from "vitest";
import { decodeLaunchReceipt } from "./receipt";

describe("receipt-derived net principal [R2, R3]", () => {
  it("R1 uses the seeded net capital rather than inferring dollars from share count", () => {
    const abi = parseAbi([
      "event FundSeeded(address indexed manager, uint256 usdcAmount, uint256 flowFee, uint256 shares)",
    ]);
    const manager = `0x${"12".repeat(20)}` as const;
    const core = `0x${"34".repeat(20)}` as const;
    const receipt = {
      logs: [
        {
          address: core,
          topics: encodeEventTopics({ abi, eventName: "FundSeeded", args: { manager } }),
          data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [BigInt("1995000"), BigInt("5000"), BigInt("2000000000000000000")],
          ),
        },
      ],
    } as unknown as TransactionReceipt;
    expect(decodeLaunchReceipt(receipt)).toMatchObject({
      seeded: { principal: "1995000", flowFee: "5000" },
    });
  });
  it("R1 decodes actual hub allocation and leaf conversion spend from receipts", () => {
    const abi = parseAbi([
      "event AllocatedToHubSpokeVault(uint256 amount)",
      "event Swapped(address indexed adapter, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 spotOut, uint16 maxLossBps, uint256 minOut)",
    ]);
    const adapter = `0x${"12".repeat(20)}` as const;
    const tokenIn = `0x${"34".repeat(20)}` as const;
    const tokenOut = `0x${"56".repeat(20)}` as const;
    const receipt = {
      logs: [
        {
          address: adapter,
          topics: encodeEventTopics({ abi, eventName: "AllocatedToHubSpokeVault" }),
          data: encodeAbiParameters([{ type: "uint256" }], [BigInt("1197000")]),
        },
        {
          address: adapter,
          topics: encodeEventTopics({
            abi,
            eventName: "Swapped",
            args: { adapter, tokenIn, tokenOut },
          }),
          data: encodeAbiParameters(
            [
              { type: "uint256" },
              { type: "uint256" },
              { type: "uint256" },
              { type: "uint16" },
              { type: "uint256" },
            ],
            [
              BigInt("47638"),
              BigInt("17635116476090"),
              BigInt("17636969552830"),
              200,
              BigInt("17287682093005"),
            ],
          ),
        },
      ],
    } as unknown as TransactionReceipt;
    expect(decodeLaunchReceipt(receipt)).toMatchObject({
      allocated: "1197000",
      swapped: { tokenIn, tokenOut, amountIn: "47638", amountOut: "17635116476090" },
    });
  });
  it("derives seeded principal from actual whole share mint, not the budget", () => {
    const abi = parseAbi([
      "event FundSeeded(address indexed manager, uint256 usdcAmount, uint256 flowFee, uint256 shares)",
    ]);
    const manager = `0x${"12".repeat(20)}` as const;
    const core = `0x${"34".repeat(20)}` as const;
    const receipt = {
      logs: [
        {
          address: core,
          topics: encodeEventTopics({ abi, eventName: "FundSeeded", args: { manager } }),
          data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [BigInt("99000000"), BigInt("250000"), BigInt("99000000000000000000")],
          ),
        },
      ],
    } as unknown as TransactionReceipt;
    expect(decodeLaunchReceipt(receipt)).toMatchObject({
      seeded: { core, manager, principal: "99000000", flowFee: "250000" },
    });
  });
});
