import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({
  value: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    DATABASE_URL: "postgres://admin",
    DATABASE_URL_READONLY: "postgres://readonly",
    LLM_PROVIDER: "openrouter" as "openrouter" | "anthropic",
    LLM_MODEL: "anthropic/claude-3-haiku",
    LLM_API_KEY: "test-key",
    LLM_BASE_URL: "https://openrouter.test/api/v1" as string | undefined,
    CRON_SECRET: "0123456789abcdef",
    OAUTH_PROVIDERS: [],
    NL_SQL_STATEMENT_TIMEOUT_MS: 5000,
    NL_SQL_MAX_ROWS: 200,
    ANOMALY_DORMANT_DAYS: 90,
    OFFBOARDING_SLA_HOURS: 24,
    PROPOSAL_EXPIRY_DAYS: 30,
  },
}));

vi.mock("@/lib/env", () => ({
  serverEnv: () => envState.value,
}));
vi.mock("@/lib/db/client", () => ({ dbAdmin: {}, dbReadonly: {} }));
vi.mock("@/lib/llm", () => ({ getLLM: () => ({}) }));
vi.mock("@/lib/services/proposals", () => ({ createProposal: vi.fn() }));

import {
  extractWorkerDataFromDocument,
  extractWorkerProvisioningFromDocument,
  isSupportedDocumentMime,
  type SupportedDocumentMime,
} from "@/lib/ai/parse-document";
import { type Intent, type ProvisioningContext } from "@/lib/ai/provisioning";

type OpenRouterBody = {
  model: string;
  messages: Array<{
    role: string;
    content: Array<{
      type: string;
      text?: string;
      file?: { filename: string; file_data: string };
      image_url?: { url: string };
    }>;
  }>;
  plugins?: Array<{ id: string; pdf: { engine: string } }>;
  response_format?: { type: string };
};

type AnthropicBody = {
  model: string;
  messages: Array<{
    role: string;
    content: Array<{
      type: string;
      source?: {
        type: string;
        media_type: string;
        data: string;
      };
      text?: string;
    }>;
  }>;
};

const ctx: ProvisioningContext = {
  warehouses: [{ code: "WH-B", name: "Budapest Hub", location: "Budapest" }],
  roles: [{ code: "picker", name: "Picker", description: "Entry-level picker" }],
};

const seedLikeCtx: ProvisioningContext = {
  warehouses: [
    { code: "WH-A", name: "Berlin Distribution Center", location: "Berlin, DE" },
    { code: "WH-B", name: "Munich Fulfilment", location: "München, DE" },
    { code: "WH-C", name: "Hamburg Port Hub", location: "Hamburg, DE" },
  ],
  roles: [
    {
      code: "forklift_operator",
      name: "Forklift operator",
      description: "Operates counterbalance forklifts on the floor",
    },
    { code: "picker", name: "Order picker", description: "Picks goods from racks" },
  ],
};

const intent: Intent = {
  employeeId: "EMP-1042",
  fullName: "Ada Lovelace",
  email: null,
  warehouseCode: "WH-B",
  roleCode: "picker",
  hireDate: "2026-05-24",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  envState.value = {
    ...envState.value,
    LLM_PROVIDER: "openrouter",
    LLM_MODEL: "anthropic/claude-3-haiku",
    LLM_BASE_URL: "https://openrouter.test/api/v1",
  };
});

describe("isSupportedDocumentMime", () => {
  it("accepts supported PDF and image types only", () => {
    expect(isSupportedDocumentMime("application/pdf")).toBe(true);
    expect(isSupportedDocumentMime("image/png")).toBe(true);
    expect(isSupportedDocumentMime("text/plain")).toBe(false);
  });
});

