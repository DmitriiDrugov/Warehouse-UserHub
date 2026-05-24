import { describe, expect, it, vi } from "vitest";

// Mock DB and storage
const mockUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
const mockDelete = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
const mockSelect = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });

vi.mock("@/lib/storage/worker-documents", () => ({
  deleteWorkerDocument: vi.fn().mockResolvedValue(undefined),
}));

import { linkStagedDocuments, deleteStagedDocuments } from "@/lib/services/proposals";
import { deleteWorkerDocument } from "@/lib/storage/worker-documents";

describe("linkStagedDocuments", () => {
  it("is exported from proposals service", () => {
    expect(typeof linkStagedDocuments).toBe("function");
  });
});

describe("deleteStagedDocuments", () => {
  it("is exported from proposals service", () => {
    expect(typeof deleteStagedDocuments).toBe("function");
  });
});
