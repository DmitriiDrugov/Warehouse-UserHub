/**
 * AI proposal lifecycle (§6 §6.4).
 *
 *   createProposal   — INSERT a pending proposal (system-only — invoked from
 *                      cron jobs / AI pipelines through dbAdmin, bypassing
 *                      RLS for the INSERT). Writes an audit row whose actor
 *                      is the seeded "system" operator.
 *
 *   approveProposal  — warehouse_admin approves. Dispatches per
 *                      proposal.type into the deterministic services with
 *                      ctx.aiAssisted=true and ctx.proposalId set, so the
 *                      audit log links each downstream mutation back to
 *                      the proposal that authorized it.
 *
 *   rejectProposal   — warehouse_admin rejects. Writes audit, no mutation.
 *
 *   expireProposal   — system marks an old pending proposal as expired.
 */

import { and, eq, lt } from "drizzle-orm";

import type { Database, DbTx } from "../db/client";
import {
  aiProposals,
  appUsers,
  type AiProposal,
  type NewAiProposal,
} from "../db/schema";
import {
  AnomalyFlagPayload,
  OffboardCompletenessPayload,
  ProvisionPayload,
  RevokeAccessPayload,
} from "../validation/proposals";
import type { ProposalType } from "../validation/enums";
import { revokeAccess } from "./access";
import { writeAudit } from "./audit";
import { ConflictError, NotFoundError, ValidationFailure } from "./errors";
import type { ServiceContext } from "./context";
import { offboardUser, createWarehouseUser } from "./warehouse-users";
import { revokeCertificate } from "./certificates";
import { grantAccess } from "./access";

const SYSTEM_OPERATOR_EMAIL = "system@warehouse-userhub.internal";

let cachedSystemOperator: { id: string } | null = null;

/**
 * Lazy lookup of the seeded "system" operator. Cached for the process
 * lifetime — it is created exactly once by the seed script and never
 * deleted. Used as the audit actor for system-originated rows.
 */
export async function getSystemOperator(
  db: Database | DbTx,
): Promise<{ id: string }> {
  if (cachedSystemOperator) return cachedSystemOperator;
  const [row] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.email, SYSTEM_OPERATOR_EMAIL))
    .limit(1);
  if (!row) {
    throw new Error(
      `system operator (${SYSTEM_OPERATOR_EMAIL}) not found — did the seed run?`,
    );
  }
  cachedSystemOperator = row;
  return row;
}

export type CreateProposalInput<T extends ProposalType = ProposalType> = {
  type: T;
  targetEntityType: string;
  targetEntityId?: string | null;
  payload: unknown;
  explanation: string;
  generatedQuery?: string | null;
};

/**
 * Create a pending proposal. Uses the admin client because the system
 * never has an active operator session, and INSERT on ai_proposals is
 * NOT granted to app_operator.
 */
export async function createProposal(
  db: Database,
  input: CreateProposalInput,
): Promise<AiProposal> {
  // Validate payload against schema for the given type. We never store an
  // unvalidated AI payload, even though the column is `jsonb`.
  switch (input.type) {
    case "provision":
      ProvisionPayload.parse(input.payload);
      break;
    case "revoke_access":
      RevokeAccessPayload.parse(input.payload);
      break;
    case "anomaly_flag":
      AnomalyFlagPayload.parse(input.payload);
      break;
    case "offboard_completeness":
      OffboardCompletenessPayload.parse(input.payload);
      break;
    default:
      throw new ValidationFailure(`unknown proposal type: ${input.type}`);
  }

  const sys = await getSystemOperator(db);

  return await db.transaction(async (tx) => {
    const values: NewAiProposal = {
      type: input.type,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId ?? null,
      payload: input.payload as NewAiProposal["payload"],
      explanation: input.explanation,
      generatedQuery: input.generatedQuery ?? null,
      status: "pending",
      createdBy: "system",
    };
    const [created] = await tx.insert(aiProposals).values(values).returning();
    if (!created) throw new Error("insert returned no row");

    await writeAudit(
      tx,
      { actor: { id: sys.id } as ServiceContext["actor"] },
      {
        entityType: "ai_proposal",
        entityId: created.id,
        action: "proposal.created",
        after: created,
      },
    );

    return created;
  });
}

