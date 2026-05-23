/**
 * Shared service-call context. Every deterministic mutation that touches
 * state takes a ServiceContext alongside its typed input. It carries:
 *
 *   actor       — the operator performing the mutation (audit "actor_id").
 *   reason      — short free-text justification recorded in the audit row.
 *   aiAssisted  — true when the mutation originated from an approved AI
 *                 proposal (audit row gets ai_assisted=true, proposal_id set).
 *   proposalId  — set together with aiAssisted; nullable otherwise.
 *
 * The audit log policy requires `actor_id = current_operator_id()` — so the
 * `actor` here must match the operator identity used by the surrounding
 * `withOperator(...)` call.
 */

import type { Operator } from "../auth/operator";

export type ServiceContext = {
  actor: Operator;
  reason?: string;
  aiAssisted?: boolean;
  proposalId?: string;
};

export function systemContext(actor: Operator, reason: string): ServiceContext {
  return { actor, reason };
}
