/**
 * Manager CLI: ship / roll / dock. This IS the manager surface for the window (POO-1068 cut).
 *
 * Nothing here signs anything. SRV-R5: every manager transaction is emitted as a payload for
 * a wallet to sign, and the manager key never reaches this process. The script compiles,
 * checks policy, records the intent, and prints calldata.
 *
 * Usage:
 *   pnpm aqua:ship  --mandate production --vault 0x... [--amount 60] [--dry-run]
 *   pnpm aqua:ship  --mandate demo       --vault 0x... [--amount 40]
 *   pnpm aqua:roll  --strategy 0x...     --vault 0x... --mandate production
 *   pnpm aqua:dock  --strategy 0x...     --vault 0x... --mandate production
 *   pnpm aqua:launch-payloads --vault 0x... --production 60 --demo 40
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function requireString(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`Missing required --${key}`);
  return value;
}

function usdcToRaw(human: string): bigint {
  const [whole = "0", frac = ""] = human.split(".");
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole) * BigInt(1_000_000) + BigInt(padded || "0");
}

function formatUsdc(raw: bigint): string {
  const whole = raw / BigInt(1_000_000);
  const frac = (raw % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function usd(e8: bigint): string {
  return (Number(e8) / 1e8).toFixed(2);
}

async function main(): Promise<void> {
  const [command = "", ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  // Imported lazily so the `server-only` guard resolves under --conditions=react-server and a
  // usage error does not require a database connection first.
  const compiler = await import("../../src/lib/aqua/api/compiler/index");
  const context = await import("../../src/lib/aqua/api/compiler/context");
  const { AQUA_SWAP_VM_ROUTER } = await import("../../src/lib/aqua/config/addresses");
  const { decodeShipsFromChain } = await import("../../src/lib/aqua/api/backfill");

  async function buildOne(
    mandateName: "production" | "demo",
    vault: `0x${string}`,
    amountRaw: bigint | undefined,
    epochOverride?: number,
    alreadyShippedOverride?: bigint,
  ) {
    const mandate = compiler.mandateFor(mandateName);
    const spot = await context.readSpot();
    const totalAssets = args["total-assets"]
      ? usdcToRaw(String(args["total-assets"]))
      : await readVaultAssets(vault);
    const alreadyShipped = alreadyShippedOverride ?? (await context.readAlreadyShipped(vault));
    const epoch = epochOverride ?? (await context.nextEpoch(vault));

    const result = compiler.compile(mandateName, mandate, {
      maker: vault,
      app: AQUA_SWAP_VM_ROUTER,
      spotE8: spot.answerE8,
      totalAssets,
      alreadyShipped,
      epoch,
      now: BigInt(Math.floor(Date.now() / 1000)),
      shipQuoteAmount: amountRaw,
    });

    console.log(`\n--- ${mandateName} band ---`);
    console.log(`  Chainlink spot   $${usd(spot.answerE8)} (age ${spot.ageSeconds}s)`);
    console.log(`  band             $${usd(result.band.lowE8)} .. $${usd(result.band.highE8)}`);
    console.log(
      `  shipped          ${formatUsdc(result.shipped.quote)} USDC + 0 WETH (both registered)`,
    );
    console.log(`  epoch / salt     ${result.epoch} / ${result.salt}`);
    console.log(
      `  deadline         ${result.deadline} (${new Date(Number(result.deadline) * 1000).toISOString()})`,
    );
    console.log(`  strategyHash     ${result.strategyHash}`);
    console.log("  program:");
    for (const line of result.instructions) console.log(`    ${line}`);
    console.log("  SHIP TX (manager signs this):");
    console.log(`    to    ${result.shipCallInfo.to}`);
    console.log(`    value ${result.shipCallInfo.value}`);
    console.log(`    data  ${result.shipCallInfo.data}`);

    return result;
  }

  /** Reads the vault's own accounting. Falls back to --total-assets before the vault exists. */
  async function readVaultAssets(vault: `0x${string}`): Promise<bigint> {
    const { arbitrumPublicClient } = await import("../../src/lib/aqua/chain/clients");
    try {
      return await arbitrumPublicClient().readContract({
        address: vault,
        abi: [
          {
            type: "function",
            name: "totalAssets",
            inputs: [],
            outputs: [{ type: "uint256" }],
            stateMutability: "view",
          },
        ] as const,
        functionName: "totalAssets",
      });
    } catch {
      throw new Error(
        `Could not read totalAssets() from ${vault}. Pass --total-assets <usdc> while the vault is not deployed yet.`,
      );
    }
  }

  /**
   * Print what the compiler produced, for the record.
   *
   * Nothing is persisted, because nothing needs to be: once the ship transaction lands, the band
   * geometry is decodable from the registry's own `Shipped` log (`api/backfill.ts`), which is what
   * the page reads. This output exists so the operator can eyeball the band before broadcasting,
   * and so a mismatch between what was compiled and what the chain later reports is visible.
   */
  function report(result: Awaited<ReturnType<typeof buildOne>>) {
    console.log(`\n  strategyHash  ${result.strategyHash}`);
    console.log(`  mandate       ${result.mandate}  (epoch ${result.epoch})`);
    console.log(`  band          $${usd(result.band.lowE8)} .. $${usd(result.band.highE8)}`);
    console.log(`  spot at ship  $${usd(result.band.spotE8)}`);
    console.log(`  deadline      ${result.deadline}`);
    console.log("  Verify after broadcast with: pnpm aqua:discover");
  }

  switch (command) {
    case "ship": {
      const vault = requireString(args, "vault") as `0x${string}`;
      const mandateName = requireString(args, "mandate") as "production" | "demo";
      const amount = args.amount ? usdcToRaw(String(args.amount)) : undefined;
      const result = await buildOne(mandateName, vault, amount);
      report(result);
      break;
    }

    case "launch-payloads": {
      // The S2 deliverable: both bands, sized so the combined ship stays inside one sleeve.
      const vault = requireString(args, "vault") as `0x${string}`;
      const productionAmount = usdcToRaw(String(args.production ?? "60"));
      const demoAmount = usdcToRaw(String(args.demo ?? "40"));
      const baseEpoch = await context.nextEpoch(vault);
      const alreadyShipped = await context.readAlreadyShipped(vault);

      const production = await buildOne(
        "production",
        vault,
        productionAmount,
        baseEpoch,
        alreadyShipped,
      );
      // The demo band must see the production ship as committed, or PRG-R6 would let the two
      // of them together exceed the sleeve.
      const demo = await buildOne(
        "demo",
        vault,
        demoAmount,
        baseEpoch + 1,
        alreadyShipped + production.shipped.quote,
      );

      console.log("\n=== LAUNCH SUMMARY ===");
      console.log(
        `  combined shipped: ${formatUsdc(production.shipped.quote + demo.shipped.quote)} USDC`,
      );
      console.log(`  production hash:  ${production.strategyHash}`);
      console.log(`  demo hash:        ${demo.strategyHash}`);
      console.log("  Ship production FIRST, then demo. Order matters only for the epoch record.");

      report(production);
      report(demo);
      break;
    }

    case "roll": {
      const vault = requireString(args, "vault") as `0x${string}`;
      const mandateName = requireString(args, "mandate") as "production" | "demo";
      const previousHash = requireString(args, "strategy") as `0x${string}`;

      // The predecessor's epoch comes from chain, decoded from its own `Shipped` log, so a roll
      // cannot be built against an epoch nobody can verify.
      const shipped = await decodeShipsFromChain(vault);
      const previous = shipped.find(
        (ship) => ship.strategyHash.toLowerCase() === previousHash.toLowerCase(),
      );
      if (!previous)
        throw new Error(
          `No Shipped log on Arbitrum for ${previousHash}; cannot roll what this vault did not ship`,
        );

      const mandate = compiler.mandateFor(mandateName);
      const spot = await context.readSpot();
      const totalAssets = args["total-assets"]
        ? usdcToRaw(String(args["total-assets"]))
        : await readVaultAssets(vault);
      const alreadyShipped = await context.readAlreadyShipped(vault);

      const rolled = compiler.buildRoll(
        { strategyHash: previousHash, epoch: previous.epochIndex },
        mandateName,
        mandate,
        {
          maker: vault,
          app: AQUA_SWAP_VM_ROUTER,
          spotE8: spot.answerE8,
          totalAssets,
          // The old strategy is being docked in the same action, so its size is freed.
          alreadyShipped: alreadyShipped,
          epoch: await context.nextEpoch(vault),
          now: BigInt(Math.floor(Date.now() / 1000)),
          shipQuoteAmount: args.amount ? usdcToRaw(String(args.amount)) : undefined,
        },
      );

      console.log("\n=== ROLL: dock(old) then ship(new), one manager action (PRG-R8) ===");
      console.log("  DOCK TX:");
      console.log(`    to   ${rolled.dock.to}`);
      console.log(`    data ${rolled.dock.data}`);
      console.log(`  old strategyHash ${previousHash} (dead forever once docked)`);
      console.log(`  new strategyHash ${rolled.ship.strategyHash} (salt ${rolled.ship.salt})`);
      console.log("  SHIP TX:");
      console.log(`    to   ${rolled.ship.shipCallInfo.to}`);
      console.log(`    data ${rolled.ship.shipCallInfo.data}`);

      report(rolled.ship);
      break;
    }

    case "dock": {
      const mandateName = requireString(args, "mandate") as "production" | "demo";
      const strategyHash = requireString(args, "strategy") as `0x${string}`;
      const dock = compiler.buildDock(
        strategyHash,
        compiler.mandateFor(mandateName),
        AQUA_SWAP_VM_ROUTER,
      );
      console.log("\n=== DOCK ===");
      console.log(`  strategyHash ${strategyHash} (dead forever after this)`);
      console.log(`  to   ${dock.to}`);
      console.log(`  data ${dock.data}`);
      break;
    }

    default:
      console.error(
        "Usage: ship | roll | dock | launch-payloads (see the header of scripts/aqua/strategy.ts)",
      );
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\n${(error as Error).message}`);
  process.exitCode = 1;
});
