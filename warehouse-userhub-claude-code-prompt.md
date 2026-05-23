# Build: Warehouse UserHub

You are building **Warehouse UserHub**, an internal tool that automates warehouse user management. It replaces manual Excel tracking with a single system where every warehouse worker has a profile, warehouse assignment, role, status, access rights, training/certificates, an onboarding/offboarding checklist, and a full change history. The business goal is to speed up user creation and maintenance, reduce access errors, revoke unnecessary rights on time, and give the warehouse team transparent, auditable control over who works where and which systems they can access.

Build the **complete, working application**. Read the entire spec before writing code.

---

## 0. Non-negotiable constraints

1. **Fully functional, zero placeholders.** Every feature must work end to end against the real database and real LLM provider. No `TODO`, no mocked logic, no fake/hardcoded responses standing in for real behavior, no "this would normally…" comments. If a function exists, it does the real thing.
2. **No visual design work.** UI styling is handled separately by a design tool (Stitch). Build components with plain, semantic, minimally-styled markup — functional structure only. Do **not** invest in design systems, theming, animations, polish, or aesthetics. Functional completeness is mandatory; visual polish is explicitly out of scope. Every form must submit, every mutation must persist, every list must load real data, every validation must run — but it can look plain.
3. **Security-first.** Authorization is enforced at the database layer (Postgres RLS), not just in application code. Treat every LLM output as untrusted input.
4. **AI never writes to authorization tables directly.** All AI output is a *proposal*. Irreversible actions (granting/revoking access, provisioning, offboarding) pass through a human approval gate. The deterministic service layer is the only thing that mutates access state.
5. **The audit log is append-only and immutable.** Every state change is recorded with actor, before/after, and reason. Never update or delete audit rows.
6. **Type-safe throughout.** Strict TypeScript, no `any`, no `@ts-ignore`. Validate all external input (forms, API, LLM output) with Zod at the boundary.

If any requirement is ambiguous, choose the option that is more secure and more auditable, and leave a short note in code comments explaining the decision.

---

## 1. Tech stack (use exactly this)

- **Next.js 15** (App Router). Server Components for reads, Server Actions for mutations. No separate API service.
- **TypeScript** (strict mode).
- **Supabase**: Postgres + Auth + Row Level Security + Storage. Use the Supabase JS client with proper server/client separation (`@supabase/ssr`).
- **Drizzle ORM** for the schema, migrations, and typed queries (deterministic layer). Generate and commit SQL migrations.
- **Zod** for all input/output validation.
- **LLM access** via a thin provider abstraction (`lib/llm/`) configurable by env var `LLM_PROVIDER` = `openrouter` | `anthropic`. Default to OpenRouter (free-tier model, e.g. a configurable `LLM_MODEL`). The abstraction exposes `complete()` and `completeJSON<T>(schema)` (the latter validates against a Zod schema and retries once on parse failure).
- **node-sql-parser** (or equivalent) for SQL AST validation in the NL→SQL pipeline.
- Plain Tailwind utility classes only where structure requires them; no custom design system.

Keep it a single Next.js monolith. This is an internal tool for a small team — do not introduce microservices, message queues, or unnecessary infrastructure.

---

## 2. Core architecture (read carefully — this is the spine)

**Two distinct entity kinds. Never conflate them:**

- **Operators** (`app_users`): the HR / warehouse-team members who log into the tool and operate it. They have *operator roles* (`viewer`, `hr`, `warehouse_admin`) that govern what they can do *in the tool*.
- **Warehouse users** (`warehouse_users`): the warehouse workers being managed. They are *records*, not logins. Their "roles" and "access rights" describe access to *warehouse systems*, and are completely independent of operator RBAC.

**Three layers, with a one-way trust boundary:**

- **Deterministic layer** (services + rules engine): the only code allowed to mutate access state. Fully explainable. Handles RBAC, CRUD, rule evaluation, grant/revoke execution, audit writes.
- **AI layer**: read-only with respect to authorization. Produces *suggestions, detections, explanations, and parsed intents*. Writes only to the `ai_proposals` queue.
- **Human approval gate**: any AI-originated change to access/provisioning/offboarding must be approved by an operator before the deterministic layer executes it.

Data flow for any access change: `AI proposal → ai_proposals (pending) → operator review → approve → deterministic service executes → audit_log`. AI output physically cannot bypass this path.

---

## 3. Data model

Implement with Drizzle. All tables get `id` (uuid, default gen), `created_at`, `updated_at` unless noted. Use foreign keys and appropriate indexes (especially on `warehouse_id`, `status`, `expires_at`, `last_used_at`).

