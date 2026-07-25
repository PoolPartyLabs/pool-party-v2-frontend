import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { aquaDatabaseUrl } from "../config/env";
import * as schema from "./schema";

/**
 * The only place in the app that opens a connection to the Aqua database (SRV-R1: the API
 * module is the sole layer allowed to touch Drizzle).
 *
 * Lazily created and memoised: importing this module must not connect, so a route that never
 * touches Aqua pays nothing and a missing env var fails at the call, not at import time.
 */

let client: ReturnType<typeof postgres> | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function aquaDb() {
  if (!db) {
    // max: 1 keeps a serverless function from exhausting Neon's connection budget; the
    // long-running scripts are single-threaded and do not need more either.
    client = postgres(aquaDatabaseUrl(), { max: 1, prepare: false });
    db = drizzle(client, { schema });
  }
  return db;
}

/** Scripts should close explicitly so `pnpm aqua:*` exits instead of hanging on the pool. */
export async function closeAquaDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    db = undefined;
  }
}

export { schema };
