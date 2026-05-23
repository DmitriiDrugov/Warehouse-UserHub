import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";

import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProposalStatusBadge, StatusBadge } from "@/components/ui/status-badge";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import { aiProposals, appUsers, warehouseUsers } from "@/lib/db/schema";
import { PROPOSAL_STATUSES, PROPOSAL_TYPES } from "@/lib/validation/enums";
import { cn } from "@/lib/cn";

export const metadata = { title: "Proposals — UserHub" };

type SearchParams = { status?: string; type?: string };

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const operator = await requireOperator();
  const params = await searchParams;
  const activeTab = params.status ?? "pending";

  const rows = await withOperator(operator.id, async (tx) => {
    const conds = [] as Array<ReturnType<typeof eq>>;
    if ((PROPOSAL_STATUSES as readonly string[]).includes(activeTab)) {
      conds.push(
        eq(aiProposals.status, activeTab as (typeof PROPOSAL_STATUSES)[number]),
      );
    }
    if (
      params.type &&
      (PROPOSAL_TYPES as readonly string[]).includes(params.type)
    ) {
      conds.push(
        eq(aiProposals.type, params.type as (typeof PROPOSAL_TYPES)[number]),
      );
    }

    return await tx
      .select({
        id: aiProposals.id,
        type: aiProposals.type,
        status: aiProposals.status,
        targetEntityType: aiProposals.targetEntityType,
        targetEntityId: aiProposals.targetEntityId,
        explanation: aiProposals.explanation,
        createdAt: aiProposals.createdAt,
        reviewedAt: aiProposals.reviewedAt,
        reviewerName: appUsers.fullName,
        targetEmployeeId: warehouseUsers.employeeId,
        targetFullName: warehouseUsers.fullName,
      })
      .from(aiProposals)
      .leftJoin(appUsers, eq(appUsers.id, aiProposals.reviewedBy))
      .leftJoin(warehouseUsers, eq(warehouseUsers.id, aiProposals.targetEntityId))
      .where(conds.length ? and(...conds) : sql`true`)
      .orderBy(desc(aiProposals.createdAt))
      .limit(500);
  });

  return (
    <>
      <PageHeader
        title="Proposals inbox"
        subtitle="Review and adjudicate AI-generated proposals across warehouse operations."
      />

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <nav className="flex items-center gap-1 border-b border-border-subtle w-full">
          {PROPOSAL_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/proposals?status=${s}`}
              className={cn(
                "px-4 py-2 font-label text-label border-b-2 -mb-px transition-colors",
                s === activeTab
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-on-surface-variant hover:text-on-surface",
              )}
            >
              {s} <span className="opacity-60">({s === activeTab ? rows.length : ""})</span>
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <Card padding="p-10" className="text-center">
          <Icon name="inbox" size={32} className="text-on-surface-variant mx-auto" />
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-2">
            No {activeTab} proposals.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <ProposalRow key={p.id} p={p} />
          ))}
        </div>
      )}
    </>
  );
}

function ProposalRow({
  p,
}: {
  p: {
    id: string;
    type: string;
    status: string;
    explanation: string;
    createdAt: Date;
    reviewedAt: Date | null;
    reviewerName: string | null;
    targetEntityType: string;
    targetEntityId: string | null;
    targetEmployeeId: string | null;
    targetFullName: string | null;
  };
}) {
  const tone = p.status === "pending" ? "violet" : "default";
  return (
    <Card
      tone={tone}
      padding="p-0"
      className="overflow-hidden hover:shadow-sm transition-shadow"
    >
      <Link href={`/proposals/${p.id}`} className="block p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge tone="violet">Proposed</StatusBadge>
            <ProposalStatusBadge value={p.status} />
            <span className="font-label text-label text-on-surface-variant">
              <code className="font-data-mono">AI-{p.id.slice(0, 8).toUpperCase()}</code>
            </span>
          </div>
          <span className="font-label text-label text-on-surface-variant">
            {timeAgo(p.createdAt)}
          </span>
        </div>
        <div className="font-title text-title text-on-surface mb-1 inline-flex items-center gap-2">
          {humanProposalType(p.type)}
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-3 line-clamp-2">
          {p.targetFullName ? (
            <>
              <span className="font-medium">Target:</span> {p.targetFullName}{" "}
              {p.targetEmployeeId ? (
                <code className="font-data-mono">({p.targetEmployeeId})</code>
              ) : null}{" "}
              ·{" "}
            </>
          ) : null}
          {p.explanation}
        </p>
        {p.reviewerName && p.reviewedAt ? (
          <p className="font-label text-label text-on-surface-variant">
            Reviewed by {p.reviewerName} · {new Date(p.reviewedAt).toISOString().slice(0, 16).replace("T", " ")}
          </p>
        ) : null}
      </Link>
    </Card>
  );
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

function timeAgo(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
