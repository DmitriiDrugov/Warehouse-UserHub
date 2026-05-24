"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/operator";
import { dbAdmin } from "@/lib/db/client";
import { workerDocuments } from "@/lib/db/schema";
import {
  uploadWorkerDocument,
  deleteWorkerDocument,
  getWorkerDocumentSignedUrl,
} from "@/lib/storage/worker-documents";
import { DOCUMENT_TYPES } from "@/lib/validation/enums";
import { z } from "zod";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const UploadSchema = z.object({
  workerId: z.string().uuid(),
  documentType: z.enum(DOCUMENT_TYPES),
});

export async function uploadWorkerDocumentAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);

  const parsed = UploadSchema.safeParse({
    workerId: formData.get("workerId"),
    documentType: formData.get("documentType"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No file provided." };
  if (file.size > MAX_FILE_SIZE) return { ok: false, error: "File too large (max 10 MB)." };

  const { workerId, documentType } = parsed.data;
  const buffer = Buffer.from(await file.arrayBuffer());

  let storagePath: string;
  try {
    storagePath = await uploadWorkerDocument({
      scope: "workers",
      scopeId: workerId,
      documentType,
      fileName: file.name,
      buffer,
      mimeType: file.type,
    });
  } catch (err) {
    return { ok: false, error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  await dbAdmin.insert(workerDocuments).values({
    workerId,
    proposalId: null,
    documentType,
    fileName: file.name,
    storagePath,
    fileSizeBytes: file.size,
    mimeType: file.type,
    uploadedBy: operator.id,
  });

  revalidatePath(`/warehouse-users/${workerId}`);
  return { ok: true };
}

export async function deleteWorkerDocumentAction(
  documentId: string,
  workerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOperator(["hr", "warehouse_admin"]);

  const [doc] = await dbAdmin
    .select({ id: workerDocuments.id, storagePath: workerDocuments.storagePath })
    .from(workerDocuments)
    .where(eq(workerDocuments.id, documentId))
    .limit(1);

  if (!doc) return { ok: false, error: "Document not found." };

  try {
    await deleteWorkerDocument(doc.storagePath);
  } catch {
    // Storage delete failure is logged but doesn't block DB cleanup
  }

  await dbAdmin.delete(workerDocuments).where(eq(workerDocuments.id, documentId));

  revalidatePath(`/warehouse-users/${workerId}`);
  return { ok: true };
}

export async function getDocumentSignedUrlAction(
  documentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireOperator();

  const [doc] = await dbAdmin
    .select({ storagePath: workerDocuments.storagePath })
    .from(workerDocuments)
    .where(eq(workerDocuments.id, documentId))
    .limit(1);

  if (!doc) return { ok: false, error: "Document not found." };

  try {
    const url = await getWorkerDocumentSignedUrl(doc.storagePath);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: `Could not generate download link: ${err instanceof Error ? err.message : String(err)}` };
  }
}
