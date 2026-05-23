import Link from "next/link";
import { and, desc, eq, or } from "drizzle-orm";

import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { aiProposals, warehouseUsers } from "@/lib/db/schema";

export const metadata = { title: "Anomalies — UserHub" };

export default async function AnomaliesPage() {
  const operator = await requireOperator();

  const rows = await withOperator(operator.id, async (tx) => {
    return await tx
      .select({
        id: aiProposals.id,
        type: aiProposals.type,
        status: aiProposals.status,
        explanation: aiProposals.explanation,
        createdAt: aiProposals.createdAt,
        targetEntityId: aiProposals.targetEntityId,
        employeeId: warehouseUsers.employeeId,
        fullName: warehouseUsers.fullName,
      })
      .from(aiProposals)
      .leftJoin(warehouseUsers, eq(warehouseUsers.id, aiProposals.targetEntityId))
      .where(
        and(
          or(
            eq(aiProposals.type, "anomaly_flag"),
            eq(aiProposals.type, "revoke_access"),
          ),
          eq(aiProposals.status, "pending"),
        ),
      )
      .orderBy(desc(aiProposals.createdAt))
      .limit(500);
  });

  return (
    <>
      <PageHeader
        title="Detected anomalies"
        subtitle="Surfaced by the rules engine + AI explainer. Approval triggers deterministic remediation."
      />

      {rows.length === 0 ? (
        <Card padding="p-10" className="text-center">
          <Icon name="check_circle" size={32} className="text-status-success mx-auto" />
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-2">
            No pending anomalies. Trigger the evaluator (
            <code className="font-data-mono">POST /api/cron/evaluate</code>) to re-run.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} tone="violet" padding="p-5">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <StatusBadge tone={r.type === "revoke_access" ? "danger" : "violet"}>
                  {r.type}
                </StatusBadge>
                {r.targetEntityId && r.employeeId ? (
                  <Link
                    href={`/warehouse-users/${r.targetEntityId}`}
                    className="font-label text-label text-primary hover:underline"
                  >
                    <code className="font-data-mono">{r.employeeId}</code> · {r.fullName}
                  </Link>
                ) : null}
                <span className="ml-auto font-label text-label text-on-surface-variant">
                  {new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface mb-3 line-clamp-3">
                {r.explanation}
              </p>
              <Link
                href={`/proposals/${r.id}`}
                className="font-label text-label text-primary hover:underline inline-flex items-center gap-1"
              >
                Review proposal <Icon name="arrow_forward" size={14} />
              </Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
