import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    NL_SQL_STATEMENT_TIMEOUT_MS: 5000,
    NL_SQL_MAX_ROWS: 100,
  }),
}));

vi.mock("@/lib/llm", () => ({
  getLLM: () => ({ complete: mocks.complete }),
}));

vi.mock("@/lib/db/client", () => ({
  dbAdmin: {},
  dbReadonly: {
    transaction: mocks.transaction,
  },
}));

import { runNlQuery } from "@/lib/ai/nl-sql";

beforeEach(() => {
  mocks.complete.mockReset();
  mocks.execute.mockReset();
  mocks.transaction.mockReset();
  mocks.transaction.mockImplementation(async (fn: (tx: { execute: typeof mocks.execute }) => Promise<unknown>) =>
    await fn({ execute: mocks.execute }),
  );
});

describe("runNlQuery follow-up context", () => {
  it("passes conversation context and model override into the SQL LLM prompt", async () => {
    mocks.complete.mockResolvedValueOnce(
      `SELECT wu.employee_id, wu.full_name, wu.warehouse_code
FROM v_warehouse_users wu
JOIN v_user_certificates c ON c.warehouse_user_id = wu.warehouse_user_id
WHERE wu.warehouse_name ILIKE '%Berlin%'
  AND c.certificate_code = 'first_aid'
  AND c.status = 'valid'
  AND c.is_expired = false
LIMIT 50`,
    );
    mocks.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          employee_id: "EMP-001",
          full_name: "Alex Morgan",
          warehouse_code: "WH-A",
        },
      ]);

    const context = [
      "User: Show me how many workers in berlin warehouse?",
      "",
      "Assistant [query result, 1 rows]:",
      "SQL: SELECT COUNT(*) AS berlin_warehouse_workers FROM v_warehouse_users WHERE warehouse_name ILIKE '%Berlin%' LIMIT 100",
      "berlin_warehouse_workers",
      "37",
    ].join("\n");

    const result = await runNlQuery(
      "How many of them have first aid certificate, and show me who",
      {
        context,
        model: "anthropic/claude-sonnet-4.6",
      },
    );

    expect(result.rows).toEqual([
      {
        employee_id: "EMP-001",
        full_name: "Alex Morgan",
        warehouse_code: "WH-A",
      },
    ]);
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ model: "anthropic/claude-sonnet-4.6" }),
    );

    const messages = mocks.complete.mock.calls[0]![0] as Array<{
      role: string;
      content: string;
    }>;
    const systemContent = messages.find((message) => message.role === "system")!.content;
    const userContent = messages.find((message) => message.role === "user")!.content;

    expect(systemContent).toContain("show/list/who");
    expect(systemContent).toContain("not a single aggregate-only COUNT row");
    expect(userContent).toContain("Conversation context for follow-up resolution");
    expect(userContent).toContain("berlin_warehouse_workers");
    expect(userContent).toContain("warehouse_name ILIKE '%Berlin%'");
    expect(userContent).toContain(
      "Question: How many of them have first aid certificate, and show me who",
    );
  });
});
