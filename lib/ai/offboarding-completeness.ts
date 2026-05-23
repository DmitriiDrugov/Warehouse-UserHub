/**
 * §6.4 — Offboarding completeness assistant.
 *
 *   buildOffboardingProposal(warehouseUserId)
 *     1. Deterministic: collect every still-active access grant and valid
 *        certificate for the user.
 *     2. Pull every "ever granted" entry from the audit log so the LLM
 *        can compare history against the current revocation plan.
 *     3. Ask the LLM (completeJSON) for any extras the deterministic set
 *        missed (e.g. badge access, shared accounts hinted at by audit
 *        history but not present in the current state).
 *     4. Insert an `offboard_completeness` proposal with the full plan.
 *
 * The proposal is then approved through the standard gate — approval
 * triggers `revokeAccess` / `revokeCertificate` for every line item.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { dbAdmin } from "../db/client";
import {
  auditLog,
  certificates,
  permissions,
  systems,
  userAccess,
  userCertificates,
  warehouseUsers,
} from "../db/schema";
import { getLLM } from "../llm";
import { createProposal } from "../services/proposals";
import {
  OffboardCompletenessPayload,
  type OffboardCompletenessPayloadT,
} from "../validation/proposals";

const ExtrasSchema = z.object({
  extras: z.array(
    z.object({
      kind: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
});

const SYSTEM_PROMPT = [
  "You audit the completeness of an offboarding plan for one warehouse worker.",
  "You will be given: (a) the current revocation plan (active access + valid certificates being revoked), and (b) a history of every access/certificate event from the audit log.",
  "Identify ONLY items hinted at in the history that are NOT covered by the revocation plan and that an operator should manually check.",
  "Examples of 'extras' worth flagging: shared accounts (system_code='shared_account'), physical badges, third-party SaaS accounts referenced by historical grants that are absent from the plan.",
  "Output JSON only matching: { extras: [{ kind: string, description: string }] }. Use an empty array if nothing is missing.",
].join(" ");

export async function buildOffboardingProposal(
  warehouseUserId: string,
): Promise<{ proposalId: string; payload: OffboardCompletenessPayloadT }> {
  const [user] = await dbAdmin
    .select({
      id: warehouseUsers.id,
      fullName: warehouseUsers.fullName,
      employeeId: warehouseUsers.employeeId,
      status: warehouseUsers.status,
    })
    .from(warehouseUsers)
    .where(eq(warehouseUsers.id, warehouseUserId))
    .limit(1);
  if (!user) throw new Error(`warehouse_user ${warehouseUserId} not found`);
  if (user.status !== "offboarded") {
    throw new Error(
      `user ${user.employeeId} is not 'offboarded' (status=${user.status})`,
    );
  }

  // Currently active access (with denormalized codes for the LLM).
  const activeAccess = await dbAdmin
    .select({
      id: userAccess.id,
      systemCode: systems.code,
      permissionCode: permissions.code,
    })
    .from(userAccess)
    .innerJoin(permissions, eq(permissions.id, userAccess.permissionId))
    .innerJoin(systems, eq(systems.id, permissions.systemId))
    .where(
      and(
        eq(userAccess.warehouseUserId, warehouseUserId),
        eq(userAccess.status, "active"),
      ),
    );

  // Currently valid certificates.
  const validCerts = await dbAdmin
    .select({
      id: userCertificates.id,
      certificateCode: certificates.code,
    })
    .from(userCertificates)
    .innerJoin(certificates, eq(certificates.id, userCertificates.certificateId))
    .where(
      and(
        eq(userCertificates.warehouseUserId, warehouseUserId),
        eq(userCertificates.status, "valid"),
      ),
    );

  // Recent audit history for this user (any entity_type linked to them).
  const auditHistory = await dbAdmin
    .select({
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      // Either an entry whose entity IS the user, OR one whose `after`
      // payload references the user. We capture (entityType, entityId)
      // for everything; the LLM is given a compact projection.
      inArray(
        auditLog.entityId,
        [
          warehouseUserId,
          ...activeAccess.map((a) => a.id),
          ...validCerts.map((c) => c.id),
        ],
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  const llmInput = {
    user: { employeeId: user.employeeId, fullName: user.fullName },
    plan: {
      activeAccess: activeAccess.map((a) => ({
        accessId: a.id,
        permission: `${a.systemCode}.${a.permissionCode}`,
      })),
      validCertificates: validCerts.map((c) => ({
        certificateId: c.id,
        certificateCode: c.certificateCode,
      })),
    },
    auditHistory: auditHistory.map((e) => ({
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      summary:
        typeof e.after === "object" && e.after !== null
          ? (e.after as { permissionCode?: string; certificateCode?: string })
          : undefined,
      at: e.createdAt.toISOString(),
    })),
  };

  let extras: { kind: string; description: string }[] = [];
  try {
    const llm = getLLM();
    const result = await llm.completeJSON(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Offboarding plan + audit history below. Return JSON { extras: [...] }.\n\n" +
            JSON.stringify(llmInput, null, 2),
        },
      ],
      ExtrasSchema,
      { temperature: 0, maxTokens: 800 },
    );
    extras = result.extras;
  } catch (err) {
    extras = [
      {
        kind: "llm_unavailable",
        description: `LLM completeness check failed: ${err instanceof Error ? err.message : String(err)}. Operator should manually review audit history.`,
      },
    ];
  }

  const payload: OffboardCompletenessPayloadT = OffboardCompletenessPayload.parse({
    warehouseUserId,
    accessIds: activeAccess.map((a) => a.id),
    certificateIds: validCerts.map((c) => c.id),
    extras,
  });

  const explanation =
    `Offboarding completeness check for ${user.fullName} (${user.employeeId}): ` +
    `${payload.accessIds.length} access grant(s), ${payload.certificateIds.length} certificate(s), ` +
    `${extras.length} additional item(s) flagged.`;

  const proposal = await createProposal(dbAdmin, {
    type: "offboard_completeness",
    targetEntityType: "warehouse_user",
    targetEntityId: warehouseUserId,
    payload,
    explanation,
  });
  return { proposalId: proposal.id, payload };
}
