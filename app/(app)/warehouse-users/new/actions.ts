"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { proposeProvision } from "@/lib/ai/provisioning";
import { createWarehouseUser } from "@/lib/services/warehouse-users";
import { CreateWarehouseUserForm, NlProvisionForm } from "@/lib/validation/forms";
import { ServiceError } from "@/lib/services/errors";

export type CreateFormState = { error?: string };
export type NlProvisionState = {
  error?: string;
  proposalId?: string;
};

export async function createWarehouseUserAction(
  _prev: CreateFormState,
  formData: FormData,
): Promise<CreateFormState> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  const parsed = CreateWarehouseUserForm.safeParse({
    employeeId: formData.get("employeeId"),
    fullName: formData.get("fullName"),
    email: formData.get("email") ?? "",
    warehouseId: formData.get("warehouseId"),
    roleId: formData.get("roleId"),
    hireDate: formData.get("hireDate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  try {
    const created = await withOperator(operator.id, async (tx) =>
      createWarehouseUser(
        tx,
        {
          employeeId: parsed.data.employeeId,
          fullName: parsed.data.fullName,
          email: parsed.data.email ?? null,
          warehouseId: parsed.data.warehouseId,
          roleId: parsed.data.roleId,
          hireDate: new Date(parsed.data.hireDate),
        },
        { actor: operator, reason: "manual create via /warehouse-users/new" },
      ),
    );
    revalidatePath("/warehouse-users");
    redirect(`/warehouse-users/${created.id}`);
  } catch (err) {
    if (err instanceof ServiceError) return { error: err.message };
    throw err;
  }
}

export async function proposeProvisionAction(
  _prev: NlProvisionState,
  formData: FormData,
): Promise<NlProvisionState> {
  await requireOperator(["hr", "warehouse_admin"]);
  const parsed = NlProvisionForm.safeParse({ text: formData.get("text") });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const result = await proposeProvision(parsed.data.text);
  if (!result.ok) {
    return { error: result.error };
  }
  revalidatePath("/proposals");
  return { proposalId: result.proposalId };
}
