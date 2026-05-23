import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ChecklistStatusBadge } from "@/components/ui/status-badge";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import {
  checklistItems,
  checklistTemplates,
  userChecklistItems,
  userChecklists,
  warehouseUsers,
  warehouses,
} from "@/lib/db/schema";
import { CHECKLIST_STATUSES, CHECKLIST_TYPES } from "@/lib/validation/enums";

export const metadata = { title: "Checklists — UserHub" };

type SearchParams = { type?: string; status?: string };

export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const operator = await requireOperator();
  const params = await searchParams;

  const rows = await withOperator(operator.id, async (tx) => {
    const conds = [] as Array<ReturnType<typeof eq>>;
    if (
      params.type &&
      (CHECKLIST_TYPES as readonly string[]).includes(params.type)
    ) {
      conds.push(
        eq(userChecklists.type, params.type as (typeof CHECKLIST_TYPES)[number]),
      );
    }
    if (
      params.status &&
      (CHECKLIST_STATUSES as readonly string[]).includes(params.status)
    ) {
      conds.push(
        eq(
          userChecklists.status,
          params.status as (typeof CHECKLIST_STATUSES)[number],
        ),
      );
    } else {
      conds.push(eq(userChecklists.status, "in_progress"));
    }

    return await tx
      .select({
        id: userChecklists.id,
        type: userChecklists.type,
        status: userChecklists.status,
        startedAt: userChecklists.startedAt,
        completedAt: userChecklists.completedAt,
        templateName: checklistTemplates.name,
        warehouseUserId: warehouseUsers.id,
        employeeId: warehouseUsers.employeeId,
        fullName: warehouseUsers.fullName,
        warehouseCode: warehouses.code,
        totalItems: sql<number>`(SELECT COUNT(*)::int FROM ${userChecklistItems} WHERE ${userChecklistItems.userChecklistId} = ${userChecklists.id})`,
        doneItems: sql<number>`(SELECT COUNT(*)::int FROM ${userChecklistItems} WHERE ${userChecklistItems.userChecklistId} = ${userChecklists.id} AND ${userChecklistItems.isDone})`,
        requiredRemaining: sql<number>`(SELECT COUNT(*)::int FROM ${userChecklistItems} uci JOIN ${checklistItems} ci ON ci.id = uci.checklist_item_id WHERE uci.user_checklist_id = ${userChecklists.id} AND uci.is_done = false AND ci.is_required = true)`,
      })
      .from(userChecklists)
      .innerJoin(
        checklistTemplates,
        eq(checklistTemplates.id, userChecklists.templateId),
      )
      .innerJoin(warehouseUsers, eq(warehouseUsers.id, userChecklists.warehouseUserId))
      .innerJoin(warehouses, eq(warehouses.id, warehouseUsers.warehouseId))
      .where(conds.length ? and(...conds) : sql`true`)
      .orderBy(desc(userChecklists.startedAt))
      .limit(500);
  });

  return (
    <>
      <PageHeader
        title="Checklists"
        subtitle="In-progress and completed onboarding and offboarding workflows."
      />

      <Card className="mb-4" padding="p-4">
        <form method="get" className="flex flex-wrap gap-3 items-end">
          <Field label="Type" className="min-w-[10rem]">
            <Select name="type" defaultValue={params.type ?? ""}>
              <option value="">— Any —</option>
              {CHECKLIST_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status" className="min-w-[10rem]">
            <Select name="status" defaultValue={params.status ?? "in_progress"}>
              {CHECKLIST_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
      </Card>

      <p className="font-label text-label text-on-surface-variant mb-2">
        Showing {rows.length.toLocaleString()} checklist(s)
      </p>

      <DataTable>
        <thead className="bg-surface-container-low">
          <tr>
            <Th>Worker</Th>
            <Th>Warehouse</Th>
            <Th>Type</Th>
            <Th>Template</Th>
            <Th>Status</Th>
            <Th>Progress</Th>
            <Th>Required left</Th>
            <Th>Started</Th>
            <Th>Completed</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.totalItems === 0 ? 0 : Math.round((r.doneItems / r.totalItems) * 100);
            return (
              <tr key={r.id} className="hover:bg-surface-container-low transition-colors">
                <Td>
                  <Link
                    href={`/warehouse-users/${r.warehouseUserId}`}
                    className="text-primary hover:underline font-medium"
                  >
                    {r.fullName}
                  </Link>
                  <div className="font-data-mono text-label text-on-surface-variant">
                    {r.employeeId}
                  </div>
                </Td>
                <Td>{r.warehouseCode}</Td>
                <Td className="capitalize">{r.type}</Td>
                <Td>{r.templateName}</Td>
                <Td><ChecklistStatusBadge value={r.status} /></Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-surface-container rounded-full overflow-hidden">
                      <div
                        className="h-full bg-status-success"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-data-mono text-data-mono text-on-surface-variant">
                      {r.doneItems}/{r.totalItems}
                    </span>
                  </div>
                </Td>
                <Td mono align="right">{r.requiredRemaining}</Td>
                <Td mono>{new Date(r.startedAt).toISOString().slice(0, 10)}</Td>
                <Td mono>
                  {r.completedAt
                    ? new Date(r.completedAt).toISOString().slice(0, 10)
                    : "—"}
                </Td>
              </tr>
            );
          })}
          {rows.length === 0 ? <EmptyRow colSpan={9} /> : null}
        </tbody>
      </DataTable>
    </>
  );
}
