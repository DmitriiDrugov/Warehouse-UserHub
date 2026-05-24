"use client";

import { useActionState } from "react";

import { CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { ChecklistStatusBadge, StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";

import { tickChecklistItemAction, type ActionState } from "./actions";

const INITIAL: ActionState = {};

type ListRow = {
  id: string;
  type: "onboarding" | "offboarding";
  status: "in_progress" | "completed";
  startedAt: Date;
  completedAt: Date | null;
};

type ItemRow = {
  id: string;
  userChecklistId: string;
  label: string;
  order: number;
  isRequired: boolean;
  isDone: boolean;
  doneAt: Date | null;
};

export function ChecklistSection({
  warehouseUserId,
  canMutate,
  lists,
  items,
}: {
  warehouseUserId: string;
  canMutate: boolean;
  lists: ListRow[];
  items: ItemRow[];
}) {
  const [tickState, tickAction, tickPending] = useActionState(
    tickChecklistItemAction,
    INITIAL,
  );

  return (
    <section className="mb-6">
      <CardHeader
        title="Checklists"
        subtitle="Onboarding and offboarding workflows. Required items must be ticked to complete the parent checklist."
      />

      {lists.length === 0 ? (
        <div className="text-body-sm text-on-surface-variant border border-dashed border-border-subtle rounded-lg p-6 text-center">
          No checklists instantiated.
        </div>
      ) : null}

      <div className="space-y-4">
        {lists.map((list) => {
          const listItems = items
            .filter((i) => i.userChecklistId === list.id)
            .sort((a, b) => a.order - b.order);
          const done = listItems.filter((i) => i.isDone).length;
          const total = listItems.length;
          const pct = total === 0 ? 0 : Math.round((done / total) * 100);

          return (
            <article
              key={list.id}
              className="bg-surface-container-lowest border border-border-subtle rounded-lg overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <Icon
                    name={list.type === "onboarding" ? "person_add" : "logout"}
                    size={20}
                    className="text-on-surface-variant"
                  />
                  <h4 className="font-title text-title text-on-surface capitalize">
                    {list.type}
                  </h4>
                  <ChecklistStatusBadge value={list.status} />
                </div>
                <div className="flex items-center gap-3 text-on-surface-variant text-label font-label">
                  <span>Started {fmtDate(list.startedAt)}</span>
                  {list.completedAt ? <span>· Completed {fmtDate(list.completedAt)}</span> : null}
                </div>
              </div>
              <div className="px-5 pt-3">
                <div className="flex items-center justify-between mb-1.5 text-label font-label">
                  <span className="text-on-surface-variant">Progress</span>
                  <span className="text-on-surface tabular-nums">
                    {done} of {total} tasks · {pct}%
                  </span>
                </div>
                <div className="h-2 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full bg-status-success"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <ul className="divide-y divide-border-subtle px-2 pb-2">
                {listItems.map((it) => (
                  <li
                    key={it.id}
                    className={cn(
                      "flex items-center justify-between gap-3 px-3 py-3 rounded",
                      it.isDone && "opacity-80",
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={cn(
                          "w-5 h-5 rounded border flex items-center justify-center shrink-0",
                          it.isDone
                            ? "bg-status-success text-white border-status-success"
                            : "border-outline-variant bg-surface-container-lowest",
                        )}
                      >
                        {it.isDone ? <Icon name="check" size={14} /> : null}
                      </span>
                      <span
                        className={cn(
                          "text-body-sm text-on-surface min-w-0 truncate",
                          it.isDone && "line-through text-on-surface-variant",
                        )}
                      >
                        {it.label}
                      </span>
                      {it.isRequired ? null : (
                        <StatusBadge tone="neutral" dot={false}>
                          optional
                        </StatusBadge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {it.isDone && it.doneAt ? (
                        <span className="font-label text-label text-on-surface-variant">
                          {fmtDateTime(it.doneAt)}
                        </span>
                      ) : null}
                      {canMutate && !it.isDone ? (
                        <form action={tickAction}>
                          <input type="hidden" name="userChecklistItemId" value={it.id} />
                          <input
                            type="hidden"
                            name="warehouseUserId"
                            value={warehouseUserId}
                          />
                          <button
                            type="submit"
                            disabled={tickPending}
                            className="font-label text-label text-primary hover:underline flex items-center gap-1"
                          >
                            {tickPending ? (
                              <Icon
                                name="progress_activity"
                                size={14}
                                className="animate-spin"
                              />
                            ) : (
                              "Mark done"
                            )}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      {tickState.error ? (
        <p className="font-body-sm text-body-sm text-status-danger mt-3">
          {tickState.error}
        </p>
      ) : null}
    </section>
  );
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 16).replace("T", " ");
}
