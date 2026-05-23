import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { CertificateStatusBadge } from "@/components/ui/status-badge";
import { DataTable, EmptyRow, Td, Th } from "@/components/ui/table";
import { requireOperator } from "@/lib/auth/operator";
import { withOperator } from "@/lib/db/client";
import {
  certificates,
  userCertificates,
  warehouseUsers,
  warehouses,
} from "@/lib/db/schema";
import { CERTIFICATE_STATUSES } from "@/lib/validation/enums";

export const metadata = { title: "Certificates — UserHub" };

type SearchParams = { status?: string; warehouse?: string };

export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const operator = await requireOperator();
  const params = await searchParams;

  const { rows, whs } = await withOperator(operator.id, async (tx) => {
    const whs = await tx.select().from(warehouses).orderBy(warehouses.code);
    const conds = [] as Array<ReturnType<typeof eq>>;
    if (
      params.status &&
      (CERTIFICATE_STATUSES as readonly string[]).includes(params.status)
    ) {
      conds.push(
        eq(
          userCertificates.status,
          params.status as (typeof CERTIFICATE_STATUSES)[number],
        ),
      );
    }
    if (params.warehouse) {
      conds.push(eq(warehouseUsers.warehouseId, params.warehouse));
    }

    const rows = await tx
      .select({
        id: userCertificates.id,
        warehouseUserId: warehouseUsers.id,
        employeeId: warehouseUsers.employeeId,
        fullName: warehouseUsers.fullName,
        warehouseCode: warehouses.code,
        certCode: certificates.code,
        certName: certificates.name,
        status: userCertificates.status,
        issuedAt: userCertificates.issuedAt,
        expiresAt: userCertificates.expiresAt,
      })
      .from(userCertificates)
      .innerJoin(certificates, eq(certificates.id, userCertificates.certificateId))
      .innerJoin(warehouseUsers, eq(warehouseUsers.id, userCertificates.warehouseUserId))
      .innerJoin(warehouses, eq(warehouses.id, warehouseUsers.warehouseId))
      .where(conds.length ? and(...conds) : sql`true`)
      .orderBy(asc(userCertificates.expiresAt))
      .limit(500);
    return { rows, whs };
  });

  return (
    <>
      <PageHeader
        title="Certificates"
        subtitle="Training and compliance records across the workforce."
      />

      <Card className="mb-4" padding="p-4">
        <form method="get" className="flex flex-wrap gap-3 items-end">
          <Field label="Status" className="min-w-[10rem]">
            <Select name="status" defaultValue={params.status ?? ""}>
              <option value="">— Any —</option>
              {CERTIFICATE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Warehouse" className="min-w-[12rem]">
            <Select name="warehouse" defaultValue={params.warehouse ?? ""}>
              <option value="">— Any —</option>
              {whs.map((w) => (
                <option key={w.id} value={w.id}>{w.code}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
      </Card>

      <p className="font-label text-label text-on-surface-variant mb-2">
        Showing {rows.length.toLocaleString()} certificate(s)
      </p>

      <DataTable>
        <thead className="bg-surface-container-low">
          <tr>
            <Th>Worker</Th>
            <Th>Warehouse</Th>
            <Th>Certificate</Th>
            <Th>Status</Th>
            <Th>Issued</Th>
            <Th>Expires</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-container-low transition-colors">
              <Td>
                <Link
                  href={`/warehouse-users/${r.warehouseUserId}`}
                  className="text-primary hover:underline font-medium"
                >
                  {r.fullName}
                </Link>
                <div className="font-data-mono text-label text-on-surface-variant">
                  {r.employeeId}
                </div>
              </Td>
              <Td>{r.warehouseCode}</Td>
              <Td>
                <div className="text-on-surface">{r.certName}</div>
                <code className="font-data-mono text-label text-on-surface-variant">
                  {r.certCode}
                </code>
              </Td>
              <Td><CertificateStatusBadge value={r.status} /></Td>
              <Td mono>{new Date(r.issuedAt).toISOString().slice(0, 10)}</Td>
              <Td mono>
                {r.expiresAt
                  ? new Date(r.expiresAt).toISOString().slice(0, 10)
                  : "—"}
              </Td>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={6} /> : null}
        </tbody>
      </DataTable>
    </>
  );
}
