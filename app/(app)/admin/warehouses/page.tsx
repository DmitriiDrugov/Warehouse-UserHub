import { asc, sql } from "drizzle-orm";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, Td, Th } from "@/components/ui/table";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { warehouseUsers, warehouses } from "@/lib/db/schema";

import { CreateWarehouseForm } from "./forms";

export const metadata = { title: "Warehouses — UserHub" };

export default async function WarehousesAdminPage() {
  const operator = await requireOperator(["warehouse_admin"]);

  const rows = await withOperator(operator.id, async (tx) =>
    tx
      .select({
        id: warehouses.id,
        code: warehouses.code,
        name: warehouses.name,
        location: warehouses.location,
        userCount: sql<number>`(SELECT COUNT(*)::int FROM ${warehouseUsers} WHERE ${warehouseUsers.warehouseId} = ${warehouses.id})`,
      })
      .from(warehouses)
      .orderBy(asc(warehouses.code)),
  );

  return (
    <>
      <PageHeader title="Warehouses" subtitle="Tenant warehouses." />
      <Card className="mb-6">
        <h3 className="font-title text-title text-on-surface mb-3">
          Create warehouse
        </h3>
        <CreateWarehouseForm />
      </Card>
      <DataTable>
        <thead className="bg-surface-container-low">
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Location</Th>
            <Th align="right">Workers</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} className="hover:bg-surface-container-low transition-colors">
              <Td><code className="font-data-mono text-data-mono">{w.code}</code></Td>
              <Td>{w.name}</Td>
              <Td className="text-on-surface-variant">{w.location ?? "—"}</Td>
              <Td mono align="right">{w.userCount}</Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </>
  );
}
