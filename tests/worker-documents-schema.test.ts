import { describe, expect, it } from "vitest";
import { DOCUMENT_TYPES } from "@/lib/validation/enums";
import { workerDocuments } from "@/lib/db/schema";

describe("DOCUMENT_TYPES", () => {
  it("has 6 entries", () => {
    expect(DOCUMENT_TYPES).toHaveLength(6);
  });

  it("includes required types", () => {
    expect(DOCUMENT_TYPES).toContain("contract");
    expect(DOCUMENT_TYPES).toContain("passport");
    expect(DOCUMENT_TYPES).toContain("work_permit");
  });
});

describe("workerDocuments table", () => {
  it("is exported from schema", () => {
    expect(workerDocuments).toBeDefined();
  });

  it("has expected columns", () => {
    const cols = Object.keys(workerDocuments);
    expect(cols).toContain("workerId");
    expect(cols).toContain("proposalId");
    expect(cols).toContain("documentType");
    expect(cols).toContain("storagePath");
  });
});
