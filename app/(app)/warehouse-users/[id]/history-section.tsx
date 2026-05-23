import Link from "next/link";

import { CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";

type Row = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  aiAssisted: boolean;
  proposalId: string | null;
  reason: string | null;
  createdAt: Date;
  actorName: string | null;
};

export function HistorySection({ history }: { history: Row[] }) {
  return (
    <section className="mb-6">
      <CardHeader
        title="Change history"
        subtitle="Append-only audit log entries scoped to this worker and their access / certificates / checklist items."
      />
      <DataTable>
        <thead className="bg-surface-container-low">
          <tr>
            <Th>When</Th>
            <Th>Action</Th>
            <Th>Actor</Th>
            <Th>AI</Th>
            <Th>Reason</Th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="hover:bg-surface-container-low transition-colors">
              <Td mono>{new Date(h.createdAt).toISOString().slice(0, 19).replace("T", " ")}</Td>
              <Td>
                <code className="font-data-mono text-data-mono">{h.action}</code>
              </Td>
              <Td>{h.actorName ?? "—"}</Td>
              <Td>
                {h.aiAssisted ? (
                  h.proposalId ? (
                    <Link
                      href={`/proposals/${h.proposalId}`}
                      className="inline-flex items-center gap-1 text-proposal-violet hover:underline"
                    >
                      <Icon name="auto_awesome" size={14} /> yes
                    </Link>
                  ) : (
                    <span className="text-proposal-violet inline-flex items-center gap-1">
                      <Icon name="auto_awesome" size={14} /> yes
                    </span>
                  )
                ) : (
                  <span className="text-on-surface-variant">no</span>
                )}
              </Td>
              <Td className="text-on-surface-variant">{h.reason ?? "—"}</Td>
            </tr>
          ))}
          {history.length === 0 ? (
            <EmptyRow colSpan={5}>No audit entries yet.</EmptyRow>
          ) : null}
        </tbody>
      </DataTable>
    </section>
  );
}