describe("extractWorkerDataFromDocument", () => {
  it("rejects unsupported document MIME types before calling an LLM", async () => {
    await expect(
      extractWorkerDataFromDocument({
        buffer: Buffer.from("txt"),
        mimeType: "text/plain",
        fileName: "notes.txt",
        ctx,
      }),
    ).rejects.toThrow("Unsupported document MIME type");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends PDFs to OpenRouter as base64 file content with the parser plugin", async () => {
    fetchMock.mockResolvedValue(okJsonResponse({
      choices: [{ message: { content: JSON.stringify(intent) } }],
    }));

    const result = await extractWorkerDataFromDocument({
      buffer: Buffer.from("pdf-bytes"),
      mimeType: "application/pdf",
      fileName: "contract.pdf",
      model: "anthropic/claude-3-haiku",
      notes: "Create proposal",
      ctx,
    });

    expect(result).toEqual(intent);
    const { url, body } = readFetchBody<OpenRouterBody>();
    expect(url).toBe("https://openrouter.test/api/v1/chat/completions");
    expect(body.model).toBe("anthropic/claude-3-haiku");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.plugins?.[0]).toEqual({
      id: "file-parser",
      pdf: { engine: "cloudflare-ai" },
    });
    const filePart = body.messages[0]!.content.find((part) => part.type === "file");
    expect(filePart?.file).toEqual({
      filename: "contract.pdf",
      file_data: "data:application/pdf;base64,cGRmLWJ5dGVz",
    });
  });

  it("sends image scans to OpenRouter as image_url content", async () => {
    fetchMock.mockResolvedValue(okJsonResponse({
      choices: [{ message: { content: "```json\n" + JSON.stringify(intent) + "\n```" } }],
    }));

    await extractWorkerDataFromDocument({
      buffer: Buffer.from("image"),
      mimeType: "image/png",
      fileName: "passport.png",
      ctx,
    });

    const { body } = readFetchBody<OpenRouterBody>();
    expect(body.plugins).toBeUndefined();
    const imagePart = body.messages[0]!.content.find((part) => part.type === "image_url");
    expect(imagePart?.image_url?.url).toBe("data:image/png;base64,aW1hZ2U=");
  });

  it("sends PDFs to Anthropic as document blocks", async () => {
    envState.value = {
      ...envState.value,
      LLM_PROVIDER: "anthropic",
      LLM_MODEL: "claude-test",
      LLM_BASE_URL: "https://anthropic.test/v1",
    };
    fetchMock.mockResolvedValue(okJsonResponse({
      content: [{ type: "text", text: JSON.stringify(intent) }],
    }));

    await extractWorkerDataFromDocument({
      buffer: Buffer.from("pdf"),
      mimeType: "application/pdf" satisfies SupportedDocumentMime,
      fileName: "contract.pdf",
      ctx,
    });

    const { url, body } = readFetchBody<AnthropicBody>();
    expect(url).toBe("https://anthropic.test/v1/messages");
    expect(body.model).toBe("claude-test");
    expect(body.messages[0]!.content[0]).toEqual({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: "cGRm",
      },
    });
  });

  it("normalizes empty model fields from contracts that omit employee id or known warehouse code", async () => {
    fetchMock.mockResolvedValue(okJsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              employeeId: "",
              fullName: "Alex Morgan",
              email: "",
              warehouseCode: "",
              roleCode: "Forklift Operator",
              hireDate: "1 June 2026",
            }),
          },
        },
      ],
    }));

    const result = await extractWorkerProvisioningFromDocument({
      buffer: Buffer.from("contract"),
      mimeType: "application/pdf",
      fileName: "employment-contract.pdf",
      ctx: seedLikeCtx,
    });

    expect(result.intent).toMatchObject({
      employeeId: "PENDING-ALEX-MORGAN-20260601",
      fullName: "Alex Morgan",
      email: null,
      warehouseCode: "WH-A",
      roleCode: "forklift_operator",
      hireDate: "2026-06-01",
    });
    expect(result.warnings.join(" ")).toContain("Employee ID was missing");
    expect(result.warnings.join(" ")).toContain("Warehouse was missing");
  });
});

function okJsonResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(json),
    text: vi.fn().mockResolvedValue(JSON.stringify(json)),
  } as unknown as Response;
}

function readFetchBody<T>(): { url: string; body: T } {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  const init = call![1] as RequestInit;
  return {
    url: String(call![0]),
    body: JSON.parse(init.body as string) as T,
  };
}
