# Vercel Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `vercel.json` to configure Vercel Cron Jobs so that `POST /api/cron/evaluate` is called automatically every 6 hours.

**Architecture:** One new file at the project root. The existing cron route already validates `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron supplies automatically — no route changes needed.

**Tech Stack:** Vercel (cron), Next.js 15 App Router

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `vercel.json` | Declares Vercel Cron schedule for the evaluate endpoint |

---

### Task 1: Create `vercel.json`

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create the file**

Create `vercel.json` at the project root with the following content:

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

- [ ] **Step 2: Verify the file is valid JSON**

Run:
```bash
node -e "require('./vercel.json'); console.log('valid JSON')"
```

Expected output:
```
valid JSON
```

- [ ] **Step 3: Verify the build still passes**

Run:
```bash
pnpm build
```

Expected: build completes without errors. `vercel.json` is not read during build, so no change in outcome — this is a sanity check.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "chore: add vercel.json with cron schedule for /api/cron/evaluate"
```

---

## Post-Deploy Verification

After deploying to Vercel, confirm the cron is registered:

1. Vercel Dashboard → your project → **Cron Jobs** tab
2. You should see one entry: `POST /api/cron/evaluate` with schedule `0 */6 * * *`
3. Trigger it manually from the dashboard and check the function logs for `{ ok: true, report: {...} }`

> **Plan note:** Hobby plan supports only 1 cron job at a minimum daily interval. `0 */6 * * *` requires Pro plan. If on Hobby, change schedule to `0 0 * * *` before deploying.
