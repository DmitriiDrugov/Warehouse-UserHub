import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { roles as rolesTable, warehouses } from "@/lib/db/schema";

import { CreateUserForm } from "./create-user-form";
import { NlProvisionForm } from "./nl-provision-form";

export const metadata = { title: "New worker — UserHub" };

export default async function NewWarehouseUserPage() {
  const operator = await requireOperator();
  if (operator.operatorRole === "viewer") {
    redirect("/warehouse-users");
  }

  const { whs, roles } = await withOperator(operator.id, async (tx) => {
    const whs = await tx.select().from(warehouses).orderBy(warehouses.code);
    const roles = await tx.select().from(rolesTable).orderBy(rolesTable.code);
    return { whs, roles };
  });

  return (
    <>
      <PageHeader
        title="Add new worker"
        subtitle="Create a new profile and assign initial access templates."
        actions={
          <Link
            href="/warehouse-users"
            className="font-label text-label text-on-surface-variant hover:text-primary inline-flex items-center gap-1"
          >
            <Icon name="close" size={16} /> Cancel
          </Link>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Manual creation"
            subtitle="Deterministic provisioning. Writes warehouse_user + role-template access + onboarding checklist in one transaction (audited)."
          />
          <CreateUserForm warehouses={whs} roles={roles} />
        </Card>

        <Card tone="violet" className="self-start">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-title text-title text-on-surface inline-flex items-center gap-2">
              <Icon name="auto_awesome" size={18} className="text-proposal-violet" />
              Natural-language provisioning
            </h3>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mb-3">
            Describe the new worker in plain English. The AI parses your request,
            resolves role / warehouse / permissions, and queues an{" "}
            <code className="font-data-mono">ai_proposals</code> row. Approval
            by a <code className="font-data-mono">warehouse_admin</code>{" "}
            executes the deterministic creation.
          </p>
          <NlProvisionForm />
        </Card>
      </div>
    </>
  );
}
