import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mocks (hoisted by Vitest before imports) ──────────────────────────────────

vi.mock("@/lib/db/client", () => {
  const mockOrderBy = vi.fn().mockReturnValue([]);
  const mockFrom = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return {
    dbAdmin: {},
    dbReadonly: { select: mockSelect },
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, asc: (field: unknown) => field };
});

vi.mock("@/lib/llm", () => ({ getLLM: () => ({}) }));

// Preserve loadProvisioningContext but avoid real DB calls (dbReadonly is mocked above)
vi.mock("@/lib/ai/provisioning", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/ai/provisioning")>();
  return { ...mod };
});

vi.mock("@/lib/env", () => ({
  // intentionally fake — never use real credentials in tests
  serverEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    LLM_PROVIDER: "anthropic",
    LLM_API_KEY: "test-api-key",
    LLM_MODEL: "claude-sonnet-4-6",
    LLM_BASE_URL: undefined,
    DATABASE_URL: "postgresql://x",
    DATABASE_URL_READONLY: "postgresql://y",
    CRON_SECRET: "cron-secret-16chars",
    OAUTH_PROVIDERS: [],
    NL_SQL_STATEMENT_TIMEOUT_MS: 5000,
    NL_SQL_MAX_ROWS: 200,
    ANOMALY_DORMANT_DAYS: 90,
    OFFBOARDING_SLA_HOURS: 24,
    PROPOSAL_EXPIRY_DAYS: 30,
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── subject ───────────────────────────────────────────────────────────────────

import { extractWorkerDataFromDocument } from "@/lib/ai/parse-document";

// ── helpers ───────────────────────────────────────────────────────────────────

const VALID_WORKER = {
  employeeId: "B-999",
  fullName: "Test User",
  warehouseCode: "WH-A",
  roleCode: "picker",
  hireDate: "2026-05-24",
};

function mockSuccess(json: object | string) {
  const text = typeof json === "string" ? json : JSON.stringify(json);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ content: [{ type: "text", text }] }),
  } as unknown as Response);
}

beforeEach(() => vi.clearAllMocks());

// ── tests ─────────────────────────────────────────────────────────────────────

describe("extractWorkerDataFromDocument", () => {
  it("throws for unsupported MIME types", async () => {
    await expect(
      extractWorkerDataFromDocument(Buffer.from("x"), "text/csv", "claude-sonnet-4-6"),
    ).rejects.toThrow("Unsupported document MIME type");
  });

  it("calls Anthropic API with 'document' content block for PDF", async () => {
    mockSuccess(VALID_WORKER);
    const buf = Buffer.from("%PDF-test");

    await extractWorkerDataFromDocument(buf, "application/pdf", "claude-sonnet-4-6");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("anthropic.com"),
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content[0].type).toBe("document");
    expect(body.headers?.["anthropic-beta"] ?? body["anthropic-beta"]);
    // beta header is in the fetch options.headers, not body
  });

  it("returns parsed worker data from PDF response", async () => {
    mockSuccess(VALID_WORKER);

    const result = await extractWorkerDataFromDocument(
      Buffer.from("%PDF-test"),
      "application/pdf",
      "claude-sonnet-4-6",
    );

    expect(result.employeeId).toBe("B-999");
    expect(result.fullName).toBe("Test User");
    expect(result.warehouseCode).toBe("WH-A");
    expect(result.roleCode).toBe("picker");
  });

  it("calls Anthropic API with 'image' content block for JPEG", async () => {
    mockSuccess(VALID_WORKER);

    await extractWorkerDataFromDocument(
      Buffer.from("fake-jpeg"),
      "image/jpeg",
      "claude-sonnet-4-6",
    );

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content[0].type).toBe("image");
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    const wrapped = `Here is the extracted data:\n\`\`\`json\n${JSON.stringify(VALID_WORKER)}\n\`\`\``;
    mockSuccess(wrapped);

    const result = await extractWorkerDataFromDocument(
      Buffer.from("%PDF-test"),
      "application/pdf",
      "claude-sonnet-4-6",
    );

    expect(result.employeeId).toBe("B-999");
  });

  it("throws when Anthropic API returns non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as unknown as Response);

    await expect(
      extractWorkerDataFromDocument(Buffer.from("x"), "application/pdf", "model"),
    ).rejects.toThrow("Anthropic API error 401");
  });
});
