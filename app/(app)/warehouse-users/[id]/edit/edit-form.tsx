"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import type { Role, Warehouse, WarehouseUser } from "@/lib/db/schema";

import { updateWarehouseUserAction, type ActionState } from "../actions";

const INITIAL: ActionState = {};

export function EditForm({
  user,
  warehouses,
  roles,
}: {
  user: WarehouseUser;
  warehouses: Warehouse[];
  roles: Role[];
}) {
  const [state, action, pending] = useActionState(
    updateWarehouseUserAction,
    INITIAL,
  );
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        <input type="hidden" name="id" value={user.id} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name" required>
            <TextInput
              name="fullName"
              defaultValue={user.fullName}
              required
              maxLength={200}
            />
          </Field>
          <Field label="Email">
            <TextInput name="email" type="email" defaultValue={user.email ?? ""} />
          </Field>
          <Field label="Warehouse" required>
            <Select name="warehouseId" defaultValue={user.warehouseId} required>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role" required>
            <Select name="roleId" defaultValue={user.roleId} required>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {state.error ? (
          <p className="font-body-sm text-body-sm text-status-danger inline-flex items-center gap-1.5">
            <Icon name="error" size={16} /> {state.error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
          <Button type="submit" icon={<Icon name="save" size={16} />}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
