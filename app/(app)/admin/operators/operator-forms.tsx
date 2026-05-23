"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import type { AppUser, Warehouse } from "@/lib/db/schema";
import { OPERATOR_ROLES } from "@/lib/validation/enums";

import {
  assignWarehouseAction,
  createOperatorAction,
  unassignWarehouseAction,
  updateOperatorAction,
  type AdminState,
} from "./actions";

const INITIAL: AdminState = {};

export function CreateOperatorForm({ warehouses }: { warehouses: Warehouse[] }) {
  const [state, action, pending] = useActionState(createOperatorAction, INITIAL);
  return (
    <form action={action} className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <fieldset disabled={pending} className="contents">
        <Field label="Email" required>
          <TextInput name="email" type="email" required placeholder="ops@example.com" />
        </Field>
        <Field label="Full name" required>
          <TextInput name="fullName" required maxLength={200} />
        </Field>
        <Field label="Role" required>
          <Select name="operatorRole" defaultValue="viewer" required>
            {OPERATOR_ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Warehouses">
          <Select
            name="warehouseIds"
            multiple
            size={Math.min(5, Math.max(2, warehouses.length))}
            className="h-auto"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="md:col-span-2 flex items-center justify-end gap-3">
          {state.error ? (
            <span className="font-label text-label text-status-danger">{state.error}</span>
          ) : null}
          <Button type="submit" icon={<Icon name="person_add" size={16} />}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

export function OperatorRow({
  op,
  warehouses,
}: {
  op: AppUser & { warehouseIds: string[] };
  warehouses: Warehouse[];
}) {
  const [updState, updAction, updPending] = useActionState(updateOperatorAction, INITIAL);
  const [, assignAction, assignPending] = useActionState(assignWarehouseAction, INITIAL);
  const [, unassignAction, unassignPending] = useActionState(unassignWarehouseAction, INITIAL);

  return (
    <tr className="hover:bg-surface-container-low transition-colors">
      <td className="px-4 py-3 border-b border-border-subtle text-table-cell align-top">
        <div className="font-medium">{op.email}</div>
      </td>
      <td className="px-4 py-3 border-b border-border-subtle align-top">
        <form action={updAction} className="flex flex-wrap items-end gap-2">
          <fieldset disabled={updPending} className="contents">
            <input type="hidden" name="id" value={op.id} />
            <TextInput
              name="fullName"
              defaultValue={op.fullName}
              required
              maxLength={200}
              className="w-48"
            />
            <Select
              name="operatorRole"
              defaultValue={op.operatorRole}
              className="w-40"
            >
              {OPERATOR_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
            <label className="inline-flex items-center gap-1 font-label text-label text-on-surface-variant">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={op.isActive}
                className="rounded"
              />
              active
            </label>
            <Button type="submit" variant="secondary" size="sm">
              {updPending ? "…" : "Save"}
            </Button>
            {updState.error ? (
              <span className="font-label text-label text-status-danger">
                {updState.error}
              </span>
            ) : null}
          </fieldset>
        </form>
      </td>
      <td className="px-4 py-3 border-b border-border-subtle align-top">
        <span
          className={`inline-flex items-center gap-1 font-label text-label ${
            op.isActive ? "text-status-success" : "text-on-surface-variant"
          }`}
        >
          <Icon name={op.isActive ? "check_circle" : "block"} size={14} />
          {op.isActive ? "yes" : "no"}
        </span>
      </td>
      <td className="px-4 py-3 border-b border-border-subtle align-top">
        <ul className="space-y-1 mb-2">
          {warehouses
            .filter((w) => op.warehouseIds.includes(w.id))
            .map((w) => (
              <li key={w.id} className="inline-flex items-center gap-1 mr-1">
                <code className="font-data-mono text-data-mono">{w.code}</code>
                <form action={unassignAction} className="inline">
                  <input type="hidden" name="appUserId" value={op.id} />
                  <input type="hidden" name="warehouseId" value={w.id} />
                  <button
                    type="submit"
                    disabled={unassignPending}
                    title="Unassign"
                    className="text-on-surface-variant hover:text-status-danger"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </form>
              </li>
            ))}
        </ul>
        <form action={assignAction} className="flex gap-1 items-center">
          <input type="hidden" name="appUserId" value={op.id} />
          <Select name="warehouseId" defaultValue="" required className="w-40">
            <option value="" disabled>+ Add warehouse</option>
            {warehouses
              .filter((w) => !op.warehouseIds.includes(w.id))
              .map((w) => (
                <option key={w.id} value={w.id}>{w.code}</option>
              ))}
          </Select>
          <Button type="submit" size="sm" variant="secondary">
            {assignPending ? "…" : "Add"}
          </Button>
        </form>
      </td>
    </tr>
  );
}
