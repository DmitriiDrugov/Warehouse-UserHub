"use client";

import { useRef, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/validation/enums";
import {
  uploadWorkerDocumentAction,
  deleteWorkerDocumentAction,
  getDocumentSignedUrlAction,
} from "./document-actions";

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  contract: "Employment Contract",
  passport: "Passport / ID",
  work_permit: "Work Permit",
  forklift_certificate: "Forklift Certificate",
  health_clearance: "Health Clearance",
  other: "Other",
};

const DOCUMENT_ICONS: Record<DocumentType, string> = {
  contract: "description",
  passport: "badge",
  work_permit: "approval",
  forklift_certificate: "construction",
  health_clearance: "health_and_safety",
  other: "attach_file",
};

export type DocumentRow = {
  id: string;
  documentType: string;
  fileName: string;
  fileSizeBytes: number | null;
  createdAt: Date;
};

export function DocumentsSection({
  workerId,
  canMutate,
  documents,
}: {
  workerId: string;
  canMutate: boolean;
  documents: DocumentRow[];
}) {
  return (
    <div className="mb-6">
      <div className="border border-border-subtle rounded-lg overflow-hidden bg-surface-container-lowest">
        <div className="px-5 py-4 border-b border-border-subtle">
          <h2 className="font-title text-title text-on-surface">Documents</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
            Required document package for this worker.
          </p>
        </div>
        <div className="divide-y divide-border-subtle">
          {DOCUMENT_TYPES.map((docType) => {
            const uploaded = documents.filter((d) => d.documentType === docType);
            return (
              <DocumentTypeRow
                key={docType}
                workerId={workerId}
                docType={docType}
                uploaded={uploaded}
                canMutate={canMutate}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DocumentTypeRow({
  workerId,
  docType,
  uploaded,
  canMutate,
}: {
  workerId: string;
  docType: DocumentType;
  uploaded: DocumentRow[];
  canMutate: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleUpload(file: File) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("workerId", workerId);
      fd.set("documentType", docType);
      fd.set("file", file);
      const result = await uploadWorkerDocumentAction(fd);
      if (!result.ok) alert(`Upload failed: ${result.error}`);
    });
  }

  function handleDelete(docId: string) {
    if (!confirm("Delete this document?")) return;
    startTransition(async () => {
      await deleteWorkerDocumentAction(docId, workerId);
    });
  }

  function handleDownload(docId: string) {
    startTransition(async () => {
      const result = await getDocumentSignedUrlAction(docId);
      if (result.ok) window.open(result.url, "_blank");
      else alert(`Download failed: ${result.error}`);
    });
  }

  const hasFiles = uploaded.length > 0;

  return (
    <div className="px-5 py-3.5 flex items-center gap-4">
      <div className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center shrink-0">
        <Icon name={DOCUMENT_ICONS[docType]} size={18} className="text-on-surface-variant" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-label text-label text-on-surface">{DOCUMENT_LABELS[docType]}</div>
        {hasFiles ? (
          <div className="font-label text-[11px] text-on-surface-variant mt-0.5">
            {uploaded[0]!.fileName}
            {uploaded[0]!.fileSizeBytes
              ? ` · ${(uploaded[0]!.fileSizeBytes / 1024).toFixed(0)} KB`
              : ""}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {hasFiles ? (
          <>
            <span className="flex items-center gap-1 text-status-success font-label text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
              Uploaded
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleDownload(uploaded[0]!.id)}
              title="Download"
              className="p-1.5 text-on-surface-variant hover:text-primary transition-colors rounded"
            >
              <Icon name="download" size={16} />
            </button>
            {canMutate && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDelete(uploaded[0]!.id)}
                title="Delete"
                className="p-1.5 text-on-surface-variant hover:text-status-danger transition-colors rounded"
              >
                <Icon name="delete" size={16} />
              </button>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1 text-on-surface-variant font-label text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-outline" />
            Missing
          </span>
        )}
        {canMutate && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={isPending}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 rounded border border-border-subtle font-label text-label text-on-surface-variant hover:bg-surface-container-low transition-colors text-[12px]"
            >
              <Icon name="upload" size={14} />
              {hasFiles ? "Replace" : "Upload"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
