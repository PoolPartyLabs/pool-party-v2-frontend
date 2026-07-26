// @vitest-environment node
//
// The compiler is pure server code and the 1inch SDKs pull in Node builtins ("assert"), which
// jsdom does not provide. Running this suite under node also matches where the code actually
// executes: a server action or a CLI script, never a browser.
import { Interaction } from "@1inch/sdk-core";
import {
  Address,
  AquaProgramBuilder,
  HexString,
  instructions,
  MakerTraits,
  Order,
} from "@1inch/swap-vm-sdk";
import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import {
  AQUA_REGISTRY,
  AQUA_SWAP_VM_ROUTER,
  DEAD_GEN1_ROUTER,
  MAKER_HOOK_DATA,
  TOKENS,
} from "../../config/addresses";
import { bandFromSpot, ethUsdToRawPriceX18, orderPair } from "./band";
import { CompilerPolicyError, compile } from "./compile";
import { MANDATES } from "./mandates";
import { buildDock, buildRoll } from "./roll";
import type { CompileContext, Mandate } from "./types";

/** ETH at $3,000, Chainlink 8dp. */
const SPOT_E8 = BigInt(3000) * BigInt(10) ** BigInt(8);
const USDC = (whole: number) => BigInt(whole) * BigInt(1_000_000);

const VAULT = "0x00000000000000000000000000000000000000A1" as const;

function ctx(overrides: Partial<CompileContext> = {}): CompileContext {
  return {
    maker: VAULT,
    app: AQUA_SWAP_VM_ROUTER,
    spotE8: SPOT_E8,
    totalAssets: USDC(1000),
    epoch: 1,
    now: BigInt(1_800_000_000),
    ...overrides,
  };
}

describe("band math", () => {
  it("orders the pair by address, not by role", () => {
    const { tokenLt, tokenGt } = orderPair(TOKENS.WETH, TOKENS.USDC);
    expect(tokenLt).toBe(TOKENS.WETH);
    expect(tokenGt).toBe(TOKENS.USDC);
  });

  it("converts a Chainlink answer to the USDC-decimal raw price", () => {
    // P = USDC raw per WETH raw, in 1e18 fixed point. For WETH(18dp)/USDC(6dp) that is
    // priceUsd * 1e6, so $3,000 becomes 3_000_000_000.
    expect(ethUsdToRawPriceX18(SPOT_E8)).toBe(BigInt(3_000_000_000));
  });

  /**
   * Ground truth: gen-2 live ship #0 encoded sqrtPriceMin 22760536265061421009 on a
   * WBTC(8dp)/USDC(6dp) band. Squaring it back must land on a sane BTC price, which is what
   * confirms the decimal convention rather than a plausible-looking formula.
   */
  it("round-trips the live ship #0 sqrt price to a sane BTC price", () => {
    const sqrtPrice = BigInt("22760536265061421009");
    const rawPriceX18 = (sqrtPrice * sqrtPrice) / BigInt(10) ** BigInt(18);
    const rawRatio = Number(rawPriceX18) / 1e18; // USDC raw per WBTC raw
    const btcUsd = rawRatio * 10 ** (8 - 6); // undo the decimals difference
    expect(btcUsd).toBeGreaterThan(20_000);
    expect(btcUsd).toBeLessThan(200_000);
  });

  it("places the band strictly below spot", () => {
    const band = bandFromSpot(SPOT_E8, -1500, -500);
    expect(band.lowE8).toBe(BigInt(2550) * BigInt(10) ** BigInt(8));
    expect(band.highE8).toBe(BigInt(2850) * BigInt(10) ** BigInt(8));
    expect(band.highE8).toBeLessThan(band.spotE8);
  });

  it("refuses non-negative offsets and inverted bands", () => {
    expect(() => bandFromSpot(SPOT_E8, -500, 100)).toThrow(/must be negative/);
    expect(() => bandFromSpot(SPOT_E8, -100, -500)).toThrow(/further below spot/);
    expect(() => bandFromSpot(BigInt(0), -1500, -500)).toThrow(/must be positive/);
  });
});

