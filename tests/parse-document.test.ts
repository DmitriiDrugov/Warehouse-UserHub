import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mocks (hoisted by Vitest before imports) ──────────────────────────────────

vi.mock("@/lib/db/client", () => {
  const mockOrderBy = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();

  mockOrderBy.mockReturnValue([]);
  mockFrom.mockReturnValue({ orderBy: mockOrderBy });
  mockSelect.mockReturnValue({ from: mockFrom });

  return {
    dbAdmin: {},
    dbReadonly: {
      select: mockSelect,
    },
  };
});

// Mock drizzle-orm — partial mock to let the schema load
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    asc: (field: unknown) => field,
  };
});

vi.mock("@/lib/llm", () => ({ getLLM: () => ({}) }));

// Mock the provisioning context loader
vi.mock("@/lib/ai/provisioning", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/ai/provisioning")>();
  return {
    ...mod,
    buildSystemPrompt: mod.buildSystemPrompt,
  };
});

vi.mock("@/lib/env", () => ({
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("extractWorkerDataFromDocument", () => {
  it("throws for unsupported MIME types", async () => {
    const buf = Buffer.from("not-a-real-file");
    await expect(
      extractWorkerDataFromDocument(buf, "text/csv", "claude-sonnet-4-6"),
    ).rejects.toThrow("Unsupported document MIME type");
  });

  it("calls Anthropic API with base64 content for PDF", async () => {
    const fakeJson = JSON.stringify({
      employeeId: "B-999",
      fullName: "Test User",
      warehouseCode: "WH-A",
      roleCode: "picker",
      hireDate: "2026-05-24",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: fakeJson }] }),
    } as unknown as Response);

    const buf = Buffer.from("%PDF-test");
    const result = await extractWorkerDataFromDocument(buf, "application/pdf", "claude-sonnet-4-6");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("anthropic.com"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.employeeId).toBe("B-999");
    expect(result.fullName).toBe("Test User");
  });
});
