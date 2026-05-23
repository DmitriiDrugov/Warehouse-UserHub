import Link from "next/link";
import { and, eq, ilike, sql } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { WarehouseUserStatusBadge } from "@/components/ui/status-badge";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import {
  roles as rolesTable,
  warehouseUsers,
  warehouses,
} from "@/lib/db/schema";
import { WAREHOUSE_USER_STATUSES } from "@/lib/validation/enums";

export const metadata = { title: "Workforce — UserHub" };

type SearchParams = {
  q?: string;
  warehouse?: string;
  role?: string;
  status?: string;
};

export default async function WarehouseUsersListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const operator = await requireOperator();
  const params = await searchParams;
  const canMutate = operator.operatorRole !== "viewer";

  const { rows, allWarehouses, allRoles } = await withOperator(
    operator.id,
    async (tx) => {
      const allWarehouses = await tx.select().from(warehouses).orderBy(warehouses.code);
      const allRoles = await tx.select().from(rolesTable).orderBy(rolesTable.code);

      const conds = [] as Array<ReturnType<typeof eq>>;
      if (params.warehouse) conds.push(eq(warehouseUsers.warehouseId, params.warehouse));
      if (params.role) conds.push(eq(warehouseUsers.roleId, params.role));
      if (
        params.status &&
        (WAREHOUSE_USER_STATUSES as readonly string[]).includes(params.status)
      ) {
        conds.push(
          eq(
            warehouseUsers.status,
            params.status as (typeof WAREHOUSE_USER_STATUSES)[number],
          ),
        );
      }
      if (params.q) {
        conds.push(ilike(warehouseUsers.fullName, `%${params.q}%`));
      }

      const rows = await tx
        .select({
          id: warehouseUsers.id,
          employeeId: warehouseUsers.employeeId,
          fullName: warehouseUsers.fullName,
          status: warehouseUsers.status,
          hireDate: warehouseUsers.hireDate,
          warehouseCode: warehouses.code,
          roleCode: rolesTable.code,
          roleName: rolesTable.name,
        })
        .from(warehouseUsers)
        .innerJoin(warehouses, eq(warehouses.id, warehouseUsers.warehouseId))
        .innerJoin(rolesTable, eq(rolesTable.id, warehouseUsers.roleId))
        .where(conds.length ? and(...conds) : sql`true`)
        .orderBy(warehouseUsers.employeeId)
        .limit(500);

      return { rows, allWarehouses, allRoles };
    },
  );

  return (
    <>
      <PageHeader
        title="Workforce Management"
        subtitle="Manage, audit, and provision warehouse personnel."
        actions={
          canMutate ? (
            <Link href="/warehouse-users/new">
              <Button icon={<Icon name="person_add" size={16} />}>Add worker</Button>
            </Link>
          ) : null
        }
      />

      <div className="bg-surface-container-lowest border border-border-subtle rounded-t-lg p-4">
        <form method="get" className="flex flex-col md:flex-row gap-3 items-end justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Search">
              <TextInput
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Name…"
                className="w-44"
              />
            </Field>
            <Field label="Warehouse">
              <Select name="warehouse" defaultValue={params.warehouse ?? ""} className="w-40">
                <option value="">All Warehouses</option>
                {allWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue={params.role ?? ""} className="w-36">
                <option value="">All Roles</option>
                {allRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select name="status" defaultValue={params.status ?? ""} className="w-36">
                <option value="">All Statuses</option>
                {WAREHOUSE_USER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" icon={<Icon name="search" size={16} />}>
              Search
            </Button>
          </div>
          <p className="font-label text-label text-on-surface-variant whitespace-nowrap">
            Showing {rows.length.toLocaleString()} worker(s)
          </p>
        </form>
      </div>

      <DataTable className="rounded-t-none border-t-0">
        <thead className="bg-surface-container-low">
          <tr>
            <Th>Worker</Th>
            <Th>Employee ID</Th>
            <Th>Warehouse</Th>
            <Th>Role</Th>
            <Th>Status</Th>
            <Th>Hired</Th>
            <Th align="right"></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr
              key={u.id}
              className="hover:bg-surface-container-low transition-colors"
            >
              <Td>
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={u.fullName} />
                  <Link
                    href={`/warehouse-users/${u.id}`}
                    className="font-medium text-on-surface hover:text-primary truncate"
                  >
                    {u.fullName}
                  </Link>
                </div>
              </Td>
              <Td mono>{u.employeeId}</Td>
              <Td>{u.warehouseCode}</Td>
              <Td>
                <div>
                  <div className="text-on-surface">{u.roleName}</div>
                  <code className="font-data-mono text-label text-on-surface-variant">
                    {u.roleCode}
                  </code>
                </div>
              </Td>
              <Td>
                <WarehouseUserStatusBadge value={u.status} />
              </Td>
              <Td mono>
                {u.hireDate ? new Date(u.hireDate).toISOString().slice(0, 10) : "—"}
              </Td>
              <Td align="right">
                <Link
                  href={`/warehouse-users/${u.id}`}
                  className="text-primary font-label text-label hover:underline"
                >
                  Open
                </Link>
              </Td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <EmptyRow colSpan={7}>No workers match these filters.</EmptyRow>
          ) : null}
        </tbody>
      </DataTable>
    </>
  );
}

function Avatar({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <div className="w-8 h-8 rounded-full bg-primary-fixed-dim text-on-primary-fixed font-medium text-label flex items-center justify-center shrink-0">
      {initials}
    </div>
  );
}
