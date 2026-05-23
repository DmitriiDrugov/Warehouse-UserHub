/**
 * Operator (app_users) services. Only `warehouse_admin` may call these —
 * the caller MUST `await requireOperator(['warehouse_admin'])` first.
 */

import { and, eq } from "drizzle-orm";

import type { DbTx } from "../db/client";
import {
  appUserWarehouses,
  appUsers,
  type AppUser,
} from "../db/schema";
import type { OperatorRole } from "../validation/enums";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError } from "./errors";
import type { ServiceContext } from "./context";

export type CreateOperatorInput = {
  email: string;
  fullName: string;
  operatorRole: OperatorRole;
  authUserId?: string | null;
  warehouseIds: string[];
};

export async function createOperator(
  tx: DbTx,
  input: CreateOperatorInput,
  ctx: ServiceContext,
): Promise<AppUser> {
  const [existing] = await tx
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.email, input.email))
    .limit(1);
  if (existing) {
    throw new ConflictError(`operator with email ${input.email} already exists`);
  }

  const [created] = await tx
    .insert(appUsers)
    .values({
      email: input.email,
      fullName: input.fullName,
      operatorRole: input.operatorRole,
      authUserId: input.authUserId ?? null,
      isActive: true,
    })
    .returning();
  if (!created) throw new Error("insert returned no row");

  if (input.warehouseIds.length > 0) {
    await tx.insert(appUserWarehouses).values(
      input.warehouseIds.map((warehouseId) => ({
        appUserId: created.id,
        warehouseId,
      })),
    );
  }

  await writeAudit(tx, ctx, {
    entityType: "app_user",
    entityId: created.id,
    action: "operator.created",
    after: { ...created, warehouseIds: input.warehouseIds },
  });

  return created;
}

export type UpdateOperatorInput = {
  id: string;
  fullName?: string;
  operatorRole?: OperatorRole;
  isActive?: boolean;
  authUserId?: string | null;
};

export async function updateOperator(
  tx: DbTx,
  input: UpdateOperatorInput,
  ctx: ServiceContext,
): Promise<AppUser> {
  const [before] = await tx
    .select()
    .from(appUsers)
    .where(eq(appUsers.id, input.id))
    .limit(1);
  if (!before) throw new NotFoundError("app_user", input.id);

  const patch: Partial<typeof appUsers.$inferInsert> = {};
  if (input.fullName !== undefined) patch.fullName = input.fullName;
  if (input.operatorRole !== undefined) patch.operatorRole = input.operatorRole;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.authUserId !== undefined) patch.authUserId = input.authUserId;

  if (Object.keys(patch).length === 0) return before;

  const [updated] = await tx
    .update(appUsers)
    .set(patch)
    .where(eq(appUsers.id, input.id))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(tx, ctx, {
    entityType: "app_user",
    entityId: updated.id,
    action:
      patch.isActive === false ? "operator.deactivated" : "operator.updated",
    before,
    after: updated,
  });

  return updated;
}

export async function assignWarehouse(
  tx: DbTx,
  appUserId: string,
  warehouseId: string,
  ctx: ServiceContext,
): Promise<void> {
  const [existing] = await tx
    .select({ id: appUserWarehouses.appUserId })
    .from(appUserWarehouses)
    .where(
      and(
        eq(appUserWarehouses.appUserId, appUserId),
        eq(appUserWarehouses.warehouseId, warehouseId),
      ),
    )
    .limit(1);
  if (existing) return;

  await tx.insert(appUserWarehouses).values({ appUserId, warehouseId });

  await writeAudit(tx, ctx, {
    entityType: "app_user",
    entityId: appUserId,
    action: "operator.updated",
    after: { warehouseAssigned: warehouseId },
  });
}

export async function unassignWarehouse(
  tx: DbTx,
  appUserId: string,
  warehouseId: string,
  ctx: ServiceContext,
): Promise<void> {
  const result = await tx
    .delete(appUserWarehouses)
    .where(
      and(
        eq(appUserWarehouses.appUserId, appUserId),
        eq(appUserWarehouses.warehouseId, warehouseId),
      ),
    )
    .returning({ appUserId: appUserWarehouses.appUserId });
  if (result.length === 0) return;

  await writeAudit(tx, ctx, {
    entityType: "app_user",
    entityId: appUserId,
    action: "operator.updated",
    after: { warehouseUnassigned: warehouseId },
  });
}
