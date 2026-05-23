"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextInput } from "@/components/ui/field";

import {
  approveProposalAction,
  rejectProposalAction,
  type ReviewState,
} from "./actions";

const INITIAL: ReviewState = {};

export function ReviewForms({ proposalId }: { proposalId: string }) {
  const [approveState, approve, approvePending] = useActionState(
    approveProposalAction,
    INITIAL,
  );
  const [rejectState, reject, rejectPending] = useActionState(
    rejectProposalAction,
    INITIAL,
  );

  return (
    <div className="space-y-3">
      <form action={approve} className="flex flex-wrap gap-2 items-center">
        <input type="hidden" name="proposalId" value={proposalId} />
        <TextInput
          name="note"
          placeholder="Add optional review note…"
          className="flex-1 min-w-[18rem]"
        />
        <Button
          type="submit"
          variant="violet"
          disabled={approvePending || rejectPending}
          icon={<Icon name="check" size={16} />}
        >
          {approvePending ? "Approving…" : "Approve & execute"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={(e) => {
            const form = (e.currentTarget.closest("div")
              ?.parentElement?.querySelector("form[data-reject]") as HTMLFormElement | null);
            const note = (e.currentTarget.closest("div")
              ?.parentElement?.querySelector('input[name="note"]') as HTMLInputElement | null)?.value ?? "";
            if (form) {
              const noteInput = form.querySelector('input[name="note"]') as HTMLInputElement | null;
              if (noteInput) noteInput.value = note;
              form.requestSubmit();
            }
          }}
          disabled={approvePending || rejectPending}
          icon={<Icon name="close" size={16} />}
        >
          Reject
        </Button>
      </form>

      <form action={reject} data-reject className="hidden">
        <input type="hidden" name="proposalId" value={proposalId} />
        <input type="hidden" name="note" />
      </form>

      {approveState.error ? (
        <p className="font-body-sm text-body-sm text-status-danger inline-flex items-center gap-1">
          <Icon name="error" size={14} /> Approve failed: {approveState.error}
        </p>
      ) : null}
      {rejectState.error ? (
        <p className="font-body-sm text-body-sm text-status-danger inline-flex items-center gap-1">
          <Icon name="error" size={14} /> Reject failed: {rejectState.error}
        </p>
      ) : null}
      <p className="font-label text-label text-on-surface-variant">
        Approval runs the deterministic services with{" "}
        <code className="font-data-mono">ai_assisted=true</code> and your operator id as actor.
      </p>
    </div>
  );
}
