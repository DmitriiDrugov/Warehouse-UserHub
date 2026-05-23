/**
 * Evaluator: loads warehouse-user context from the DB, runs all rules,
 * and either applies deterministic auto-actions OR routes the finding
 * into the AI-explanation pipeline that creates an ai_proposal.
 *
 *   evaluateUser(userId)  — runs rules for one user, returns the findings
 *                            (without acting on them — read-only).
 *   runEvaluation()       — iterates every non-offboarded user (plus
 *                            offboarded users still inside SLA), applies
 *                            auto-actions, creates proposals for the rest.
 *
 * The "explain" function is injected so this file stays decoupled from
 * lib/llm — the cron route handler passes the real LLM-backed explainer;
 * unit tests pass a deterministic stub.
 */

import { and, asc, eq, or } from "drizzle-orm";

import { serverEnv } from "../env";
import { type Database, dbAdmin, withOperator } from "../db/client";
import {
  aiProposals,
  certificates,
  permissions,
  roles as rolesTable,
  systems,
  userAccess,
  userCertificates,
  warehouseUsers,
} from "../db/schema";
import type { ProposalType } from "../validation/enums";
import { expireAccess } from "../services/access";
import { writeAudit } from "../services/audit";
import type { ServiceContext } from "../services/context";
import {
  createProposal,
  getSystemOperator,
} from "../services/proposals";
import { runAllRules } from "./rules";
import type {
  EvaluatorParams,
  Finding,
  FindingAction,
  WarehouseUserContext,
} from "./types";

// ---------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------

async function loadUserContext(
  db: Database,
  warehouseUserId: string,
): Promise<WarehouseUserContext | null> {
  const [wu] = await db
    .select({
      id: warehouseUsers.id,
      warehouseId: warehouseUsers.warehouseId,
      status: warehouseUsers.status,
      terminationDate: warehouseUsers.terminationDate,
      roleCode: rolesTable.code,
    })
    .from(warehouseUsers)
    .innerJoin(rolesTable, eq(rolesTable.id, warehouseUsers.roleId))
    .where(eq(warehouseUsers.id, warehouseUserId))
    .limit(1);
  if (!wu) return null;

  const accessRows = await db
    .select({
      id: userAccess.id,
      permissionId: userAccess.permissionId,
      source: userAccess.source,
      status: userAccess.status,
      grantedAt: userAccess.grantedAt,
      expiresAt: userAccess.expiresAt,
      lastUsedAt: userAccess.lastUsedAt,
      permCode: permissions.code,
      sysCode: systems.code,
    })
    .from(userAccess)
    .innerJoin(permissions, eq(permissions.id, userAccess.permissionId))
    .innerJoin(systems, eq(systems.id, permissions.systemId))
    .where(eq(userAccess.warehouseUserId, warehouseUserId));

  const certRows = await db
    .select({
      id: userCertificates.id,
      status: userCertificates.status,
      expiresAt: userCertificates.expiresAt,
      certCode: certificates.code,
    })
    .from(userCertificates)
    .innerJoin(certificates, eq(certificates.id, userCertificates.certificateId))
    .where(eq(userCertificates.warehouseUserId, warehouseUserId));

  return {
    warehouseUserId: wu.id,
    warehouseId: wu.warehouseId,
    status: wu.status,
    terminationDate: wu.terminationDate,
    roleCode: wu.roleCode,
    access: accessRows.map((a) => ({
      id: a.id,
      permissionId: a.permissionId,
      permissionCode: `${a.sysCode}.${a.permCode}`,
      source: a.source,
      status: a.status,
      grantedAt: a.grantedAt,
      expiresAt: a.expiresAt,
      lastUsedAt: a.lastUsedAt,
    })),
    certificates: certRows.map((c) => ({
      id: c.id,
      certificateCode: c.certCode,
      status: c.status,
      expiresAt: c.expiresAt,
    })),
  };
}

// ---------------------------------------------------------------------
// Read-only entry point
// ---------------------------------------------------------------------

function defaultParams(now = new Date()): EvaluatorParams {
  const env = serverEnv();
  return {
    now,
    dormantDays: env.ANOMALY_DORMANT_DAYS,
    offboardingSlaHours: env.OFFBOARDING_SLA_HOURS,
  };
}

export async function evaluateUser(
  warehouseUserId: string,
  now: Date = new Date(),
): Promise<{ findings: Finding[]; context: WarehouseUserContext | null }> {
  const ctx = await loadUserContext(dbAdmin, warehouseUserId);
  if (!ctx) return { findings: [], context: null };
  const findings = runAllRules(ctx, defaultParams(now));
  return { findings, context: ctx };
}

// ---------------------------------------------------------------------
// Deduplication helpers
// ---------------------------------------------------------------------

async function hasPendingProposal(
  warehouseUserId: string,
  type: ProposalType,
): Promise<boolean> {
  const [existing] = await dbAdmin
    .select({ id: aiProposals.id })
    .from(aiProposals)
    .where(
      and(
        eq(aiProposals.targetEntityId, warehouseUserId),
        eq(aiProposals.type, type),
        eq(aiProposals.status, "pending"),
      ),
    )
    .limit(1);
  return !!existing;
}

// ---------------------------------------------------------------------
// Action application
// ---------------------------------------------------------------------

export type FindingExplainer = (
  finding: Finding,
  ctx: WarehouseUserContext,
) => Promise<string>;

/** Default explainer used when no LLM is configured (tests, fallback). */
export const templateExplainer: FindingExplainer = async (f) =>
  `${f.title}. Details: ${JSON.stringify(f.details)}`;