describe("compile: canonical program order (PRG-R1 v3)", () => {
  it("emits [deadline][concentrate][flatFee][xycSwap][salt] and nothing else", () => {
    const result = compile("production", MANDATES.production, ctx());
    const names = AquaProgramBuilder.decode(new HexString(result.program) as never)
      .getInstructions()
      .map((ix) => ix.opcode.id.description);

    expect(names).toEqual([
      "Controls.deadline",
      "XYCConcentrate.concentrateGrowLiquidity2D",
      "Fee.flatFeeAmountInXD",
      "XYCSwap.xycSwapXD",
      "Controls.salt",
    ]);
  });

  it("includes xycSwapXD, without which the program has no executing curve", () => {
    // Regression guard for the v2 order. A concentrate-only program quotes zero output and
    // reverts with TakerTraitsAmountOutMustBeGreaterThanZero on the deployed router.
    const result = compile("production", MANDATES.production, ctx());
    expect(result.instructions.some((line) => line.includes("xycSwapXD"))).toBe(true);
  });

  it("puts the flat fee before the curve, where it is actually applied", () => {
    const result = compile("production", MANDATES.production, ctx());
    const feeAt = result.instructions.findIndex((l) => l.includes("flatFeeAmountInXD"));
    const curveAt = result.instructions.findIndex((l) => l.includes("xycSwapXD"));
    expect(feeAt).toBeGreaterThanOrEqual(0);
    expect(feeAt).toBeLessThan(curveAt);
  });

  it("encodes the flat fee at 1e9 = 100%, so 80 bps is 8_000_000", () => {
    const result = compile("production", MANDATES.production, ctx());
    const fee = result.instructions.find((l) => l.includes("flatFeeAmountInXD"));
    expect(fee).toContain('"fee":"8000000"');
  });

  /**
   * The strongest pin available: the actual BYTES, not the instruction names.
   *
   * A SwapVM program is [opcode][argsLength][args] repeated. Opcode bytes come from the
   * measured Aqua array (VERIFIED.md): deadline 0x0d, concentrate 0x12, flatFee 0x15,
   * xycSwap 0x11, salt 0x14. Argument lengths are fixed by each coder. Asserting the
   * opcode/length skeleton catches an opcode-table drift or a reordering that a
   * name-based test would still pass, because it is exactly what the router dispatches on.
   */
  it("emits the measured opcode bytes in the measured order", () => {
    const result = compile("production", MANDATES.production, ctx());
    const bytes = result.program.slice(2);

    const skeleton: Array<[string, number]> = [];
    let i = 0;
    while (i < bytes.length) {
      const opcode = bytes.slice(i, i + 2);
      const argsLength = Number.parseInt(bytes.slice(i + 2, i + 4), 16);
      skeleton.push([opcode, argsLength]);
      i += 4 + argsLength * 2;
    }

    expect(skeleton).toEqual([
      ["0d", 5], // Controls.deadline, uint40
      ["12", 64], // XYCConcentrate.concentrateGrowLiquidity2D, 2 x uint256
      ["15", 4], // Fee.flatFeeAmountInXD, uint32
      ["11", 0], // XYCSwap.xycSwapXD, the executing curve
      ["14", 8], // Controls.salt, uint64
    ]);
    // The walk consumed the program exactly: no trailing bytes, no overrun.
    expect(i).toBe(bytes.length);
  });

  it("encodes 80 bps as the literal bytes 007a1200 at 1e9 scale", () => {
    const result = compile("production", MANDATES.production, ctx());
    expect(result.program).toContain("1504007a1200");
  });

  it("round-trips its own program through decode -> build", () => {
    const result = compile("production", MANDATES.production, ctx());
    const rebuilt = AquaProgramBuilder.decode(new HexString(result.program) as never)
      .build()
      .toString();
    expect(rebuilt.toLowerCase()).toBe(result.program.toLowerCase());
  });
});