**Operators & tenancy**
- `app_users` — operators. `auth_user_id` (FK to Supabase auth), `email`, `full_name`, `operator_role` (`viewer`|`hr`|`warehouse_admin`), `is_active`.
- `app_user_warehouses` — which warehouses an operator may access (M:N with `app_users` / `warehouses`).
- `warehouses` — `code`, `name`, `location`.

**Managed workforce**
- `warehouse_users` — `employee_id` (unique), `full_name`, `email`, `warehouse_id`, `role_id`, `status` (`pending`|`active`|`suspended`|`offboarded`), `hire_date`, `termination_date` (nullable).
- `roles` — warehouse role catalog: `code` (e.g. `forklift_operator`), `name`, `description`.
- `systems` — systems access is granted to: `code` (e.g. `wms`, `badge`, `email`, `shared_account`), `name`.
- `permissions` — granular rights: `system_id`, `code`, `name`, `description`.
- `role_permissions` — role template: which permissions a role grants by default (M:N `roles`/`permissions`).
- `user_access` — **actually granted rights** (the most important table; AI reads it, only deterministic layer writes it): `warehouse_user_id`, `permission_id`, `granted_by` (operator), `granted_at`, `expires_at` (nullable), `last_used_at` (nullable), `source` (`role_template`|`manual`|`temporary_project`), `status` (`active`|`revoked`|`expired`), `revoked_at`, `revoked_by` (nullable).

**Training & compliance**
- `certificates` — catalog: `code`, `name`, `validity_days` (nullable for non-expiring).
- `user_certificates` — `warehouse_user_id`, `certificate_id`, `issued_at`, `expires_at` (computed from validity), `status` (`valid`|`expired`|`revoked`), `document_path` (Supabase Storage key, nullable).

**Onboarding / offboarding**
- `checklist_templates` — `name`, `type` (`onboarding`|`offboarding`), `role_id` (nullable = applies to all).
- `checklist_items` — `template_id`, `label`, `order`, `is_required`.
- `user_checklists` — `warehouse_user_id`, `template_id`, `type`, `status` (`in_progress`|`completed`), `started_at`, `completed_at`.
- `user_checklist_items` — `user_checklist_id`, `checklist_item_id`, `is_done`, `done_by`, `done_at`.

**Audit & AI**
- `audit_log` — **append-only, never updated/deleted**: `entity_type`, `entity_id`, `action`, `actor_id` (operator), `ai_assisted` (bool), `proposal_id` (nullable), `before` (jsonb), `after` (jsonb), `reason` (text), `created_at`. Enforce immutability with a DB trigger that rejects `UPDATE`/`DELETE`.
- `ai_proposals` — the AI→human queue: `type` (`provision`|`revoke_access`|`anomaly_flag`|`offboard_completeness`), `target_entity_type`, `target_entity_id` (nullable), `payload` (jsonb — the structured proposed change), `explanation` (text — human-readable LLM rationale), `generated_query` (text, nullable — for NL→SQL transparency), `status` (`pending`|`approved`|`rejected`|`expired`), `created_by` (`system`), `reviewed_by` (nullable operator), `reviewed_at` (nullable), `review_note` (nullable).

Generate seed data (see §9). Commit the migration SQL.

---

## 4. Authentication & authorization

- Supabase Auth for operators. Wire up email/password login plus support for an OAuth/SSO provider via env config (assume a corporate IdP may be plugged in later — make the provider configurable, do not hardcode). Operators self-authenticate; do not build an operator self-signup flow — operators are provisioned by a `warehouse_admin` or seeded.
- **Row Level Security on every table.** Enforce in Postgres, not just app code:
  - An operator sees only rows for warehouses in `app_user_warehouses`.
  - `viewer` = read-only. `hr` = manage warehouse_users, certificates, checklists, propose access. `warehouse_admin` = full, including approving proposals, managing operators, editing rules.
  - Approving an `ai_proposals` row requires `warehouse_admin` (or a configurable approver role). Write the RLS policies and test them.
- Server Actions must re-check operator role server-side before any mutation. RLS is the backstop, not the only check.
- Provide a helper `requireOperator(roles[])` used at the top of every protected Server Action.

---

## 5. Deterministic rules engine

Implement a declarative, versioned rules engine in `lib/rules/`. Rules are defined in typed config (TS objects validated by Zod), version-stamped, and evaluated deterministically. No LLM involvement. Every rule produces an explainable outcome that can be traced in the audit log.

