/**
 * Verifies the Aqua extension tables exist and are writable, without printing anything that
 * could leak the mirror's contents or its connection string.
 *
 * Run: pnpm aqua:db:check
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main(): Promise<void> {
  // Imported after dotenv so the env guard sees the loaded values.
  const { aquaDb, closeAquaDb, schema } = await import("../../src/lib/aqua/db/client");
  const { sql } = await import("drizzle-orm");

  const db = aquaDb();

  const tables = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'aqua\\_%'
        ORDER BY table_name`,
  );
  const names = [...tables].map((row) => row.table_name);
  console.log(`aqua_* tables present: ${names.length ? names.join(", ") : "(none)"}`);

  const expected = ["aqua_fills", "aqua_ships"];
  const missing = expected.filter((t) => !names.includes(t));
  if (missing.length) {
    console.error(`MISSING: ${missing.join(", ")}. Run pnpm aqua:db:migrate.`);
    process.exitCode = 1;
    await closeAquaDb();
    return;
  }

  // Round-trip a row so a permissions problem surfaces here, not at launch.
  const probeId = "db-check-probe";
  await db.delete(schema.aquaShips).where(sql`${schema.aquaShips.id} = ${probeId}`);
  await db.insert(schema.aquaShips).values({
    id: probeId,
    strategyHash: `0x${"00".repeat(32)}`,
    maker: `0x${"00".repeat(20)}`,
    app: `0x${"00".repeat(20)}`,
    mandate: "probe",
    programHex: "0x",
    orderBytes: "0x",
    epoch: 0,
    salt: "0",
    // The repo targets ES2017, so bigints are constructed, never written as `0n` literals.
    deadline: BigInt(0),
    spotE8: "0",
    bandLowE8: "0",
    bandHighE8: "0",
    shippedUsdc: "0",
    shippedWeth: "0",
    status: "docked",
  });
  const [readBack] = await db
    .select({ salt: schema.aquaShips.salt, shipped: schema.aquaShips.shippedUsdc })
    .from(schema.aquaShips)
    .where(sql`${schema.aquaShips.id} = ${probeId}`);
  await db.delete(schema.aquaShips).where(sql`${schema.aquaShips.id} = ${probeId}`);

  // SRV-R2: money must come back as a string. A number here means precision is already gone.
  const saltIsString = typeof readBack?.salt === "string";
  const shippedIsString = typeof readBack?.shipped === "string";
  console.log(`insert/select/delete round-trip: OK`);
  console.log(
    `money columns read back as string: salt=${saltIsString} shipped_usdc=${shippedIsString}`,
  );
  if (!saltIsString || !shippedIsString) {
    console.error("FAIL: a numeric column decoded to a JS number; money precision is at risk.");
    process.exitCode = 1;
  }

  await closeAquaDb();
}

main().catch(async (error) => {
  // Never echo the error verbatim: a postgres connection error embeds the URL, and this repo
  // must never surface the mirror's credential anywhere.
  console.error(
    `db-check failed: ${(error as Error).name}: ${(error as Error).message.slice(0, 160)}`,
  );
  process.exitCode = 1;
});
