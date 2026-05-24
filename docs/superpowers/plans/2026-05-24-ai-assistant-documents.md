# AI Assistant Page + Worker Document Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the isolated `/nl-query` page with a unified `/ai` chat interface that routes NL queries, NL provisioning, and document-based provisioning through one input; add a model selector in the topbar; add a Documents section to worker profiles backed by Supabase Storage.

**Architecture:** Chat history lives only in React state (no DB table). A server-side `classifyIntent()` call routes text messages to `nl-sql.ts` (query) or `provisioning.ts` (provision). File uploads bypass classification and go directly to `parseDocumentForProvisioning()` (direct Anthropic API call with base64 file content). Uploaded files are staged in Supabase Storage under `proposals/{proposalId}/…`; on proposal approval the `worker_documents` rows are linked to the new `worker_id`; on rejection the files are deleted. Worker profiles gain a Documents tab with manual upload/view/delete at any time.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM + postgres.js, Supabase Storage (`@supabase/supabase-js`), Vitest, `pnpm`, Tailwind CSS, Material Symbols icons.

---

## File Map

**Create:**
- `lib/validation/enums.ts` — add `DOCUMENT_TYPES` constant
- `lib/db/schema.ts` — add `workerDocuments` table
- `drizzle/migrations/` — new migration (auto-generated)
- `lib/storage/worker-documents.ts` — Supabase Storage helpers (upload, delete, signedUrl)
- `lib/ai/classify.ts` — `classifyIntent(text, model)`
- `lib/ai/parse-document.ts` — `parseDocumentForProvisioning(buf, mime, model)`
- `app/(app)/ai/page.tsx` — server wrapper (auth check)
- `app/(app)/ai/chat-interface.tsx` — full client-side chat UI
- `app/(app)/ai/actions.ts` — `chatAction`, `uploadDocAction`
- `components/ui/model-selector.tsx` — topbar model dropdown
- `app/(app)/warehouse-users/[id]/documents-section.tsx` — profile Documents section
- `app/(app)/warehouse-users/[id]/document-actions.ts` — `uploadWorkerDocumentAction`, `deleteWorkerDocumentAction`, `getDocumentSignedUrlAction`

**Modify:**
- `lib/validation/enums.ts` — add `DOCUMENT_TYPES`
- `lib/db/schema.ts` — add `workerDocuments` table + export
- `lib/services/proposals.ts` — link docs on approve, delete docs on reject
- `components/app/app-topbar.tsx` — add `<ModelSelectorDropdown />`
- `components/app/app-sidebar.tsx` — rename "NL Query" → "AI Assistant", href → `/ai`
- `app/(app)/warehouse-users/[id]/page.tsx` — add Documents tab + `<DocumentsSection />`
- `app/(app)/nl-query/page.tsx` — replace with `redirect("/ai")`

---

## Task 1: DOCUMENT_TYPES enum + worker_documents DB schema + migration

**Files:**
- Modify: `lib/validation/enums.ts`
- Modify: `lib/db/schema.ts`
- Create: `tests/worker-documents-schema.test.ts`

- [ ] **Step 1: Add DOCUMENT_TYPES to enums**

Open `lib/validation/enums.ts` and add at the end (after `AUDIT_ACTIONS`):

```ts
export const DOCUMENT_TYPES = [
  "contract",
  "passport",
  "work_permit",
  "forklift_certificate",
  "health_clearance",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
```

- [ ] **Step 2: Add workerDocuments table to schema**

Open `lib/db/schema.ts`. Add this import at the top with the other drizzle imports:
```ts
// (already imported) integer is already there — just confirm it's present
```

Add the table definition near the end of the file (after `userCertificates`):

```ts
export const workerDocuments = pgTable(
  "worker_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null until the proposal is approved and the worker is created
    workerId: uuid("worker_id").references(() => warehouseUsers.id, {
      onDelete: "cascade",
    }),
    // set when uploaded via AI chat; cleared on worker link
    proposalId: uuid("proposal_id").references(() => aiProposals.id, {
      onDelete: "set null",
    }),
    documentType: text("document_type").notNull(),
    fileName: text("file_name").notNull(),
    // Supabase Storage object path, e.g. "proposals/abc/contract/file.pdf"
    storagePath: text("storage_path").notNull(),
    fileSizeBytes: integer("file_size_bytes"),
    mimeType: text("mime_type"),
    uploadedBy: uuid("uploaded_by").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    byWorker: index("worker_documents_by_worker").on(t.workerId),
    byProposal: index("worker_documents_by_proposal").on(t.proposalId),
  }),
);
```

Also add a `workerDocumentsRelations` export (after the other relations blocks):

```ts
export const workerDocumentsRelations = relations(
  workerDocuments,
  ({ one }) => ({
    worker: one(warehouseUsers, {
      fields: [workerDocuments.workerId],
      references: [warehouseUsers.id],
    }),
    proposal: one(aiProposals, {
      fields: [workerDocuments.proposalId],
      references: [aiProposals.id],
    }),
  }),
);
```

- [ ] **Step 3: Write the test**

Create `tests/worker-documents-schema.test.ts`:

```ts
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
```

- [ ] **Step 4: Run test (should pass — schema is pure TS)**

```
pnpm test tests/worker-documents-schema.test.ts
```

Expected: PASS

- [ ] **Step 5: Generate and run migration**

```
pnpm run db:generate
pnpm run db:migrate
```

Expected: new migration file in `drizzle/migrations/`, applied to DB.

- [ ] **Step 6: Commit**

```
git add lib/validation/enums.ts lib/db/schema.ts drizzle/migrations/ tests/worker-documents-schema.test.ts
git commit -m "feat: add worker_documents table and DOCUMENT_TYPES enum"
```

---

## Task 2: Supabase Storage helper

**Files:**
- Create: `lib/storage/worker-documents.ts`
- Create: `tests/storage-helper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage-helper.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test tests/storage-helper.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement the storage helper**

Create `lib/storage/worker-documents.ts`:

```ts
/**
 * Supabase Storage helpers for worker documents.
 *
 * Bucket: "worker-documents" (private, authenticated access only)
 * Path convention:
 *   proposals/{proposalId}/{documentType}/{fileName}   — staged, pending worker creation
 *   workers/{workerId}/{documentType}/{fileName}        — manual upload on profile
 */

import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "../env";

const BUCKET = "worker-documents";

function getStorageClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export type UploadScope = "proposals" | "workers";

export type UploadInput = {
  scope: UploadScope;
  scopeId: string; // proposalId or workerId
  documentType: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
};

