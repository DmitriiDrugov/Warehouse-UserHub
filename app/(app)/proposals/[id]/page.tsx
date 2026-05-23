import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import {
  ProposalStatusBadge,
  StatusBadge,
} from "@/components/ui/status-badge";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";
import { canApproveProposals, requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { aiProposals, appUsers, auditLog } from "@/lib/db/schema";

import { ReviewForms } from "./review-forms";

type PageProps = { params: Promise<{ id: string }> };

export default async function ProposalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const operator = await requireOperator();

  const data = await withOperator(operator.id, async (tx) => {
    const [p] = await tx
      .select()
      .from(aiProposals)
      .where(eq(aiProposals.id, id))
      .limit(1);
    if (!p) return null;

    const reviewer = p.reviewedBy
      ? await tx
          .select({ id: appUsers.id, name: appUsers.fullName })
          .from(appUsers)
          .where(eq(appUsers.id, p.reviewedBy))
          .limit(1)
      : [];

    const audit = await tx
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorName: appUsers.fullName,
        aiAssisted: auditLog.aiAssisted,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        reason: auditLog.reason,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(appUsers, eq(appUsers.id, auditLog.actorId))
      .where(eq(auditLog.proposalId, id));

    return { proposal: p, reviewer: reviewer[0] ?? null, audit };
  });

  if (!data) notFound();
  const { proposal, reviewer, audit } = data;
  const canApprove = canApproveProposals(operator) && proposal.status === "pending";

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            {humanProposalType(proposal.type)}
            <ProposalStatusBadge value={proposal.status} />
          </span>
        }
        subtitle={
          <span className="font-data-mono">
            AI-{proposal.id.slice(0, 8).toUpperCase()} · {proposal.targetEntityType}
            {proposal.targetEntityId ? ` / ${proposal.targetEntityId.slice(0, 8)}…` : ""}
          </span>
        }
        actions={
          <Link
            href="/proposals"
            className="font-label text-label text-on-surface-variant hover:text-primary inline-flex items-center gap-1"
          >
            <Icon name="arrow_back" size={16} /> Back to inbox
          </Link>
        }
      />

      <Card tone={proposal.status === "pending" ? "violet" : "default"} className="mb-6">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <StatusBadge tone="violet">Proposed — awaiting approval</StatusBadge>
          <span className="font-label text-label text-on-surface-variant">
            Generated {new Date(proposal.createdAt).toISOString().replace("T", " ").slice(0, 19)}
          </span>
        </div>

        <h3 className="font-title text-title text-on-surface mb-1">Reasoning</h3>
        <p className="font-body-sm text-body-sm text-on-surface mb-5">
          {proposal.explanation}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-2">
          <DiffPanel
            label="Current (committed)"
            tone="danger"
            content={prettyJson(diffBefore(proposal))}
          />
          <DiffPanel
            label="Proposed change"
            tone="success"
            content={prettyJson(proposal.payload)}
          />
        </div>

        {proposal.generatedQuery ? (
          <div className="mt-4">
            <h4 className="font-label text-label text-on-surface-variant mb-2">
              Generated SQL
            </h4>
            <pre className="font-data-mono text-data-mono bg-surface-container-lowest border border-border-subtle rounded p-3 overflow-auto">
              {proposal.generatedQuery}
            </pre>
          </div>
        ) : null}

        {proposal.reviewNote ? (
          <div className="mt-4 border-t border-border-subtle pt-4">
            <h4 className="font-label text-label text-on-surface-variant mb-1">
              Reviewer note
            </h4>
            <p className="font-body-sm text-body-sm">{proposal.reviewNote}</p>
            {reviewer ? (
              <p className="font-label text-label text-on-surface-variant mt-1">
                — {reviewer.name},{" "}
                {proposal.reviewedAt
                  ? new Date(proposal.reviewedAt).toISOString().replace("T", " ").slice(0, 19)
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        {canApprove ? (
          <div className="mt-5 pt-5 border-t border-border-subtle">
            <ReviewForms proposalId={proposal.id} />
          </div>
        ) : proposal.status === "pending" ? (
          <p className="mt-5 pt-5 border-t border-border-subtle font-label text-label text-on-surface-variant">
            Only <code className="font-data-mono">warehouse_admin</code> can approve or reject.
          </p>
        ) : null}
      </Card>

      <section>
        <h2 className="font-title text-title text-on-surface mb-3">
          Linked audit entries · {audit.length}
        </h2>
        <DataTable>
          <thead className="bg-surface-container-low">
            <tr>
              <Th>When</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Actor</Th>
              <Th>AI</Th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id} className="hover:bg-surface-container-low transition-colors">
                <Td mono>{new Date(a.createdAt).toISOString().replace("T", " ").slice(0, 19)}</Td>
                <Td><code className="font-data-mono text-data-mono">{a.action}</code></Td>
                <Td>
                  <code className="font-data-mono text-label">
                    {a.entityType} / {a.entityId.slice(0, 8)}…
                  </code>
                </Td>
                <Td>{a.actorName ?? "—"}</Td>
                <Td>
                  {a.aiAssisted ? (
                    <span className="inline-flex items-center gap-1 text-proposal-violet">
                      <Icon name="auto_awesome" size={14} /> yes
                    </span>
                  ) : (
                    <span className="text-on-surface-variant">no</span>
                  )}
                </Td>
              </tr>
            ))}
            {audit.length === 0 ? <EmptyRow colSpan={5}>None yet.</EmptyRow> : null}
          </tbody>
        </DataTable>
      </section>
    </>
  );
}

function DiffPanel({
  label,
  tone,
  content,
}: {
  label: string;
  tone: "danger" | "success";
  content: string;
}) {
  const wrap =
    tone === "danger"
      ? "bg-error-container/30 border-status-danger/40"
      : "bg-status-success/10 border-status-success/40";
  return (
    <div className={`border rounded ${wrap} p-3`}>
      <div className="font-label text-label uppercase tracking-wide text-on-surface-variant mb-2">
        {label}
      </div>
      <pre className="font-data-mono text-data-mono whitespace-pre-wrap break-words text-on-surface">
        {content}
      </pre>
    </div>
  );
}

function diffBefore(proposal: { type: string; payload: unknown }): unknown {
  if (proposal.type === "provision") {
    return { state: "no warehouse_user record" };
  }
  if (proposal.type === "revoke_access") {
    const p = proposal.payload as { accessIds: string[] };
    return { accessIds: p.accessIds, status: "active" };
  }
  return { note: "see current entity state for diff" };
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function humanProposalType(t: string): string {
  switch (t) {
    case "provision": return "Provision new worker";
    case "revoke_access": return "Revoke access";
    case "anomaly_flag": return "Anomaly flagged";
    case "offboard_completeness": return "Offboarding completeness review";
    default: return t;
  }
}
