/**
 * RLS isolation test (§11). Proves that, when connected via withOperator(...),
 * an operator scoped to warehouse A cannot SELECT a warehouse_user that
 * lives in warehouse B.
 *
 * Mechanism: each query inside withOperator runs as the `app_operator`
 * Postgres role (NOT BYPASSRLS). The has_warehouse_access() helper reads
 * `app.operator_id` from the session and joins through
 * `app_user_warehouses`. Warehouse B's row should therefore be invisible.
 *
 * Skips if no usable DATABASE_URL.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import {
  appUserWarehouses,
  appUsers,
  roles,
  warehouseUsers,
  warehouses,
} from "@/lib/db/schema";
import { tryConnect, close, type TestDb } from "./db-helpers";

let testDb: TestDb | null = null;
let skip = false;

beforeAll(async () => {
  testDb = await tryConnect();
  if (!testDb) skip = true;
});

afterAll(async () => {
  if (testDb) await close(testDb);
});

describe.runIf(!skip)("RLS isolation (integration)", () => {
  it("operator can only see warehouse_users in their assigned warehouses", async () => {
    if (!testDb) return;
    const db = testDb.db;
    const marker = `rls-${randomUUID().slice(0, 8)}`;

    // Set up: two warehouses, a role, two warehouse_users (one per warehouse),
    // and two operators (one scoped per warehouse).
    const [whA] = await db
      .insert(warehouses)
      .values({ code: `${marker}-A`, name: `${marker} A` })
      .returning();
    const [whB] = await db
      .insert(warehouses)
      .values({ code: `${marker}-B`, name: `${marker} B` })
      .returning();
    const [role] = await db
      .insert(roles)
      .values({ code: `${marker}-role`, name: `${marker} role` })
      .returning();
    const [opA] = await db
      .insert(appUsers)
      .values({
        email: `${marker}-a@example.com`,
        fullName: "Op A",
        operatorRole: "hr",
        isActive: true,
      })
      .returning();
    const [opB] = await db
      .insert(appUsers)
      .values({
        email: `${marker}-b@example.com`,
        fullName: "Op B",
        operatorRole: "hr",
        isActive: true,
      })
      .returning();
    await db.insert(appUserWarehouses).values([
      { appUserId: opA!.id, warehouseId: whA!.id },
      { appUserId: opB!.id, warehouseId: whB!.id },
    ]);

    const [wuA] = await db
      .insert(warehouseUsers)
      .values({
        employeeId: `${marker}-A1`,
        fullName: "Worker A",
        warehouseId: whA!.id,
        roleId: role!.id,
        hireDate: new Date(),
        status: "active",
      })
      .returning();
    const [wuB] = await db
      .insert(warehouseUsers)
      .values({
        employeeId: `${marker}-B1`,
        fullName: "Worker B",
        warehouseId: whB!.id,
        roleId: role!.id,
        hireDate: new Date(),
        status: "active",
      })
      .returning();

    // Helper: run a query as a specific operator and return rows.
    async function asOperator(operatorId: string) {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE app_operator`);
        await tx.execute(
          sql`SELECT set_config('app.operator_id', ${operatorId}, true)`,
        );
        const rows = await tx
          .select({ id: warehouseUsers.id, employeeId: warehouseUsers.employeeId })
          .from(warehouseUsers)
          .where(
            sql`${warehouseUsers.id} in (${wuA!.id}, ${wuB!.id})`,
          );
        return rows;
      });
    }

    const seenByA = await asOperator(opA!.id);
    const seenByB = await asOperator(opB!.id);

    const idsA = seenByA.map((r) => r.id);
    const idsB = seenByB.map((r) => r.id);

    expect(idsA).toContain(wuA!.id);
    expect(idsA).not.toContain(wuB!.id);
    expect(idsB).toContain(wuB!.id);
    expect(idsB).not.toContain(wuA!.id);

    // cleanup (we use bypass-RLS connection for teardown)
    await db.delete(warehouseUsers).where(eq(warehouseUsers.id, wuA!.id));
    await db.delete(warehouseUsers).where(eq(warehouseUsers.id, wuB!.id));
    await db.delete(appUserWarehouses).where(eq(appUserWarehouses.appUserId, opA!.id));
    await db.delete(appUserWarehouses).where(eq(appUserWarehouses.appUserId, opB!.id));
    await db.delete(appUsers).where(eq(appUsers.id, opA!.id));
    await db.delete(appUsers).where(eq(appUsers.id, opB!.id));
    await db.delete(roles).where(eq(roles.id, role!.id));
    await db.delete(warehouses).where(eq(warehouses.id, whA!.id));
    await db.delete(warehouses).where(eq(warehouses.id, whB!.id));
  });
});