Implement at minimum these rule types, each as a pure, tested function:
- **Certificate gate**: a role requiring a certificate (e.g. `forklift_operator` → forklift cert) blocks/flags floor access if the cert is missing or expired.
- **Segregation of duties (SoD)**: defined incompatible permission pairs cannot coexist on one user.
- **Temporary access expiry**: `user_access` with `source=temporary_project` and a past `expires_at` is auto-marked `expired` and scheduled for revocation.
- **Offboarding SLA**: when `warehouse_users.status` becomes `offboarded`, all active access must be revoked within an SLA window (configurable, e.g. 24h); overdue → escalation flag.

Provide an evaluator entry point `evaluateUser(userId)` returning structured findings, and a scheduled task (Next.js route handler protected by a cron secret, runnable via Supabase pg_cron or external scheduler) that runs evaluation across all active users and applies deterministic auto-actions (e.g. expiring temporary access) while routing anything requiring judgment into `ai_proposals` for explanation/approval.

---

## 6. AI subsystem

All four pipelines live under `lib/ai/`. Each treats LLM output as untrusted and validates it with Zod. None of them mutate authorization state directly.

### 6.1 NL → SQL (natural-language query over the workforce)
The headline feature. An operator types a question ("who at warehouse A has an expired forklift certificate but still has active floor access?") and gets a real, filtered result table.

Pipeline, in order:
1. Build the prompt from a curated set of **read-only reporting VIEWs** (not raw tables) plus few-shot examples. The LLM only ever sees these view definitions.
2. LLM generates a single `SELECT`.
3. **AST validation** with node-sql-parser: reject anything that is not exactly one `SELECT`; allow only the whitelisted reporting views; forbid all functions/keywords that mutate or escalate; force an injected `LIMIT`.
4. Execute under a **dedicated Postgres role that has `SELECT` only** on those views (create this role in a migration), with a statement timeout. Never execute generated SQL on the app's read-write connection.
5. Return the result set **and the generated SQL** to the operator for transparency.

This pipeline is read-only and does not create proposals.

### 6.2 Anomaly detection
A scheduled job that is **deterministic for detection, LLM only for explanation**:
- Compute, in SQL/TS (no LLM): per-user access vs. peer baseline (same role + warehouse — flag permissions held by a user but absent in most peers), dormant access (`last_used_at` older than configurable N days), SoD violations, and active access tied to expired certificates.
- For each finding, call the LLM to produce a human-readable explanation and a recommended action.
- Insert each as an `ai_proposals` row (`type=anomaly_flag` or `revoke_access`, `status=pending`) with the structured payload and the explanation.

