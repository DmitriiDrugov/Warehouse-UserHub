/**
 * LLM-backed explainer for rule findings (§5 + §6.2).
 *
 * Used by the cron evaluator to attach a short human-readable rationale
 * to each AI proposal. Treats LLM output as plain text — no JSON, no
 * structured fields — so failure modes are limited to "less helpful
 * explanation". A failed call falls back to a deterministic template
 * so the evaluator keeps making progress.
 */

import { getLLM } from "../llm";
import type { FindingExplainer } from "../rules/evaluator";

const SYSTEM_PROMPT = [
  "You are an internal-tooling assistant for a warehouse access-management system.",
  "Given a structured rule finding about one warehouse worker, write a short, neutral, factual explanation suitable for the reviewing operator.",
  "Two to four sentences. Plain prose. No JSON. No fences. No advice about whether to approve — just describe what was found and why it matters.",
].join(" ");

export const llmExplainer: FindingExplainer = async (finding, ctx) => {
  const llm = getLLM();
  const userPayload = {
    finding: {
      type: finding.type,
      severity: finding.severity,
      title: finding.title,
      details: finding.details,
    },
    user: {
      roleCode: ctx.roleCode,
      warehouseId: ctx.warehouseId,
      status: ctx.status,
      activeAccessCount: ctx.access.filter((a) => a.status === "active").length,
      certificateCount: ctx.certificates.length,
    },
  };
  try {
    const text = await llm.complete(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Finding to explain (JSON below). Write 2–4 plain sentences.\n\n" +
            JSON.stringify(userPayload, null, 2),
        },
      ],
      { temperature: 0.2, maxTokens: 350 },
    );
    return text.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `${finding.title}. (LLM explanation unavailable: ${message}.) Details: ${JSON.stringify(finding.details)}`;
  }
};