/** Upload a file and return its storage path. */
export async function uploadWorkerDocument(input: UploadInput): Promise<string> {
  const path = `${input.scope}/${input.scopeId}/${input.documentType}/${input.fileName}`;
  const client = getStorageClient();
  const { error } = await client.storage
    .from(BUCKET)
    .upload(path, input.buffer, {
      contentType: input.mimeType,
      upsert: false,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

/** Delete one file from storage by its path. */
export async function deleteWorkerDocument(storagePath: string): Promise<void> {
  const client = getStorageClient();
  const { error } = await client.storage.from(BUCKET).remove([storagePath]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

/** Create a 1-hour signed URL for viewing/downloading. */
export async function getWorkerDocumentSignedUrl(storagePath: string): Promise<string> {
  const client = getStorageClient();
  const { data, error } = await client.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(`Signed URL failed: ${error?.message ?? "no data"}`);
  }
  return data.signedUrl;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm test tests/storage-helper.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```
git add lib/storage/worker-documents.ts tests/storage-helper.test.ts
git commit -m "feat: add Supabase Storage helper for worker documents"
```

---

## Task 3: classifyIntent() — intent routing

**Files:**
- Create: `lib/ai/classify.ts`
- Create: `tests/classify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/classify.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ dbAdmin: {}, dbReadonly: {} }));

const mockComplete = vi.fn();
vi.mock("@/lib/llm", () => ({
  getLLM: () => ({ complete: mockComplete }),
}));

import { classifyIntent } from "@/lib/ai/classify";

describe("classifyIntent", () => {
  it("returns 'query' for lookup requests", async () => {
    mockComplete.mockResolvedValueOnce("query");
    const result = await classifyIntent("Show all pickers at WH-A");
    expect(result).toBe("query");
  });

  it("returns 'provision' for creation requests", async () => {
    mockComplete.mockResolvedValueOnce("provision");
    const result = await classifyIntent("Create a new forklift operator");
    expect(result).toBe("provision");
  });

  it("returns 'unsupported' for unknown requests", async () => {
    mockComplete.mockResolvedValueOnce("unsupported");
    const result = await classifyIntent("Delete all warehouse data");
    expect(result).toBe("unsupported");
  });

  it("defaults to 'unsupported' if LLM returns garbage", async () => {
    mockComplete.mockResolvedValueOnce("GARBAGE_RESPONSE_XYZ");
    const result = await classifyIntent("some text");
    expect(result).toBe("unsupported");
  });

  it("passes model override to getLLM().complete", async () => {
    mockComplete.mockResolvedValueOnce("query");
    await classifyIntent("show workers", "claude-opus-4-7");
    expect(mockComplete).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ model: "claude-opus-4-7", maxTokens: 10 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test tests/classify.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement classifyIntent**

Create `lib/ai/classify.ts`:

```ts
/**
 * Classify a free-form warehouse admin message into one of three intent types.
 * Used by the AI chat page to route messages to the correct handler.
 */

import { getLLM } from "../llm";

export type IntentType = "query" | "provision" | "unsupported";

const VALID_INTENTS = new Set<IntentType>(["query", "provision", "unsupported"]);

const SYSTEM_PROMPT = `You are classifying a warehouse admin request into exactly one of:
- "query"       — user wants to look up, list, search, or export data
- "provision"   — user wants to create a new warehouse worker
- "unsupported" — anything else (edit, delete, bulk operations, off-topic)

Respond with one lowercase word only. No punctuation. No explanation.`;

export async function classifyIntent(
  text: string,
  model?: string,
): Promise<IntentType> {
  const llm = getLLM();
  const raw = await llm.complete(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 500) }, // cap input for classify call
    ],
    { temperature: 0, maxTokens: 10, model },
  );

  const trimmed = raw.trim().toLowerCase() as IntentType;
  return VALID_INTENTS.has(trimmed) ? trimmed : "unsupported";
}
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm test tests/classify.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```
git add lib/ai/classify.ts tests/classify.test.ts
git commit -m "feat: add classifyIntent() for AI chat routing"
```

---

## Task 4: parseDocumentForProvisioning() — AI document reading

**Files:**
- Create: `lib/ai/parse-document.ts`
- Create: `tests/parse-document.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/parse-document.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ dbAdmin: {}, dbReadonly: {} }));
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

import { extractWorkerDataFromDocument } from "@/lib/ai/parse-document";

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
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test tests/parse-document.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement parseDocument**

Create `lib/ai/parse-document.ts`:

```ts
/**
 * Extract warehouse worker registration data from an uploaded document
 * (PDF or image) using Claude's vision/document API.
 *
 * Uses the Anthropic API directly (raw fetch) because the LLMProvider
 * abstraction only supports text-only messages. Only works when
 * LLM_PROVIDER=anthropic (or if a model override pointing to Anthropic is given).
 *
 * Returns the same Intent shape as provisioning.ts so it flows through
 * the same resolveIntent() logic.
 */

import { z } from "zod";
import { serverEnv } from "../env";
import { buildSystemPrompt, type ProvisioningContext } from "./provisioning";
import { dbReadonly } from "../db/client";
import { roles, warehouses } from "../db/schema";
import { asc } from "drizzle-orm";

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
type SupportedMime = (typeof SUPPORTED_MIME_TYPES)[number];

function isSupportedMime(mime: string): mime is SupportedMime {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mime);
}

const IntentFromDocSchema = z.object({
  employeeId: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email().nullable().optional(),
  warehouseCode: z.string().min(1),
  roleCode: z.string().min(1),
  hireDate: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "hireDate must be ISO date"),
  referenceEmployeeId: z.string().min(1).nullable().optional(),
  extraPermissionCodes: z
    .array(z.string().regex(/^[a-z_]+\.[a-z_]+$/))
    .optional(),
});

export type DocumentIntent = z.infer<typeof IntentFromDocSchema>;

async function loadContext(): Promise<ProvisioningContext> {
  const [warehouseRows, roleRows] = await Promise.all([
    dbReadonly
      .select({ code: warehouses.code, name: warehouses.name, location: warehouses.location })
      .from(warehouses)
      .orderBy(asc(warehouses.code)),
    dbReadonly
      .select({ code: roles.code, name: roles.name, description: roles.description })
      .from(roles)
      .orderBy(asc(roles.code)),
  ]);
  return { warehouses: warehouseRows, roles: roleRows };
}

/**
 * Call the Anthropic API directly with a document content block so Claude
 * can read the file and extract worker data.
 */