describe("compile: output shape (PRG-R9)", () => {
  it("returns ABI-encoded Order bytes, not the bare program", () => {
    const result = compile("production", MANDATES.production, ctx());
    expect(result.orderBytes).not.toBe(result.program);
    const decoded = Order.decode(new HexString(result.orderBytes));
    expect(decoded.program.toString().toLowerCase()).toBe(result.program.toLowerCase());
    expect(decoded.maker.toString().toLowerCase()).toBe(VAULT.toLowerCase());
  });

  it("hashes the ORDER bytes, matching what the registry stores", () => {
    const result = compile("production", MANDATES.production, ctx());
    expect(result.strategyHash).toBe(keccak256(result.orderBytes));
    expect(result.strategyHash).not.toBe(keccak256(result.program));
  });

  /**
   * The JIT path lives or dies on this flag, and its absence is SILENT. Without the hook the
   * ship still succeeds, quotes still look correct, and small fills still settle from the hot
   * buffer. Only a fill larger than the buffer fails, because the router never calls the vault
   * and the vault never unparks from Aave. That is the one trace the demo exists to show.
   *
   * This was a real defect: the compiler shipped with plain MakerTraits.default() and the
   * first self-audit missed it, because the audit checked the four named rule items and the
   * hook CONSTANTS, not whether the hook was actually wired into the order.
   */
  it("declares the preTransferOut hook, without which the JIT path is silently dead", () => {
    const result = compile("production", MANDATES.production, ctx());
    const decoded = Order.decode(new HexString(result.orderBytes));

    expect(decoded.traits.preTransferOutHook).toBeDefined();
    // Zero target means "call the maker itself", which is what the vault expects.
    expect(decoded.traits.preTransferOutHook?.target.toString()).toBe(
      "0x0000000000000000000000000000000000000000",
    );
    expect(decoded.traits.preTransferOutHook?.data.toString()).toBe(MAKER_HOOK_DATA);
  });

  it("keeps the Aqua-mode traits the router requires", () => {
    const result = compile("production", MANDATES.production, ctx());
    const decoded = Order.decode(new HexString(result.orderBytes));
    // PRG-R10: Aqua mode enforces receiver == maker and forbids WETH unwrap. Setting either
    // makes the ship revert with MakerTraitsCustomReceiverIsIncompatibleWithAqua /
    // MakerTraitsUnwrapIsIncompatibleWithAqua.
    expect(decoded.traits.useAquaInsteadOfSignature).toBe(true);
    expect(decoded.traits.shouldUnwrap).toBe(false);
    expect(decoded.traits.customReceiver).toBeUndefined();
  });

  it("targets the Aqua registry with a ship CallInfo", () => {
    const result = compile("production", MANDATES.production, ctx());
    expect(result.shipCallInfo.to.toLowerCase()).toBe(AQUA_REGISTRY.toLowerCase());
    expect(result.shipCallInfo.data.startsWith("0x")).toBe(true);
    expect(result.shipCallInfo.value).toBe("0");
  });

  it("registers BOTH tokens with the base side at 0 (PRG-R2)", () => {
    const result = compile("production", MANDATES.production, ctx());
    expect(result.shipped.base).toBe(BigInt(0));
    expect(result.shipped.quote).toBeGreaterThan(BigInt(0));
    // Both token addresses appear in the ship calldata, so tokensCount is 2.
    const data = result.shipCallInfo.data.toLowerCase();
    expect(data).toContain(TOKENS.USDC.slice(2).toLowerCase());
    expect(data).toContain(TOKENS.WETH.slice(2).toLowerCase());
  });
});

/**
 * There are TWO program producers in this project: this compiler, and
 * `scripts/build-orders.ts` in pool-party-aqua, which is what Murilo actually runs to mint the
 * launch payloads. They must agree byte for byte, or the strategy the vault ships is not the
 * strategy this app describes.
 *
 * The reference below is built the way Track A's script builds it, deliberately from the raw
 * SDK rather than by calling our own helpers, so this is a genuine second opinion and not a
 * tautology. It is how the missing preTransferOut hook was caught.
 */
