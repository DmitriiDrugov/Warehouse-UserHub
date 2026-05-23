import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { roles as rolesTable, warehouseUsers, warehouses } from "@/lib/db/schema";

import { EditForm } from "./edit-form";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditWarehouseUserPage({ params }: PageProps) {
  const { id } = await params;
  const operator = await requireOperator(["hr", "warehouse_admin"]);
  if (operator.operatorRole === "viewer") redirect(`/warehouse-users/${id}`);

  const data = await withOperator(operator.id, async (tx) => {
    const [user] = await tx
      .select()
      .from(warehouseUsers)
      .where(eq(warehouseUsers.id, id))
      .limit(1);
    if (!user) return null;
    const whs = await tx.select().from(warehouses).orderBy(warehouses.code);
    const rs = await tx.select().from(rolesTable).orderBy(rolesTable.code);
    return { user, warehouses: whs, roles: rs };
  });
  if (!data) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${data.user.fullName}`}
        subtitle={`Employee ${data.user.employeeId}`}
        actions={
          <Link
            href={`/warehouse-users/${id}`}
            className="font-label text-label text-on-surface-variant hover:text-primary inline-flex items-center gap-1"
          >
            <Icon name="arrow_back" size={16} /> Back to profile
          </Link>
        }
      />
      <Card className="max-w-3xl">
        <EditForm user={data.user} warehouses={data.warehouses} roles={data.roles} />
      </Card>
    </>
  );
}
