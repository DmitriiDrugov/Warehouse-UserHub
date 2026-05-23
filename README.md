# Warehouse UserHub

Internal tool that automates warehouse user management. Every warehouse worker has a profile, warehouse assignment, role, status, access rights, training/certificates, an onboarding/offboarding checklist, and a full change history.

Built per [`warehouse-userhub-claude-code-prompt.md`](warehouse-userhub-claude-code-prompt.md).

## Stack

- **Next.js 15** (App Router) — Server Components for reads, Server Actions for mutations.
- **TypeScript** strict.
- **Supabase** — Postgres + Auth + Row Level Security + Storage.
- **Drizzle ORM** — schema, typed queries, SQL migrations.
- **Zod** — validation at every input boundary (forms, server actions, LLM output).
- **LLM** via `lib/llm/` provider abstraction (`openrouter` or `anthropic`).
- **node-sql-parser** — AST validation for the NL→SQL pipeline.
- **Plain Tailwind** utility classes only where structure requires it. No design system.

## Architecture (the spine)

Two distinct entity kinds — never conflate:

- **Operators** (`app_users`) — log in and run the tool. Operator roles: `viewer`, `hr`, `warehouse_admin`.
- **Warehouse users** (`warehouse_users`) — managed records, not logins. Their "roles" and "access rights" describe access to *warehouse systems*.

Three layers with a one-way trust boundary:

1. **Deterministic layer** (`lib/services`, `lib/rules`) — only code allowed to mutate access state. Fully explainable. Always writes `audit_log`.
2. **AI layer** (`lib/ai`) — read-only w.r.t. authorization. Produces suggestions, detections, explanations, parsed intents. Writes only to `ai_proposals`.
3. **Human approval gate** — any AI-originated change to access/provisioning/offboarding requires operator approval before the deterministic layer executes it.

Data flow for any access change:
```
AI proposal → ai_proposals (pending) → operator review → approve → deterministic service → audit_log
```

## Setup

### 1. Prerequisites

- Node ≥ 20
- pnpm ≥ 9
- A Supabase project (Postgres + Auth + Storage)
- An OpenRouter or Anthropic API key

### 2. Install

```bash
pnpm install
```

### 3. Environment

Copy `.env.example` to `.env.local` and fill in real values:

```bash
cp .env.example .env.local
```

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DATABASE_URL_READONLY`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `CRON_SECRET`.

> **About `DATABASE_URL_READONLY`:** migration `0001` creates a Postgres role `nl_query_reader` with `SELECT`-only access to the NL→SQL reporting views. After running `pnpm db:migrate`, set this role's password in Supabase SQL editor and put the corresponding connection string into `DATABASE_URL_READONLY`. The NL→SQL pipeline refuses to execute on any other connection.

### 4. Apply schema, then seed

```bash
pnpm db:generate    # generate SQL from lib/db/schema.ts (only when schema changes)
pnpm db:migrate     # apply pending migrations
pnpm db:seed        # populate realistic + intentionally-anomalous demo data
```

### 5. Run

```bash
pnpm dev
```

Open <http://localhost:3000>. Log in as one of the seeded operators. The seed script prints credentials at the end; the default set is:

| Role | Email | Password |
|------|-------|----------|
| `warehouse_admin` | `admin@example.com` | from `SEED_OPERATOR_PASSWORD` (default `WarehouseDev!2026`) |
| `hr` | `hr-a@example.com`, `hr-b@example.com`, `hr-c@example.com` | same |
| `viewer` | `viewer@example.com` | same |

Change `SEED_OPERATOR_PASSWORD` in `.env.local` before seeding to override.

## Scheduled jobs

`POST /api/cron/evaluate` runs `evaluateUser` across all active warehouse users — applies deterministic auto-actions (expiring temporary access) and routes anything requiring judgment into `ai_proposals`.

Protect with `Authorization: Bearer $CRON_SECRET`. Wire up via Supabase `pg_cron` or any external scheduler.

## Tests

```bash
pnpm test
```

Covers: rules engine, SQL AST validator, LLM-output validation, full proposal lifecycle (proposal → approve → deterministic execution → audit entry), and RLS isolation between operators.

## Project layout

```
/app                  routes (App Router), Server Components + Server Actions
/lib
  /db                 drizzle schema, client, migrations
  /auth               supabase clients (server/client), requireOperator
  /rules              declarative rules engine + evaluator + scheduled task
  /ai                 llm provider abstraction + the 4 AI pipelines
  /services           deterministic mutation services (grant, revoke, provision, offboard)
  /validation         zod schemas
/components           plain functional components (no design system)
```

## Security invariants

- RLS on every table; operators isolated by warehouse.
- AI cannot mutate `user_access`, `warehouse_users`, `user_certificates`, or `user_checklist_items` directly — only via approved proposals executed by the deterministic layer.
- NL→SQL: AST validation + view allowlist + forced LIMIT + statement timeout, executed on the read-only role.
- `audit_log` is append-only, enforced by a DB trigger that rejects `UPDATE` / `DELETE`.
- All LLM JSON output validated with Zod before use.

## Out of scope

Visual design, theming, animations (handled by Stitch). Operator self-signup, billing, multi-tenant SaaS, mobile apps. Any LLM involvement in the authorization decision path.