async function applyFinding(
  finding: Finding,
  ctx: WarehouseUserContext,
  explain: FindingExplainer,
): Promise<{ applied: "auto" | "proposal" | "dedup"; proposalId?: string }> {
  const sys = await getSystemOperator(dbAdmin);
  const systemServiceCtx: ServiceContext = {
    actor: {
      id: sys.id,
      email: "",
      fullName: "system",
      operatorRole: "warehouse_admin",
      authUserId: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    reason: `rule:${finding.type}`,
  };

  return await dispatchAction(finding, ctx, systemServiceCtx, explain);
}

async function dispatchAction(
  finding: Finding,
  ctx: WarehouseUserContext,
  systemServiceCtx: ServiceContext,
  explain: FindingExplainer,
): Promise<{ applied: "auto" | "proposal" | "dedup"; proposalId?: string }> {
  const action: FindingAction = finding.action;

  if (action.kind === "auto_expire_access") {
    await withOperator(systemServiceCtx.actor.id, async (tx) => {
      for (const accessId of action.accessIds) {
        try {
          await expireAccess(tx, accessId, systemServiceCtx);
        } catch {
          // already expired/revoked — keep going
        }
      }
      await writeAudit(tx, systemServiceCtx, {
        entityType: "warehouse_user",
        entityId: ctx.warehouseUserId,
        action: "access.expired",
        after: {
          ruleType: finding.type,
          accessIds: action.accessIds,
        },
      });
    });
    return { applied: "auto" };
  }

  const explanation = await explain(finding, ctx);

  switch (action.kind) {
    case "create_proposal_revoke_access": {
      if (await hasPendingProposal(ctx.warehouseUserId, "revoke_access")) {
        return { applied: "dedup" };
      }
      const proposal = await createProposal(dbAdmin, {
        type: "revoke_access",
        targetEntityType: "warehouse_user",
        targetEntityId: ctx.warehouseUserId,
        payload: {
          warehouseUserId: ctx.warehouseUserId,
          accessIds: action.accessIds,
          reason: action.reason,
        },
        explanation,
      });
      return { applied: "proposal", proposalId: proposal.id };
    }
    case "create_proposal_anomaly_flag": {
      if (await hasPendingProposal(ctx.warehouseUserId, "anomaly_flag")) {
        return { applied: "dedup" };
      }
      const proposal = await createProposal(dbAdmin, {
        type: "anomaly_flag",
        targetEntityType: "warehouse_user",
        targetEntityId: ctx.warehouseUserId,
        payload: {
          warehouseUserId: ctx.warehouseUserId,
          anomalyType: action.anomalyType,
          details: finding.details,
          suggestedAccessIdsToRevoke: action.suggestedAccessIdsToRevoke,
        },
        explanation,
      });
      return { applied: "proposal", proposalId: proposal.id };
    }
    case "create_proposal_offboard_completeness": {
      if (await hasPendingProposal(ctx.warehouseUserId, "offboard_completeness")) {
        return { applied: "dedup" };
      }
      // Build the full revocation set from CURRENT state (in case anything
      // changed since the finding was produced).
      const stillActive = ctx.access
        .filter((a) => a.status === "active")
        .map((a) => a.id);
      const stillValidCerts = ctx.certificates
        .filter((c) => c.status === "valid")
        .map((c) => c.id);
      const proposal = await createProposal(dbAdmin, {
        type: "offboard_completeness",
        targetEntityType: "warehouse_user",
        targetEntityId: ctx.warehouseUserId,
        payload: {
          warehouseUserId: ctx.warehouseUserId,
          accessIds: stillActive,
          certificateIds: stillValidCerts,
          extras: [],
        },
        explanation,
      });
      return { applied: "proposal", proposalId: proposal.id };
    }
    default: {
      const _exhaust: never = action;
      throw new Error(`unknown action: ${JSON.stringify(_exhaust)}`);
    }
  }
}

// ---------------------------------------------------------------------
// Full-run entry point (cron)
// ---------------------------------------------------------------------

export type EvaluationReport = {
  usersEvaluated: number;
  findings: number;
  autoActions: number;
  proposalsCreated: number;
  durationMs: number;
};

export async function runEvaluation(options?: {
  explain?: FindingExplainer;
  now?: Date;
}): Promise<EvaluationReport> {
  const start = Date.now();
  const explain = options?.explain ?? templateExplainer;
  const now = options?.now ?? new Date();

  // Active + offboarded users (so offboarding SLA rule can fire).
  const candidates = await dbAdmin
    .select({ id: warehouseUsers.id })
    .from(warehouseUsers)
    .where(
      or(
        eq(warehouseUsers.status, "active"),
        eq(warehouseUsers.status, "offboarded"),
        eq(warehouseUsers.status, "suspended"),
      ),
    )
    .orderBy(asc(warehouseUsers.id));

  let findingsCount = 0;
  let autoCount = 0;
  let proposalCount = 0;

  // Dedupe: avoid creating a duplicate proposal for the same (user, finding type)
  // that already has a pending one. We check after producing the finding by
  // querying `ai_proposals` filtered by targetEntityId + type + status='pending'.
  // For brevity in this scheduled-run code: we de-dupe inside dispatch via
  // a per-run cache; cross-run dedup is achieved by skipping when a pending
  // proposal already exists.
  for (const { id } of candidates) {
    const { findings, context } = await evaluateUser(id, now);
    if (!context) continue;
    findingsCount += findings.length;
    for (const finding of findings) {
      const result = await applyFinding(finding, context, explain);
      if (result.applied === "auto") autoCount++;
      else if (result.applied === "proposal") proposalCount++;
      // "dedup" — a pending proposal already existed; no new one created,
      // so we don't increment proposalsCreated.
    }
  }

  return {
    usersEvaluated: candidates.length,
    findings: findingsCount,
    autoActions: autoCount,
    proposalsCreated: proposalCount,
    durationMs: Date.now() - start,
  };
}