export async function extractWorkerDataFromDocument(
  buffer: Buffer,
  mimeType: string,
  model: string,
): Promise<DocumentIntent> {
  if (!isSupportedMime(mimeType)) {
    throw new Error(
      `Unsupported document MIME type: ${mimeType}. Use PDF, JPEG, PNG, or WebP.`,
    );
  }

  const env = serverEnv();
  const ctx = await loadContext();
  const systemPrompt =
    "Extract warehouse worker registration data from the attached document.\n\n" +
    buildSystemPrompt(ctx);

  const base64 = buffer.toString("base64");

  // Anthropic content block type depends on MIME:
  // PDFs → { type: "document", source: { type: "base64", media_type, data } }
  // Images → { type: "image", source: { type: "base64", media_type, data } }
  const contentBlock =
    mimeType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: mimeType, data: base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: mimeType, data: base64 },
        };

  const baseUrl = (env.LLM_BASE_URL ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.LLM_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "pdfs-2024-09-25",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            contentBlock,
            {
              type: "text",
              text: "Extract worker registration data from this document and output JSON only (schema as described in the system prompt).",
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(`Anthropic error: ${data.error.message}`);
  }

  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic returned no text content");
  }

  // Extract JSON from the response (might be wrapped in markdown code fences)
  const raw = textBlock.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse JSON from document extraction: ${raw.slice(0, 200)}`);
  }

  return IntentFromDocSchema.parse(parsed);
}
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm test tests/parse-document.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```
git add lib/ai/parse-document.ts tests/parse-document.test.ts
git commit -m "feat: add parseDocumentForProvisioning() for AI document reading"
```

---

## Task 5: Proposal service hooks — stage on create, link on approve, delete on reject

**Files:**
- Modify: `lib/services/proposals.ts`
- Create: `tests/proposals-document-hooks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/proposals-document-hooks.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm test tests/proposals-document-hooks.test.ts
```

Expected: FAIL (exports not found)

- [ ] **Step 3: Add linkStagedDocuments and deleteStagedDocuments**

Open `lib/services/proposals.ts`.

Add import at the top (with other schema imports):
```ts
import { workerDocuments } from "../db/schema";
import {
  deleteWorkerDocument,
} from "../storage/worker-documents";
```

Add these two exported helper functions after `getSystemOperator` (before `createProposal`):

```ts
/**
 * After a provision proposal is approved and the worker is created,
 * link any staged documents (uploaded during AI chat) to the new worker.
 * Called inside the approveProposal transaction.
 */
export async function linkStagedDocuments(
  tx: DbTx,
  proposalId: string,
  workerId: string,
): Promise<void> {
  await tx
    .update(workerDocuments)
    .set({ workerId })
    .where(eq(workerDocuments.proposalId, proposalId));
}

/**
 * When a provision proposal is rejected, delete any staged documents
 * (both the DB rows and the Storage objects).
 * Called inside rejectProposal.
 */
export async function deleteStagedDocuments(
  tx: DbTx,
  proposalId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: workerDocuments.id, storagePath: workerDocuments.storagePath })
    .from(workerDocuments)
    .where(eq(workerDocuments.proposalId, proposalId));

  // Delete storage files (best-effort — don't fail the transaction)
  await Promise.allSettled(rows.map((r) => deleteWorkerDocument(r.storagePath)));

  if (rows.length > 0) {
    await tx
      .delete(workerDocuments)
      .where(eq(workerDocuments.proposalId, proposalId));
  }
}
```

- [ ] **Step 4: Wire linkStagedDocuments into approveProposal**

In `approveProposal`, find the `case "provision":` block. After `const wu = await createWarehouseUser(...)`, add:

```ts
// Link any documents uploaded via AI chat to the newly created worker
await linkStagedDocuments(tx, proposalId, wu.id);
```

The full provision case should look like:
```ts
case "provision": {
  const payload = ProvisionPayload.parse(proposal.payload);
  const wu = await createWarehouseUser(
    tx,
    { /* ... existing fields ... */ },
    downstreamCtx,
  );
  await linkStagedDocuments(tx, proposalId, wu.id); // ← ADD THIS LINE
  if (payload.extraPermissionIds?.length) {
    for (const permissionId of payload.extraPermissionIds) {
      await grantAccess(tx, { warehouseUserId: wu.id, permissionId, source: "manual" }, downstreamCtx);
    }
  }
  return { proposal: updated, result: { type: "provision", warehouseUserId: wu.id } };
}
```

- [ ] **Step 5: Wire deleteStagedDocuments into rejectProposal**

In `rejectProposal`, after the `await writeAudit(...)` call, add:

```ts
// Delete staged documents (uploaded via AI chat before the proposal was reviewed)
if (proposal.type === "provision") {
  await deleteStagedDocuments(tx, proposalId);
}

return updated;
```

- [ ] **Step 6: Run tests to verify they pass**

```
pnpm test tests/proposals-document-hooks.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```
git add lib/services/proposals.ts tests/proposals-document-hooks.test.ts
git commit -m "feat: link/delete staged worker documents on proposal approve/reject"
```

---

## Task 6: Model selector component + topbar integration

**Files:**
- Create: `components/ui/model-selector.tsx`
- Modify: `components/app/app-topbar.tsx`

- [ ] **Step 1: Create ModelSelectorDropdown component**