describe("cross-producer equivalence with the launch payload builder", () => {
  function trackAReference(
    lowBps: bigint,
    highBps: bigint,
    salt: bigint,
    spotE8: bigint,
    now: bigint,
  ) {
    const BPS_ = BigInt(10_000);
    const lowE8 = (spotE8 * (BPS_ + lowBps)) / BPS_;
    const highE8 = (spotE8 * (BPS_ + highBps)) / BPS_;
    const toRawX18 = (e8: bigint) =>
      (e8 * BigInt(10) ** BigInt(6) * BigInt(10) ** BigInt(18)) /
      (BigInt(10) ** BigInt(8) * BigInt(10) ** BigInt(18));

    const program = new AquaProgramBuilder()
      .deadline({ deadline: now + BigInt(3) * BigInt(86_400) })
      .concentrateGrowLiquidity2D(
        instructions.concentrate.ConcentrateGrowLiquidity2DArgs.fromRawPrices(
          toRawX18(lowE8),
          toRawX18(highE8),
        ),
      )
      .flatFeeAmountInXD({ fee: BigInt(8_000_000) })
      .xycSwapXD()
      .salt({ salt })
      .build();

    const traits = MakerTraits.default().with({
      preTransferOutHook: new Interaction(Address.ZERO_ADDRESS, new HexString("0x01")),
    });
    return Order.new({ maker: new Address(VAULT), traits, program })
      .encode()
      .toString();
  }

  it("production band: order bytes are identical", () => {
    const mine = compile("production", MANDATES.production, ctx({ epoch: 0 }));
    expect(mine.orderBytes.toLowerCase()).toBe(
      trackAReference(
        BigInt(-1500),
        BigInt(-500),
        BigInt(0),
        SPOT_E8,
        BigInt(1_800_000_000),
      ).toLowerCase(),
    );
  });

  it("demo band: order bytes are identical", () => {
    const mine = compile("demo", MANDATES.demo, ctx({ epoch: 1 }));
    expect(mine.orderBytes.toLowerCase()).toBe(
      trackAReference(
        BigInt(-30),
        BigInt(-10),
        BigInt(1),
        SPOT_E8,
        BigInt(1_800_000_000),
      ).toLowerCase(),
    );
  });

  it("and therefore the same strategyHash, which is the identity Aqua stores", () => {
    const mine = compile("production", MANDATES.production, ctx({ epoch: 0 }));
    const reference = trackAReference(
      BigInt(-1500),
      BigInt(-500),
      BigInt(0),
      SPOT_E8,
      BigInt(1_800_000_000),
    );
    expect(mine.strategyHash).toBe(keccak256(reference as `0x${string}`));
  });
});

describe("compile: guardrails, each with a failing input", () => {
  it("PRG-R3 refuses a band whose top is at or above spot", () => {
    const aboveSpot: Mandate = { ...MANDATES.production, bandLowPct: -500, bandHighPct: -1 };
    // Shape check fires first for a positive offset; use a mandate that is below spot but
    // inside the required margin to reach the policy check.
    expect(() => compile("production", aboveSpot, ctx())).toThrow(CompilerPolicyError);
    expect(() => compile("production", aboveSpot, ctx())).toThrow(/PRG-R3/);
  });

  it("PRG-R3 refuses the demo band under the production margin", () => {
    const demoUnderProductionMargin: Mandate = { ...MANDATES.demo, minBelowSpotBps: 200 };
    expect(() => compile("demo", demoUnderProductionMargin, ctx())).toThrow(/PRG-R3/);
  });

  it("PRG-R3 accepts the demo band under its own margin", () => {
    expect(() => compile("demo", MANDATES.demo, ctx())).not.toThrow();
  });

  it("PRG-R5 refuses a ship above the sleeve", () => {
    // 10% of 1000 USDC = 100 USDC.
    expect(() =>
      compile("production", MANDATES.production, ctx({ shipQuoteAmount: USDC(101) })),
    ).toThrow(/PRG-R5/);
    expect(() =>
      compile("production", MANDATES.production, ctx({ shipQuoteAmount: USDC(100) })),
    ).not.toThrow();
  });

  it("PRG-R5 refuses a ship above maxPerShip even when the sleeve allows it", () => {
    // 10% of 10,000 USDC = 1,000 USDC, but maxPerShip is 150.
    const rich = ctx({ totalAssets: USDC(10_000), shipQuoteAmount: USDC(200) });
    expect(() => compile("production", MANDATES.production, rich)).toThrow(/PRG-R5/);
  });

  it("PRG-R5 refuses a zero or negative ship", () => {
    expect(() =>
      compile("production", MANDATES.production, ctx({ shipQuoteAmount: BigInt(0) })),
    ).toThrow(/PRG-R5/);
  });

  it("PRG-R6 refuses a ship that would push coverage below 1.0", () => {
    const overCommitted = ctx({
      totalAssets: USDC(1000),
      liquidQuote: USDC(120),
      alreadyShipped: USDC(100),
      shipQuoteAmount: USDC(50),
    });
    expect(() => compile("production", MANDATES.production, overCommitted)).toThrow(/PRG-R6/);
  });

  it("PRG-R6 allows the two launch bands together inside one sleeve", () => {
    const production = compile(
      "production",
      MANDATES.production,
      ctx({ shipQuoteAmount: USDC(60) }),
    );
    expect(() =>
      compile(
        "demo",
        MANDATES.demo,
        ctx({ shipQuoteAmount: USDC(40), alreadyShipped: production.shipped.quote }),
      ),
    ).not.toThrow();
  });

  it("PRG-R4 refuses a negative or non-integer epoch", () => {
    expect(() => compile("production", MANDATES.production, ctx({ epoch: -1 }))).toThrow(/PRG-R4/);
    expect(() => compile("production", MANDATES.production, ctx({ epoch: 1.5 }))).toThrow(/PRG-R4/);
  });

  it("PRG-R4 sets the deadline to the epoch end", () => {
    const now = BigInt(1_800_000_000);
    const result = compile("production", MANDATES.production, ctx({ now }));
    expect(result.deadline).toBe(now + BigInt(3) * BigInt(86_400));
  });

  it("refuses the dead gen-1 deployment as the app", () => {
    expect(() =>
      compile("production", MANDATES.production, ctx({ app: DEAD_GEN1_ROUTER })),
    ).toThrow(/dead gen-1/);
  });
});

