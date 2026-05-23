"use server";

import { revalidatePath } from "next/cache";

import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { ServiceError } from "@/lib/services/errors";
import {
  assignWarehouse,
  createOperator,
  unassignWarehouse,
  updateOperator,
} from "@/lib/services/operators";
import {
  AssignWarehouseForm,
  CreateOperatorForm,
  UnassignWarehouseForm,
  UpdateOperatorForm,
} from "@/lib/validation/forms";

export type AdminState = { error?: string; ok?: true };

export async function createOperatorAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const operator = await requireOperator(["warehouse_admin"]);
  const parsed = CreateOperatorForm.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    operatorRole: formData.get("operatorRole"),
    warehouseIds: formData.getAll("warehouseIds"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      createOperator(
        tx,
        {
          email: parsed.data.email,
          fullName: parsed.data.fullName,
          operatorRole: parsed.data.operatorRole,
          authUserId: null,
          warehouseIds: parsed.data.warehouseIds,
        },
        { actor: operator, reason: "admin: create operator" },
      ),
    );
  } catch (err) {
    if (err instanceof ServiceError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/operators");
  return { ok: true };
}

export async function updateOperatorAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const operator = await requireOperator(["warehouse_admin"]);
  const parsed = UpdateOperatorForm.safeParse({
    id: formData.get("id"),
    fullName: formData.get("fullName"),
    operatorRole: formData.get("operatorRole"),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      updateOperator(
        tx,
        {
          id: parsed.data.id,
          fullName: parsed.data.fullName,
          operatorRole: parsed.data.operatorRole,
          isActive: parsed.data.isActive,
        },
        { actor: operator, reason: "admin: update operator" },
      ),
    );
  } catch (err) {
    if (err instanceof ServiceError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/operators");
  return { ok: true };
}

export async function assignWarehouseAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const operator = await requireOperator(["warehouse_admin"]);
  const parsed = AssignWarehouseForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      assignWarehouse(tx, parsed.data.appUserId, parsed.data.warehouseId, {
        actor: operator,
        reason: "admin: assign warehouse",
      }),
    );
  } catch (err) {
    if (err instanceof ServiceError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/operators");
  return { ok: true };
}

export async function unassignWarehouseAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const operator = await requireOperator(["warehouse_admin"]);
  const parsed = UnassignWarehouseForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) =>
      unassignWarehouse(tx, parsed.data.appUserId, parsed.data.warehouseId, {
        actor: operator,
        reason: "admin: unassign warehouse",
      }),
    );
  } catch (err) {
    if (err instanceof ServiceError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/operators");
  return { ok: true };
}
