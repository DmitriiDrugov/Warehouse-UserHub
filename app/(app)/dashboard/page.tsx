/**
 * Dashboard (§7.2). Live counts and lists scoped to the operator's
 * warehouses by RLS via withOperator(...). Stitch design — bento-style
 * stat tiles + "Needs Attention" feed + Recent Activity column.
 */

import Link from "next/link";
import { and, desc, eq, isNotNull, lt, lte, sql } from "drizzle-orm";

import { Card, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireOperator } from "@/lib/auth/operator";
import { serverEnv } from "@/lib/env";
import { withOperator } from "@/lib/db/client";
import {
  aiProposals,
  appUsers,
  auditLog,
  userAccess,
  userCertificates,
  warehouseUsers,
} from "@/lib/db/schema";

export const metadata = { title: "Dashboard — Warehouse UserHub" };

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function DashboardPage() {
  const operator = await requireOperator();
  const env = serverEnv();

  const data = await withOperator(operator.id, async (tx) => {
    const horizon = new Date(Date.now() + 30 * DAY_MS);
    const slaCutoff = new Date(Date.now() - env.OFFBOARDING_SLA_HOURS * 60 * 60 * 1000);

    const [active] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(warehouseUsers)
      .where(eq(warehouseUsers.status, "active"));
    const [pendingUsers] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(warehouseUsers)
      .where(eq(warehouseUsers.status, "pending"));

    const [pendingProposals] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(aiProposals)
      .where(eq(aiProposals.status, "pending"));

    const [certsSoon] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userCertificates)
      .where(
        and(
          eq(userCertificates.status, "valid"),
          isNotNull(userCertificates.expiresAt),
          lte(userCertificates.expiresAt, horizon),
        ),
      );

    const slaBreaches = await tx
      .select({
        id: warehouseUsers.id,
        employeeId: warehouseUsers.employeeId,
        fullName: warehouseUsers.fullName,
        terminationDate: warehouseUsers.terminationDate,
        activeAccessCount: sql<number>`(SELECT COUNT(*)::int FROM ${userAccess} WHERE ${userAccess.warehouseUserId} = ${warehouseUsers.id} AND ${userAccess.status} = 'active')`,
      })
      .from(warehouseUsers)
      .where(
        and(
          eq(warehouseUsers.status, "offboarded"),
          isNotNull(warehouseUsers.terminationDate),
          lt(warehouseUsers.terminationDate, slaCutoff),
        ),
      )
      .limit(20);
    const slaBreaching = slaBreaches.filter((s) => s.activeAccessCount > 0);

    const attention = await tx
      .select({
        id: aiProposals.id,
        type: aiProposals.type,
        explanation: aiProposals.explanation,
        createdAt: aiProposals.createdAt,
        targetEntityId: aiProposals.targetEntityId,
      })
      .from(aiProposals)
      .where(eq(aiProposals.status, "pending"))
      .orderBy(desc(aiProposals.createdAt))
      .limit(6);

    const activity = await tx
      .select({
        id: auditLog.id,
        action: auditLog.action,
        aiAssisted: auditLog.aiAssisted,
        reason: auditLog.reason,
        createdAt: auditLog.createdAt,
        actorName: appUsers.fullName,
      })
      .from(auditLog)
      .leftJoin(appUsers, eq(appUsers.id, auditLog.actorId))
      .orderBy(desc(auditLog.createdAt))
      .limit(8);

    return {
      active: active?.count ?? 0,
      pendingUsers: pendingUsers?.count ?? 0,
      pendingProposals: pendingProposals?.count ?? 0,
      certsSoon: certsSoon?.count ?? 0,
      slaBreaching,
      attention,
      activity,
    };
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of operations and pending actions."
      />

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatTile
          label="Active warehouse users"
          value={data.active}
          icon="groups"
          tone="success"
          href="/warehouse-users?status=active"
        />
        <StatTile
          label="Pending AI proposals"
          value={data.pendingProposals}
          icon="smart_toy"
          tone="violet"
          subtitle="Awaiting approval"
          href="/proposals"
        />
        <StatTile
          label="Certs expiring ≤ 30d"
          value={data.certsSoon}
          icon="warning"
          tone="warning"
          subtitle="Requires scheduling"
          href="/certificates?status=valid"
        />
        <StatTile
          label="Offboarding SLA breaches"
          value={data.slaBreaching.length}
          icon="error"
          tone="danger"
          subtitle={data.slaBreaching.length > 0 ? "Action required" : "All clear"}
          href="/warehouse-users?status=offboarded"
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-title text-title text-on-surface">Needs attention</h2>
            <Link href="/proposals" className="font-label text-label text-primary hover:underline">
              View all proposals
            </Link>
          </div>
          <Card padding="p-0">
            <ul className="divide-y divide-border-subtle">
              {data.slaBreaching.slice(0, 3).map((s) => (
                <li key={s.id} className="p-4 hover:bg-surface-container-low transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon name="gpp_maybe" size={20} className="text-status-danger mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Link
                            href={`/warehouse-users/${s.id}`}
                            className="font-body-sm font-medium text-on-surface hover:text-primary"
                          >
                            {s.fullName} offboarding delayed
                          </Link>
                          <StatusBadge tone="danger">SLA breach</StatusBadge>
                        </div>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">
                          {s.activeAccessCount} active grant(s) still on file after termination.
                        </p>
                        <code className="inline-block mt-1.5 font-data-mono text-data-mono text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded">
                          ID: {s.employeeId}
                        </code>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {data.attention.map((p) => (
                <li
                  key={p.id}
                  className="p-4 bg-proposal-violet-soft hover:opacity-90 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon name="smart_toy" size={20} className="text-proposal-violet mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Link
                            href={`/proposals/${p.id}`}
                            className="font-body-sm font-medium text-on-surface hover:text-primary"
                          >
                            {humanProposalType(p.type)}
                          </Link>
                          <StatusBadge tone="violet">Proposed</StatusBadge>
                        </div>
                        <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-2">
                          {p.explanation}
                        </p>
                      </div>
                    </div>
                    <span className="font-label text-label text-on-surface-variant whitespace-nowrap">
                      {timeAgo(p.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
              {data.slaBreaching.length === 0 && data.attention.length === 0 ? (
                <li className="p-10 text-center text-on-surface-variant">
                  <Icon name="check_circle" size={28} className="text-status-success" />
                  <p className="mt-2 font-body-sm">Nothing urgent. Inbox is clear.</p>
                </li>
              ) : null}
            </ul>
          </Card>
        </section>

        <section>
          <h2 className="font-title text-title text-on-surface mb-3">Recent activity</h2>
          <Card>
            <div className="relative border-l border-border-subtle ml-2 space-y-5">
              {data.activity.map((e) => (
                <div key={e.id} className="relative pl-5">
                  <span
                    className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-surface-container-lowest ${
                      e.aiAssisted ? "bg-proposal-violet" : "bg-border-subtle"
                    }`}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-label text-label font-medium text-on-surface truncate">
                      {e.actorName ?? "System"}
                    </span>
                    <span className="font-label text-label text-on-surface-variant whitespace-nowrap">
                      {timeAgo(e.createdAt)}
                    </span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    <code className="font-data-mono text-data-mono">{e.action}</code>
                    {e.reason ? <> · {e.reason}</> : null}
                  </p>
                  {e.aiAssisted ? (
                    <div className="mt-1.5 inline-flex items-center gap-1 bg-surface-container-low border border-border-subtle rounded px-1.5 py-0.5">
                      <Icon name="auto_awesome" size={14} className="text-proposal-violet" />
                      <span className="font-label text-label text-on-surface-variant">
                        AI-assisted
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        </section>
      </div>
    </>
  );
}

function StatTile({
  label,
  value,
  icon,
  tone,
  subtitle,
  href,
}: {
  label: string;
  value: number;
  icon: string;
  tone: "success" | "violet" | "warning" | "danger";
  subtitle?: string;
  href: string;
}) {
  const colors = {
    success: { text: "text-status-success", border: "border-border-subtle" },
    violet: {
      text: "text-proposal-violet",
      border: "border-proposal-violet",
    },
    warning: { text: "text-status-warning", border: "border-border-subtle" },
    danger: { text: "text-status-danger", border: "border-status-danger" },
  }[tone];
  const tinted = tone === "violet" ? "bg-proposal-violet-soft" : tone === "danger" ? "bg-error-container/30" : "bg-surface-container-lowest";
  return (
    <Link
      href={href}
      className={`block border ${colors.border} rounded-xl ${tinted} p-5 hover:shadow-sm transition-shadow`}
    >
      <div className="flex items-start justify-between mb-3">
        <span className={`font-label text-label ${colors.text}`}>{label}</span>
        <Icon name={icon} size={20} className={colors.text} />
      </div>
      <div className="font-display text-display text-on-surface tabular-nums">
        {value.toLocaleString()}
      </div>
      {subtitle ? (
        <div className={`font-body-sm text-body-sm mt-1 ${colors.text}`}>{subtitle}</div>
      ) : null}
    </Link>
  );
}

function humanProposalType(t: string): string {
  switch (t) {
    case "provision": return "Provision new worker";
    case "revoke_access": return "Revoke access";
    case "anomaly_flag": return "Anomaly flagged";
    case "offboard_completeness": return "Offboarding completeness";
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
