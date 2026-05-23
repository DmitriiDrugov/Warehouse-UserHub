"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/field";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";

import { runNlQueryAction, type NlQueryState } from "./actions";

const INITIAL: NlQueryState = {};

const SUGGESTIONS = [
  "Who has expired forklift certificates but still holds active floor access?",
  "Active access grants at warehouse WH-A",
  "Users at each warehouse currently offboarded",
  "Recent audit entries linked to AI proposals",
];

export function NlQueryConsole() {
  const [state, action, pending] = useActionState(runNlQueryAction, INITIAL);

  return (
    <>
      <Card className="mb-4">
        <form action={action} className="space-y-3">
          <fieldset disabled={pending} className="space-y-3">
            <div className="relative">
              <Icon
                name="auto_awesome"
                size={18}
                className="absolute left-3 top-3 text-proposal-violet"
              />
              <Textarea
                id="question"
                name="question"
                rows={2}
                className="pl-10"
                defaultValue={state.question ?? ""}
                placeholder="e.g. Show me all pickers with an efficiency rate below 85% this week…"
                required
              />
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <SuggestionChip key={s} text={s} />
                ))}
              </div>
              <Button type="submit" icon={<Icon name="play_arrow" size={16} />}>
                {pending ? "Running…" : "Run"}
              </Button>
            </div>
          </fieldset>
        </form>
      </Card>

      <Card padding="p-0">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <h3 className="font-title text-title text-on-surface">Query results</h3>
          <div className="flex items-center gap-3 text-on-surface-variant">
            <button type="button" title="Download" className="hover:text-primary">
              <Icon name="download" size={18} />
            </button>
            <button type="button" title="More" className="hover:text-primary">
              <Icon name="more_horiz" size={18} />
            </button>
          </div>
        </div>

        {state.error ? (
          <div className="p-6 text-body-sm">
            <div className="inline-flex items-start gap-2 text-status-danger">
              <Icon name="error" size={18} />
              <div>
                <div className="font-medium">Query rejected</div>
                <div className="text-on-surface-variant">{state.error}</div>
              </div>
            </div>
            {state.result?.llmSql ? (
              <details className="mt-3">
                <summary className="font-label text-label text-on-surface-variant cursor-pointer">
                  Show raw LLM output
                </summary>
                <pre className="font-data-mono text-data-mono bg-surface-container-low border border-border-subtle rounded p-3 mt-2 overflow-auto">
                  {state.result.llmSql}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}

        {!state.error && !state.result ? (
          <div className="p-16 flex flex-col items-center justify-center text-center text-on-surface-variant">
            <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center mb-3">
              <Icon name="manage_search" size={28} className="text-on-surface-variant" />
            </div>
            <h4 className="font-title text-title text-on-surface mb-1">Ready to explore</h4>
            <p className="font-body-sm text-body-sm max-w-md">
              Type a question in plain English above. The AI translates to a sanitized SELECT
              over the reporting views and runs it as the <code className="font-data-mono">nl_query_reader</code> role.
            </p>
          </div>
        ) : null}

        {state.result && !state.error ? (
          <>
            <div className="px-5 py-3 border-b border-border-subtle bg-surface-container-low">
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <span className="font-label text-label text-on-surface-variant">
                  Views used: {state.result.tablesUsed.join(", ")} · LIMIT{" "}
                  {state.result.appliedLimit} · {state.result.durationMs} ms
                </span>
              </div>
              <pre className="font-data-mono text-data-mono bg-surface-container-lowest border border-border-subtle rounded p-3 overflow-auto">
                {state.result.sql}
              </pre>
              <details className="mt-2">
                <summary className="font-label text-label text-on-surface-variant cursor-pointer">
                  Raw LLM output (before canonicalization)
                </summary>
                <pre className="font-data-mono text-data-mono mt-2 text-on-surface-variant">
                  {state.result.llmSql}
                </pre>
              </details>
            </div>

            <div className="overflow-x-auto">
              <DataTable className="rounded-none border-0">
                <thead className="bg-surface-container-low">
                  <tr>
                    {state.result.columns.map((c) => (
                      <Th key={c}>{c}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-surface-container-low transition-colors">
                      {state.result!.columns.map((c) => (
                        <Td key={c} mono>{formatCell(row[c])}</Td>
                      ))}
                    </tr>
                  ))}
                  {state.result.rows.length === 0 ? (
                    <EmptyRow colSpan={state.result.columns.length || 1}>
                      Query returned 0 rows.
                    </EmptyRow>
                  ) : null}
                </tbody>
              </DataTable>
            </div>
          </>
        ) : null}
      </Card>
    </>
  );
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="px-2.5 py-1 rounded-full bg-surface-container-low border border-border-subtle font-label text-label text-on-surface-variant hover:bg-surface-container hover:text-primary"
      onClick={(e) => {
        const ta = e.currentTarget
          .closest("form")
          ?.querySelector('textarea[name="question"]') as HTMLTextAreaElement | null;
        if (ta) {
          ta.value = text;
          ta.focus();
        }
      }}
    >
      {text}
    </button>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
