/**
 * Prints every Active Reserve vault discovered from chain. No arguments, no config beyond
 * AQUA_MANAGER_ADDRESS: this is the same code path the page uses, run standalone so the
 * discovery can be checked without a browser.
 *
 * Run: pnpm aqua:discover
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main(): Promise<void> {
  const { discoverVaults } = await import("../../src/lib/aqua/api/discovery");
  const vaults = await discoverVaults();

  console.log(`discovered ${vaults.length} Active Reserve vault(s)\n`);
  for (const v of vaults) {
    console.log(`  ${v.vault}`);
    console.log(`    adapter ${v.adapter ?? "(none)"}`);
    console.log(`    owner   ${v.owner}`);
    console.log(`    ships   ${v.shipCount}, first seen at block ${v.firstSeenBlock}`);
  }
  if (vaults.length === 0) {
    console.log("  Set AQUA_MANAGER_ADDRESS, or no vault has shipped a strategy yet.");
  }
}

main().catch((error) => {
  console.error(`discover failed: ${(error as Error).message.slice(0, 200)}`);
  process.exitCode = 1;
});
