/**
 * Rebuilds `aqua_ships` from chain for every discovered vault.
 *
 * The launch ran through Foundry scripts, which cannot write to Postgres, so the table was
 * empty and the page had no band edges or mandate names. Everything needed is public, so this
 * decodes rather than reconstructs: anyone with an RPC can reproduce every row.
 *
 * Idempotent. Re-running updates `status` (a strategy may have been docked since) and leaves
 * the immutable columns alone, so it is safe on a cron or after every launch.
 *
 * Run: pnpm aqua:backfill            (all discovered vaults)
 *      pnpm aqua:backfill --dry-run  (print, write nothing)
 *      pnpm aqua:backfill --vault 0x...
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const usd = (e8: string) => `$${(Number(e8) / 1e8).toFixed(2)}`;
const usdc = (raw: string) => `$${(Number(raw) / 1e6).toFixed(2)}`;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const { discoverVaults } = await import("../../src/lib/aqua/api/discovery");
  const { decodeShipsFromChain } = await import("../../src/lib/aqua/api/backfill");
  const { aquaDb, closeAquaDb } = await import("../../src/lib/aqua/db/client");
  const { aquaShips } = await import("../../src/lib/aqua/db/schema");
  const { eq } = await import("drizzle-orm");

  const pinned = arg("vault");
  const vaults = pinned ? [pinned as `0x${string}`] : (await discoverVaults()).map((v) => v.vault);

  if (vaults.length === 0) {
    console.log("No vaults found. Set AQUA_MANAGER_ADDRESS or pass --vault.");
    await closeAquaDb();
    return;
  }

  console.log(`backfilling ${vaults.length} vault(s)${dryRun ? " [dry-run]" : ""}\n`);
  let inserted = 0;
  let updated = 0;

  for (const vault of vaults) {
    const ships = await decodeShipsFromChain(vault);
    console.log(`${vault}: ${ships.length} ship(s) decoded from chain`);

    for (const ship of ships) {
      console.log(
        `  ${ship.strategyHash.slice(0, 12)} ${ship.mandate.padEnd(10)} ` +
          `band ${usd(ship.bandLowE8)}..${usd(ship.bandHighE8)} ` +
          `spot ${usd(ship.spotE8)} shipped ${usdc(ship.shippedUsdc)} [${ship.status}]`,
      );
      if (dryRun) continue;

      const [existing] = await aquaDb()
        .select({ id: aquaShips.id, status: aquaShips.status })
        .from(aquaShips)
        .where(eq(aquaShips.strategyHash, ship.strategyHash));

      if (existing) {
        // Only the mutable column moves. The rest is decoded from immutable chain data, so
        // rewriting it would either be a no-op or would mean the decode changed under us.
        if (existing.status !== ship.status) {
          await aquaDb()
            .update(aquaShips)
            .set({ status: ship.status, dockedAt: ship.status === "docked" ? new Date() : null })
            .where(eq(aquaShips.id, existing.id));
          updated += 1;
        }
        continue;
      }

      await aquaDb()
        .insert(aquaShips)
        .values({
          id: randomUUID(),
          strategyHash: ship.strategyHash,
          maker: ship.maker,
          app: ship.app,
          mandate: ship.mandate,
          programHex: ship.programHex,
          orderBytes: ship.orderBytes,
          epoch: ship.epochIndex,
          salt: ship.salt,
          deadline: ship.deadline,
          spotE8: ship.spotE8,
          bandLowE8: ship.bandLowE8,
          bandHighE8: ship.bandHighE8,
          shippedUsdc: ship.shippedUsdc,
          shippedWeth: ship.shippedWeth,
          status: ship.status,
          shipTxHash: ship.shipTxHash,
          shippedAt: ship.shippedAt,
          mandateSnapshot: { source: "backfill-from-chain", decodedAt: new Date().toISOString() },
        });
      inserted += 1;
    }
  }

  console.log(
    dryRun ? "\n[dry-run] nothing written." : `\ninserted ${inserted}, status-updated ${updated}`,
  );
  await closeAquaDb();
}

main().catch((error) => {
  console.error(`backfill failed: ${(error as Error).message.slice(0, 300)}`);
  process.exitCode = 1;
});
