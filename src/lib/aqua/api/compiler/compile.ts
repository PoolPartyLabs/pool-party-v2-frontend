import "server-only";

import { AquaProtocolContract } from "@1inch/aqua-sdk";
// Interaction lives in sdk-core, pinned to the exact version swap-vm-sdk depends on so the
// class identity the SDK checks against is the one we construct.
import { Interaction } from "@1inch/sdk-core";
import { Address, AquaProgramBuilder, HexString, MakerTraits, Order } from "@1inch/swap-vm-sdk";
import { keccak256 } from "viem";
import { AQUA_REGISTRY, assertNotDeadGeneration, MAKER_HOOK_DATA } from "../../config/addresses";
import { BPS, bandFromSpot, concentrateArgsFor } from "./band";
import type { CompileContext, CompileResult, Mandate, MandateName, ShipCallInfo } from "./types";

/**
 * The ONLY producer of Aqua programs and ship calldata.
 *
 * Every platform guardrail is enforced here, so an out-of-policy program cannot be built at
 * all rather than being caught in review. Each refusal names the rule it comes from.
 *
 * The program order below is PRG-R1 **v3**, corrected in POO-1058 against the four live gen-2
 * ships and confirmed end to end on an Arbitrum fork:
 *
 *     [deadline][concentrateGrowLiquidity2D][flatFeeAmountInXD][xycSwapXD][salt]
 *
 * The v2 order in the rules doc was wrong in three ways. `concentrateGrowLiquidity2D` is not
 * the terminal curve, it shapes reserves; `xycSwapXD` is the instruction that executes the
 * swap on them, and a program without it reverts with TakerTraitsAmountOutMustBeGreaterThanZero
 * because it produces zero output. The flat fee belongs after concentrate and immediately
 * before the curve. And `salt` trails the curve in every live program, which is fine because
 * it is a documented no-op that only affects the order hash.
 *
 * No opcode byte is ever written by hand: everything goes through AquaProgramBuilder, which
 * also refuses opcodes outside the Aqua instruction set by construction.
 */

/** FlatFeeArgs and ProtocolFeeArgs are scaled so 1e9 = 100%, hence 1 bp = 1e5. */
const FEE_SCALE = BigInt(1_000_000_000);
const SECONDS_PER_DAY = BigInt(86_400);
const ZERO = BigInt(0);

function feeBpsToRaw(bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0)
    throw new Error(`feeBps must be a non-negative integer, got ${bps}`);
  return (BigInt(bps) * FEE_SCALE) / BPS;
}

/** Every refusal carries the rule that caused it, so a failure is self-explaining. */
export class CompilerPolicyError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`${rule}: ${message}`);
    this.name = "CompilerPolicyError";
  }
}

