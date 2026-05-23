/**
 * Shared helpers for DB-backed tests. If DATABASE_URL is unset or the
 * connection fails, the helper signals "skip" so the test can mark itself
 * skipped instead of failing the whole suite on a fresh checkout.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

export type TestDb = {
  client: postgres.Sql;
  db: ReturnType<typeof drizzle<typeof schema>>;
};

export async function tryConnect(): Promise<TestDb | null> {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("CHANGEME")) return null;
  try {
    const client = postgres(url, { max: 2, prepare: false, connect_timeout: 3 });
    // probe connection
    await client`select 1`;
    return { client, db: drizzle(client, { schema }) };
  } catch {
    return null;
  }
}

export async function close(db: TestDb): Promise<void> {
  await db.client.end({ timeout: 3 });
}
