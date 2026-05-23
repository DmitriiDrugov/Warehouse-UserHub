"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { SourceTag } from "@/components/ui/source-tag";
import { AccessStatusBadge } from "@/components/ui/status-badge";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";
import { ACCESS_SOURCES } from "@/lib/validation/enums";

import {
  grantAccessAction,
  revokeAccessAction,
  type ActionState,
} from "./actions";

const INITIAL: ActionState = {};

type AccessRow = {
  id: string;
  permissionCode: string;
  permissionName: string;
  systemCode: string;
  status: "active" | "revoked" | "expired";
  source: "role_template" | "manual" | "temporary_project";
  grantedAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  grantedByName: string | null;
};

type PermissionOpt = {
  id: string;
  code: string;
  systemCode: string;
  name: string;
};

export function AccessSection({
  warehouseUserId,
  canMutate,
  access,
  permissions,
}: {
  warehouseUserId: string;
  canMutate: boolean;
  access: AccessRow[];
  permissions: PermissionOpt[];
}) {
  const [grantState, grantAction, grantPending] = useActionState(
    grantAccessAction,
    INITIAL,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeAccessAction,
    INITIAL,
  );

  return (
    <section className="mb-6">
      <CardHeader
        title="Access"
        subtitle="Permissions granted to this worker across warehouse systems."
      />

      <DataTable className="mb-4">
        <thead className="bg-surface-container-low">
          <tr>
            <Th>Resource</Th>
            <Th>Status</Th>
            <Th>Source</Th>
            <Th>Granted</Th>
            <Th>Expires</Th>
            <Th>Last used</Th>
            <Th>By</Th>
            {canMutate ? <Th align="right"></Th> : null}
          </tr>
        </thead>
        <tbody>
          {access.map((a) => (
            <tr key={a.id} className="hover:bg-surface-container-low transition-colors">
              <Td>
                <div>
                  <div className="text-on-surface">{a.permissionName}</div>
                  <code className="font-data-mono text-label text-on-surface-variant">
                    {a.systemCode}.{a.permissionCode}
                  </code>
                </div>
              </Td>
              <Td>
                <AccessStatusBadge value={a.status} />
              </Td>
              <Td>
                <SourceTag value={a.source} />
              </Td>
              <Td mono>{fmtDate(a.grantedAt)}</Td>
              <Td mono>{fmtDate(a.expiresAt)}</Td>
              <Td mono>{fmtDate(a.lastUsedAt)}</Td>
              <Td>{a.grantedByName ?? "—"}</Td>
              {canMutate ? (
                <Td align="right">
                  {a.status === "active" ? (
                    <form action={revokeAction} className="inline">
                      <input type="hidden" name="accessId" value={a.id} />
                      <input
                        type="hidden"
                        name="warehouseUserId"
                        value={warehouseUserId}
                      />
                      <button
                        type="submit"
                        disabled={revokePending}
                        className="font-label text-label text-status-danger hover:underline"
                      >
                        {revokePending ? "…" : "Revoke"}
                      </button>
                    </form>
                  ) : null}
                </Td>
              ) : null}
            </tr>
          ))}
          {access.length === 0 ? (
            <EmptyRow colSpan={canMutate ? 8 : 7}>
              No access grants on record.
            </EmptyRow>
          ) : null}
        </tbody>
      </DataTable>

      {revokeState.error ? (
        <p className="font-body-sm text-body-sm text-status-danger mb-3">
          Revoke failed: {revokeState.error}
        </p>
      ) : null}

      {canMutate ? (
        <Card padding="p-4">
          <h4 className="font-title text-title text-on-surface mb-3 inline-flex items-center gap-2">
            <Icon name="add_circle" size={18} /> Grant new permission
          </h4>
          <form action={grantAction} className="space-y-3">
            <fieldset disabled={grantPending} className="space-y-3">
              <input
                type="hidden"
                name="warehouseUserId"
                value={warehouseUserId}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Permission" required className="md:col-span-2">
                  <Select name="permissionId" required defaultValue="">
                    <option value="" disabled>— Select permission —</option>
                    {permissions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.systemCode}.{p.code} — {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Source" required>
                  <Select name="source" required defaultValue="manual">
                    {ACCESS_SOURCES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Expires (optional)">
                  <TextInput name="expiresAt" type="date" />
                </Field>
                <Field label="Reason" className="md:col-span-2">
                  <TextInput name="reason" placeholder="why is this grant being added?" />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-3">
                {grantState.error ? (
                  <span className="font-label text-label text-status-danger inline-flex items-center gap-1">
                    <Icon name="error" size={14} /> {grantState.error}
                  </span>
                ) : null}
                <Button type="submit">
                  {grantPending ? "Granting…" : "Grant access"}
                </Button>
              </div>
            </fieldset>
          </form>
        </Card>
      ) : null}
    </section>
  );
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}