export function compile(
  mandateName: MandateName,
  mandate: Mandate,
  context: CompileContext,
): CompileResult {
  assertNotDeadGeneration(context.app);

  const band = bandFromSpot(context.spotE8, mandate.bandLowPct, mandate.bandHighPct);

  // PRG-R3, with ONE KNOWN DIVERGENCE FROM THE WRITTEN RULE, flagged on POO-1057 and not yet
  // ruled on. The rule text says a flat `bandHigh <= spot * 0.98`. The demo mandate approved
  // in the execution plan puts its band top at spot-0.1%, which that flat rule would refuse,
  // so the launch as approved could not be compiled at all. The margin is therefore a
  // per-mandate `minBelowSpotBps` (production keeps the rule's 200 bps, demo uses 10).
  //
  // What does NOT bend is the invariant the rule exists to protect: the whole band sits
  // strictly below spot, checked first and unconditionally. Track A noted that the vault does
  // not enforce band placement at all, so this is the only guard; it is deliberately the
  // stricter of the two checks and applies to every mandate.
  if (band.highE8 >= band.spotE8) {
    throw new CompilerPolicyError(
      "PRG-R3",
      `band top ${band.highE8} is at or above spot ${band.spotE8}; a buy band must sit entirely below spot`,
    );
  }
  const maxAllowedHigh = (context.spotE8 * (BPS - BigInt(mandate.minBelowSpotBps))) / BPS;
  if (band.highE8 > maxAllowedHigh) {
    throw new CompilerPolicyError(
      "PRG-R3",
      `band top ${band.highE8} is closer than ${mandate.minBelowSpotBps} bps to spot ${context.spotE8} (max ${maxAllowedHigh})`,
    );
  }

  // PRG-R5: shipped quote <= min(maxPerShip, bandSleevePct x totalAssets).
  const sleeveCap = (context.totalAssets * BigInt(mandate.bandSleevePct)) / BigInt(100);
  const allowed = sleeveCap < mandate.maxPerShip ? sleeveCap : mandate.maxPerShip;
  const shipQuote = context.shipQuoteAmount ?? allowed;
  if (shipQuote <= ZERO) {
    throw new CompilerPolicyError("PRG-R5", `ship amount must be positive, got ${shipQuote}`);
  }
  if (shipQuote > allowed) {
    throw new CompilerPolicyError(
      "PRG-R5",
      `ship of ${shipQuote} exceeds min(maxPerShip ${mandate.maxPerShip}, ${mandate.bandSleevePct}% sleeve ${sleeveCap}) = ${allowed}`,
    );
  }

  // PRG-R6: coverage 1.0. Everything committed across active strategies must be honourable.
  const liquid = context.liquidQuote ?? context.totalAssets;
  const committed = (context.alreadyShipped ?? ZERO) + shipQuote;
  if (committed > liquid) {
    throw new CompilerPolicyError(
      "PRG-R6",
      `total committed ${committed} exceeds liquid quote ${liquid}; coverage would drop below 1.0`,
    );
  }

  // PRG-R4: deadline = epoch end, salt = epoch id.
  if (!Number.isInteger(context.epoch) || context.epoch < 0) {
    throw new CompilerPolicyError(
      "PRG-R4",
      `epoch must be a non-negative integer, got ${context.epoch}`,
    );
  }
  const deadline = context.now + BigInt(mandate.epochDays) * SECONDS_PER_DAY;
  const salt = BigInt(context.epoch);

  // PRG-R1 v3. Curve is terminal; nothing that affects pricing may follow xycSwapXD.
  const program = new AquaProgramBuilder()
    .deadline({ deadline })
    .concentrateGrowLiquidity2D(concentrateArgsFor(band))
    .flatFeeAmountInXD({ fee: feeBpsToRaw(mandate.feeBps) })
    .xycSwapXD()
    .salt({ salt })
    .build();

  // PRG-R2: for every opcode that PULLS a token, the shipped amount of that token must cover
  // it. We ship the base side at 0, so any *AmountIn* fee opcode would pull WETH we do not
  // have and revert the fill (proven on the fork: arithmetic underflow). The canonical order
  // contains none, and this asserts it stays that way if someone edits the builder chain.
  assertNoTokenInPullingOpcode(program.toString());

  // Aqua mode: authenticated by the ship, not a signature. A custom receiver and WETH unwrap
  // are both rejected upstream in Aqua mode, so those defaults are the only valid choice.
  //
  // The preTransferOut hook is NOT optional for this product, and omitting it is silent: the
  // ship succeeds, quotes look right, small fills settle from the hot buffer, and only a fill
  // larger than the buffer fails, because without this flag the router never calls the vault
  // and the vault never unparks from Aave. That is precisely the JIT path the product is
  // built around. Target zero means "call the maker itself"; the SDK rejects empty data, and
  // the router forwards this byte to the vault untouched (the vault ignores it).
  const traits = MakerTraits.default().with({
    preTransferOutHook: new Interaction(Address.ZERO_ADDRESS, new HexString(MAKER_HOOK_DATA)),
  });
  const order = Order.new({
    maker: new Address(context.maker),
    traits,
    program,
  });

  // PRG-R9: the bytes that go on chain are the ABI-encoded Order, not the bare program.
  const orderBytes = order.encode().toString() as `0x${string}`;
  const strategyHash = keccak256(orderBytes);

  // PRG-R2: BOTH tokens registered. tokensCount comes from this array, and safeBalances/push
  // refuse any token that was not registered at ship time, so the empty side ships at 0
  // rather than being omitted.
  const shipCall = new AquaProtocolContract(new Address(AQUA_REGISTRY)).ship({
    app: new Address(context.app),
    strategy: new HexString(orderBytes),
    amountsAndTokens: [
      { token: new Address(mandate.pair.quote), amount: shipQuote },
      { token: new Address(mandate.pair.base), amount: ZERO },
    ],
  });

  const shipCallInfo: ShipCallInfo = {
    to: shipCall.to.toString() as `0x${string}`,
    data: shipCall.data.toString() as `0x${string}`,
    value: String(shipCall.value ?? 0),
  };

  return {
    mandate: mandateName,
    program: program.toString() as `0x${string}`,
    orderBytes,
    strategyHash,
    shipCallInfo,
    shipped: { quote: shipQuote, base: ZERO },
    band,
    deadline,
    salt,
    epoch: context.epoch,
    instructions: describeProgram(program.toString()),
  };
}

/**
 * Decode the program we just built and refuse any opcode that pulls tokenIn during runLoop.
 *
 * This is deliberately a check on the BUILT BYTES rather than on the builder chain: it stays
 * true no matter how the program is assembled, and it is the exact failure mode that reverts
 * a real fill against a base-side-at-zero ship.
 */
const TOKEN_IN_PULLING_OPCODES = [
  "Fee.protocolFeeAmountInXD",
  "Fee.aquaProtocolFeeAmountInXD",
  "Fee.dynamicProtocolFeeAmountInXD",
  "Fee.aquaDynamicProtocolFeeAmountInXD",
];

export function assertNoTokenInPullingOpcode(programHex: string): void {
  const decoded = AquaProgramBuilder.decode(new HexString(programHex) as never);
  for (const ix of decoded.getInstructions()) {
    const name = ix.opcode.id.description ?? "";
    if (TOKEN_IN_PULLING_OPCODES.includes(name)) {
      throw new CompilerPolicyError(
        "PRG-R2/PRG-R7",
        `${name} pulls tokenIn during runLoop, but the base side ships at amount 0; the fill would revert`,
      );
    }
  }
}

/** Human-readable decode, stored with the ship so a program is reviewable after the fact. */
export function describeProgram(programHex: string): string[] {
  const decoded = AquaProgramBuilder.decode(new HexString(programHex) as never);
  return decoded.getInstructions().map((ix, position) => {
    const name = ix.opcode.id.description ?? "unknown";
    return `#${position} ${name} ${JSON.stringify(ix.args.toJSON())}`;
  });
}
