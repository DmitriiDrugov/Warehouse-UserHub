/**
 * Checklist services.
 *
 *   instantiateChecklist  — create a `user_checklists` row + one
 *                           `user_checklist_items` row for every item in
 *                           the template.
 *   tickChecklistItem     — flip `is_done` on a single item (with audit).
 *                           If all required items are done, the parent
 *                           checklist transitions to status='completed'.
 *
 * Used by the onboarding flow (createWarehouseUser), the offboarding flow
 * (offboardUser), and the checklist UI (§7.6).
 */

import { and, eq } from "drizzle-orm";

import type { DbTx } from "../db/client";
import {
  checklistItems,
  userChecklistItems,
  userChecklists,
  type UserChecklist,
  type UserChecklistItem,
} from "../db/schema";
import type { ChecklistType } from "../validation/enums";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError } from "./errors";
import type { ServiceContext } from "./context";

export type InstantiateChecklistInput = {
  warehouseUserId: string;
  templateId: string;
  type: ChecklistType;
};

export async function instantiateChecklist(
  tx: DbTx,
  input: InstantiateChecklistInput,
  ctx: ServiceContext,
): Promise<UserChecklist> {
  const [instance] = await tx
    .insert(userChecklists)
    .values({
      warehouseUserId: input.warehouseUserId,
      templateId: input.templateId,
      type: input.type,
      status: "in_progress",
    })
    .returning();
  if (!instance) throw new Error("insert returned no row");

  const templateItems = await tx
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.templateId, input.templateId));

  if (templateItems.length > 0) {
    await tx
      .insert(userChecklistItems)
      .values(
        templateItems.map((item) => ({
          userChecklistId: instance.id,
          checklistItemId: item.id,
          isDone: false,
        })),
      );
  }

  await writeAudit(tx, ctx, {
    entityType: "user_checklist",
    entityId: instance.id,
    action: "checklist.instantiated",
    after: { templateId: input.templateId, items: templateItems.length },
  });

  return instance;
}

export async function tickChecklistItem(
  tx: DbTx,
  userChecklistItemId: string,
  ctx: ServiceContext,
): Promise<UserChecklistItem> {
  const [before] = await tx
    .select()
    .from(userChecklistItems)
    .where(eq(userChecklistItems.id, userChecklistItemId))
    .limit(1);
  if (!before) throw new NotFoundError("user_checklist_item", userChecklistItemId);
  if (before.isDone) throw new ConflictError("checklist item is already done");

  const now = new Date();
  const [updated] = await tx
    .update(userChecklistItems)
    .set({ isDone: true, doneBy: ctx.actor.id, doneAt: now })
    .where(eq(userChecklistItems.id, userChecklistItemId))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(tx, ctx, {
    entityType: "user_checklist_item",
    entityId: updated.id,
    action: "checklist.item_done",
    before,
    after: updated,
  });

  await maybeCompleteParent(tx, updated.userChecklistId, ctx);
  return updated;
}

async function maybeCompleteParent(
  tx: DbTx,
  userChecklistId: string,
  ctx: ServiceContext,
): Promise<void> {
  const items = await tx
    .select({
      itemId: userChecklistItems.id,
      isDone: userChecklistItems.isDone,
      isRequired: checklistItems.isRequired,
    })
    .from(userChecklistItems)
    .innerJoin(
      checklistItems,
      eq(checklistItems.id, userChecklistItems.checklistItemId),
    )
    .where(eq(userChecklistItems.userChecklistId, userChecklistId));

  const requiredRemaining = items.filter(
    (i) => i.isRequired && !i.isDone,
  ).length;
  if (requiredRemaining > 0) return;

  const [parent] = await tx
    .select()
    .from(userChecklists)
    .where(
      and(
        eq(userChecklists.id, userChecklistId),
        eq(userChecklists.status, "in_progress"),
      ),
    )
    .limit(1);
  if (!parent) return;

  const [completed] = await tx
    .update(userChecklists)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(userChecklists.id, userChecklistId))
    .returning();
  if (!completed) return;

  await writeAudit(tx, ctx, {
    entityType: "user_checklist",
    entityId: userChecklistId,
    action: "checklist.completed",
    before: { status: parent.status },
    after: { status: completed.status },
  });
}
