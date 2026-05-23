/**
 * Audit writer. Every deterministic mutation calls `writeAudit(tx, ...)`
 * INSIDE the same transaction as the mutation it records. The audit_log
 * append-only trigger blocks UPDATE/DELETE, so once written this row is
 * immutable for the lifetime of the database (§0.5, §8).
 *
 * Identity matters: the RLS policy on audit_log requires
 *   actor_id = current_operator_id()
 * so when running under `withOperator(op.id, ...)`, the `ctx.actor.id`
 * must equal `op.id`. The wrapper API enforces this by always reading
 * the operator from the same surrounding requireOperator() call.
 *
 * Note: when the *system* (not an operator) writes an audit row — e.g.
 * the cron evaluator marking access as expired — it runs as dbAdmin
 * which bypasses RLS, but it still must set a real actor_id. Convention:
 * use a designated `system` operator seeded with operator_role='warehouse_admin'
 * and is_active=true. (Set by seed; see §9.)
 */

import { type AuditAction } from "../validation/enums";
import { auditLog, type NewAuditLogEntry } from "../db/schema";
import type { DbTx, Database } from "../db/client";
import type { ServiceContext } from "./context";

export type AuditPayload = {
  entityType: string;
  entityId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
};

export async function writeAudit(
  tx: DbTx | Database,
  ctx: ServiceContext,
  payload: AuditPayload,
): Promise<void> {
  const row: NewAuditLogEntry = {
    entityType: payload.entityType,
    entityId: payload.entityId,
    action: payload.action,
    actorId: ctx.actor.id,
    aiAssisted: ctx.aiAssisted === true,
    proposalId: ctx.proposalId ?? null,
    before: (payload.before ?? null) as NewAuditLogEntry["before"],
    after: (payload.after ?? null) as NewAuditLogEntry["after"],
    reason: ctx.reason ?? null,
  };
  await tx.insert(auditLog).values(row);
}
