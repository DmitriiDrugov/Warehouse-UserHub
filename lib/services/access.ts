/**
 * Access services. The only code allowed to mutate `user_access` (§2).
 *
 *   grantAccess        — create a new active grant
 *   revokeAccess       — flip status to 'revoked' (kept as history)
 *   expireAccess       — flip status to 'expired' (used by the rules engine)
 *   markUsed           — bump last_used_at (anomaly detection inputs)
 *   applyRoleTemplate  — bulk-grant every permission in a role's template
 *
 * All write audit_log inside the same transaction.
 */

import { and, eq } from "drizzle-orm";

import type { DbTx } from "../db/client";
import {
  permissions,
  systems,
  userAccess,
  warehouseUsers,
  type UserAccess,
} from "../db/schema";
import { rolePermissions } from "../db/schema";
import type { AccessSource } from "../validation/enums";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError, ValidationFailure } from "./errors";
import type { ServiceContext } from "./context";

export type GrantAccessInput = {
  warehouseUserId: string;
  permissionId: string;
  source: AccessSource;
  expiresAt?: Date | null;
};

async function loadActiveGrant(
  tx: DbTx,
  warehouseUserId: string,
  permissionId: string,
): Promise<UserAccess | null> {
  const [row] = await tx
    .select()
    .from(userAccess)
    .where(
      and(
        eq(userAccess.warehouseUserId, warehouseUserId),
        eq(userAccess.permissionId, permissionId),
        eq(userAccess.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadPermissionWithSystem(tx: DbTx, permissionId: string) {
  const [row] = await tx
    .select({
      id: permissions.id,
      code: permissions.code,
      systemCode: systems.code,
    })
    .from(permissions)
    .innerJoin(systems, eq(systems.id, permissions.systemId))
    .where(eq(permissions.id, permissionId))
    .limit(1);
  if (!row) throw new NotFoundError("permission", permissionId);
  return row;
}

async function assertWarehouseUserGrantable(
  tx: DbTx,
  warehouseUserId: string,
) {
  const [row] = await tx
    .select({ id: warehouseUsers.id, status: warehouseUsers.status })
    .from(warehouseUsers)
    .where(eq(warehouseUsers.id, warehouseUserId))
    .limit(1);
  if (!row) throw new NotFoundError("warehouse_user", warehouseUserId);
  if (row.status === "offboarded") {
    throw new ConflictError(
      "Cannot grant access to an offboarded warehouse user",
    );
  }
}

export async function grantAccess(
  tx: DbTx,
  input: GrantAccessInput,
  ctx: ServiceContext,
): Promise<UserAccess> {
  await assertWarehouseUserGrantable(tx, input.warehouseUserId);
  const perm = await loadPermissionWithSystem(tx, input.permissionId);

  const existing = await loadActiveGrant(
    tx,
    input.warehouseUserId,
    input.permissionId,
  );
  if (existing) {
    throw new ConflictError(
      `${perm.systemCode}.${perm.code} is already granted to this user`,
    );
  }

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new ValidationFailure("expires_at must be in the future");
  }

  const [inserted] = await tx
    .insert(userAccess)
    .values({
      warehouseUserId: input.warehouseUserId,
      permissionId: input.permissionId,
      grantedBy: ctx.actor.id,
      expiresAt: input.expiresAt ?? null,
      source: input.source,
      status: "active",
    })
    .returning();
  if (!inserted) throw new Error("insert returned no row");

  await writeAudit(tx, ctx, {
    entityType: "user_access",
    entityId: inserted.id,
    action: "access.granted",
    after: { ...inserted, permissionCode: `${perm.systemCode}.${perm.code}` },
  });

  return inserted;
}

export async function revokeAccess(
  tx: DbTx,
  accessId: string,
  ctx: ServiceContext,
): Promise<UserAccess> {
  const [before] = await tx
    .select()
    .from(userAccess)
    .where(eq(userAccess.id, accessId))
    .limit(1);
  if (!before) throw new NotFoundError("user_access", accessId);
  if (before.status !== "active") {
    throw new ConflictError(`access is already '${before.status}'`);
  }

  const now = new Date();
  const [updated] = await tx
    .update(userAccess)
    .set({
      status: "revoked",
      revokedAt: now,
      revokedBy: ctx.actor.id,
    })
    .where(eq(userAccess.id, accessId))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(tx, ctx, {
    entityType: "user_access",
    entityId: accessId,
    action: "access.revoked",
    before,
    after: updated,
  });

  return updated;
}

export async function expireAccess(
  tx: DbTx,
  accessId: string,
  ctx: ServiceContext,
): Promise<UserAccess> {
  const [before] = await tx
    .select()
    .from(userAccess)
    .where(eq(userAccess.id, accessId))
    .limit(1);
  if (!before) throw new NotFoundError("user_access", accessId);
  if (before.status !== "active") {
    throw new ConflictError(`access is already '${before.status}'`);
  }

  const [updated] = await tx
    .update(userAccess)
    .set({
      status: "expired",
      revokedAt: new Date(),
      revokedBy: ctx.actor.id,
    })
    .where(eq(userAccess.id, accessId))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(tx, ctx, {
    entityType: "user_access",
    entityId: accessId,
    action: "access.expired",
    before,
    after: updated,
  });

  return updated;
}

export async function markUsed(
  tx: DbTx,
  accessId: string,
  ctx: ServiceContext,
): Promise<void> {
  const now = new Date();
  const result = await tx
    .update(userAccess)
    .set({ lastUsedAt: now })
    .where(and(eq(userAccess.id, accessId), eq(userAccess.status, "active")))
    .returning({ id: userAccess.id });
  if (result.length === 0) return; // nothing to do (revoked/missing)

  await writeAudit(tx, ctx, {
    entityType: "user_access",
    entityId: accessId,
    action: "access.marked_used",
    after: { lastUsedAt: now },
  });
}

export type ApplyRoleTemplateInput = {
  warehouseUserId: string;
  roleId: string;
  source?: AccessSource;
};

export async function applyRoleTemplate(
  tx: DbTx,
  input: ApplyRoleTemplateInput,
  ctx: ServiceContext,
): Promise<UserAccess[]> {
  const source = input.source ?? "role_template";

  const templatePermissions = await tx
    .select({ permissionId: rolePermissions.permissionId })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, input.roleId));

  if (templatePermissions.length === 0) return [];

  const granted: UserAccess[] = [];
  for (const { permissionId } of templatePermissions) {
    const existing = await loadActiveGrant(
      tx,
      input.warehouseUserId,
      permissionId,
    );
    if (existing) continue; // skip silently for templates
    const row = await grantAccess(
      tx,
      {
        warehouseUserId: input.warehouseUserId,
        permissionId,
        source,
      },
      ctx,
    );
    granted.push(row);
  }
  return granted;
}
