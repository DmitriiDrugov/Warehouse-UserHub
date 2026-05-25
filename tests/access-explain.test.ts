import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  dbAdmin: {},
  dbReadonly: {},
  withOperator: vi.fn(),
}));

const mockCompleteJSON = vi.fn();
vi.mock("@/lib/llm", () => ({
  getLLM: () => ({ completeJSON: mockCompleteJSON }),
}));

import {
  buildAccessExplanation,
  parseAccessQuestion,
  parseAccessQuestionIntent,
} from "@/lib/ai/access-explain";

describe("access explanation helpers", () => {
  beforeEach(() => {
    mockCompleteJSON.mockReset();
  });

  it("parses Russian no-access questions with a worker name", () => {
    const question = "\u041f\u043e\u0447\u0435\u043c\u0443 \u0443 Alina Lange \u043d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430?";
    const parsed = parseAccessQuestion(question);

    expect(parsed.workerName).toBe("Alina Lange");
    expect(parsed.target).toBeNull();
    expect(parsed.kind).toBe("why_missing");
  });

  it("parses targeted English WMS access questions", () => {
    const parsed = parseAccessQuestion("Why does Alina Lange not have WMS access?");

    expect(parsed.workerName).toBe("Alina Lange");
    expect(parsed.target?.label).toBe("WMS access");
    expect(parsed.kind).toBe("status");
  });

  it("uses the LLM extractor for flexible diagnostic wording", async () => {
    mockCompleteJSON.mockResolvedValueOnce({
      kind: "blockers",
      workerName: "EMP-022",
      target: {
        systemCode: "wms",
        permissionCode: "dispatch_order",
        label: null,
      },
    });

    const parsed = await parseAccessQuestionIntent(
      "\u0427\u0442\u043e \u043c\u0435\u0448\u0430\u0435\u0442 EMP-022 \u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u0432 outbound WMS?",
    );

    expect(parsed.workerName).toBe("EMP-022");
    expect(parsed.kind).toBe("blockers");
    expect(parsed.target?.label).toBe("WMS dispatch access");
  });

  it("falls back for direct blocker questions without the LLM", () => {
    const parsed = parseAccessQuestion("What blocks EMP-022 from WMS dispatch?");

    expect(parsed.workerName).toBe("EMP-022");
    expect(parsed.kind).toBe("blockers");
    expect(parsed.target?.label).toBe("WMS dispatch access");
  });

  it("explains missing grants using role template and certificate evidence", () => {
    const result = buildAccessExplanation({
      question: "\u041a\u0430\u043a\u0438\u0445 \u0434\u043e\u0441\u0442\u0443\u043f\u043e\u0432 \u043d\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 Alina Lange?",
      kind: "missing",
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

    expect(result.summary).toBe("Alina Lange is missing 2 role-template grants for warehouse system access.");
    expect(result.reasons.join("\n")).toContain("requires certificate forklift");
    expect(result.reasons.join("\n")).toContain("Missing role-template grants: wms.view_only, badge.entry");
  });
});
