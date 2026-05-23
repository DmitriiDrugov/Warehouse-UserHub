import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/operator";

export const metadata = { title: "Admin — UserHub" };

const TILES = [
  {
    href: "/admin/operators",
    icon: "supervisor_account",
    title: "Operators",
    body: "Manage who can log in (app_users), their roles and warehouse assignments.",
  },
  {
    href: "/admin/warehouses",
    icon: "warehouse",
    title: "Warehouses",
    body: "Add, rename, locate warehouses. Reflected in every RLS-scoped query.",
  },
  {
    href: "/admin/roles",
    icon: "badge",
    title: "Roles & templates",
    body: "Warehouse-role catalog plus the permission templates attached to each role.",
  },
  {
    href: "/admin/rules",
    icon: "rule",
    title: "Rule configuration",
    body: "Certificate requirements + segregation-of-duties pairs evaluated by the rules engine.",
  },
];

export default async function AdminPage() {
  await requireOperator(["warehouse_admin"]);
  return (
    <>
      <PageHeader
        title="Admin"
        subtitle="Tenant-wide configuration. Restricted to warehouse_admin."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group block"
          >
            <Card className="h-full hover:border-primary hover:shadow-sm transition-all">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon name={t.icon} size={20} />
                </div>
                <div>
                  <h3 className="font-title text-title text-on-surface group-hover:text-primary">
                    {t.title}
                  </h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                    {t.body}
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
