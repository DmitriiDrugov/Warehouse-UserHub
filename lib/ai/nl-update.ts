/**
 * Natural-language update pipeline (§6.2).
 *
 * Supports a deliberately narrow set of write operations so that
 * the AI cannot mutate arbitrary data. Currently supported:
 *
 *   grant_certificate    — insert a user_certificates row for one or more workers.
 *   revoke_certificate   — set status='revoked' on matching user_certificates rows.
 *   update_worker_email  — update warehouseUsers.email for one or more workers.
 *   update_worker_status — change warehouseUsers.status (pending/active/suspended/offboarded).
 *
 * Flow:
 *   1. LLM parses free text → structured UpdateIntent JSON (validated by Zod).
 *   2. Resolve worker names → warehouseUsers rows via ILIKE.
 *   3. For cert ops: resolve certificate code → certificates row.
 *   4. Execute via dbAdmin (bypasses RLS; operator role enforced upstream by
 *      requireOperator in the server action).
 *   5. Return a typed NlUpdateResult for rendering.
 *
 * Note: userAccess is intentionally excluded — the schema comment marks it
 * as "only the deterministic services layer writes to it; AI never touches it."
 */

import { and, eq, ilike } from "drizzle-orm";
import { z } from "zod";

import { dbAdmin } from "../db/client";
import { certificates, userCertificates, warehouseUsers } from "../db/schema";
import { getLLM } from "../llm";
import { WAREHOUSE_USER_STATUSES } from "../validation/enums";

// ─── Intent schema ────────────────────────────────────────────────────────────

const UpdateIntentSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("grant_certificate"),
    /** Worker names/surnames as given in the request. */
    workers: z.array(z.string().min(1)).min(1),
    /** Best-guess snake_case certificate code (e.g. first_aid, forklift). */
    certificateCode: z.string().min(1),
    /** ISO date string (YYYY-MM-DD). "today" must be resolved before output. */
    issuedAt: z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), "issuedAt must be ISO date"),
    /** ISO date or null if not explicitly stated. */
    expiresAt: z.string().nullable().optional(),
  }),
  z.object({
    op: z.literal("revoke_certificate"),
    workers: z.array(z.string().min(1)).min(1),
    certificateCode: z.string().min(1),
  }),
  z.object({
    op: z.literal("update_worker_email"),
    workers: z.array(z.string().min(1)).min(1),
    /** The new e-mail address. */
    newEmail: z.string().email(),
  }),
  z.object({
    op: z.literal("update_worker_status"),
    workers: z.array(z.string().min(1)).min(1),
    /** Target status — must be one of the known warehouse_user_status values. */
    newStatus: z.enum(WAREHOUSE_USER_STATUSES),
  }),
  z.object({
    op: z.literal("unsupported"),
    reason: z.string(),
  }),
]);

// ─── Public types ─────────────────────────────────────────────────────────────

export type NlUpdateResult = {
  operation: string;
  affected: Array<{ employeeId: string; fullName: string }>;
  summary: string;
};

export class UpdateUnsupportedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UpdateUnsupportedError";
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function resolveWorkers(workerNames: string[]) {
  const matches = (
    await Promise.all(
      workerNames.map((name) =>
        dbAdmin
          .select({
            id: warehouseUsers.id,
            fullName: warehouseUsers.fullName,
            employeeId: warehouseUsers.employeeId,
          })
          .from(warehouseUsers)
          .where(ilike(warehouseUsers.fullName, `%${name}%`)),
      ),
    )
  ).flat();

  return [...new Map(matches.map((w) => [w.id, w])).values()];
}

