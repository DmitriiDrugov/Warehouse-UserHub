"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { CertificateStatusBadge } from "@/components/ui/status-badge";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";

import {
  issueCertificateAction,
  renewCertificateAction,
  revokeCertificateAction,
  type ActionState,
} from "./actions";

const INITIAL: ActionState = {};

type CertRow = {
  id: string;
  certificateCode: string;
  certificateName: string;
  status: "valid" | "expired" | "revoked";
  issuedAt: Date;
  expiresAt: Date | null;
  documentPath: string | null;
};

type Catalog = {
  id: string;
  code: string;
  name: string;
  validityDays: number | null;
};

export function CertificateSection({
  warehouseUserId,
  canMutate,
  certs,
  catalog,
}: {
  warehouseUserId: string;
  canMutate: boolean;
  certs: CertRow[];
  catalog: Catalog[];
}) {
  const [issueState, issueAction, issuePending] = useActionState(
    issueCertificateAction,
    INITIAL,
  );
  const [renewState, renewAction, renewPending] = useActionState(
    renewCertificateAction,
    INITIAL,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeCertificateAction,
    INITIAL,
  );

  return (
    <section className="mb-6">
      <CardHeader
        title="Certificates"
        subtitle="Training and compliance records. Expiry drives the certificate gate rule."
      />

      <DataTable className="mb-4">
        <thead className="bg-surface-container-low">
          <tr>
            <Th>Certificate</Th>
            <Th>Status</Th>
            <Th>Issued</Th>
            <Th>Expires</Th>
            <Th>Document</Th>
            {canMutate ? <Th align="right"></Th> : null}
          </tr>
        </thead>
        <tbody>
          {certs.map((c) => (
            <tr key={c.id} className="hover:bg-surface-container-low transition-colors">
              <Td>
                <div className="text-on-surface">{c.certificateName}</div>
                <code className="font-data-mono text-label text-on-surface-variant">
                  {c.certificateCode}
                </code>
              </Td>
              <Td>
                <CertificateStatusBadge value={c.status} />
              </Td>
              <Td mono>{fmtDate(c.issuedAt)}</Td>
              <Td mono>{fmtDate(c.expiresAt)}</Td>
              <Td className="text-on-surface-variant">{c.documentPath ?? "—"}</Td>
              {canMutate ? (
                <Td align="right">
                  <div className="flex justify-end gap-2">
                    {c.status !== "revoked" ? (
                      <>
                        <form action={renewAction} className="inline">
                          <input type="hidden" name="userCertificateId" value={c.id} />
                          <input
                            type="hidden"
                            name="warehouseUserId"
                            value={warehouseUserId}
                          />
                          <button
                            type="submit"
                            disabled={renewPending}
                            className="font-label text-label text-primary hover:underline"
                          >
                            {renewPending ? "…" : "Renew"}
                          </button>
                        </form>
                        <form action={revokeAction} className="inline">
                          <input type="hidden" name="userCertificateId" value={c.id} />
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
                      </>
                    ) : null}
                  </div>
                </Td>
              ) : null}
            </tr>
          ))}
          {certs.length === 0 ? (
            <EmptyRow colSpan={canMutate ? 6 : 5}>No certificates issued.</EmptyRow>
          ) : null}
        </tbody>
      </DataTable>

      {(renewState.error || revokeState.error) ? (
        <p className="font-body-sm text-body-sm text-status-danger mb-3">
          {renewState.error ?? revokeState.error}
        </p>
      ) : null}

      {canMutate ? (
        <Card padding="p-4">
          <h4 className="font-title text-title text-on-surface mb-3 inline-flex items-center gap-2">
            <Icon name="add_circle" size={18} /> Issue certificate
          </h4>
          <form action={issueAction} className="space-y-3">
            <fieldset disabled={issuePending} className="space-y-3">
              <input
                type="hidden"
                name="warehouseUserId"
                value={warehouseUserId}
              />
              <Field label="Certificate" required>
                <Select name="certificateId" required defaultValue="">
                  <option value="" disabled>— Select —</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                      {c.validityDays ? ` (${c.validityDays}d)` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Issued at">
                  <TextInput
                    name="issuedAt"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                  />
                </Field>
                <Field label="Override expires (optional)">
                  <TextInput name="expiresAt" type="date" />
                </Field>
                <Field label="Document path">
                  <TextInput name="documentPath" placeholder="e.g. /certs/forklift-2025.pdf" />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-3">
                {issueState.error ? (
                  <span className="font-label text-label text-status-danger">
                    {issueState.error}
                  </span>
                ) : null}
                <Button type="submit">{issuePending ? "Issuing…" : "Issue certificate"}</Button>
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
