/**
 * Warehouse-user services. Cover the full lifecycle:
 *
 *   createWarehouseUser   — INSERT + apply role template + instantiate onboarding checklist
 *   updateWarehouseUser   — generic field updates
 *   changeStatus          — explicit state transition with audit
 *   offboardUser          — composite: status=offboarded, revoke all active access,
 *                           expire valid certs, instantiate offboarding checklist.
 *                           Returns a structured summary used by the §6.4 pipeline.
 *
 * All operations write audit_log for every step they perform.
 */

import { and, eq } from "drizzle-orm";

import type { DbTx } from "../db/client";
import {
  certificates,
  checklistTemplates,
  userAccess,
  userCertificates,
  userChecklists,
  warehouseUsers,
  type NewWarehouseUser,
  type WarehouseUser,
} from "../db/schema";
import type { WarehouseUserStatus } from "../validation/enums";
import { applyRoleTemplate, revokeAccess } from "./access";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError } from "./errors";
import { instantiateChecklist } from "./checklists";
import type { ServiceContext } from "./context";

export type CreateWarehouseUserInput = {
  employeeId: string;
  fullName: string;
  email?: string | null;
  warehouseId: string;
  roleId: string;
  hireDate: Date;
  status?: WarehouseUserStatus;
};

async function loadWarehouseUser(
  tx: DbTx,
  id: string,
): Promise<WarehouseUser> {
  const [row] = await tx
    .select()
    .from(warehouseUsers)
    .where(eq(warehouseUsers.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("warehouse_user", id);
  return row;
}

export async function createWarehouseUser(
  tx: DbTx,
  input: CreateWarehouseUserInput,
  ctx: ServiceContext,
): Promise<WarehouseUser> {
  const values: NewWarehouseUser = {
    employeeId: input.employeeId,
    fullName: input.fullName,
    email: input.email ?? null,
    warehouseId: input.warehouseId,
    roleId: input.roleId,
    hireDate: input.hireDate,
    status: input.status ?? "pending",
  };

  const [created] = await tx.insert(warehouseUsers).values(values).returning();
  if (!created) throw new Error("insert returned no row");

  await writeAudit(tx, ctx, {
    entityType: "warehouse_user",
    entityId: created.id,
    action: "warehouse_user.created",
    after: created,
  });

  // Apply role template
  await applyRoleTemplate(
    tx,
    { warehouseUserId: created.id, roleId: input.roleId, source: "role_template" },
    ctx,
  );

  // Instantiate onboarding checklist: role-specific first, fall back to generic.
  const candidates = await tx
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.type, "onboarding"));
  const preferred =
    candidates.find((c) => c.roleId === input.roleId) ??
    candidates.find((c) => c.roleId === null) ??
    null;
  if (preferred) {
    await instantiateChecklist(
      tx,
      {
        warehouseUserId: created.id,
        templateId: preferred.id,
        type: "onboarding",
      },
      ctx,
    );
  }

  return created;
}

export type UpdateWarehouseUserInput = {
  id: string;
  fullName?: string;
  email?: string | null;
  warehouseId?: string;
  roleId?: string;
};

export async function updateWarehouseUser(
  tx: DbTx,
  input: UpdateWarehouseUserInput,
  ctx: ServiceContext,
): Promise<WarehouseUser> {
  const before = await loadWarehouseUser(tx, input.id);

  const patch: Partial<NewWarehouseUser> = {};
  if (input.fullName !== undefined) patch.fullName = input.fullName;
  if (input.email !== undefined) patch.email = input.email;
  if (input.warehouseId !== undefined) patch.warehouseId = input.warehouseId;
  if (input.roleId !== undefined) patch.roleId = input.roleId;

  if (Object.keys(patch).length === 0) return before;

  const [updated] = await tx
    .update(warehouseUsers)
    .set(patch)
    .where(eq(warehouseUsers.id, input.id))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(tx, ctx, {
    entityType: "warehouse_user",
    entityId: updated.id,
    action: "warehouse_user.updated",
    before,
    after: updated,
  });

  return updated;
}

const ALLOWED_TRANSITIONS: Record<WarehouseUserStatus, WarehouseUserStatus[]> = {
  pending: ["active", "suspended", "offboarded"],
  active: ["suspended", "offboarded"],
  suspended: ["active", "offboarded"],
  offboarded: [], // terminal
};

