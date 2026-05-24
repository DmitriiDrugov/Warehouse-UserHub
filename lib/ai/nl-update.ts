/**
 * Natural-language update pipeline (§6.2).
 *
 * Supports a deliberately narrow set of write operations so that
 * the AI cannot mutate arbitrary data. Currently supported:
 *
 *   grant_certificate — insert a user_certificates row for one or
 *     more workers identified by name.
 *
 * Flow:
 *   1. LLM parses free text → structured UpdateIntent JSON (validated by Zod).
 *   2. Resolve worker names → warehouseUsers rows via ILIKE.
 *   3. Resolve certificate code → certificates row.
 *   4. INSERT into user_certificates via dbAdmin (bypasses RLS; operator
 *      role is enforced upstream by requireOperator in the server action).
 *   5. Return a typed NlUpdateResult for rendering.
 */

import { z } from "zod";
import { ilike } from "drizzle-orm";
import { dbAdmin } from "../db/client";
import { certificates, userCertificates, warehouseUsers } from "../db/schema";
import { getLLM } from "../llm";

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
ONLY supported operation:
  grant_certificate — assign a training / compliance certificate to one or more workers.
  Output: {"op":"grant_certificate","workers":["full name"],"certificateCode":"code","issuedAt":"YYYY-MM-DD","expiresAt":"YYYY-MM-DD or null"}

Anything else:
  Output: {"op":"unsupported","reason":"<one short sentence>"}

Rules:
- Today = ${todayStr}. Substitute "today" / "todays date" with this value.
- certificateCode: snake_case code inferred from context (e.g. first_aid, forklift, hazmat, fire_safety, evacuation_warden).
- workers: extract full names from the request text OR from the conversation context above if the request uses pronouns ("them", "those", "all of them").
- expiresAt: include only when explicitly stated in the request; otherwise null.
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

  const { workers: workerNames, certificateCode, issuedAt, expiresAt } = intent;

  // 1. Resolve workers — ILIKE on full_name, deduplicate by id
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

  const unique = [...new Map(matches.map((w) => [w.id, w])).values()];
  if (unique.length === 0) {
    throw new Error(
      `No workers found matching: ${workerNames.join(", ")}. Check the name spelling.`,
    );
  }

  // 2. Resolve certificate by code
  const certRows = await dbAdmin
    .select({
      id: certificates.id,
      name: certificates.name,
      validityDays: certificates.validityDays,
    })
    .from(certificates)
    .where(ilike(certificates.code, certificateCode));

  const cert = certRows[0];
  if (!cert) {
    throw new Error(
      `Certificate not found: "${certificateCode}". Check the certificates catalog.`,
    );
  }

  // 3. Calculate expiry (explicit > validity_days > none)
  const issuedDate = new Date(issuedAt);
  let expiresDate: Date | undefined;
  if (expiresAt) {
    expiresDate = new Date(expiresAt);
  } else if (cert.validityDays) {
    expiresDate = new Date(
      issuedDate.getTime() + cert.validityDays * 86_400_000,
    );
  }

  // 4. Insert user_certificates for each resolved worker
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
    affected: unique.map((w) => ({
      employeeId: w.employeeId,
      fullName: w.fullName,
    })),
    summary: `"${cert.name}" certificate (issued ${issuedAt}${expiryStr}) recorded for ${unique.map((w) => w.fullName).join(", ")}.`,
  };
}