describe("PRG-R10: a docked strategyHash is dead forever, so every roll must re-salt", () => {
  it("refuses a roll that reuses the epoch", () => {
    const first = compile("production", MANDATES.production, ctx({ epoch: 7 }));
    expect(() =>
      buildRoll(
        { strategyHash: first.strategyHash, epoch: 7 },
        "production",
        MANDATES.production,
        ctx({ epoch: 7 }),
      ),
    ).toThrow(/PRG-R10/);
  });

  it("produces a different strategyHash when only the salt changes", () => {
    const first = compile("production", MANDATES.production, ctx({ epoch: 7 }));
    const second = compile("production", MANDATES.production, ctx({ epoch: 8 }));
    expect(second.salt).not.toBe(first.salt);
    expect(second.strategyHash).not.toBe(first.strategyHash);
    // Nothing else moved: same band, same deadline, same size.
    expect(second.band.lowE8).toBe(first.band.lowE8);
    expect(second.deadline).toBe(first.deadline);
    expect(second.shipped.quote).toBe(first.shipped.quote);
  });

  it("is deterministic: identical inputs give identical bytes", () => {
    const a = compile("production", MANDATES.production, ctx({ epoch: 3 }));
    const b = compile("production", MANDATES.production, ctx({ epoch: 3 }));
    expect(b.strategyHash).toBe(a.strategyHash);
    expect(b.orderBytes).toBe(a.orderBytes);
  });

  it("builds a roll as dock(old) + ship(new) (PRG-R8)", () => {
    const first = compile("production", MANDATES.production, ctx({ epoch: 7 }));
    const rolled = buildRoll(
      { strategyHash: first.strategyHash, epoch: 7 },
      "production",
      MANDATES.production,
      ctx({ epoch: 8 }),
    );
    expect(rolled.dock.to.toLowerCase()).toBe(AQUA_REGISTRY.toLowerCase());
    expect(rolled.ship.strategyHash).not.toBe(first.strategyHash);
  });

  it("docks both registered tokens, since a partial dock reverts", () => {
    const dock = buildDock(
      ("0x" + "11".repeat(32)) as `0x${string}`,
      MANDATES.production,
      AQUA_SWAP_VM_ROUTER,
    );
    const data = dock.data.toLowerCase();
    expect(data).toContain(TOKENS.USDC.slice(2).toLowerCase());
    expect(data).toContain(TOKENS.WETH.slice(2).toLowerCase());
  });
});

describe("the two launch mandates", () => {
  it("production sits 15% to 5% below spot", () => {
    const result = compile("production", MANDATES.production, ctx());
    expect(result.band.lowE8).toBe((SPOT_E8 * BigInt(8500)) / BigInt(10_000));
    expect(result.band.highE8).toBe((SPOT_E8 * BigInt(9500)) / BigInt(10_000));
  });

  it("demo sits 0.3% to 0.1% below spot", () => {
    const result = compile("demo", MANDATES.demo, ctx());
    expect(result.band.lowE8).toBe((SPOT_E8 * BigInt(9970)) / BigInt(10_000));
    expect(result.band.highE8).toBe((SPOT_E8 * BigInt(9990)) / BigInt(10_000));
    expect(result.band.highE8).toBeLessThan(SPOT_E8);
  });

  it("gives the two bands distinct hashes even at the same epoch", () => {
    const production = compile("production", MANDATES.production, ctx({ epoch: 1 }));
    const demo = compile("demo", MANDATES.demo, ctx({ epoch: 1 }));
    expect(demo.strategyHash).not.toBe(production.strategyHash);
  });
});
