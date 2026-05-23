/**
 * Scheduled evaluation endpoint (§5).
 *
 * Protect with `Authorization: Bearer <CRON_SECRET>`. Wire up via
 * Supabase `pg_cron` (cron.schedule that calls https://<app>/api/cron/evaluate)
 * or any external scheduler.
 *
 * Runs `runEvaluation()` with the LLM-backed explainer (anomaly detection
 * §6.2 share the same evaluator output: every non-auto finding becomes
 * an ai_proposals row with an LLM-written explanation).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { llmExplainer } from "@/lib/ai/explain";
import { serverEnv } from "@/lib/env";
import { dbAdmin } from "@/lib/db/client";
import { expireOldProposals } from "@/lib/services/proposals";
import { runEvaluation } from "@/lib/rules/evaluator";

const HEADER = "authorization";

function isAuthorized(request: Request): boolean {
  const header = request.headers.get(HEADER) ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) return false;
  // Constant-time-ish comparison.
  const provided = match[1] ?? "";
  const expected = serverEnv().CRON_SECRET;
  if (provided.length !== expected.length) return false;
  let ok = 0;
  for (let i = 0; i < provided.length; i++) {
    ok |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return ok === 0;
}

const NowSchema = z
  .object({ now: z.string().datetime().optional() })
  .strict();

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { now?: string } = {};
  try {
    const text = await request.text();
    if (text.length > 0) body = NowSchema.parse(JSON.parse(text));
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid body",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  const env = serverEnv();
  const now = body.now ? new Date(body.now) : new Date();

  const [expiry, report] = await Promise.all([
    expireOldProposals(dbAdmin, env.PROPOSAL_EXPIRY_DAYS),
    runEvaluation({ explain: llmExplainer, now }),
  ]);

  return NextResponse.json({ ok: true, report: { ...report, expiredProposals: expiry.expired } });
}
