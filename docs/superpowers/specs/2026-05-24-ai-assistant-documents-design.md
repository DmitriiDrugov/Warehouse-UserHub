# AI Assistant Page + Worker Document Storage

**Date:** 2026-05-24  
**Status:** Approved  
**Scope:** New route `/ai`, worker profile Documents section, Supabase Storage integration

---

## Problem

The existing NL provisioning is a small card on the `/warehouse-users/new` page — it only creates workers and competes visually with the manual form. The nl-sql query feature has no dedicated UI at all. There is no unified place for power-users to interact with the system via natural language, and worker profile documents (contracts, passports, work permits) have no home in the app.

---

## Solution Overview

1. **`/ai` page** — unified AI chat interface (model from Stitch design) combining NL queries, NL provisioning, and document-based provisioning in one chat thread.
2. **Model switcher** — top-navbar dropdown to pick the Claude model per session.
3. **Document parsing in chat** — attach a file → AI extracts worker data → proposal pre-filled.
4. **Document staging** — uploaded files are stored in Supabase Storage, tagged with `proposal_id`; on approval the file is linked to the new worker.
5. **Worker profile Documents section** — fixed list of document types, manual upload/view/delete at any time.

---

## Architecture

```
/ai page
  └─ ChatInterface (client component — React state only, no DB persistence)
       ├─ ModelSelector (top navbar dropdown, stored in localStorage)
       ├─ ChatHistory (array of ChatMessage in useState)
       └─ InputArea
            ├─ Textarea (auto-resize)
            ├─ AttachFile button → FileInput (hidden)
            └─ Send button → handleSend(text, file?, model)

handleSend
  ├─ file present  → dispatchAction("parse_doc", file, model)
  └─ text only
       └─ classifyIntent(text) → "query" | "provision" | "unsupported"
            ├─ "query"       → dispatchAction("query", text, model)
            ├─ "provision"   → dispatchAction("provision", text, model)
            └─ "unsupported" → local warning card (no server call)
```

### Response types rendered in chat history

| Action type | Server handler | UI component |
|-------------|---------------|--------------|
| `query` | `nl-sql.ts` → SQL → rows | `<QueryResultCard>` — table |
| `provision` | `provisioning.ts` → proposal | `<ProposalCard>` — violet card |
| `parse_doc` | `parseDocumentForProvisioning()` → proposal | `<ProposalCard>` with "📄 Parsed from document" badge |
| `unsupported` | — (client only) | `<WarningCard>` amber |

---

## Model Switcher

**Location:** Top navbar (matching Stitch design — pill chip with `auto_awesome` icon).

```
[ ✦ Model  ▾ ]
    Claude Haiku    ← fast
  ✓ Claude Sonnet   ← default
    Claude Opus     ← powerful
```

**Implementation:**
- `ModelSelectorDropdown` client component in `components/ui/model-selector.tsx`
- State stored in `localStorage` key `"ai_model_preference"`, default `"claude-sonnet-4-6"`
- Model IDs: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7`
- Friendly names: `Claude Haiku`, `Claude Sonnet`, `Claude Opus`
- Passed as `model` field to every server action; `getLLM(model)` receives it

**`getLLM` change:** No change needed. `CompleteOptions.model` already exists in `lib/llm/types.ts` and is honoured by both providers. Every AI call passes the selected model via `{ model: selectedModel }` in `CompleteOptions`.

---

## Intent Classification

```ts
// lib/ai/classify.ts
type IntentType = "query" | "provision" | "unsupported";

async function classifyIntent(text: string): Promise<IntentType>
```

Single Claude call (`temperature: 0`, `max_tokens: 10`). System prompt:

```
Classify the warehouse admin request as exactly one word:
- "query"       — user wants to look up / list / search data
- "provision"   — user wants to create a new worker
- "unsupported" — anything else

