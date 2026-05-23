import { asc } from "drizzle-orm";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, Td, Th } from "@/components/ui/table";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { appUserWarehouses, appUsers, warehouses } from "@/lib/db/schema";

import { CreateOperatorForm, OperatorRow } from "./operator-forms";

export const metadata = { title: "Operators — UserHub" };

export default async function OperatorsPage() {
  const operator = await requireOperator(["warehouse_admin"]);

  const { ops, whs } = await withOperator(operator.id, async (tx) => {
    const ops = await tx.select().from(appUsers).orderBy(asc(appUsers.email));
    const whs = await tx.select().from(warehouses).orderBy(asc(warehouses.code));
    const assignments = await tx.select().from(appUserWarehouses);

    const byUser = new Map<string, string[]>();
    for (const a of assignments) {
      const list = byUser.get(a.appUserId) ?? [];
      list.push(a.warehouseId);
      byUser.set(a.appUserId, list);
    }
    return {
      ops: ops.map((o) => ({ ...o, warehouseIds: byUser.get(o.id) ?? [] })),
      whs,
    };
  });

  return (
    <>
      <PageHeader
        title="Operators"
        subtitle="People who can sign in. The Supabase auth account must exist separately for password login."
      />

      <Card className="mb-6">
        <h3 className="font-title text-title text-on-surface mb-3">Create operator</h3>
        <CreateOperatorForm warehouses={whs} />
        <p className="mt-3 font-label text-label text-on-surface-variant">
          The operator must also exist in Supabase Auth (or have an{" "}
          <code className="font-data-mono">auth_user_id</code> attached later) to actually sign in.
        </p>
      </Card>

      <DataTable>
        <thead className="bg-surface-container-low">
          <tr>
            <Th>Email</Th>
            <Th>Name &amp; role</Th>
            <Th>Active</Th>
            <Th>Warehouses</Th>
          </tr>
        </thead>
        <tbody>
          {ops.map((op) => (
            <OperatorRow key={op.id} op={op} warehouses={whs} />
          ))}
        </tbody>
      </DataTable>
    </>
  );
}

void Td;
void Th;
