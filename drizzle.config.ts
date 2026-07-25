import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// AQUA_DATABASE_URL lives only in .env.local (gitignored). drizzle-kit runs outside Next, so
// it has to load the file itself.
config({ path: ".env.local", quiet: true });

/**
 * Drizzle config for the Aqua extension tables ONLY.
 *
 * `tablesFilter` matters: the target database is a mirror of production and already carries
 * the real pool-party-api schema. Without the filter, drizzle-kit would read those tables as
 * "not in my schema" and generate DROP statements for them. Scoped to `aqua_*`, a migration
 * can only ever touch tables we created.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/aqua/db/schema.ts",
  out: "./drizzle/aqua",
  tablesFilter: ["aqua_*"],
  dbCredentials: {
    url: process.env.AQUA_DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
