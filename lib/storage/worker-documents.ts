/**
 * Supabase Storage helpers for worker documents.
 *
 * Bucket: "worker-documents" (private, authenticated access only)
 * Path convention:
 *   proposals/{proposalId}/{documentType}/{fileName}   — staged, pending worker creation
 *   workers/{workerId}/{documentType}/{fileName}        — manual upload on profile
 */

import { basename } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "../env";
import { type DocumentType } from "../validation/enums";

const BUCKET = "worker-documents";

let _storageClient: SupabaseClient | undefined;
function getStorageClient(): SupabaseClient {
  if (_storageClient) return _storageClient;
  const env = serverEnv();
  _storageClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return _storageClient;
}

export type UploadScope = "proposals" | "workers";

export type UploadInput = {
  scope: UploadScope;
  scopeId: string; // proposalId or workerId
  documentType: DocumentType;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
};

/** Upload a file and return its storage path. */
export async function uploadWorkerDocument(input: UploadInput): Promise<string> {
  const safeName = basename(input.fileName);
  const storagePath = `${input.scope}/${input.scopeId}/${input.documentType}/${safeName}`;
  const { error } = await getStorageClient()
    .storage
    .from(BUCKET)
    .upload(storagePath, input.buffer, {
      contentType: input.mimeType,
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

/** Delete one file from storage by its path. */
export async function deleteWorkerDocument(storagePath: string): Promise<void> {
  const { error } = await getStorageClient().storage.from(BUCKET).remove([storagePath]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

/** Create a 1-hour signed URL for viewing/downloading. */
export async function getWorkerDocumentSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await getStorageClient()
    .storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(`Signed URL failed: ${error?.message ?? "no data"}`);
  }
  return data.signedUrl;
}
