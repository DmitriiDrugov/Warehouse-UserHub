"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { warehouses } from "@/lib/db/schema";
import { writeAudit } from "@/lib/services/audit";

const Form = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  location: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
});

export type State = { error?: string; ok?: true };

export async function createWarehouseAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const operator = await requireOperator(["warehouse_admin"]);
  const parsed = Form.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    location: formData.get("location"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  try {
    await withOperator(operator.id, async (tx) => {
      const [row] = await tx
        .insert(warehouses)
        .values({
          code: parsed.data.code,
          name: parsed.data.name,
          location: parsed.data.location ?? null,
        })
        .returning();
      if (!row) throw new Error("insert returned no row");
      await writeAudit(tx, { actor: operator, reason: "admin: create warehouse" }, {
        entityType: "warehouse",
        entityId: row.id,
        action: "operator.created",
        after: row,
      });
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/admin/warehouses");
  return { ok: true };
}
