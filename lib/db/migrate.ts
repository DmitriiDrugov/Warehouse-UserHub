/**
 * Programmatic migrator. Runs in two passes:
 *
 *   1. drizzle-orm's PG migrator over lib/db/migrations/*.sql
 *      (the auto-generated schema migrations).
 *   2. Hand-written extras in lib/db/migrations/extras/*.sql, applied in
 *      lexicographic order. These files MUST be idempotent — they re-run
 *      on every `pnpm db:migrate`.
 *
 * Both passes run as the role behind DATABASE_URL (typically `postgres`
 * on Supabase, which is a superuser and bypasses RLS — exactly what we
 * want for schema management).
 *
 * Invoked by:
 *   - `pnpm db:migrate` (developer)
 *   - the seed script before populating data
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "migrations");
const extrasFolder = join(migrationsFolder, "extras");

async function main() {
  console.log("[migrate] connecting…");
  // `max: 1` is required by drizzle-orm/postgres-js/migrator.
  const sql = postgres(databaseUrl!, { max: 1, prepare: false });
  const db = drizzle(sql);

  try {
    console.log(`[migrate] applying drizzle migrations from ${migrationsFolder}`);
    await migrate(db, { migrationsFolder });

    console.log(`[migrate] applying hand-written extras from ${extrasFolder}`);
    let extraFiles: string[];
    try {
      extraFiles = readdirSync(extrasFolder)
        .filter((f) => f.endsWith(".sql"))
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.log("[migrate] no extras folder; skipping");
        extraFiles = [];
      } else {
        throw err;
      }
    }

    for (const filename of extraFiles) {
      const path = join(extrasFolder, filename);
      const contents = readFileSync(path, "utf8");
      console.log(`[migrate]   ↳ ${filename} (${contents.length} bytes)`);
      // postgres.js's `sql.unsafe` runs the script as a single multi-statement
      // command — exactly what we want for hand-written DDL files.
      await sql.unsafe(contents);
    }

    console.log("[migrate] done.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