### 6.3 NL provisioning
"Create a forklift operator at warehouse B with the same access as Péter."
1. LLM parses intent into a validated structured object: `{ action, role_code, warehouse_code, reference_user?, attributes }` via `completeJSON`.
2. Deterministically map role → `role_permissions` template (and merge reference user's access if specified).
3. Create an `ai_proposals` row (`type=provision`) with the proposed user + access set.
4. On approval, the deterministic service creates the `warehouse_user`, applies the grants, instantiates the onboarding checklist, and writes the audit entries.

### 6.4 Offboarding completeness assistant
When a user is set to `offboarded`:
1. Deterministic service assembles the full revocation set from `user_access`, `user_certificates`, and linked `systems` (incl. badge, shared accounts).
2. LLM cross-checks completeness against the user's history (audit log) and flags anything ever granted but missing from the revocation set.
3. Produce an `offboard_completeness` proposal with the complete revocation checklist; on approval the deterministic layer revokes everything and records each revocation in the audit log.

### Proposal lifecycle (shared)
Build the approval gate UI/logic: list pending proposals, show payload + explanation + generated query, allow approve/reject with a note. **Approval is the only path that triggers deterministic execution.** On execution, write `audit_log` with `ai_assisted=true`, `proposal_id` set, and `actor_id` = the approving operator (the human owns the action).

---

## 7. Functional scope (pages & flows)

Build all of these, each fully wired (plain markup, real data, working mutations):

1. **Operator login** + session handling, role-gated navigation.
2. **Dashboard**: counts and lists driven by real queries — active users, pending proposals, expiring certificates, offboarding-SLA breaches.
3. **Warehouse users**: list (filter by warehouse/role/status), detail view (profile, current access with source/expiry, certificates, checklist progress, change history from audit log), create/edit (deterministic + the NL-provisioning entry point), status transitions.
4. **Access management**: grant/revoke (deterministic, audited), view role template vs. actual access diff.
5. **Certificates**: issue/renew/revoke, upload supporting document to Supabase Storage, expiry tracking.
6. **Checklists**: instantiate onboarding/offboarding from templates, tick items (audited), completion state.
7. **NL query console**: the §6.1 pipeline with result table + shown SQL.
8. **Proposals inbox**: the §6.4 approval gate.
9. **Anomalies**: surfaced anomaly proposals with explanations and one-click approve-to-remediate.
10. **Audit log viewer**: filterable, read-only, showing actor / ai_assisted / before-after diff.
11. **Admin**: manage operators, warehouses, roles, role templates, rule config.

Each page's **definition of done**: loads real data via Server Components, mutations via Server Actions with `requireOperator` + Zod validation, RLS enforced, and every state-changing action writes to `audit_log`.

---

## 8. Security requirements (consolidated)

- RLS policies on all tables, tested. Operators isolated by warehouse.
- Separate read-only Postgres role for NL→SQL, created in migration; generated SQL never runs on the read-write connection.
- AST validation + view allowlist + forced LIMIT + statement timeout on all generated SQL.
- All LLM JSON output validated with Zod before use; never trust shape or content.
- Zod validation at every input boundary (forms, server actions, route handlers, LLM output).
- Audit log immutability enforced by DB trigger.
- Secrets only via env (never committed). LLM keys server-side only — never exposed to the client.
- AI cannot mutate `user_access`, `warehouse_users`, `user_certificates`, or `user_checklist_items` directly — only via approved proposals executed by the deterministic layer.

---

## 9. Seed & demo data

Provide a seed script that creates a realistic, **internally consistent** dataset: 2–3 warehouses, ~5 operators across the three roles, role catalog with templates, systems + permissions, 25–40 warehouse users across all statuses, certificates (some expiring soon, some expired), in-progress and completed checklists, and a populated audit log. Seed must deliberately include a few **detectable anomalies** (a dormant grant, an SoD violation, expired-cert-with-active-access) so the AI pipelines have something real to surface in a demo. Seeding is the only acceptable source of non-live data — application logic must never fabricate data.

---

## 10. Project structure

```
/app                  routes (App Router), Server Components + Server Actions
/lib
  /db                 drizzle schema, client, migrations
  /auth               supabase clients (server/client), requireOperator
  /rules              declarative rules engine + evaluator + scheduled task
  /ai                 llm provider abstraction + the 4 pipelines
  /services           deterministic mutation services (grant, revoke, provision, offboard) — all audit-writing
  /validation         zod schemas
/components           plain functional components (no design system)
```

Keep deterministic services as the single source of truth for mutations; Server Actions call services, services write audit. AI pipelines call services only indirectly, through approved proposals.

---

## 11. Testing

- Unit tests for the rules engine (every rule type), the SQL AST validator (must reject mutations, multi-statements, non-allowlisted views, missing LIMIT), and LLM-output validation.
- Integration test for the full proposal lifecycle: AI proposal → approve → deterministic execution → audit entry.
- A test proving an operator cannot read another warehouse's rows (RLS).
- Tests must pass; do not stub out the assertions.

---

## 12. Build order

1. Schema + migrations + seed + Drizzle client. Verify data loads.
2. Auth + RLS + `requireOperator` + role-gated nav. Verify isolation.
3. Deterministic services + audit logging + rules engine. Verify mutations are audited.
4. Core CRUD pages (users, access, certificates, checklists) wired to services.
5. LLM abstraction, then the four AI pipelines, each behind the proposal/approval gate.
6. NL query console with full SQL-safety stack.
7. Dashboard, audit viewer, admin, anomalies, proposals inbox.
8. Tests. Then a final pass confirming zero placeholders and every flow working end to end.

---

## 13. Out of scope (do not build)

- Visual design, theming, branding, animations, responsive polish — Stitch handles UI design. Markup stays plain and functional.
- Operator self-signup, billing, multi-org SaaS tenancy, mobile apps.
- Any LLM involvement in the authorization decision path.

---

## 14. Environment

Create `.env.example` documenting every required variable: Supabase URL/keys (anon + service role), database URL + read-only role URL, `LLM_PROVIDER`, `LLM_MODEL`, LLM API key, cron secret, OAuth/SSO config placeholders. Never commit real secrets. Document setup, migration, seed, and run commands in a short `README.md`.

---

Deliver a running application: `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev` should bring up a fully functional Warehouse UserHub with working auth, RLS, deterministic access management, audited mutations, and all four AI pipelines operating through the human approval gate — with no placeholders anywhere.
