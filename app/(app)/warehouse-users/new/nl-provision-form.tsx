"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/field";

import { proposeProvisionAction, type NlProvisionState } from "./actions";

const INITIAL: NlProvisionState = {};

export function NlProvisionForm() {
  const [state, action, pending] = useActionState(
    proposeProvisionAction,
    INITIAL,
  );
  return (
    <form action={action} className="space-y-3">
      <fieldset disabled={pending} className="space-y-3">
        <label htmlFor="nl-text" className="block">
          <span className="font-label text-label text-on-surface-variant">Request</span>
        </label>
        <Textarea
          id="nl-text"
          name="text"
          rows={4}
          placeholder="e.g. Create a forklift operator at warehouse WH-B with employee id B011, full name Sven Karlsson, hire date today, same access as A001."
          required
        />
        {state.error ? (
          <p className="font-body-sm text-body-sm text-status-danger flex items-start gap-1.5">
            <Icon name="error" size={16} /> {state.error}
          </p>
        ) : null}
        {state.proposalId ? (
          <div className="bg-surface-container-lowest border border-border-subtle rounded p-3 text-body-sm flex items-start gap-2">
            <Icon name="check_circle" size={18} className="text-status-success mt-0.5" />
            <div className="flex-1">
              <p>
                Proposal queued —{" "}
                <Link
                  href={`/proposals/${state.proposalId}`}
                  className="text-primary hover:underline font-medium"
                >
                  open #{state.proposalId.slice(0, 8)}
                </Link>
                .
              </p>
              <p className="text-on-surface-variant">
                Awaiting approval by warehouse_admin.
              </p>
            </div>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="violet"
            icon={<Icon name="auto_awesome" size={16} />}
          >
            {pending ? "Parsing…" : "Parse with AI"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
