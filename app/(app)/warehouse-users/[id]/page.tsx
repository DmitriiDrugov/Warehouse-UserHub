import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, or } from "drizzle-orm";

import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { WarehouseUserStatusBadge } from "@/components/ui/status-badge";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import {
  appUsers,
  auditLog,
  certificates as certificatesTable,
  checklistItems,
  permissions,
  roles as rolesTable,
  systems,
  userAccess,
  userCertificates,
  userChecklistItems,
  userChecklists,
  warehouseUsers,
  warehouses,
} from "@/lib/db/schema";

import { AccessSection } from "./access-section";
import { CertificateSection } from "./certificate-section";
import { ChecklistSection } from "./checklist-section";
import { HistorySection } from "./history-section";
import { OffboardForm, StatusForm } from "./status-forms";

type PageProps = { params: Promise<{ id: string }> };

export default async function WarehouseUserDetailPage({ params }: PageProps) {
  const { id } = await params;
  const operator = await requireOperator();

  const data = await withOperator(operator.id, async (tx) => {
    const [user] = await tx
      .select({
        id: warehouseUsers.id,
        employeeId: warehouseUsers.employeeId,
        fullName: warehouseUsers.fullName,
        email: warehouseUsers.email,
        status: warehouseUsers.status,
        hireDate: warehouseUsers.hireDate,
        terminationDate: warehouseUsers.terminationDate,
        warehouseId: warehouseUsers.warehouseId,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        roleId: warehouseUsers.roleId,
        roleCode: rolesTable.code,
        roleName: rolesTable.name,
      })
      .from(warehouseUsers)
      .innerJoin(warehouses, eq(warehouses.id, warehouseUsers.warehouseId))
      .innerJoin(rolesTable, eq(rolesTable.id, warehouseUsers.roleId))
      .where(eq(warehouseUsers.id, id))
      .limit(1);
    if (!user) return null;

    const access = await tx
      .select({
        id: userAccess.id,
        permissionId: userAccess.permissionId,
        permissionCode: permissions.code,
        permissionName: permissions.name,
        systemCode: systems.code,
        status: userAccess.status,
        source: userAccess.source,
        grantedAt: userAccess.grantedAt,
        expiresAt: userAccess.expiresAt,
        lastUsedAt: userAccess.lastUsedAt,
        revokedAt: userAccess.revokedAt,
        grantedByName: appUsers.fullName,
      })
      .from(userAccess)
      .innerJoin(permissions, eq(permissions.id, userAccess.permissionId))
      .innerJoin(systems, eq(systems.id, permissions.systemId))
      .leftJoin(appUsers, eq(appUsers.id, userAccess.grantedBy))
      .where(eq(userAccess.warehouseUserId, id))
      .orderBy(desc(userAccess.grantedAt));

    const certs = await tx
      .select({
        id: userCertificates.id,
        certificateId: userCertificates.certificateId,
        certificateCode: certificatesTable.code,
        certificateName: certificatesTable.name,
        status: userCertificates.status,
        issuedAt: userCertificates.issuedAt,
        expiresAt: userCertificates.expiresAt,
        documentPath: userCertificates.documentPath,
      })
      .from(userCertificates)
      .innerJoin(
        certificatesTable,
        eq(certificatesTable.id, userCertificates.certificateId),
      )
      .where(eq(userCertificates.warehouseUserId, id))
      .orderBy(desc(userCertificates.issuedAt));

    const lists = await tx
      .select({
        id: userChecklists.id,
        type: userChecklists.type,
        status: userChecklists.status,
        startedAt: userChecklists.startedAt,
        completedAt: userChecklists.completedAt,
      })
      .from(userChecklists)
      .where(eq(userChecklists.warehouseUserId, id))
      .orderBy(desc(userChecklists.startedAt));

    const listIds = lists.map((l) => l.id);
    const listItems = listIds.length
      ? await tx
          .select({
            id: userChecklistItems.id,
            userChecklistId: userChecklistItems.userChecklistId,
            label: checklistItems.label,
            order: checklistItems.order,
            isRequired: checklistItems.isRequired,
            isDone: userChecklistItems.isDone,
            doneAt: userChecklistItems.doneAt,
          })
          .from(userChecklistItems)
          .innerJoin(
            checklistItems,
            eq(checklistItems.id, userChecklistItems.checklistItemId),
          )
          .where(
            or(
              ...listIds.map((lid) => eq(userChecklistItems.userChecklistId, lid)),
            ),
          )
          .orderBy(checklistItems.order)
      : [];

    const childIds = [
      ...access.map((a) => a.id),
      ...certs.map((c) => c.id),
      ...lists.map((l) => l.id),
      ...listItems.map((i) => i.id),
    ];
    const history = await tx
      .select({
        id: auditLog.id,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        aiAssisted: auditLog.aiAssisted,
        proposalId: auditLog.proposalId,
        reason: auditLog.reason,
        createdAt: auditLog.createdAt,
        actorName: appUsers.fullName,
      })
      .from(auditLog)
      .leftJoin(appUsers, eq(appUsers.id, auditLog.actorId))
      .where(
        childIds.length === 0
          ? eq(auditLog.entityId, id)
          : or(
              eq(auditLog.entityId, id),
              ...childIds.map((cid) => eq(auditLog.entityId, cid)),
            ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(100);

    const permList = await tx
      .select({
        id: permissions.id,
        code: permissions.code,
        systemCode: systems.code,
        name: permissions.name,
      })
      .from(permissions)
      .innerJoin(systems, eq(systems.id, permissions.systemId))
      .orderBy(systems.code, permissions.code);

    const certCatalog = await tx
      .select()
      .from(certificatesTable)
      .orderBy(certificatesTable.code);

    return {
      user,
      access,
      certs,
      lists,
      listItems,
      history,
      permList,
      certCatalog,
    };
  });

  if (!data) notFound();

  const { user, access, certs, lists, listItems, history, permList, certCatalog } = data;
  const canMutate =
    operator.operatorRole === "hr" || operator.operatorRole === "warehouse_admin";

  const initials =
    user.fullName
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <>
      <div className="mb-4">
        <Link
          href="/warehouse-users"
          className="font-label text-label text-on-surface-variant hover:text-primary inline-flex items-center gap-1"
        >
          <Icon name="arrow_back" size={16} /> Workforce
        </Link>
      </div>

      {/* Profile hero card */}
      <Card className="mb-6 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-primary-fixed-dim text-on-primary-fixed text-display font-display flex items-center justify-center shrink-0 border-2 border-surface-container-highest">
              {initials}
            </div>
            <div>
              <h1 className="font-display text-display text-on-surface mb-1">{user.fullName}</h1>
              <div className="flex items-center gap-3 text-on-surface-variant font-body-sm text-body-sm flex-wrap">
                <span className="font-data-mono text-data-mono">ID: {user.employeeId}</span>
                <span>·</span>
                <span>{user.roleName}</span>
                <span>·</span>
                <span>{user.warehouseCode} · {user.warehouseName}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <WarehouseUserStatusBadge value={user.status} />
            {canMutate ? (
              <Link
                href={`/warehouse-users/${user.id}/edit`}
                className="font-label text-label text-on-surface-variant hover:text-primary inline-flex items-center gap-1"
              >
                <Icon name="edit" size={14} /> Edit
              </Link>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Tabs nav */}
      <div className="border-b border-border-subtle mb-6">
        <nav className="flex gap-8">
          {(["Profile", "Access", "Certificates", "Checklist", "History"] as const).map(
            (tab) => (
              <a
                key={tab}
                href={`#${tab.toLowerCase()}`}
                className="font-label text-label text-on-surface-variant hover:text-on-surface pb-3 px-1 transition-colors border-b-2 border-transparent hover:border-on-surface-variant"
              >
                {tab}
              </a>
            ),
          )}
        </nav>
      </div>

      {/* Core info card */}
      <Card id="profile" className="mb-6">
        <h2 className="font-title text-title text-on-surface mb-4 pb-2 border-b border-border-subtle">Core Information</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-8 mb-0">
          <Stat label="Email" value={user.email ?? "—"} />
          <Stat label="Warehouse" value={`${user.warehouseCode} · ${user.warehouseName}`} />
          <Stat label="Role" value={user.roleName} />
          <Stat
            label="Hire Date"
            value={user.hireDate ? new Date(user.hireDate).toISOString().slice(0, 10) : "—"}
            mono
          />
          {user.terminationDate ? (
            <Stat
              label="Terminated"
              value={new Date(user.terminationDate).toISOString().slice(0, 10)}
              mono
            />
          ) : null}
        </div>

        {canMutate ? (
          <div className="mt-5 pt-5 border-t border-border-subtle flex flex-wrap gap-4">
            <StatusForm userId={user.id} currentStatus={user.status} />
            {user.status !== "offboarded" ? (
              <OffboardForm userId={user.id} />
            ) : null}
          </div>
        ) : null}
      </Card>

      <div id="access">
        <AccessSection
          warehouseUserId={user.id}
          canMutate={canMutate}
          access={access}
          permissions={permList}
        />
      </div>

      <div id="certificates">
        <CertificateSection
          warehouseUserId={user.id}
          canMutate={canMutate}
          certs={certs}
          catalog={certCatalog}
        />
      </div>

      <div id="checklist">
        <ChecklistSection
          warehouseUserId={user.id}
          canMutate={canMutate}
          lists={lists}
          items={listItems}
        />
      </div>

      <div id="history">
        <HistorySection history={history} />
      </div>
    </>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="font-label text-label text-on-surface-variant">{label}</div>
      <div className={mono ? "font-data-mono text-data-mono text-on-surface" : "text-on-surface"}>
        {value}
      </div>
    </div>
  );
}
