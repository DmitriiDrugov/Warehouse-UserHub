import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mocks (hoisted by Vitest before imports) ──────────────────────────────────

vi.mock("@/lib/env", () => ({
  // intentionally fake — never use a real service role key in tests
  serverEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
  }),
}));

const mockUpload = vi.fn();
const mockRemove = vi.fn();
const mockCreateSignedUrl = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: mockUpload,
        remove: mockRemove,
        createSignedUrl: mockCreateSignedUrl,
      }),
    },
  }),
}));

// ── subject ───────────────────────────────────────────────────────────────────

import {
  deleteWorkerDocument,
  getWorkerDocumentSignedUrl,
  uploadWorkerDocument,
} from "@/lib/storage/worker-documents";

// ── helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("uploadWorkerDocument", () => {
  it("calls supabase upload with correct path and returns path", async () => {
    mockUpload.mockResolvedValue({ data: { path: "test/path" }, error: null });

    const buf = Buffer.from("test");
    const result = await uploadWorkerDocument({
      scope: "proposals",
      scopeId: "proposal-123",
      documentType: "contract",
      fileName: "contract.pdf",
      buffer: buf,
      mimeType: "application/pdf",
    });

    expect(mockUpload).toHaveBeenCalledWith(
      "proposals/proposal-123/contract/contract.pdf",
      buf,
      expect.objectContaining({ contentType: "application/pdf", upsert: true }),
    );
    expect(result).toBe("proposals/proposal-123/contract/contract.pdf");
  });

  it("sanitises path-traversal attempts in fileName", async () => {
    mockUpload.mockResolvedValue({ data: { path: "test/path" }, error: null });

    const result = await uploadWorkerDocument({
      scope: "proposals",
      scopeId: "proposal-123",
      documentType: "passport",
      fileName: "../../etc/passwd",
      buffer: Buffer.from("x"),
      mimeType: "text/plain",
    });

    // basename("../../etc/passwd") === "passwd"
    expect(result).toBe("proposals/proposal-123/passport/passwd");
    expect(mockUpload).toHaveBeenCalledWith(
      "proposals/proposal-123/passport/passwd",
      expect.any(Buffer),
      expect.any(Object),
    );
  });

  it("throws when supabase upload returns an error", async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: "bucket not found" } });

    await expect(
      uploadWorkerDocument({
        scope: "workers",
        scopeId: "worker-456",
        documentType: "contract",
        fileName: "doc.pdf",
        buffer: Buffer.from(""),
        mimeType: "application/pdf",
      }),
    ).rejects.toThrow("Storage upload failed: bucket not found");
  });
});

describe("deleteWorkerDocument", () => {
  it("calls supabase remove with the path in an array", async () => {
    mockRemove.mockResolvedValue({ error: null });

    await deleteWorkerDocument("proposals/proposal-123/contract/contract.pdf");

    expect(mockRemove).toHaveBeenCalledWith(["proposals/proposal-123/contract/contract.pdf"]);
  });

  it("throws when supabase remove returns an error", async () => {
    mockRemove.mockResolvedValue({ error: { message: "not found" } });

    await expect(
      deleteWorkerDocument("proposals/proposal-123/contract/contract.pdf"),
    ).rejects.toThrow("Storage delete failed: not found");
  });
});

describe("getWorkerDocumentSignedUrl", () => {
  it("returns a signed URL on success", async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://example.com/signed" },
      error: null,
    });

    const url = await getWorkerDocumentSignedUrl("proposals/proposal-123/contract/contract.pdf");
    expect(url).toBe("https://example.com/signed");
  });

  it("throws when supabase returns an error", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: "access denied" } });

    await expect(
      getWorkerDocumentSignedUrl("proposals/proposal-123/contract/contract.pdf"),
    ).rejects.toThrow("Signed URL failed: access denied");
  });

  it("throws when supabase returns null data without error", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: null });

    await expect(
      getWorkerDocumentSignedUrl("proposals/proposal-123/contract/contract.pdf"),
    ).rejects.toThrow("Signed URL failed: no data");
  });
});
