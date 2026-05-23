/**
 * Integration test (§11): full proposal lifecycle.
 *
 *   1. seed catalog + a warehouse_user + an active access grant
 *   2. INSERT an ai_proposals row of type 'revoke_access' targeting that grant
 *   3. approveProposal as a warehouse_admin operator
 *   4. assert user_access.status='revoked'
 *   5. assert audit_log has matching proposal.approved + access.revoked entries
 *      linked back to the proposal_id (ai_assisted=true)
 *
 * Skips itself if no usable DATABASE_URL.
 */

import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, beforeAll } from "vitest";
import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";

import {
  aiProposals,
  appUsers,
  auditLog,
  permissions,
  rolePermissions,
  roles,
  systems,
  userAccess,
  warehouseUsers,
  warehouses,
} from "@/lib/db/schema";
import { approveProposal } from "@/lib/services/proposals";
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

describe.runIf(!skip)("proposal lifecycle (integration)", () => {
  it("approve → executes deterministic mutation → writes linked audit", async () => {
    if (!testDb) return; // type guard — runIf already gates
    const db = testDb.db;

    // unique markers so we can clean up at the end
    const marker = `proptest-${randomUUID().slice(0, 8)}`;
    const cleanup: Array<() => Promise<void>> = [];

    // 1. catalog: warehouse, role, system, permission, role-permission
    const [wh] = await db
      .insert(warehouses)
      .values({ code: `${marker}-WH`, name: `${marker} warehouse` })
      .returning();
    cleanup.push(async () => {
      await db.delete(warehouses).where(eq(warehouses.id, wh!.id));
    });

    const [role] = await db
      .insert(roles)
      .values({ code: `${marker}-role`, name: `${marker} role` })
      .returning();
    cleanup.push(async () => {
      await db.delete(roles).where(eq(roles.id, role!.id));
    });

    const [sys] = await db
      .insert(systems)
      .values({ code: `${marker}sys`, name: `${marker} sys` })
      .returning();
    cleanup.push(async () => {
      await db.delete(systems).where(eq(systems.id, sys!.id));
    });

    const [perm] = await db
      .insert(permissions)
      .values({ systemId: sys!.id, code: `${marker}perm`, name: `${marker} perm` })
      .returning();
    cleanup.push(async () => {
      await db.delete(permissions).where(eq(permissions.id, perm!.id));
    });

    await db.insert(rolePermissions).values({
      roleId: role!.id,
      permissionId: perm!.id,
    });

    // 2. operator: a warehouse_admin who will approve
    const [op] = await db
      .insert(appUsers)
      .values({
        email: `${marker}-admin@example.com`,
        fullName: `${marker} admin`,
        operatorRole: "warehouse_admin",
        isActive: true,
        authUserId: null,
      })
      .returning();
    cleanup.push(async () => {
      await db.delete(appUsers).where(eq(appUsers.id, op!.id));
    });

    // 3. warehouse_user + active access
    const [wu] = await db
      .insert(warehouseUsers)
      .values({
        employeeId: `${marker}-emp`,
        fullName: `${marker} worker`,
        warehouseId: wh!.id,
        roleId: role!.id,
        hireDate: new Date(),
        status: "active",
      })
      .returning();
    cleanup.push(async () => {
      await db.delete(warehouseUsers).where(eq(warehouseUsers.id, wu!.id));
    });

    const [grant] = await db
      .insert(userAccess)
      .values({
        warehouseUserId: wu!.id,
        permissionId: perm!.id,
        grantedBy: op!.id,
        source: "manual",
        status: "active",
      })
      .returning();

    // 4. proposal
    const [proposal] = await db
      .insert(aiProposals)
      .values({
        type: "revoke_access",
        targetEntityType: "warehouse_user",
        targetEntityId: wu!.id,
        payload: {
          warehouseUserId: wu!.id,
          accessIds: [grant!.id],
          reason: "test: dormant",
        } as Record<string, unknown>,
        explanation: `${marker}: revoke dormant access`,
        status: "pending",
        createdBy: "system",
      })
      .returning();

    // 5. approve under withOperator-equivalent transaction (we connect as
    //    postgres for the test, which bypasses RLS — that's fine because the
    //    RLS test in rls.test.ts verifies enforcement separately).
    await db.transaction(async (tx) => {
      await approveProposal(tx, proposal!.id, {
        actor: {
          id: op!.id,
          email: op!.email,
          fullName: op!.fullName,
          operatorRole: op!.operatorRole,
          authUserId: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        reason: "test approval",
      });
    });

    // 6. user_access is now revoked
    const [after] = await db
      .select()
      .from(userAccess)
      .where(eq(userAccess.id, grant!.id))
      .limit(1);
    expect(after?.status).toBe("revoked");
    expect(after?.revokedBy).toBe(op!.id);

    // 7. audit log: proposal.approved + access.revoked, both pointing to the
    //    proposal, ai_assisted=true
    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.proposalId, proposal!.id))
      .orderBy(desc(auditLog.createdAt));
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every((e) => e.aiAssisted)).toBe(true);
    expect(entries.some((e) => e.action === "proposal.approved")).toBe(true);
    expect(entries.some((e) => e.action === "access.revoked")).toBe(true);

    // 8. Cleanup
    // We deliberately do NOT delete the proposal: audit_log.proposal_id is
    // ON DELETE RESTRICT (because SET NULL would UPDATE an immutable audit
    // row). We also cannot DELETE audit_log rows (append-only trigger).
    // The proposal + audit entries persist under the unique `marker` — fine
    // for an integration test scoped by random marker. Catalog rows are
    // cleaned up below; warehouseUsers cascade-deletes user_access.
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch {
        // best-effort; some catalog rows may now be referenced by surviving
        // audit/proposal rows under RESTRICT — that is acceptable, the
        // accumulation per test is small.
      }
    }
    // reference unused imports for clarity / future use
    void and;
    void drizzleSql;
  });
});
