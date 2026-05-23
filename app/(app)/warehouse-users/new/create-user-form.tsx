"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";

import {
  createWarehouseUserAction,
  type CreateFormState,
} from "./actions";

const INITIAL: CreateFormState = {};

type Option = { id: string; code: string; name: string };

export function CreateUserForm({
  warehouses,
  roles,
}: {
  warehouses: Option[];
  roles: Option[];
}) {
  const [state, action, pending] = useActionState(
    createWarehouseUserAction,
    INITIAL,
  );
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name" required>
            <TextInput name="fullName" required maxLength={200} placeholder="e.g. Jane Doe" />
          </Field>
          <Field label="Worker ID" required>
            <TextInput name="employeeId" required maxLength={64} placeholder="e.g. B-0011" />
          </Field>
        </div>

        <Field label="Email address">
          <TextInput
            name="email"
            type="email"
            placeholder="jane.doe@warehouse.com"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Assigned warehouse" required>
            <Select name="warehouseId" required defaultValue="">
              <option value="" disabled>— Select warehouse —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role template" required>
            <Select name="roleId" required defaultValue="">
              <option value="" disabled>— Select role —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Hire date" required>
          <TextInput
            name="hireDate"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        </Field>

        {state.error ? (
          <p className="font-body-sm text-body-sm text-status-danger flex items-center gap-1.5">
            <Icon name="error" size={16} /> {state.error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
          <Button type="submit" icon={<Icon name="save" size={16} />}>
            {pending ? "Saving…" : "Save worker"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