async function loadProposal(tx: DbTx, id: string): Promise<AiProposal> {
  const [row] = await tx
    .select()
    .from(aiProposals)
    .where(eq(aiProposals.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("ai_proposal", id);
  return row;
}

export type ApprovalResult =
  | { type: "provision"; warehouseUserId: string }
  | { type: "revoke_access"; revokedAccessIds: string[] }
  | { type: "anomaly_flag"; acknowledged: true }
  | {
      type: "offboard_completeness";
      revokedAccessIds: string[];
      revokedCertificateIds: string[];
    };

export async function approveProposal(
  tx: DbTx,
  proposalId: string,
  ctx: ServiceContext,
  options?: { note?: string },
): Promise<{ proposal: AiProposal; result: ApprovalResult }> {
  if (ctx.actor.operatorRole !== "warehouse_admin") {
    throw new ConflictError("only warehouse_admin can approve proposals");
  }

  const proposal = await loadProposal(tx, proposalId);
  if (proposal.status !== "pending") {
    throw new ConflictError(`proposal is already '${proposal.status}'`);
  }

  // Mark approved BEFORE executing downstream mutations so the audit log
  // reflects approval-time even if a downstream service fails (the whole
  // transaction rolls back atomically — including the approval — so this
  // is consistent under either outcome).
  const [updated] = await tx
    .update(aiProposals)
    .set({
      status: "approved",
      reviewedBy: ctx.actor.id,
      reviewedAt: new Date(),
      reviewNote: options?.note ?? null,
    })
    .where(eq(aiProposals.id, proposalId))
    .returning();
  if (!updated) throw new Error("update returned no row");

  // The approval row itself also gets the proposal_id linkage, so a single
  // `WHERE proposal_id = $1` query returns every audit entry related to the
  // proposal (approval + downstream mutations).
  await writeAudit(
    tx,
    { ...ctx, aiAssisted: true, proposalId },
    {
      entityType: "ai_proposal",
      entityId: proposalId,
      action: "proposal.approved",
      before: proposal,
      after: updated,
    },
  );

  // Downstream services run with aiAssisted=true and proposalId set so
  // their audit entries point back to this proposal.
  const downstreamCtx: ServiceContext = {
    ...ctx,
    aiAssisted: true,
    proposalId,
    reason: ctx.reason ?? `approval of proposal ${proposalId}`,
  };

  switch (proposal.type) {
    case "provision": {
      const payload = ProvisionPayload.parse(proposal.payload);
      const wu = await createWarehouseUser(
        tx,
        {
          employeeId: payload.employeeId,
          fullName: payload.fullName,
          email: payload.email ?? null,
          warehouseId: payload.warehouseId,
          roleId: payload.roleId,
          hireDate: new Date(payload.hireDate),
          status: "active",
        },
        downstreamCtx,
      );
      if (payload.extraPermissionIds?.length) {
        for (const permissionId of payload.extraPermissionIds) {
          await grantAccess(
            tx,
            {
              warehouseUserId: wu.id,
              permissionId,
              source: "manual",
            },
            downstreamCtx,
          );
        }
      }
      return {
        proposal: updated,
        result: { type: "provision", warehouseUserId: wu.id },
      };
    }
    case "revoke_access": {
      const payload = RevokeAccessPayload.parse(proposal.payload);
      const revokedAccessIds: string[] = [];
      for (const accessId of payload.accessIds) {
        await revokeAccess(tx, accessId, {
          ...downstreamCtx,
          reason: payload.reason,
        });
        revokedAccessIds.push(accessId);
      }
      return {
        proposal: updated,
        result: { type: "revoke_access", revokedAccessIds },
      };
    }
    case "anomaly_flag": {
      // Pure acknowledgement — operator can choose to take action via the
      // suggestedAccessIdsToRevoke separately. If present, we revoke them.
      const payload = AnomalyFlagPayload.parse(proposal.payload);
      const suggested = payload.suggestedAccessIdsToRevoke ?? [];
      if (suggested.length === 0) {
        return {
          proposal: updated,
          result: { type: "anomaly_flag", acknowledged: true },
        };
      }
      for (const accessId of suggested) {
        await revokeAccess(tx, accessId, {
          ...downstreamCtx,
          reason: `anomaly_flag: ${payload.anomalyType}`,
        });
      }
      // We still represent it as an acknowledgement result for callers.
      return {
        proposal: updated,
        result: { type: "anomaly_flag", acknowledged: true },
      };
    }
    case "offboard_completeness": {
      const payload = OffboardCompletenessPayload.parse(proposal.payload);

      // Ensure user is offboarded — offboardUser is idempotent for the
      // status change but will also auto-revoke remaining active access.
      // Here we explicitly revoke the exact lists from the proposal so the
      // audit trail matches the approval payload.
      const revokedAccessIds: string[] = [];
      for (const accessId of payload.accessIds) {
        // Skip silently if already non-active (offboardUser earlier may
        // have revoked everything; this proposal is the "did we miss
        // anything?" check).
        try {
          await revokeAccess(tx, accessId, downstreamCtx);
          revokedAccessIds.push(accessId);
        } catch (err) {
          if (err instanceof ConflictError) continue;
          throw err;
        }
      }
      const revokedCertificateIds: string[] = [];
      for (const certId of payload.certificateIds) {
        try {
          await revokeCertificate(tx, certId, downstreamCtx);
          revokedCertificateIds.push(certId);
        } catch (err) {
          if (err instanceof ConflictError) continue;
          throw err;
        }
      }
      // Defensive: make sure the warehouse_user is actually offboarded.
      // offboardUser internally short-circuits if no transition is needed.
      try {
        await offboardUser(tx, payload.warehouseUserId, downstreamCtx);
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
      }
      return {
        proposal: updated,
        result: {
          type: "offboard_completeness",
          revokedAccessIds,
          revokedCertificateIds,
        },
      };
    }
    default: {
      const _exhaust: never = proposal.type;
      throw new Error(`unhandled proposal type: ${String(_exhaust)}`);
    }
  }
}

export async function rejectProposal(
  tx: DbTx,
  proposalId: string,
  ctx: ServiceContext,
  options?: { note?: string },
): Promise<AiProposal> {
  if (ctx.actor.operatorRole !== "warehouse_admin") {
    throw new ConflictError("only warehouse_admin can reject proposals");
  }

  const proposal = await loadProposal(tx, proposalId);
  if (proposal.status !== "pending") {
    throw new ConflictError(`proposal is already '${proposal.status}'`);
  }

  const [updated] = await tx
    .update(aiProposals)
    .set({
      status: "rejected",
      reviewedBy: ctx.actor.id,
      reviewedAt: new Date(),
      reviewNote: options?.note ?? null,
    })
    .where(eq(aiProposals.id, proposalId))
    .returning();
  if (!updated) throw new Error("update returned no row");

  await writeAudit(
    tx,
    { ...ctx, aiAssisted: true, proposalId },
    {
      entityType: "ai_proposal",
      entityId: proposalId,
      action: "proposal.rejected",
      before: proposal,
      after: updated,
    },
  );

  return updated;
}

/**
 * Expire all pending proposals older than `olderThanDays` days.
 * Called by the cron evaluator so proposals don't accumulate indefinitely.
 */
export async function expireOldProposals(
  db: Database,
  olderThanDays: number,
): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const stale = await db
    .select({ id: aiProposals.id })
    .from(aiProposals)
    .where(
      and(
        eq(aiProposals.status, "pending"),
        lt(aiProposals.createdAt, cutoff),
      ),
    );

  let expired = 0;
  for (const { id } of stale) {
    try {
      const result = await expireProposal(db, id);
      // expireProposal returns early (without mutating) when the proposal
      // has already transitioned out of 'pending' (race condition).
      // Only count rows that were actually flipped to 'expired' in this call.
      if (result.status === "expired") expired++;
    } catch {
      // proposal was deleted concurrently — skip
    }
  }
  return { expired };
}

export async function expireProposal(
  db: Database,
  proposalId: string,
): Promise<AiProposal> {
  const sys = await getSystemOperator(db);
  return await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(aiProposals)
      .where(eq(aiProposals.id, proposalId))
      .limit(1);
    if (!before) throw new NotFoundError("ai_proposal", proposalId);
    if (before.status !== "pending") return before;

    const [updated] = await tx
      .update(aiProposals)
      .set({ status: "expired" })
      .where(eq(aiProposals.id, proposalId))
      .returning();
    if (!updated) throw new Error("update returned no row");

    await writeAudit(
      tx,
      { actor: { id: sys.id } as ServiceContext["actor"] },
      {
        entityType: "ai_proposal",
        entityId: proposalId,
        action: "proposal.expired",
        before,
        after: updated,
      },
    );

    return updated;
  });
}
