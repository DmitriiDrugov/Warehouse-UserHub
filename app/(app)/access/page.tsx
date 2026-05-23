import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SourceTag } from "@/components/ui/source-tag";
import { AccessStatusBadge } from "@/components/ui/status-badge";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import {
  permissions,
  roles as rolesTable,
  systems,
  userAccess,
  warehouseUsers,
  warehouses,
} from "@/lib/db/schema";
import { ACCESS_STATUSES } from "@/lib/validation/enums";

export const metadata = { title: "Access — UserHub" };

type SearchParams = { warehouse?: string; status?: string };

export default async function AccessOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const operator = await requireOperator();
  const params = await searchParams;

  const { rows, whs } = await withOperator(operator.id, async (tx) => {
    const whs = await tx.select().from(warehouses).orderBy(warehouses.code);
    const conds = [] as Array<ReturnType<typeof eq>>;
    if (params.warehouse) conds.push(eq(warehouseUsers.warehouseId, params.warehouse));
    if (
      params.status &&
      (ACCESS_STATUSES as readonly string[]).includes(params.status)
    ) {
      conds.push(
        eq(userAccess.status, params.status as (typeof ACCESS_STATUSES)[number]),
      );
    } else {
      conds.push(eq(userAccess.status, "active"));
    }

    const rows = await tx
      .select({
        accessId: userAccess.id,
        warehouseUserId: warehouseUsers.id,
        employeeId: warehouseUsers.employeeId,
        fullName: warehouseUsers.fullName,
        warehouseCode: warehouses.code,
        roleCode: rolesTable.code,
        systemCode: systems.code,
        permissionCode: permissions.code,
        permissionName: permissions.name,
        status: userAccess.status,
        source: userAccess.source,
        grantedAt: userAccess.grantedAt,
        expiresAt: userAccess.expiresAt,
        lastUsedAt: userAccess.lastUsedAt,
      })
      .from(userAccess)
      .innerJoin(warehouseUsers, eq(warehouseUsers.id, userAccess.warehouseUserId))
      .innerJoin(warehouses, eq(warehouses.id, warehouseUsers.warehouseId))
      .innerJoin(rolesTable, eq(rolesTable.id, warehouseUsers.roleId))
      .innerJoin(permissions, eq(permissions.id, userAccess.permissionId))
      .innerJoin(systems, eq(systems.id, permissions.systemId))
      .where(conds.length ? and(...conds) : sql`true`)
      .orderBy(desc(userAccess.grantedAt))
      .limit(500);
    return { rows, whs };
  });

  return (
    <>
      <PageHeader
        title="Access management"
        subtitle="Every permission granted to a warehouse worker, across every system."
      />

      <Card className="mb-4" padding="p-4">
        <form method="get" className="flex flex-wrap gap-3 items-end">
          <Field label="Warehouse" className="min-w-[16rem]">
            <Select name="warehouse" defaultValue={params.warehouse ?? ""}>
              <option value="">— Any —</option>
              {whs.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" className="min-w-[10rem]">
            <Select name="status" defaultValue={params.status ?? "active"}>
              {ACCESS_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </Card>

      <p className="font-label text-label text-on-surface-variant mb-2">
        Showing {rows.length.toLocaleString()} grant(s)
      </p>

      <DataTable>
        <thead className="bg-surface-container-low">
          <tr>
            <Th>Worker</Th>
            <Th>Warehouse</Th>
            <Th>Role</Th>
            <Th>Permission</Th>
            <Th>Status</Th>
            <Th>Source</Th>
            <Th>Granted</Th>
            <Th>Expires</Th>
            <Th>Last used</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.accessId} className="hover:bg-surface-container-low transition-colors">
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
              <Td className="font-data-mono text-label">{r.roleCode}</Td>
              <Td>
                <div className="text-on-surface">{r.permissionName}</div>
                <code className="font-data-mono text-label text-on-surface-variant">
                  {r.systemCode}.{r.permissionCode}
                </code>
              </Td>
              <Td><AccessStatusBadge value={r.status} /></Td>
              <Td><SourceTag value={r.source} /></Td>
              <Td mono>{fmt(r.grantedAt)}</Td>
              <Td mono>{fmt(r.expiresAt)}</Td>
              <Td mono>{fmt(r.lastUsedAt)}</Td>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={9} /> : null}
        </tbody>
      </DataTable>
    </>
  );
}

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}
