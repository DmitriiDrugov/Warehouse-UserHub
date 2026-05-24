/**
 * Supabase Storage helpers for worker documents.
 *
 * Bucket: "worker-documents" (private, authenticated access only)
 * Path convention:
 *   proposals/{proposalId}/{documentType}/{fileName}   — staged, pending worker creation
 *   workers/{workerId}/{documentType}/{fileName}        — manual upload on profile
 */

import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "../env";

const BUCKET = "worker-documents";

function getStorageClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export type UploadScope = "proposals" | "workers";

export type UploadInput = {
  scope: UploadScope;
  scopeId: string; // proposalId or workerId
  documentType: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
};

/** Upload a file and return its storage path. */
export async function uploadWorkerDocument(input: UploadInput): Promise<string> {
  const path = `${input.scope}/${input.scopeId}/${input.documentType}/${input.fileName}`;
  const client = getStorageClient();
  const { error } = await client.storage
    .from(BUCKET)
    .upload(path, input.buffer, {
      contentType: input.mimeType,
      upsert: false,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

/** Delete one file from storage by its path. */
export async function deleteWorkerDocument(storagePath: string): Promise<void> {
  const client = getStorageClient();
  const { error } = await client.storage.from(BUCKET).remove([storagePath]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

/** Create a 1-hour signed URL for viewing/downloading. */
export async function getWorkerDocumentSignedUrl(storagePath: string): Promise<string> {
  const client = getStorageClient();
  const { data, error } = await client.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(`Signed URL failed: ${error?.message ?? "no data"}`);
  }
  return data.signedUrl;
}
