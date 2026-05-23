"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { buildOffboardingProposal } from "@/lib/ai/offboarding-completeness";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { grantAccess, revokeAccess } from "@/lib/services/access";
import {
  issueCertificate,
  renewCertificate,
  revokeCertificate,
} from "@/lib/services/certificates";
import { tickChecklistItem } from "@/lib/services/checklists";
import { ServiceError } from "@/lib/services/errors";
import {
  changeStatus,
  offboardUser,
  updateWarehouseUser,
} from "@/lib/services/warehouse-users";
import {
  ChangeStatusForm,
  EditWarehouseUserForm,
  GrantAccessForm,
  IssueCertificateForm,
  OffboardForm,
  RenewCertificateForm,
  RevokeAccessForm,
  RevokeCertificateForm,
  TickChecklistItemForm,
} from "@/lib/validation/forms";

export type ActionState = { error?: string; ok?: true };

function rev(id: string) {
  revalidatePath(`/warehouse-users/${id}`);
  revalidatePath("/warehouse-users");
  revalidatePath("/dashboard");
}

function asState(err: unknown): ActionState {
  if (err instanceof ServiceError) return { error: err.message };
  throw err;
}

// -------------------------------------------------------------------
// Edit / status
// -------------------------------------------------------------------

export async function updateWarehouseUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = EditWarehouseUserForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      updateWarehouseUser(
        tx,
        {
          id: parsed.data.id,
          fullName: parsed.data.fullName,
          email: parsed.data.email,
          warehouseId: parsed.data.warehouseId,
          roleId: parsed.data.roleId,
        },
        { actor: operator, reason: "edit via UI" },
      ),
    );
    rev(parsed.data.id);
    redirect(`/warehouse-users/${parsed.data.id}`);
  } catch (err) {
    return asState(err);
  }
}

export async function changeStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = ChangeStatusForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      changeStatus(tx, parsed.data.id, parsed.data.nextStatus, {
        actor: operator,
        reason: parsed.data.reason ?? "status change via UI",
      }),
    );
    rev(parsed.data.id);
    return { ok: true };
  } catch (err) {
    return asState(err);
  }
}

export async function offboardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = OffboardForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      offboardUser(tx, parsed.data.id, {
        actor: operator,
        reason: parsed.data.reason ?? "offboard via UI",
      }),
    );
    // Kick the AI completeness check (§6.4). Best-effort: errors are recorded
    // in the resulting proposal's extras list rather than failing the offboard.
    try {
      await buildOffboardingProposal(parsed.data.id);
    } catch (err) {
      console.warn(
        "[offboardAction] completeness check failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
    rev(parsed.data.id);
    return { ok: true };
  } catch (err) {
    return asState(err);
  }
}

// -------------------------------------------------------------------
// Access
// -------------------------------------------------------------------

export async function grantAccessAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = GrantAccessForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      grantAccess(
        tx,
        {
          warehouseUserId: parsed.data.warehouseUserId,
          permissionId: parsed.data.permissionId,
          source: parsed.data.source,
          expiresAt: parsed.data.expiresAt
            ? new Date(parsed.data.expiresAt)
            : null,
        },
        {
          actor: operator,
          reason: parsed.data.reason ?? "manual grant via UI",
        },
      ),
    );
    rev(parsed.data.warehouseUserId);
    return { ok: true };
  } catch (err) {
    return asState(err);
  }
}

export async function revokeAccessAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = RevokeAccessForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const warehouseUserId = formData.get("warehouseUserId");
  try {
    await withOperator(operator.id, async (tx) =>
      revokeAccess(tx, parsed.data.accessId, {
        actor: operator,
        reason: parsed.data.reason ?? "manual revoke via UI",
      }),
    );
    if (typeof warehouseUserId === "string") rev(warehouseUserId);
    return { ok: true };
  } catch (err) {
    return asState(err);
  }
}

// -------------------------------------------------------------------
// Certificates
// -------------------------------------------------------------------

export async function issueCertificateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = IssueCertificateForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      issueCertificate(
        tx,
        {
          warehouseUserId: parsed.data.warehouseUserId,
          certificateId: parsed.data.certificateId,
          issuedAt: parsed.data.issuedAt ? new Date(parsed.data.issuedAt) : undefined,
          expiresAt: parsed.data.expiresAt
            ? new Date(parsed.data.expiresAt)
            : undefined,
          documentPath: parsed.data.documentPath ?? null,
        },
        { actor: operator, reason: "manual cert issue via UI" },
      ),
    );
    rev(parsed.data.warehouseUserId);
    return { ok: true };
  } catch (err) {
    return asState(err);
  }
}

export async function renewCertificateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = RenewCertificateForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const warehouseUserId = formData.get("warehouseUserId");
  try {
    await withOperator(operator.id, async (tx) =>
      renewCertificate(tx, parsed.data.userCertificateId, {
        actor: operator,
        reason: "manual cert renewal via UI",
      }),
    );
    if (typeof warehouseUserId === "string") rev(warehouseUserId);
    return { ok: true };
  } catch (err) {
    return asState(err);
  }
}

export async function revokeCertificateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = RevokeCertificateForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const warehouseUserId = formData.get("warehouseUserId");
  try {
    await withOperator(operator.id, async (tx) =>
      revokeCertificate(tx, parsed.data.userCertificateId, {
        actor: operator,
        reason: "manual cert revoke via UI",
      }),
    );
    if (typeof warehouseUserId === "string") rev(warehouseUserId);
    return { ok: true };
  } catch (err) {
    return asState(err);
  }
}

// -------------------------------------------------------------------
// Checklists
// -------------------------------------------------------------------

export async function tickChecklistItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = TickChecklistItemForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const warehouseUserId = formData.get("warehouseUserId");
  try {
    await withOperator(operator.id, async (tx) =>
      tickChecklistItem(tx, parsed.data.userChecklistItemId, {
        actor: operator,
        reason: "manual checklist tick via UI",
      }),
    );
    if (typeof warehouseUserId === "string") rev(warehouseUserId);
    return { ok: true };
  } catch (err) {
    return asState(err);
  }
}