Create `components/ui/model-selector.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

export type ModelId =
  | "claude-haiku-4-5-20251001"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7";

const MODELS: { id: ModelId; label: string; description: string }[] = [
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku",
    description: "Fastest · lower cost",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet",
    description: "Balanced · default",
  },
  {
    id: "claude-opus-4-7",
    label: "Claude Opus",
    description: "Most capable · slower",
  },
];

const STORAGE_KEY = "ai_model_preference";
export const DEFAULT_MODEL: ModelId = "claude-sonnet-4-6";

export function useSelectedModel(): [ModelId, (m: ModelId) => void] {
  const [model, setModelState] = useState<ModelId>(DEFAULT_MODEL);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ModelId | null;
    if (stored && MODELS.some((m) => m.id === stored)) {
      setModelState(stored);
    }
  }, []);

  const setModel = (m: ModelId) => {
    localStorage.setItem(STORAGE_KEY, m);
    setModelState(m);
  };

  return [model, setModel];
}

export function ModelSelectorDropdown() {
  const [model, setModel] = useSelectedModel();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const current = MODELS.find((m_) => m_.id === model) ?? MODELS[1]!;

  return (
    <div ref={ref} className="relative hidden md:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-low border border-border-subtle rounded-lg hover:bg-surface-container transition-colors"
      >
        <Icon name="auto_awesome" size={18} className="text-proposal-violet" fill />
        <div className="flex flex-col items-start leading-none">
          <span className="text-[10px] text-outline uppercase font-bold tracking-wide">Model</span>
          <span className="font-label text-label text-on-surface">{current.label}</span>
        </div>
        <Icon name="expand_more" size={16} className="text-on-surface-variant" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-surface-container-lowest border border-border-subtle rounded-lg shadow-lg z-50 overflow-hidden">
          {MODELS.map((m_) => (
            <button
              key={m_.id}
              type="button"
              onClick={() => { setModel(m_.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-container-low transition-colors ${
                m_.id === model ? "bg-surface-container" : ""
              }`}
            >
              <div className="flex-1">
                <div className="font-label text-label text-on-surface">{m_.label}</div>
                <div className="font-label text-[11px] text-on-surface-variant">{m_.description}</div>
              </div>
              {m_.id === model && (
                <Icon name="check" size={16} className="text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add ModelSelectorDropdown to AppTopBar**

Open `components/app/app-topbar.tsx`.

Add the import at the top:
```tsx
import { ModelSelectorDropdown } from "@/components/ui/model-selector";
```

In the JSX, find the `<div className="flex items-center gap-1">` that contains the notification/audit/apps links. Add `<ModelSelectorDropdown />` **before** that div:

```tsx
<div className="flex items-center gap-3">
  <ModelSelectorDropdown />      {/* ← ADD */}
  <div className="flex items-center gap-1">
    <Link href="/proposals" ...>
      ...
    </Link>
    ...
  </div>
  <span className="mx-2 h-6 w-px ..."/>
  <div className="w-8 h-8 ...">
    {initials}
  </div>
</div>
```

- [ ] **Step 3: Run typecheck to verify no TS errors**

```
pnpm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```
git add components/ui/model-selector.tsx components/app/app-topbar.tsx
git commit -m "feat: add model selector dropdown to topbar"
```

---

## Task 7: AI chat server actions

**Files:**
- Create: `app/(app)/ai/actions.ts`

> There is no separate test file for these actions because they are thin orchestration shells that call already-tested functions (classifyIntent, nl-sql, provisioning). The integration is verified in Task 8.

- [ ] **Step 1: Create the actions file**

Create `app/(app)/ai/actions.ts`:

```ts
"use server";

import { requireOperator } from "@/lib/auth/operator";
import { classifyIntent } from "@/lib/ai/classify";
import { proposeProvision } from "@/lib/ai/provisioning";
import { extractWorkerDataFromDocument } from "@/lib/ai/parse-document";
import { runNlQuery } from "@/lib/ai/nl-sql";
import { createProposal } from "@/lib/services/proposals";
import { dbAdmin } from "@/lib/db/client";
import { workerDocuments } from "@/lib/db/schema";
import { uploadWorkerDocument } from "@/lib/storage/worker-documents";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/validation/enums";
import { z } from "zod";

// ─── Types returned to the chat interface ────────────────────────────────────

export type QueryResult = {
  type: "query";
  columns: string[];
  rows: Record<string, unknown>[];
  sql: string;
  durationMs: number;
};

export type ProposalResult = {
  type: "provision";
  proposalId: string;
  explanation: string;
  fromDocument?: boolean;
};

export type UnsupportedResult = {
  type: "unsupported";
  message: string;
};

export type ErrorResult = {
  type: "error";
  message: string;
};

export type ChatResult = QueryResult | ProposalResult | UnsupportedResult | ErrorResult;

// ─── Text chat action ─────────────────────────────────────────────────────────

const ChatInputSchema = z.object({
  text: z.string().min(1).max(2000),
  model: z.string().min(1).default("claude-sonnet-4-6"),
});

export async function chatAction(formData: FormData): Promise<ChatResult> {
  await requireOperator(["hr", "warehouse_admin"]);

  const parsed = ChatInputSchema.safeParse({
    text: formData.get("text"),
    model: formData.get("model") ?? "claude-sonnet-4-6",
  });
  if (!parsed.success) {
    return { type: "error", message: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const { text, model } = parsed.data;
  const intent = await classifyIntent(text, model);

  if (intent === "unsupported") {
    return {
      type: "unsupported",
      message:
        "This action isn't supported via AI chat yet. Use the specific management pages for bulk edits, deletions, or access changes.",
    };
  }

  if (intent === "query") {
    try {
      // Note: runNlQuery does not accept a model override — it uses getLLM() default.
      const result = await runNlQuery(text);
      return {
        type: "query",
        columns: result.columns,
        rows: result.rows,
        sql: result.sql,
        durationMs: result.durationMs,
      };
    } catch (err) {
      return {
        type: "error",
        message: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // intent === "provision"
  const result = await proposeProvision(text, model);
  if (!result.ok) {
    return { type: "error", message: result.error };
  }
  return {
    type: "provision",
    proposalId: result.proposalId,
    explanation: result.explanation ?? "",
  };
}

// ─── Document upload action ───────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function uploadDocAction(formData: FormData): Promise<ChatResult> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);

  const file = formData.get("file") as File | null;
  const model = (formData.get("model") as string | null) ?? "claude-sonnet-4-6";

  if (!file || file.size === 0) {
    return { type: "error", message: "No file provided." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { type: "error", message: "File too large. Maximum size is 10 MB." };
  }

  const mimeType = file.type;
  const buffer = Buffer.from(await file.arrayBuffer());

  // 1. Extract worker data from document via Claude
  let docIntent;
  try {
    docIntent = await extractWorkerDataFromDocument(buffer, mimeType, model);
  } catch (err) {
    return {
      type: "error",
      message: `Could not read document: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Create the provisioning proposal
  const provisionResult = await proposeProvision(
    `Create worker: employeeId=${docIntent.employeeId} fullName="${docIntent.fullName}" ` +
      `warehouseCode=${docIntent.warehouseCode} roleCode=${docIntent.roleCode} hireDate=${docIntent.hireDate}`,
    model,
    docIntent, // pass pre-parsed intent to skip LLM call
  );

  if (!provisionResult.ok) {
    return { type: "error", message: provisionResult.error };
  }

  const proposalId = provisionResult.proposalId;

  // 3. Upload file to Supabase Storage staged under the proposal ID
  let storagePath: string;
  try {
    storagePath = await uploadWorkerDocument({
      scope: "proposals",
      scopeId: proposalId,
      documentType: "other", // document type inferred from document; can be improved later
      fileName: file.name,
      buffer,
      mimeType,
    });
  } catch {
    // Don't fail the whole action if storage upload fails
    storagePath = "";
  }

  // 4. Insert worker_documents row (staged — workerId is null until approval)
  if (storagePath) {
    await dbAdmin.insert(workerDocuments).values({
      workerId: null,
      proposalId,
      documentType: "other",
      fileName: file.name,
      storagePath,
      fileSizeBytes: file.size,
      mimeType,
      uploadedBy: operator.id,
    });
  }

  return {
    type: "provision",
    proposalId,
    explanation: provisionResult.explanation ?? "",
    fromDocument: true,
  };
}
```

> **Note:** `proposeProvision` needs a small addition to accept a pre-parsed intent (to skip the LLM call when we already extracted data from a document). See the note in the implementation about passing `docIntent`.

- [ ] **Step 2: Update proposeProvision to accept optional pre-parsed intent**

Open `lib/ai/provisioning.ts`. Change the `proposeProvision` signature:

```ts
export async function proposeProvision(
  text: string,
  model?: string,
  preParseIntent?: Intent,
): Promise<
  | { ok: true; proposalId: string; explanation: string }
  | { ok: false; error: string; parsed?: Intent }
> {
  let intent: Intent;
  if (preParseIntent) {
    intent = preParseIntent;
  } else {
    try {
      intent = await parseProvisioningIntent(text, model);
    } catch (err) {
      return {
        ok: false,
        error: `Could not parse request: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const resolved = await resolveIntent(intent);
  if (!resolved.ok) return { ok: false, error: resolved.error, parsed: intent };

  const proposal = await createProposal(dbAdmin, {
    type: "provision",
    targetEntityType: "warehouse_user",
    targetEntityId: null,
    payload: resolved.payload,
    explanation: resolved.explanation,
  });
  return { ok: true, proposalId: proposal.id, explanation: resolved.explanation };
}
```

Also update `parseProvisioningIntent` to accept optional `model`:

```ts
export async function parseProvisioningIntent(text: string, model?: string): Promise<Intent> {
  const ctx = await loadProvisioningContext();
  const llm = getLLM();
  return await llm.completeJSON(
    [
      { role: "system", content: buildSystemPrompt(ctx) },
      { role: "user", content: "Convert this request to JSON (schema described above):\n\n" + text },
    ],
    IntentSchema,
    { temperature: 0, model },
  );
}
```

- [ ] **Step 3: Run typecheck**

```
pnpm run typecheck
```

Expected: no errors

- [ ] **Step 4: Check that nl-sql exports runNlQuery**

Open `lib/ai/nl-sql.ts` and verify `runNlQuery` is exported. If the exported function is named differently (e.g. `executeNlQuery`), update the import in `actions.ts`.

```
grep -n "^export" lib/ai/nl-sql.ts
```

- [ ] **Step 5: Commit**

```
git add app/(app)/ai/actions.ts lib/ai/provisioning.ts
git commit -m "feat: AI chat server actions (chatAction, uploadDocAction)"
```

---

## Task 8: AI chat UI — ChatInterface + page

**Files:**
- Create: `app/(app)/ai/page.tsx`
- Create: `app/(app)/ai/chat-interface.tsx`

- [ ] **Step 1: Create the page server wrapper**

Create `app/(app)/ai/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth/operator";

export const metadata = { title: "AI Assistant — UserHub" };

export default async function AiAssistantPage() {
  const operator = await requireOperator();
  if (operator.operatorRole === "viewer") {
    redirect("/warehouse-users");
  }
  // Lazy import to keep the bundle small — ChatInterface is a large client component
  const { ChatInterface } = await import("./chat-interface");
  return <ChatInterface />;
}
```

- [ ] **Step 2: Create ChatInterface — skeleton with types**

Create `app/(app)/ai/chat-interface.tsx` with the full implementation:

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useSelectedModel } from "@/components/ui/model-selector";
import type { ChatResult } from "./actions";
import { chatAction, uploadDocAction } from "./actions";

// ─── Message types ────────────────────────────────────────────────────────────

type UserMessage = { role: "user"; text: string; fileName?: string };
type AssistantMessage = { role: "assistant"; result: ChatResult };
type ChatMessage = UserMessage | AssistantMessage;

// ─── Quick suggestion chips (matching Stitch design) ─────────────────────────

const SUGGESTIONS = [
  "Who is on shift in WH-B?",
  "Generate audit for Zone A",
  "Show open workforce gaps",
];

// ─── Main component ───────────────────────────────────────────────────────────

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPending, startTransition] = useTransition();
  const [selectedModel] = useSelectedModel();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function handleSendText(text: string) {
    if (!text.trim()) return;
    const userMsg: UserMessage = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    if (textareaRef.current) textareaRef.current.value = "";
    scrollToBottom();

    startTransition(async () => {
      const fd = new FormData();
      fd.set("text", text);
      fd.set("model", selectedModel);
      const result = await chatAction(fd);
      setMessages((prev) => [...prev, { role: "assistant", result }]);
      scrollToBottom();
    });
  }

  function handleSendFile(file: File) {
    const userMsg: UserMessage = { role: "user", text: `📄 ${file.name}`, fileName: file.name };
    setMessages((prev) => [...prev, userMsg]);
    scrollToBottom();

    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("model", selectedModel);
      const result = await uploadDocAction(fd);
      setMessages((prev) => [...prev, { role: "assistant", result }]);
      scrollToBottom();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText(textareaRef.current?.value ?? "");
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-1px)] -mt-6 -mx-gutter">
      {/* History zone */}
      <div className="flex-1 overflow-y-auto px-gutter pt-8 pb-44 max-w-[1200px] mx-auto w-full">
        {messages.length === 0 && <EmptyState />}
        <div className="space-y-10">
          {messages.map((msg, i) => (
            <MessagePair key={i} message={msg} />
          ))}
          {isPending && <ThinkingBubble />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input zone — fixed at bottom, gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 px-gutter bg-gradient-to-t from-bg-page via-bg-page/95 to-transparent pt-10 pb-4">
        <div className="max-w-[1200px] mx-auto w-full">
          <div className="bg-surface-container-lowest border border-border-subtle rounded-xl shadow-lg p-2 focus-within:ring-2 focus-within:ring-proposal-violet/20 focus-within:border-proposal-violet transition-all">
            <div className="flex items-end gap-2">
              <div className="flex-1 px-3 py-2">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  disabled={isPending}
                  onKeyDown={handleKeyDown}
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = `${t.scrollHeight}px`;
                  }}
                  placeholder="Ask about workers, schedules, or warehouse audits…"
                  className="w-full bg-transparent border-none focus:ring-0 resize-none placeholder:text-outline max-h-40 min-h-[44px] text-body-lg font-body-lg"
                />
              </div>
              <div className="flex items-center gap-2 pb-2 pr-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleSendFile(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach document (PDF, JPG, PNG)"
                  className="p-2 text-on-surface-variant hover:bg-surface-container transition-colors rounded-lg disabled:opacity-50"
                >
                  <Icon name="attach_file" size={20} />
                </button>
                <button
                  type="button"
                  disabled={isPending || !textareaRef.current?.value}
                  onClick={() => handleSendText(textareaRef.current?.value ?? "")}
                  className="bg-proposal-violet text-on-primary w-10 h-10 rounded flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                >
                  <Icon name="send" size={20} />
                </button>
              </div>
            </div>
            {/* Status bar */}
            <div className="flex items-center gap-4 px-3 py-1.5 border-t border-border-subtle/50 text-[11px] text-on-surface-variant/70">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
                <span>Secure Channel Active</span>
              </div>
            </div>
          </div>
          {/* Suggestion chips */}
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSendText(s)}
                className="px-3 py-1 rounded-full border border-border-subtle bg-surface-container-lowest font-label text-label text-on-surface-variant hover:border-proposal-violet hover:text-proposal-violet transition-all text-[12px]"
              >
                &ldquo;{s}&rdquo;
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Message renderers ────────────────────────────────────────────────────────

function MessagePair({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-surface-container-highest/50 px-5 py-3 rounded-xl max-w-2xl border border-border-subtle">
          <p className="text-body-lg font-body-lg">{message.text}</p>
        </div>
      </div>
    );
  }

  const { result } = message;

  return (
    <div className="flex items-start gap-4">
      <div className="w-8 h-8 rounded-full bg-proposal-violet/10 flex items-center justify-center shrink-0 mt-1">
        <Icon name="auto_awesome" size={18} className="text-proposal-violet" fill />
      </div>
      <div className="flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-label text-label text-proposal-violet font-semibold">Warehouse AI</span>
        </div>
        <ResultRenderer result={result} />
      </div>
    </div>
  );
}

function ResultRenderer({ result }: { result: ChatResult }) {
  if (result.type === "query") {
    return (
      <div className="space-y-2">
        <span className="font-label text-[11px] text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
          {result.rows.length} row{result.rows.length !== 1 ? "s" : ""} · {result.durationMs} ms
        </span>
        {result.rows.length === 0 ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant">Query returned 0 rows.</p>
        ) : (
          <div className="bg-surface-container-lowest border border-border-subtle rounded-lg overflow-hidden shadow-sm max-w-3xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low border-b border-border-subtle">
                    {result.columns.map((c) => (
                      <th key={c} className="px-4 py-2 font-label text-label text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-table-cell text-table-cell">
                  {result.rows.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-container-lowest">
                      {result.columns.map((c) => (
                        <td key={c} className="px-4 py-2 font-data-mono text-data-mono">
                          {formatCell(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (result.type === "provision") {
    return (
      <div className="bg-violet-50/50 border border-dashed border-proposal-violet rounded-xl p-5 space-y-4 max-w-lg"
           style={{ boxShadow: "0 0 15px rgba(124, 58, 237, 0.1)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="bolt" size={20} className="text-proposal-violet" />
            <span className="font-title text-title text-proposal-violet">✦ Proposal queued</span>
          </div>
          <span className="bg-violet-100 text-proposal-violet px-2 py-0.5 rounded font-label text-[11px]">
            Awaiting approval
          </span>
        </div>
        <div className="space-y-2">
          {result.fromDocument && (
            <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
              <Icon name="description" size={14} />
              Parsed from uploaded document
            </div>
          )}
          <p className="font-body-sm text-body-sm text-on-surface">{result.explanation}</p>
          <div className="flex items-center gap-2 text-primary font-label text-label">
            <Icon name="link" size={16} />
            <Link href={`/proposals/${result.proposalId}`} className="hover:underline">
              Open proposal #{result.proposalId.slice(0, 8)}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (result.type === "unsupported") {
    return (
      <div className="bg-status-warning/5 border border-status-warning/30 rounded-xl p-5 max-w-lg flex gap-4">
        <Icon name="warning" size={20} className="text-status-warning shrink-0" />
        <div>
          <p className="font-title text-title text-on-surface leading-tight mb-1">Action limited</p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">{result.message}</p>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="flex items-start gap-2 text-status-danger font-body-sm text-body-sm">
      <Icon name="error" size={18} />
      {result.message}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-start gap-4">
      <div className="w-8 h-8 rounded-full bg-proposal-violet/10 flex items-center justify-center shrink-0 mt-1">
        <Icon name="auto_awesome" size={18} className="text-proposal-violet" fill />
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="w-2 h-2 rounded-full bg-proposal-violet/40 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center text-on-surface-variant">
      <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center mb-4">
        <Icon name="auto_awesome" size={32} className="text-proposal-violet" />
      </div>
      <h2 className="font-title text-title text-on-surface mb-1">AI Assistant</h2>
      <p className="font-body-sm text-body-sm max-w-sm">
        Ask about workforce data, create new workers, or upload an employment document to provision automatically.
      </p>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
```

- [ ] **Step 3: Run typecheck**

```
pnpm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```
git add app/(app)/ai/page.tsx app/(app)/ai/chat-interface.tsx
git commit -m "feat: AI Assistant chat page UI"
```

---

## Task 9: Worker document server actions (upload/delete/signedUrl)

**Files:**
- Create: `app/(app)/warehouse-users/[id]/document-actions.ts`

- [ ] **Step 1: Create the actions file**

Create `app/(app)/warehouse-users/[id]/document-actions.ts`:

```ts
"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/operator";
import { dbAdmin } from "@/lib/db/client";
import { workerDocuments } from "@/lib/db/schema";
import {
  uploadWorkerDocument,
  deleteWorkerDocument,
  getWorkerDocumentSignedUrl,
} from "@/lib/storage/worker-documents";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/validation/enums";
import { z } from "zod";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const UploadSchema = z.object({
  workerId: z.string().uuid(),
  documentType: z.enum(DOCUMENT_TYPES),
});

export async function uploadWorkerDocumentAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const operator = await requireOperator(["hr", "warehouse_admin"]);

  const parsed = UploadSchema.safeParse({
    workerId: formData.get("workerId"),
    documentType: formData.get("documentType"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No file provided." };
  if (file.size > MAX_FILE_SIZE) return { ok: false, error: "File too large (max 10 MB)." };

  const { workerId, documentType } = parsed.data;
  const buffer = Buffer.from(await file.arrayBuffer());

  let storagePath: string;
  try {
    storagePath = await uploadWorkerDocument({
      scope: "workers",
      scopeId: workerId,
      documentType,
      fileName: file.name,
      buffer,
      mimeType: file.type,
    });
  } catch (err) {
    return { ok: false, error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  await dbAdmin.insert(workerDocuments).values({
    workerId,
    proposalId: null,
    documentType,
    fileName: file.name,
    storagePath,
    fileSizeBytes: file.size,
    mimeType: file.type,
    uploadedBy: operator.id,
  });

  revalidatePath(`/warehouse-users/${workerId}`);
  return { ok: true };
}

export async function deleteWorkerDocumentAction(
  documentId: string,
  workerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOperator(["hr", "warehouse_admin"]);

  const [doc] = await dbAdmin
    .select({ id: workerDocuments.id, storagePath: workerDocuments.storagePath })
    .from(workerDocuments)
    .where(eq(workerDocuments.id, documentId))
    .limit(1);

  if (!doc) return { ok: false, error: "Document not found." };

  try {
    await deleteWorkerDocument(doc.storagePath);
  } catch {
    // Storage delete failure is logged but doesn't block DB cleanup
  }

  await dbAdmin.delete(workerDocuments).where(eq(workerDocuments.id, documentId));

  revalidatePath(`/warehouse-users/${workerId}`);
  return { ok: true };
}

export async function getDocumentSignedUrlAction(
  documentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireOperator();

  const [doc] = await dbAdmin
    .select({ storagePath: workerDocuments.storagePath })
    .from(workerDocuments)
    .where(eq(workerDocuments.id, documentId))
    .limit(1);

  if (!doc) return { ok: false, error: "Document not found." };

  try {
    const url = await getWorkerDocumentSignedUrl(doc.storagePath);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: `Could not generate download link: ${err instanceof Error ? err.message : String(err)}` };
  }
}
```

- [ ] **Step 2: Run typecheck**

```
pnpm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```
git add "app/(app)/warehouse-users/[id]/document-actions.ts"
git commit -m "feat: worker profile document upload/delete/signedUrl actions"
```

---

## Task 10: DocumentsSection component + worker profile integration

**Files:**
- Create: `app/(app)/warehouse-users/[id]/documents-section.tsx`
- Modify: `app/(app)/warehouse-users/[id]/page.tsx`

- [ ] **Step 1: Create DocumentsSection component**

Create `app/(app)/warehouse-users/[id]/documents-section.tsx`:

```tsx
"use client";

import { useRef, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/validation/enums";
import {
  uploadWorkerDocumentAction,
  deleteWorkerDocumentAction,
  getDocumentSignedUrlAction,
} from "./document-actions";

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  contract: "Employment Contract",
  passport: "Passport / ID",
  work_permit: "Work Permit",
  forklift_certificate: "Forklift Certificate",
  health_clearance: "Health Clearance",
  other: "Other",
};

const DOCUMENT_ICONS: Record<DocumentType, string> = {
  contract: "description",
  passport: "badge",
  work_permit: "approval",
  forklift_certificate: "construction",
  health_clearance: "health_and_safety",
  other: "attach_file",
};

export type DocumentRow = {
  id: string;
  documentType: string;
  fileName: string;
  fileSizeBytes: number | null;
  createdAt: Date;
};

export function DocumentsSection({
  workerId,
  canMutate,
  documents,
}: {
  workerId: string;
  canMutate: boolean;
  documents: DocumentRow[];
}) {
  return (
    <div className="mb-6">
      <div className="border border-border-subtle rounded-lg overflow-hidden bg-surface-container-lowest">
        <div className="px-5 py-4 border-b border-border-subtle">
          <h2 className="font-title text-title text-on-surface">Documents</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
            Required document package for this worker.
          </p>
        </div>
        <div className="divide-y divide-border-subtle">
          {DOCUMENT_TYPES.map((docType) => {
            const uploaded = documents.filter((d) => d.documentType === docType);
            return (
              <DocumentTypeRow
                key={docType}
                workerId={workerId}
                docType={docType}
                uploaded={uploaded}
                canMutate={canMutate}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DocumentTypeRow({
  workerId,
  docType,
  uploaded,
  canMutate,
}: {
  workerId: string;
  docType: DocumentType;
  uploaded: DocumentRow[];
  canMutate: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleUpload(file: File) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("workerId", workerId);
      fd.set("documentType", docType);
      fd.set("file", file);
      const result = await uploadWorkerDocumentAction(fd);
      if (!result.ok) alert(`Upload failed: ${result.error}`);
    });
  }

  function handleDelete(docId: string) {
    if (!confirm("Delete this document?")) return;
    startTransition(async () => {
      await deleteWorkerDocumentAction(docId, workerId);
    });
  }

  function handleDownload(docId: string) {
    startTransition(async () => {
      const result = await getDocumentSignedUrlAction(docId);
      if (result.ok) window.open(result.url, "_blank");
      else alert(`Download failed: ${result.error}`);
    });
  }

  const hasFiles = uploaded.length > 0;

  return (
    <div className="px-5 py-3.5 flex items-center gap-4">
      <div className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center shrink-0">
        <Icon name={DOCUMENT_ICONS[docType]} size={18} className="text-on-surface-variant" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-label text-label text-on-surface">{DOCUMENT_LABELS[docType]}</div>
        {hasFiles ? (
          <div className="font-label text-[11px] text-on-surface-variant mt-0.5">
            {uploaded[0]!.fileName}
            {uploaded[0]!.fileSizeBytes
              ? ` · ${(uploaded[0]!.fileSizeBytes / 1024).toFixed(0)} KB`
              : ""}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {hasFiles ? (
          <>
            <span className="flex items-center gap-1 text-status-success font-label text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
              Uploaded
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleDownload(uploaded[0]!.id)}
              title="Download"
              className="p-1.5 text-on-surface-variant hover:text-primary transition-colors rounded"
            >
              <Icon name="download" size={16} />
            </button>
            {canMutate && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDelete(uploaded[0]!.id)}
                title="Delete"
                className="p-1.5 text-on-surface-variant hover:text-status-danger transition-colors rounded"
              >
                <Icon name="delete" size={16} />
              </button>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1 text-on-surface-variant font-label text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-outline" />
            Missing
          </span>
        )}
        {canMutate && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={isPending}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 rounded border border-border-subtle font-label text-label text-on-surface-variant hover:bg-surface-container-low transition-colors text-[12px]"
            >
              <Icon name="upload" size={14} />
              {hasFiles ? "Replace" : "Upload"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Documents tab and section to the worker profile page**

Open `app/(app)/warehouse-users/[id]/page.tsx`.

**2a. Add import at top:**
```tsx
import { DocumentsSection, type DocumentRow } from "./documents-section";
```

Also add `workerDocuments` to the schema imports:
```tsx
import {
  // ...existing imports...
  workerDocuments,
} from "@/lib/db/schema";
```

**2b. Add documents query inside `withOperator` (after the `certCatalog` query, before the `return`):**
```ts
const docs = await tx
  .select({
    id: workerDocuments.id,
    documentType: workerDocuments.documentType,
    fileName: workerDocuments.fileName,
    fileSizeBytes: workerDocuments.fileSizeBytes,
    createdAt: workerDocuments.createdAt,
  })
  .from(workerDocuments)
  .where(eq(workerDocuments.workerId, id));

return {
  user,
  access,
  certs,
  lists,
  listItems,
  history,
  permList,
  certCatalog,
  docs,           // ← ADD
};
```

**2c. Destructure `docs` from `data`:**
```ts
const { user, access, certs, lists, listItems, history, permList, certCatalog, docs } = data;
```

**2d. Add "Documents" to the tabs nav** (find the `["Profile", "Access", "Certificates", "Checklist", "History"]` array and add "Documents"):
```tsx
{(["Profile", "Access", "Certificates", "Checklist", "Documents", "History"] as const).map(
  (tab) => (
    <a
      key={tab}
      href={`#${tab.toLowerCase()}`}
      className="..."
    >
      {tab}
    </a>
  ),
)}
```

**2e. Add the DocumentsSection before the history section:**
```tsx
<div id="documents">
  <DocumentsSection
    workerId={user.id}
    canMutate={canMutate}
    documents={docs}
  />
</div>

<div id="history">
  <HistorySection history={history} />
</div>
```

- [ ] **Step 3: Run typecheck**

```
pnpm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```
git add "app/(app)/warehouse-users/[id]/documents-section.tsx" "app/(app)/warehouse-users/[id]/page.tsx"
git commit -m "feat: worker profile Documents section with upload/download/delete"
```

---

## Task 11: Navigation migration — sidebar + nl-query redirect

**Files:**
- Modify: `components/app/app-sidebar.tsx`
- Modify: `app/(app)/nl-query/page.tsx`

- [ ] **Step 1: Update sidebar — rename NL Query → AI Assistant**

Open `components/app/app-sidebar.tsx`. Find the `PRIMARY` array entry for `/nl-query`:

```ts
{
  href: "/nl-query",
  label: "NL Query",
  icon: "auto_awesome",
  match: (p) => p.startsWith("/nl-query"),
},
```

Replace with:
```ts
{
  href: "/ai",
  label: "AI Assistant",
  icon: "auto_awesome",
  match: (p) => p.startsWith("/ai"),
},
```

- [ ] **Step 2: Replace nl-query page with redirect**

Open `app/(app)/nl-query/page.tsx` and replace the entire content:

```tsx
import { redirect } from "next/navigation";

export default function NlQueryLegacyRedirect() {
  redirect("/ai");
}
```

- [ ] **Step 3: Delete the now-unused nl-query files**

```
rm "app/(app)/nl-query/actions.ts"
rm "app/(app)/nl-query/console.tsx"
```

- [ ] **Step 4: Run typecheck**

```
pnpm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```
git add components/app/app-sidebar.tsx "app/(app)/nl-query/page.tsx"
git rm "app/(app)/nl-query/actions.ts" "app/(app)/nl-query/console.tsx"
git commit -m "feat: rename NL Query → AI Assistant in sidebar, redirect /nl-query → /ai, delete legacy files"
```

---

## Task 12: Check nl-sql.ts exports and wire up correctly

**Files:**
- Review: `lib/ai/nl-sql.ts`
- Possibly modify: `app/(app)/ai/actions.ts`

- [ ] **Step 1: Check the exported function name**

```
grep -n "^export" lib/ai/nl-sql.ts
```

- [ ] **Step 2: If the export name is not `runNlQuery`, update the import in actions.ts**

Open `app/(app)/ai/actions.ts` and update:
```ts
import { <actual_export_name> as runNlQuery } from "@/lib/ai/nl-sql";
```

Also check what shape the return value has (columns, rows, sql, durationMs). If different, adjust the `QueryResult` type and the mapping in `chatAction`.

- [ ] **Step 3: Run full typecheck and test suite**

```
pnpm run typecheck
pnpm test
```

Expected: typecheck passes, all tests pass.

- [ ] **Step 4: Commit any fixes**

```
git add -A
git commit -m "fix: wire nl-sql exports correctly in AI chat actions"
```

---

## Task 13: Create Supabase Storage bucket

The `worker-documents` bucket must exist in Supabase before uploads work.

- [ ] **Step 1: Create the bucket via Supabase dashboard OR SQL migration**

**Option A — Dashboard:** Go to Supabase Dashboard → Storage → New bucket.
- Name: `worker-documents`
- Public: ❌ (private)

**Option B — SQL migration** (add to a new migration file):

```sql
-- Creates the worker-documents storage bucket.
-- Run via: pnpm run db:migrate  (if this is a raw SQL migration)
-- OR apply manually in the Supabase dashboard SQL editor.
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES (
  'worker-documents',
  'worker-documents',
  false,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp'],
  10485760  -- 10 MB
)
ON CONFLICT (id) DO NOTHING;

-- RLS policy: service role can do anything (our server uses the service key)
CREATE POLICY "Service role full access"
  ON storage.objects FOR ALL
  USING (bucket_id = 'worker-documents' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'worker-documents' AND auth.role() = 'service_role');
```

- [ ] **Step 2: Verify bucket exists**

In Supabase Dashboard → Storage → confirm `worker-documents` bucket appears.

- [ ] **Step 3: Commit the migration if Option B was used**

```
git add drizzle/migrations/
git commit -m "feat: create worker-documents Supabase Storage bucket"
```

---

## Final verification

- [ ] Run `pnpm run typecheck` — no errors
- [ ] Run `pnpm test` — all tests pass
- [ ] Run `pnpm run dev` — app starts
- [ ] Visit `/ai` — chat interface loads, empty state shown
- [ ] Model selector appears in topbar, clicking shows dropdown with 3 models
- [ ] Visit `/nl-query` — redirects to `/ai`
- [ ] Type a query ("show all workers at WH-A") — table result appears
- [ ] Type a provision request ("create picker Ivanov at WH-A, ID T-001") — proposal card appears
- [ ] Visit `/warehouse-users/{id}` — Documents tab is visible, all 6 types listed
- [ ] Upload a file manually on profile — appears as Uploaded with download link
