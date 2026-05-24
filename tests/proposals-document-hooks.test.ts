import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mocks ─────────────────────────────────────────────────────────────────────

// vi.mock is hoisted — cannot reference variables declared above it in the factory.
// Use vi.fn() inline and retrieve the reference after import.
vi.mock("@/lib/storage/worker-documents", () => ({
  deleteWorkerDocument: vi.fn().mockResolvedValue(undefined),
}));

// Minimal Drizzle-style transaction mock factory
function makeTx(opts: { selectRows?: Array<{ storagePath: string }> } = {}) {
  const { selectRows = [] } = opts;

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockDeleteWhere = vi.fn().mockResolvedValue([]);
  const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  const mockSelectWhere = vi.fn().mockResolvedValue(selectRows);
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  const tx = { update: mockUpdate, delete: mockDelete, select: mockSelect };
  return { tx, mockUpdate, mockUpdateSet, mockUpdateWhere, mockDelete, mockDeleteWhere };
}

// ── subject ───────────────────────────────────────────────────────────────────

import { linkStagedDocuments, deleteStagedDocuments } from "@/lib/services/proposals";
import { deleteWorkerDocument } from "@/lib/storage/worker-documents";

// Typed reference to the mock for assertions
const mockDeleteStorageFile = deleteWorkerDocument as ReturnType<typeof vi.fn>;

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

describe("linkStagedDocuments", () => {
  it("is exported from proposals service", () => {
    expect(typeof linkStagedDocuments).toBe("function");
  });

  it("updates workerDocuments setting workerId AND clearing proposalId", async () => {
    const { tx, mockUpdate, mockUpdateSet, mockUpdateWhere } = makeTx();

    await linkStagedDocuments(tx as never, "proposal-abc", "worker-xyz");

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({
      workerId: "worker-xyz",
      proposalId: null,
    });
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
  });
});

describe("deleteStagedDocuments", () => {
  it("is exported from proposals service", () => {
    expect(typeof deleteStagedDocuments).toBe("function");
  });

  it("returns early without DB delete when no staged documents exist", async () => {
    const { tx, mockDelete } = makeTx({ selectRows: [] });

    await deleteStagedDocuments(tx as never, "proposal-empty");

    expect(mockDeleteStorageFile).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes storage files and DB rows when staged documents exist", async () => {
    const { tx, mockDelete } = makeTx({
      selectRows: [
        { storagePath: "proposals/proposal-abc/contract/file.pdf" },
        { storagePath: "proposals/proposal-abc/passport/scan.jpg" },
      ],
    });

    await deleteStagedDocuments(tx as never, "proposal-abc");

    expect(mockDeleteStorageFile).toHaveBeenCalledTimes(2);
    expect(mockDeleteStorageFile).toHaveBeenCalledWith("proposals/proposal-abc/contract/file.pdf");
    expect(mockDeleteStorageFile).toHaveBeenCalledWith("proposals/proposal-abc/passport/scan.jpg");
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("still deletes DB rows even when a storage deletion fails", async () => {
    const { tx, mockDelete } = makeTx({
      selectRows: [{ storagePath: "proposals/proposal-fail/contract/file.pdf" }],
    });
    mockDeleteStorageFile.mockRejectedValueOnce(new Error("storage error"));

    // Should not throw — storage deletion is best-effort
    await expect(deleteStagedDocuments(tx as never, "proposal-fail")).resolves.toBeUndefined();
    // DB delete still proceeds
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
