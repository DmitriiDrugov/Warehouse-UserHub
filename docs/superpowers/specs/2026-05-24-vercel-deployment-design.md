# Vercel Deployment — Design Spec

**Date:** 2026-05-24  
**Approach:** Minimal (A)  
**Status:** Approved

---

## Goal

Prepare Warehouse UserHub for production deployment on Vercel with minimal code changes.

---

## Scope

- Create `vercel.json` to configure cron jobs
- Document pre-deploy steps (migrations, env vars)

The codebase is already well-prepared for serverless deployment; no app code changes are required.

---

## Changes

### 1. `vercel.json` (new file, project root)

```json
{
  "crons": [
    {
      "path": "/api/cron/evaluate",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

- Schedules `POST /api/cron/evaluate` every 6 hours.
- Vercel Cron automatically appends `Authorization: Bearer <CRON_SECRET>`, matching the existing constant-time comparison in `app/api/cron/evaluate/route.ts`.

---

## Why Nothing Else Needs Changing

| Requirement | How it's already met |
|---|---|
| `prepare: false` on postgres client | `lib/db/client.ts` — required for Supabase transaction pooler (port 6543) |
| Native module bundling | `next.config.ts` — `serverExternalPackages: ["postgres", "drizzle-orm"]` |
| Node.js ≥ 20 | `package.json` — `engines: { "node": ">=20.0.0" }` (Vercel reads this) |
| CRON_SECRET validation | `app/api/cron/evaluate/route.ts` — constant-time Bearer check |
| Env var documentation | `.env.example` — all variables documented with descriptions |

---

## Pre-Deploy Checklist (manual steps, not in code)

### A. Supabase setup
- [ ] Confirm `worker-documents` storage bucket exists and is private
- [ ] Confirm `nl_query_reader` role exists (created by migration `0001_easy_newton_destine.sql`)

### B. Run database migrations
```bash
# Against production DATABASE_URL — run locally before first Vercel deploy
pnpm db:migrate
```

### C. Vercel project setup
1. Connect GitHub repository via Vercel Git Integration
2. Set **all** environment variables from `.env.example` in:  
   `Vercel Dashboard → Settings → Environment Variables`  
   Required variables:

   | Variable | Notes |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server-only, never expose |
   | `DATABASE_URL` | Transaction pooler, port 6543 |
   | `DATABASE_URL_READONLY` | `nl_query_reader` role, port 6543 |
   | `LLM_PROVIDER` | `openrouter` or `anthropic` |
   | `LLM_MODEL` | Provider-specific model ID |
   | `LLM_API_KEY` | Provider API key |
   | `CRON_SECRET` | ≥16 chars random string |
   | `LLM_BASE_URL` | Optional — leave empty for defaults |
   | `OAUTH_PROVIDERS` | Optional — leave empty for email+password only |
   | `NL_SQL_STATEMENT_TIMEOUT_MS` | Optional — default 5000 |
   | `NL_SQL_MAX_ROWS` | Optional — default 200 |
   | `ANOMALY_DORMANT_DAYS` | Optional — default 90 |
   | `OFFBOARDING_SLA_HOURS` | Optional — default 24 |
   | `PROPOSAL_EXPIRY_DAYS` | Optional — default 30 |

### D. Deploy
```bash
git push origin main  # Vercel builds automatically
```

---

## Vercel Cron Notes

- Vercel Cron Jobs are available on Hobby plan (1 cron max, minimum interval: daily) and Pro plan (multiple crons, hourly minimum).
- `0 */6 * * *` (every 6 hours) requires **Pro plan or higher**.
- On Hobby: use `0 0 * * *` (daily at midnight UTC) instead.

---

## Out of Scope

- Database migrations in Vercel build step (runs manually)
- Connection pool tuning (current settings are safe with transaction pooler)
- GitHub Actions CI/CD (Vercel Git Integration handles deploys)
