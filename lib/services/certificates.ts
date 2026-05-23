/**
 * Certificate services. Issues, renews, and revokes `user_certificates`,
 * always writing audit. Computes `expires_at` from `certificates.validity_days`
 * (or accepts an explicit override for non-standard certificates).
 *
 * Supabase Storage upload is handled separately by the calling Server
 * Action; this service only persists the resulting `document_path`.
 */

import { eq } from "drizzle-orm";

import type { DbTx } from "../db/client";
import {
  certificates,
  userCertificates,
  type Certificate,
  type UserCertificate,
} from "../db/schema";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError } from "./errors";
import type { ServiceContext } from "./context";

export type IssueCertificateInput = {
  warehouseUserId: string;
  certificateId: string;
  issuedAt?: Date;
  expiresAt?: Date | null;
  documentPath?: string | null;
};

async function loadCertificate(tx: DbTx, id: string): Promise<Certificate> {
  const [row] = await tx
    .select()
    .from(certificates)
    .where(eq(certificates.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("certificate", id);
  return row;
}

function computeExpiresAt(cat: Certificate, issuedAt: Date): Date | null {
  if (cat.validityDays === null || cat.validityDays === undefined) return null;
  const out = new Date(issuedAt);
  out.setDate(out.getDate() + cat.validityDays);
  return out;
}

export async function issueCertificate(
  tx: DbTx,
  input: IssueCertificateInput,
  ctx: ServiceContext,
): Promise<UserCertificate> {
  const cat = await loadCertificate(tx, input.certificateId);
  const issuedAt = input.issuedAt ?? new Date();
  const expiresAt =
    input.expiresAt !== undefined ? input.expiresAt : computeExpiresAt(cat, issuedAt);

  const [created] = await tx
    .insert(userCertificates)
    .values({
      warehouseUserId: input.warehouseUserId,
      certificateId: input.certificateId,
      issuedAt,
      expiresAt,
      status: "valid",
      documentPath: input.documentPath ?? null,
    })
    .returning();
  if (!created) throw new Error("insert returned no row");

  await writeAudit(tx, ctx, {
    entityType: "user_certificate",
    entityId: created.id,
    action: "certificate.issued",
    after: created,
  });

  return created;
}

export async function renewCertificate(
  tx: DbTx,
  userCertificateId: string,
  ctx: ServiceContext,
  options?: { issuedAt?: Date; documentPath?: string | null },
): Promise<UserCertificate> {
  const [before] = await tx
    .select()
    .from(userCertificates)
    .where(eq(userCertificates.id, userCertificateId))
    .limit(1);
  if (!before) throw new NotFoundError("user_certificate", userCertificateId);

  const cat = await loadCertificate(tx, before.certificateId);
  const issuedAt = options?.issuedAt ?? new Date();
  const expiresAt = computeExpiresAt(cat, issuedAt);

  const [updated] = await tx
    .update(userCertificates)
    .set({
      issuedAt,
      expiresAt,
      status: "valid",
      documentPath:
        options?.documentPath !== undefined
          ? options.documentPath
          : before.documentPath,
    })
    .where(eq(userCertificates.id, userCertificateId))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(tx, ctx, {
    entityType: "user_certificate",
    entityId: updated.id,
    action: "certificate.renewed",
    before,
    after: updated,
  });

  return updated;
}

export async function revokeCertificate(
  tx: DbTx,
  userCertificateId: string,
  ctx: ServiceContext,
): Promise<UserCertificate> {
  const [before] = await tx
    .select()
    .from(userCertificates)
    .where(eq(userCertificates.id, userCertificateId))
    .limit(1);
  if (!before) throw new NotFoundError("user_certificate", userCertificateId);
  if (before.status === "revoked") {
    throw new ConflictError("certificate is already revoked");
  }

  const [updated] = await tx
    .update(userCertificates)
    .set({ status: "revoked" })
    .where(eq(userCertificates.id, userCertificateId))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(tx, ctx, {
    entityType: "user_certificate",
    entityId: updated.id,
    action: "certificate.revoked",
    before,
    after: updated,
  });

  return updated;
}

export async function markCertificateExpired(
  tx: DbTx,
  userCertificateId: string,
  ctx: ServiceContext,
): Promise<UserCertificate> {
  const [before] = await tx
    .select()
    .from(userCertificates)
    .where(eq(userCertificates.id, userCertificateId))
    .limit(1);
  if (!before) throw new NotFoundError("user_certificate", userCertificateId);
  if (before.status !== "valid") return before;

  const [updated] = await tx
    .update(userCertificates)
    .set({ status: "expired" })
    .where(eq(userCertificates.id, userCertificateId))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(tx, ctx, {
    entityType: "user_certificate",
    entityId: updated.id,
    action: "certificate.expired",
    before,
    after: updated,
  });

  return updated;
}
