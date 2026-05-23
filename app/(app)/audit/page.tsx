import Link from "next/link";
import { and, desc, eq, ilike, sql } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { appUsers, auditLog } from "@/lib/db/schema";

export const metadata = { title: "Audit log — UserHub" };

type SearchParams = { entity?: string; action?: string; aiOnly?: string };

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const operator = await requireOperator();
  const params = await searchParams;

  const rows = await withOperator(operator.id, async (tx) => {
    const conds = [] as Array<ReturnType<typeof eq>>;
    if (params.entity) conds.push(eq(auditLog.entityType, params.entity));
    if (params.action) conds.push(ilike(auditLog.action, `%${params.action}%`));
    if (params.aiOnly === "1") conds.push(eq(auditLog.aiAssisted, true));

    return await tx
      .select({
        id: auditLog.id,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        aiAssisted: auditLog.aiAssisted,
        proposalId: auditLog.proposalId,
        reason: auditLog.reason,
        before: auditLog.before,
        after: auditLog.after,
        createdAt: auditLog.createdAt,
        actorName: appUsers.fullName,
      })
      .from(auditLog)
      .leftJoin(appUsers, eq(appUsers.id, auditLog.actorId))
      .where(conds.length ? and(...conds) : sql`true`)
      .orderBy(desc(auditLog.createdAt))
      .limit(300);
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only. Last 300 entries (newest first)."
      />

      <Card className="mb-4" padding="p-4">
        <form method="get" className="flex flex-wrap gap-3 items-end">
          <Field label="Entity type" className="min-w-[12rem]">
            <TextInput
              name="entity"
              defaultValue={params.entity ?? ""}
              placeholder="e.g. warehouse_user"
            />
          </Field>
          <Field label="Action contains" className="min-w-[14rem]">
            <TextInput
              name="action"
              defaultValue={params.action ?? ""}
              placeholder="e.g. access.revoked"
            />
          </Field>
          <label className="inline-flex items-center gap-2 font-label text-label text-on-surface-variant">
            <input
              type="checkbox"
              name="aiOnly"
              value="1"
              defaultChecked={params.aiOnly === "1"}
              className="rounded"
            />
            AI-assisted only
          </label>
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
      </Card>

      <DataTable>
        <thead className="bg-surface-container-low">
          <tr>
            <Th>When</Th>
            <Th>Actor</Th>
            <Th>AI</Th>
            <Th>Action</Th>
            <Th>Entity</Th>
            <Th>Reason</Th>
            <Th>Diff</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-container-low transition-colors">
              <Td mono>{new Date(r.createdAt).toISOString().slice(0, 19).replace("T", " ")}</Td>
              <Td>{r.actorName ?? "—"}</Td>
              <Td>
                {r.aiAssisted ? (
                  r.proposalId ? (
                    <Link
                      href={`/proposals/${r.proposalId}`}
                      className="inline-flex items-center gap-1 text-proposal-violet hover:underline"
                    >
                      <Icon name="auto_awesome" size={14} /> yes
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-proposal-violet">
                      <Icon name="auto_awesome" size={14} /> yes
                    </span>
                  )
                ) : (
                  <span className="text-on-surface-variant">no</span>
                )}
              </Td>
              <Td><code className="font-data-mono text-data-mono">{r.action}</code></Td>
              <Td>
                <code className="font-data-mono text-label">
                  {r.entityType} / {r.entityId.slice(0, 8)}…
                </code>
              </Td>
              <Td className="text-on-surface-variant">{r.reason ?? "—"}</Td>
              <Td>
                <details>
                  <summary className="cursor-pointer text-primary font-label text-label hover:underline">
                    before / after
                  </summary>
                  <pre className="font-data-mono text-data-mono mt-1 max-w-[28rem] whitespace-pre-wrap break-words">
                    {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                  </pre>
                </details>
              </Td>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={7} /> : null}
        </tbody>
      </DataTable>
    </>
  );
}
