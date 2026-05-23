/**
 * Database clients.
 *
 *  - `dbAdmin`   — connects with the full-privilege role (DATABASE_URL).
 *                  Bypasses RLS. Used by:
 *                    • drizzle migrations
 *                    • the seed script
 *                    • scheduled cron jobs (`/api/cron/*`)
 *                    • deterministic services that always run under
 *                      `withOperator()` (so RLS still applies via SET LOCAL ROLE).
 *
 *  - `withOperator(operatorId, fn)` — opens a transaction, switches role to
 *                  `app_operator` (a non-BYPASSRLS role created in
 *                  `0001_security_extras.sql`), sets `app.operator_id`, and
 *                  runs `fn` against a TX-scoped Drizzle client. RLS policies
 *                  read `app.operator_id` to enforce per-warehouse isolation
 *                  inside the database itself (§4, §8).
 *
 *  - `dbReadonly`— connects with the `nl_query_reader` role (DATABASE_URL_READONLY).
 *                  Has SELECT only on the NL→SQL reporting views (§6.1, §8).
 *                  Used exclusively by `lib/ai/nl-sql`.
 *
 * Two different `postgres` clients = two different connection pools.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import { serverEnv } from "../env";
import * as schema from "./schema";

type Globals = {
  __adminSql?: ReturnType<typeof postgres>;
  __readonlySql?: ReturnType<typeof postgres>;
};
const g = globalThis as unknown as Globals;

function getAdminSql() {
  if (!g.__adminSql) {
    g.__adminSql = postgres(serverEnv().DATABASE_URL, {
      max: 10,
      prepare: false,
      idle_timeout: 20,
    });
  }
  return g.__adminSql;
}

function getReadonlySql() {
  if (!g.__readonlySql) {
    g.__readonlySql = postgres(serverEnv().DATABASE_URL_READONLY, {
      max: 4,
      prepare: false,
      idle_timeout: 20,
    });
  }
  return g.__readonlySql;
}

export const dbAdmin = drizzle(getAdminSql(), { schema });
export const dbReadonly = drizzle(getReadonlySql(), { schema });

export type Database = typeof dbAdmin;
export type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Run `fn` against the database with RLS enforced for the given operator.
 *
 * Implementation detail: opens a transaction, executes
 *   SET LOCAL ROLE app_operator;
 *   SET LOCAL app.operator_id = '<uuid>';
 * — then hands the TX-scoped Drizzle client to `fn`. When the transaction
 * commits, the role and setting are released (LOCAL = transaction scope).
 *
 * Why both? `app_operator` is a non-BYPASSRLS role, so policies actually
 * fire; `app.operator_id` is read inside the policies via
 * `current_setting('app.operator_id', true)::uuid` to know *which* operator
 * is asking.
 */
export async function withOperator<T>(
  operatorId: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return await dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_operator`);
    await tx.execute(
      sql`SELECT set_config('app.operator_id', ${operatorId}, true)`,
    );
    return await fn(tx);
  });
}
