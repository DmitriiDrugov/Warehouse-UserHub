import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
  }),
}));

// Mock Supabase client
const mockUpload = vi.fn().mockResolvedValue({ data: { path: "test/path" }, error: null });
const mockRemove = vi.fn().mockResolvedValue({ error: null });
const mockCreateSignedUrl = vi.fn().mockResolvedValue({
  data: { signedUrl: "https://example.com/signed" },
  error: null,
});
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

import {
  uploadWorkerDocument,
  deleteWorkerDocument,
  getWorkerDocumentSignedUrl,
} from "@/lib/storage/worker-documents";

describe("uploadWorkerDocument", () => {
  it("calls supabase upload with correct path and returns path", async () => {
    const buf = Buffer.from("test");
    const path = await uploadWorkerDocument({
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
      expect.objectContaining({ contentType: "application/pdf", upsert: false }),
    );
    expect(path).toBe("proposals/proposal-123/contract/contract.pdf");
  });
});

describe("deleteWorkerDocument", () => {
  it("calls supabase remove with the path", async () => {
    await deleteWorkerDocument("proposals/proposal-123/contract/contract.pdf");
    expect(mockRemove).toHaveBeenCalledWith(["proposals/proposal-123/contract/contract.pdf"]);
  });
});

describe("getWorkerDocumentSignedUrl", () => {
  it("returns a signed URL", async () => {
    const url = await getWorkerDocumentSignedUrl("proposals/proposal-123/contract/contract.pdf");
    expect(url).toBe("https://example.com/signed");
  });
});
