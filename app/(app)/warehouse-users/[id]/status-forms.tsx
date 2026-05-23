"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import {
  WAREHOUSE_USER_STATUSES,
  type WarehouseUserStatus,
} from "@/lib/validation/enums";

import { changeStatusAction, offboardAction, type ActionState } from "./actions";

const INITIAL: ActionState = {};

export function StatusForm({
  userId,
  currentStatus,
}: {
  userId: string;
  currentStatus: WarehouseUserStatus;
}) {
  const [state, action, pending] = useActionState(changeStatusAction, INITIAL);
  const options = WAREHOUSE_USER_STATUSES.filter((s) => s !== currentStatus);
  return (
    <form action={action} className="flex items-end gap-2 flex-wrap min-w-0">
      <input type="hidden" name="id" value={userId} />
      <Field label="Change status">
        <Select name="nextStatus" required defaultValue="">
          <option value="" disabled>— pick —</option>
          {options.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </Field>
      <Field label="Reason">
        <TextInput name="reason" placeholder="optional" />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "…" : "Apply"}
      </Button>
      {state.error ? (
        <span className="font-label text-label text-status-danger flex items-center gap-1">
          <Icon name="error" size={14} /> {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function OffboardForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(offboardAction, INITIAL);
  return (
    <form action={action} className="flex items-end gap-2 flex-wrap min-w-0">
      <input type="hidden" name="id" value={userId} />
      <Field label="Offboard worker" hint="Revokes access + certs, queues AI completeness proposal">
        <TextInput name="reason" placeholder="reason (optional)" />
      </Field>
      <Button
        type="submit"
        variant="danger"
        disabled={pending}
        icon={<Icon name="logout" size={16} />}
      >
        {pending ? "Offboarding…" : "Offboard now"}
      </Button>
      {state.error ? (
        <span className="font-label text-label text-status-danger flex items-center gap-1">
          <Icon name="error" size={14} /> {state.error}
        </span>
      ) : null}
    </form>
  );
}
