import "server-only";

import { AquaProtocolContract } from "@1inch/aqua-sdk";
import { Address, HexString } from "@1inch/swap-vm-sdk";
import { AQUA_REGISTRY } from "../../config/addresses";
import { CompilerPolicyError, compile } from "./compile";
import type { CompileContext, CompileResult, Mandate, MandateName, ShipCallInfo } from "./types";

/**
 * Dock and roll.
 *
 * PRG-R10 is the rule that bites hardest in practice: a docked strategyHash is dead FOREVER.
 * The registry stores a docked marker, not zero, so re-shipping identical bytes reverts with
 * StrategiesMustBeImmutable (proven on the fork). Every roll must therefore change the salt,
 * and `buildRoll` refuses to hand back a payload that would not.
 *
 * PRG-R8: a roll is dock(old) + ship(new), executed as one manager action.
 */

export type DockCallInfo = ShipCallInfo;

export function buildDock(
  strategyHash: `0x${string}`,
  mandate: Mandate,
  app: `0x${string}`,
): DockCallInfo {
  const call = new AquaProtocolContract(new Address(AQUA_REGISTRY)).dock({
    app: new Address(app),
    strategyHash: new HexString(strategyHash),
    // Docking must close ALL registered tokens or the registry reverts with
    // DockingShouldCloseAllTokens, so both sides go in even though one shipped at 0.
    tokens: [new Address(mandate.pair.quote), new Address(mandate.pair.base)],
  });
  return {
    to: call.to.toString() as `0x${string}`,
    data: call.data.toString() as `0x${string}`,
    value: String(call.value ?? 0),
  };
}

export type RollResult = {
  dock: DockCallInfo;
  ship: CompileResult;
};

export function buildRoll(
  previous: { strategyHash: `0x${string}`; epoch: number },
  mandateName: MandateName,
  mandate: Mandate,
  context: CompileContext,
): RollResult {
  // PRG-R10, checked before doing any work so the error names the real problem.
  if (context.epoch === previous.epoch) {
    throw new CompilerPolicyError(
      "PRG-R10",
      `roll must advance the epoch: salt ${context.epoch} equals the docked strategy's salt. ` +
        "A docked strategyHash is dead forever and re-shipping it reverts with StrategiesMustBeImmutable.",
    );
  }

  const ship = compile(mandateName, mandate, context);

  // Belt and braces: the epoch could differ while some other change cancels it out. What
  // actually matters on chain is that the HASH is new.
  if (ship.strategyHash.toLowerCase() === previous.strategyHash.toLowerCase()) {
    throw new CompilerPolicyError(
      "PRG-R10",
      `the rolled strategyHash is identical to the docked one (${previous.strategyHash}); the ship would revert`,
    );
  }

  return {
    dock: buildDock(previous.strategyHash, mandate, context.app),
    ship,
  };
}
