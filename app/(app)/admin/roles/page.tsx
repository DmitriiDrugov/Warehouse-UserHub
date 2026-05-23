import { asc, eq } from "drizzle-orm";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, Td, Th } from "@/components/ui/table";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import {
  permissions,
  rolePermissions,
  roles,
  systems,
} from "@/lib/db/schema";

export const metadata = { title: "Roles & templates — UserHub" };

export default async function RolesAdminPage() {
  const operator = await requireOperator(["warehouse_admin"]);

  const data = await withOperator(operator.id, async (tx) => {
    const allRoles = await tx.select().from(roles).orderBy(asc(roles.code));
    const allTemplateRows = await tx
      .select({
        roleId: rolePermissions.roleId,
        permId: permissions.id,
        permCode: permissions.code,
        permName: permissions.name,
        sysCode: systems.code,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .innerJoin(systems, eq(systems.id, permissions.systemId))
      .orderBy(asc(systems.code), asc(permissions.code));
    const allSystems = await tx.select().from(systems).orderBy(asc(systems.code));
    const allPerms = await tx
      .select({
        id: permissions.id,
        code: permissions.code,
        name: permissions.name,
        sysCode: systems.code,
      })
      .from(permissions)
      .innerJoin(systems, eq(systems.id, permissions.systemId))
      .orderBy(asc(systems.code), asc(permissions.code));
    return { allRoles, allTemplateRows, allSystems, allPerms };
  });

  return (
    <>
      <PageHeader
        title="Roles & templates"
        subtitle="Catalog is read-only via UI. Edit via migrations + seed; permissions resolve against systems."
      />

      <h2 className="font-title text-title text-on-surface mb-3">Warehouse roles</h2>
      <DataTable className="mb-8">
        <thead className="bg-surface-container-low">
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Description</Th>
            <Th>Default permissions</Th>
          </tr>
        </thead>
        <tbody>
          {data.allRoles.map((r) => (
            <tr key={r.id} className="hover:bg-surface-container-low transition-colors">
              <Td><code className="font-data-mono text-data-mono">{r.code}</code></Td>
              <Td>{r.name}</Td>
              <Td className="text-on-surface-variant">{r.description ?? "—"}</Td>
              <Td>
                <ul className="flex flex-wrap gap-1.5">
                  {data.allTemplateRows
                    .filter((t) => t.roleId === r.id)
                    .map((t) => (
                      <li key={t.permId}>
                        <code className="font-data-mono text-label bg-surface-container-high text-on-surface-variant rounded px-1.5 py-0.5">
                          {t.sysCode}.{t.permCode}
                        </code>
                      </li>
                    ))}
                </ul>
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <h2 className="font-title text-title text-on-surface mb-3">Systems</h2>
          <Card padding="p-0">
            <ul className="divide-y divide-border-subtle">
              {data.allSystems.map((s) => (
                <li key={s.id} className="px-4 py-3 flex justify-between">
                  <code className="font-data-mono text-data-mono text-on-surface">{s.code}</code>
                  <span className="text-on-surface-variant">{s.name}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
        <section>
          <h2 className="font-title text-title text-on-surface mb-3">Permissions</h2>
          <Card padding="p-0">
            <ul className="divide-y divide-border-subtle">
              {data.allPerms.map((p) => (
                <li key={p.id} className="px-4 py-3 flex justify-between gap-3">
                  <code className="font-data-mono text-data-mono text-on-surface">
                    {p.sysCode}.{p.code}
                  </code>
                  <span className="text-on-surface-variant text-right">{p.name}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    </>
  );
}
