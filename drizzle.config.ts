import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

// `generate` does not require a live DB; `push` and `migrate` do. We
// fall back to a placeholder so `pnpm db:generate` works even without
// .env.local (CI / fresh checkout). The runtime migrator (lib/db/migrate.ts)
// validates the real DATABASE_URL via lib/env.ts.
const url = process.env.DATABASE_URL ?? "postgresql://placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
  schemaFilter: ["public"],
});
