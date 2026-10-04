import { encodeAbiParameters, encodeEventTopics, parseAbi, type TransactionReceipt } from "viem";
import { describe, expect, it } from "vitest";
import { decodeLaunchReceipt } from "./receipt";

describe("receipt-derived net principal [R2, R3]", () => {
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
