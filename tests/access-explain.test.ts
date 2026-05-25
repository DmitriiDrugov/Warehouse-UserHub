import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  dbAdmin: {},
  dbReadonly: {},
  withOperator: vi.fn(),
}));

import {
  buildAccessExplanation,
  parseAccessQuestion,
} from "@/lib/ai/access-explain";

describe("access explanation helpers", () => {
  it("parses Russian no-access questions with a worker name", () => {
    const parsed = parseAccessQuestion("Почему у Alina Lange нет доступа?");

    expect(parsed.workerName).toBe("Alina Lange");
    expect(parsed.target).toBeNull();
  });

  it("parses targeted English WMS access questions", () => {
    const parsed = parseAccessQuestion("Why does Alina Lange not have WMS access?");

    expect(parsed.workerName).toBe("Alina Lange");
    expect(parsed.target?.label).toBe("WMS access");
  });

  it("explains missing grants using role template and certificate evidence", () => {
    const result = buildAccessExplanation({
      question: "Почему у Alina Lange нет доступа?",
      target: null,
      worker: {
        id: "worker-1",
        employeeId: "EMP-022",
        fullName: "Alina Lange",
        status: "active",
        warehouseId: "warehouse-1",
        warehouseCode: "WH-A",
        warehouseName: "Berlin Distribution Center",
        roleId: "role-1",
        roleCode: "forklift_operator",
        roleName: "Forklift operator",
        terminationDate: null,
      },
      access: [],
      roleAccess: [
        {
          systemCode: "wms",
          systemName: "Warehouse Management System",
          permissionCode: "view_only",
          permissionName: "View-only WMS access",
        },
        {
          systemCode: "badge",
          systemName: "Physical badge / access control",
          permissionCode: "entry",
          permissionName: "Floor entry badge",
        },
      ],
      certs: [
        {
          id: "cert-1",
          certificateCode: "forklift",
          certificateName: "Forklift operator licence",
          status: "expired",
          expiresAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      ],
      findings: [],
      pendingProposals: [],
    });

    expect(result.summary).toBe("Alina Lange has no active warehouse system access.");
    expect(result.reasons.join("\n")).toContain("requires certificate forklift");
    expect(result.reasons.join("\n")).toContain("role template expects warehouse system access");
  });
});