async function resolveCertificate(code: string) {
  const rows = await dbAdmin
    .select({
      id: certificates.id,
      name: certificates.name,
      validityDays: certificates.validityDays,
    })
    .from(certificates)
    .where(ilike(certificates.code, code));
  return rows[0] ?? null;
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function runNlUpdate(
  text: string,
  model?: string,
  context?: string,
): Promise<NlUpdateResult> {
  const llm = getLLM();
  const todayStr = new Date().toISOString().slice(0, 10);

  const contextSection = context
    ? `\nConversation context — use it to resolve pronouns like "them", "those workers", "all of them", "the ones above":\n---\n${context}\n---\n`
    : "";

  const intent = await llm.completeJSON(
    [
      {
        role: "system",
        content: `Parse a warehouse management update request into JSON.${contextSection}
SUPPORTED OPERATIONS:

1. grant_certificate — assign a training/compliance certificate to one or more workers.
   Output: {"op":"grant_certificate","workers":["full name"],"certificateCode":"code","issuedAt":"YYYY-MM-DD","expiresAt":"YYYY-MM-DD or null"}

2. revoke_certificate — revoke an existing valid certificate for one or more workers.
   Output: {"op":"revoke_certificate","workers":["full name"],"certificateCode":"code"}

3. update_worker_email — update the email address for one or more workers.
   Output: {"op":"update_worker_email","workers":["full name"],"newEmail":"email@domain.com"}

4. update_worker_status — change the employment/onboarding status for one or more workers.
   Valid values: pending, active, suspended, offboarded
   Output: {"op":"update_worker_status","workers":["full name"],"newStatus":"active"}

Anything else:
   Output: {"op":"unsupported","reason":"<one short sentence>"}

Rules:
- Today = ${todayStr}. Substitute "today" / "today's date" with this value.
- certificateCode: snake_case code inferred from context (e.g. first_aid, forklift, hazmat, fire_safety, evacuation_warden).
- workers: extract full names from the request text OR from the conversation context above if the request uses pronouns ("them", "those", "all of them").
- expiresAt (grant_certificate only): include only when explicitly stated; otherwise null.
- Output JSON only. No prose, no fences.`,
      },
      { role: "user", content: text.slice(0, 600) },
    ],
    UpdateIntentSchema,
    { temperature: 0, maxTokens: 400, model },
  );

  if (intent.op === "unsupported") {
    throw new UpdateUnsupportedError(intent.reason);
  }

  // ── grant_certificate ──────────────────────────────────────────────────────

  if (intent.op === "grant_certificate") {
    const { workers: workerNames, certificateCode, issuedAt, expiresAt } = intent;

    const unique = await resolveWorkers(workerNames);
    if (unique.length === 0) {
      throw new Error(
        `No workers found matching: ${workerNames.join(", ")}. Check the name spelling.`,
      );
    }

    const cert = await resolveCertificate(certificateCode);
    if (!cert) {
      throw new Error(
        `Certificate not found: "${certificateCode}". Check the certificates catalog.`,
      );
    }

    const issuedDate = new Date(issuedAt);
    let expiresDate: Date | undefined;
    if (expiresAt) {
      expiresDate = new Date(expiresAt);
    } else if (cert.validityDays) {
      expiresDate = new Date(
        issuedDate.getTime() + cert.validityDays * 86_400_000,
      );
    }

    for (const worker of unique) {
      await dbAdmin.insert(userCertificates).values({
        warehouseUserId: worker.id,
        certificateId: cert.id,
        issuedAt: issuedDate,
        ...(expiresDate ? { expiresAt: expiresDate } : {}),
        status: "valid",
      });
    }

    const expiryStr = expiresDate
      ? ` · expires ${expiresDate.toISOString().slice(0, 10)}`
      : "";
    return {
      operation: `Granted "${cert.name}"`,
      affected: unique.map((w) => ({ employeeId: w.employeeId, fullName: w.fullName })),
      summary: `"${cert.name}" certificate (issued ${issuedAt}${expiryStr}) recorded for ${unique.map((w) => w.fullName).join(", ")}.`,
    };
  }

  // ── revoke_certificate ─────────────────────────────────────────────────────

  if (intent.op === "revoke_certificate") {
    const { workers: workerNames, certificateCode } = intent;

    const unique = await resolveWorkers(workerNames);
    if (unique.length === 0) {
      throw new Error(
        `No workers found matching: ${workerNames.join(", ")}. Check the name spelling.`,
      );
    }

    const cert = await resolveCertificate(certificateCode);
    if (!cert) {
      throw new Error(
        `Certificate not found: "${certificateCode}". Check the certificates catalog.`,
      );
    }

    for (const worker of unique) {
      await dbAdmin
        .update(userCertificates)
        .set({ status: "revoked" })
        .where(
          and(
            eq(userCertificates.warehouseUserId, worker.id),
            eq(userCertificates.certificateId, cert.id),
            eq(userCertificates.status, "valid"),
          ),
        );
    }

    return {
      operation: `Revoked "${cert.name}"`,
      affected: unique.map((w) => ({ employeeId: w.employeeId, fullName: w.fullName })),
      summary: `"${cert.name}" certificate revoked for ${unique.map((w) => w.fullName).join(", ")}.`,
    };
  }

  // ── update_worker_email ────────────────────────────────────────────────────

  if (intent.op === "update_worker_email") {
    const { workers: workerNames, newEmail } = intent;

    const unique = await resolveWorkers(workerNames);
    if (unique.length === 0) {
      throw new Error(
        `No workers found matching: ${workerNames.join(", ")}. Check the name spelling.`,
      );
    }

    for (const worker of unique) {
      await dbAdmin
        .update(warehouseUsers)
        .set({ email: newEmail })
        .where(eq(warehouseUsers.id, worker.id));
    }

    return {
      operation: "Updated email",
      affected: unique.map((w) => ({ employeeId: w.employeeId, fullName: w.fullName })),
      summary: `Email updated to "${newEmail}" for ${unique.map((w) => w.fullName).join(", ")}.`,
    };
  }

  // ── update_worker_status ───────────────────────────────────────────────────
  // Exhaustive: intent.op === "update_worker_status" at this point.

  const { workers: workerNames, newStatus } = intent;

  const unique = await resolveWorkers(workerNames);
  if (unique.length === 0) {
    throw new Error(
      `No workers found matching: ${workerNames.join(", ")}. Check the name spelling.`,
    );
  }

  for (const worker of unique) {
    await dbAdmin
      .update(warehouseUsers)
      .set({ status: newStatus })
      .where(eq(warehouseUsers.id, worker.id));
  }

  const STATUS_LABEL: Record<string, string> = {
    pending: "Pending",
    active: "Active",
    suspended: "Suspended",
    offboarded: "Offboarded",
  };

  return {
    operation: `Status → ${STATUS_LABEL[newStatus] ?? newStatus}`,
    affected: unique.map((w) => ({ employeeId: w.employeeId, fullName: w.fullName })),
    summary: `Status set to "${newStatus}" for ${unique.map((w) => w.fullName).join(", ")}.`,
  };
}