export async function changeStatus(
  tx: DbTx,
  id: string,
  nextStatus: WarehouseUserStatus,
  ctx: ServiceContext,
): Promise<WarehouseUser> {
  const before = await loadWarehouseUser(tx, id);
  if (before.status === nextStatus) return before;

  const allowed = ALLOWED_TRANSITIONS[before.status];
  if (!allowed.includes(nextStatus)) {
    throw new ConflictError(
      `Invalid status transition: ${before.status} → ${nextStatus}`,
    );
  }

  const patch: Partial<NewWarehouseUser> = { status: nextStatus };
  if (nextStatus === "offboarded") {
    patch.terminationDate = new Date();
  }

  const [updated] = await tx
    .update(warehouseUsers)
    .set(patch)
    .where(eq(warehouseUsers.id, id))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(tx, ctx, {
    entityType: "warehouse_user",
    entityId: id,
    action: "warehouse_user.status_changed",
    before: { status: before.status },
    after: { status: updated.status },
  });

  return updated;
}

export type OffboardSummary = {
  warehouseUser: WarehouseUser;
  revokedAccessIds: string[];
  revokedCertificateIds: string[];
  offboardingChecklistId: string | null;
};

export async function offboardUser(
  tx: DbTx,
  warehouseUserId: string,
  ctx: ServiceContext,
): Promise<OffboardSummary> {
  const wu = await changeStatus(tx, warehouseUserId, "offboarded", ctx);

  // Revoke every active access grant.
  const activeAccess = await tx
    .select({ id: userAccess.id })
    .from(userAccess)
    .where(
      and(
        eq(userAccess.warehouseUserId, warehouseUserId),
        eq(userAccess.status, "active"),
      ),
    );
  const revokedAccessIds: string[] = [];
  for (const { id } of activeAccess) {
    await revokeAccess(tx, id, {
      ...ctx,
      reason: ctx.reason ?? "offboarding: auto-revoke",
    });
    revokedAccessIds.push(id);
  }

  // Revoke every still-valid certificate.
  const validCerts = await tx
    .select({ id: userCertificates.id })
    .from(userCertificates)
    .where(
      and(
        eq(userCertificates.warehouseUserId, warehouseUserId),
        eq(userCertificates.status, "valid"),
      ),
    );
  const revokedCertificateIds: string[] = [];
  for (const { id } of validCerts) {
    const [before] = await tx
      .select()
      .from(userCertificates)
      .where(eq(userCertificates.id, id))
      .limit(1);
    if (!before) continue;
    const [updated] = await tx
      .update(userCertificates)
      .set({ status: "revoked" })
      .where(eq(userCertificates.id, id))
      .returning();
    if (!updated) continue;
    await writeAudit(tx, ctx, {
      entityType: "user_certificate",
      entityId: id,
      action: "certificate.revoked",
      before,
      after: updated,
    });
    revokedCertificateIds.push(id);
  }
  // Reference catalog (silence unused-import warning while keeping intent clear).
  void certificates;

  // Instantiate offboarding checklist if a template exists — idempotent:
  // if the user already has an offboarding checklist (e.g. offboardUser was
  // called a second time from approveProposal for offboard_completeness),
  // reuse the existing one rather than creating a duplicate.
  const candidates = await tx
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.type, "offboarding"));
  const preferred =
    candidates.find((c) => c.roleId === wu.roleId) ??
    candidates.find((c) => c.roleId === null) ??
    null;

  let offboardingChecklistId: string | null = null;
  if (preferred) {
    const [existingChecklist] = await tx
      .select({ id: userChecklists.id })
      .from(userChecklists)
      .where(
        and(
          eq(userChecklists.warehouseUserId, warehouseUserId),
          eq(userChecklists.type, "offboarding"),
        ),
      )
      .limit(1);

    if (existingChecklist) {
      offboardingChecklistId = existingChecklist.id;
    } else {
      const instance = await instantiateChecklist(
        tx,
        {
          warehouseUserId,
          templateId: preferred.id,
          type: "offboarding",
        },
        ctx,
      );
      offboardingChecklistId = instance.id;
    }
  }

  await writeAudit(tx, ctx, {
    entityType: "warehouse_user",
    entityId: warehouseUserId,
    action: "warehouse_user.offboarded",
    after: {
      revokedAccessIds,
      revokedCertificateIds,
      offboardingChecklistId,
    },
  });

  return {
    warehouseUser: wu,
    revokedAccessIds,
    revokedCertificateIds,
    offboardingChecklistId,
  };
}
