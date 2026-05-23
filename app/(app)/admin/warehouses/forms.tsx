"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";

import { createWarehouseAction, type State } from "./actions";

const INITIAL: State = {};

export function CreateWarehouseForm() {
  const [state, action, pending] = useActionState(createWarehouseAction, INITIAL);
  return (
    <form action={action} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
      <fieldset disabled={pending} className="contents">
        <Field label="Code" required>
          <TextInput name="code" required maxLength={32} placeholder="WH-D" />
        </Field>
        <Field label="Name" required>
          <TextInput name="name" required maxLength={200} placeholder="Dortmund Cross-dock" />
        </Field>
        <Field label="Location">
          <TextInput name="location" maxLength={200} placeholder="Dortmund, DE" />
        </Field>
        <div className="md:col-span-3 flex items-center justify-end gap-3">
          {state.error ? (
            <span className="font-label text-label text-status-danger">{state.error}</span>
          ) : null}
          <Button type="submit" icon={<Icon name="add_business" size={16} />}>
            {pending ? "Creating…" : "Create warehouse"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