Output one word only.
```

File attached → skip classification, always `parse_doc`.

---

## Document Parsing

```ts
// lib/ai/provisioning.ts — new export
async function parseDocumentForProvisioning(
  fileBuffer: Buffer,
  mimeType: string,
  model: string,
): Promise<Intent>
```

- Sends file as base64 to Claude (vision for images, text-extraction for PDFs via `document` content block)
- System prompt: same as `buildSystemPrompt(ctx)` but prefixed with *"Extract worker registration data from the attached document."*
- Returns `Intent` → goes through existing `resolveIntent()` unchanged

**Supported MIME types:** `application/pdf`, `image/jpeg`, `image/png`, `image/webp`  
**Max file size:** 10 MB (enforced client-side and server-side)

---

## Database — New Table

```ts
// lib/db/schema.ts — new table
export const workerDocuments = pgTable("worker_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workerId: uuid("worker_id").references(() => warehouseUsers.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id").references(() => aiProposals.id, { onDelete: "set null" }),
  documentType: text("document_type").notNull(),
  // enum values: 'contract' | 'passport' | 'work_permit' | 'forklift_certificate' | 'health_clearance' | 'other'
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: text("mime_type"),
  uploadedBy: uuid("uploaded_by").references(() => appUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Indexes:** `worker_id`, `proposal_id`

**Document type enum values (fixed list):**
```ts
export const DOCUMENT_TYPES = [
  "contract",
  "passport",
  "work_permit",
  "forklift_certificate",
  "health_clearance",
  "other",
] as const;
```

---

## Supabase Storage

**Bucket:** `worker-documents` (private, authenticated access only)

**Path convention:**
- Via chat (staged): `proposals/{proposalId}/{documentType}/{originalFileName}`
- Via manual upload: `workers/{workerId}/{documentType}/{originalFileName}`

**Access:** Signed URLs (1 hour TTL) for viewing/downloading — generated server-side.

---

## Staging & Linking Flow

```
1. User attaches file in chat
2. Server action uploads file to Storage → path: proposals/{proposalId}/...
3. worker_documents row inserted: { proposalId, workerId: NULL, storagePath, documentType }
4. Proposal created and returned to chat as ProposalCard

5. warehouse_admin approves proposal
6. approveProposal() in lib/services/proposals.ts:
   - creates warehouseUser (existing logic)
   - UPDATE worker_documents SET worker_id = {newWorkerId} WHERE proposal_id = {proposalId}
   
7. If proposal is REJECTED:
   - worker_documents rows with this proposal_id remain (workerId still NULL, orphaned)
   - Nightly cleanup job deletes orphaned rows + Storage files older than 7 days
   (OR: delete immediately on rejection — simpler, chosen for v1)
```

**On rejection:** `rejectProposal()` deletes `worker_documents` rows where `proposal_id = X AND worker_id IS NULL` and calls Supabase Storage `remove()` on each `storagePath`.

---

## Worker Profile — Documents Section

**New tab** added to the profile tabs nav: `Profile | Access | Certificates | Checklist | **Documents** | History`

**Component:** `app/(app)/warehouse-users/[id]/documents-section.tsx`

UI layout — one row per document type:
```
┌──────────────────────────────────────────────────────┐
│ 📄 Employment Contract          [✓ Uploaded] [↓] [✕] │
│ 🪪 Passport / ID                [✗ Missing]  [↑ Upload] │
│ 📋 Work Permit                  [✗ Missing]  [↑ Upload] │
│ 🏗  Forklift Certificate        [✓ Uploaded] [↓] [✕] │
│ 🏥 Health Clearance             [✗ Missing]  [↑ Upload] │
│ 📎 Other                        [↑ Upload]            │
└──────────────────────────────────────────────────────┘
```

- **Download** → server action returns signed URL → `window.open(url)`
- **Delete** → removes Storage file + DB row (only `hr` / `warehouse_admin`)
- **Upload** → `<input type="file">` → `uploadWorkerDocumentAction(workerId, documentType, formData)`

**Data fetch:** Added to `WarehouseUserDetailPage` — query `worker_documents WHERE worker_id = id`.

---

## New Files

| File | Purpose |
|------|---------|
| `app/(app)/ai/page.tsx` | AI Assistant page (server component wrapper) |
| `app/(app)/ai/chat-interface.tsx` | Full chat UI (client component) |
| `app/(app)/ai/actions.ts` | Server actions: chat dispatch, file upload |
| `lib/ai/classify.ts` | `classifyIntent()` |
| `components/ui/model-selector.tsx` | Navbar model dropdown |
| `app/(app)/warehouse-users/[id]/documents-section.tsx` | Profile documents UI |

## Modified Files

| File | Change |
|------|--------|
| `lib/ai/provisioning.ts` | Add `parseDocumentForProvisioning()` |
| `lib/llm.ts` | `getLLM(model?)` accepts optional model override |
| `lib/db/schema.ts` | Add `workerDocuments` table + `DOCUMENT_TYPES` |
| `lib/services/proposals.ts` | On approve: link staged docs; on reject: delete staged docs |
| `app/(app)/warehouse-users/[id]/page.tsx` | Add DocumentsSection + Documents tab |
| `components/app/app-topbar.tsx` | Add ModelSelectorDropdown pill (right of search bar) |
| `components/app/app-sidebar.tsx` | Rename "NL Query" → "AI Assistant", href `/nl-query` → `/ai` |
| `drizzle/migrations/` | New migration for `worker_documents` |

---

## Migration: /nl-query → /ai

`/nl-query` already exists with its own page and actions. The new `/ai` route supersedes it:

- Sidebar item "NL Query" (`/nl-query`) is **renamed** to "AI Assistant" (`/ai`)
- `app/(app)/nl-query/` is kept but `page.tsx` is replaced with a `redirect("/ai")`
- `nl-query/actions.ts` and `nl-query/console.tsx` are deleted (logic moves to `/ai/actions.ts`)
- `nl-sql.ts` itself is unchanged — `/ai/actions.ts` imports it directly

## What Does NOT Change

- `lib/ai/nl-sql.ts`, `nl-sql-views.ts`, `nl-sql-validate.ts` — called as-is
- `provisioning.ts` `resolveIntent()` — unchanged
- `lib/llm/index.ts`, `lib/llm/types.ts` — no changes; model passed via existing `CompleteOptions.model`
- Proposal approval/rejection page — no UI changes, only service-layer hook
- Auth model — same `requireOperator` guards

---

## Failure Modes

| Situation | Behavior |
|-----------|----------|
| File too large (>10 MB) | Client rejects before upload, shows error |
| Unsupported MIME type | Server returns `{ ok: false, error: "Unsupported file type" }` |
| AI cannot extract data from document | `parse_doc` returns partial Intent → Zod validation fails → error card in chat |
| Supabase Storage upload fails | Server action returns error, no DB row created |
| Proposal rejected, storage delete fails | Log error, row stays orphaned — nightly cleanup handles it |
| Model unavailable | Falls back to `claude-sonnet-4-6`, shows toast |

---

## Out of Scope (v1)

- Chat history persistence in DB
- Response streaming
- Bulk provisioning (multiple workers from one message)
- Bulk document upload (multiple files at once per worker)
- Document expiry tracking / renewal reminders
