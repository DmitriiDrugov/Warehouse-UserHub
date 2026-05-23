/**
 * Pure rule functions. Each takes pre-fetched user context + params and
 * returns Finding[]. Zero side effects, zero IO — making them trivial to
 * unit test (§11).
 */

import { RULES_VERSION, getRulesConfig } from "./config";
import type {
  AccessRow,
  EvaluatorParams,
  Finding,
  WarehouseUserContext,
} from "./types";

// ---------------------------------------------------------------------
// Rule: certificate gate
// ---------------------------------------------------------------------

/**
 * For each "role requires certificate X" rule:
 *   - if user lacks any valid certificate of that code → cert_missing
 *   - if user has an expired/revoked cert AND active access whose
 *     permission relates to that certificate area → cert_expired_with_active_access
 *
 * The "permission relates to certificate area" mapping is intentionally
 * conservative: we flag if ANY active access exists, on the principle
 * that a missing/expired cert in a regulated role is a problem regardless.
 */
export function ruleCertificateGate(
  ctx: WarehouseUserContext,
  _params: EvaluatorParams,
): Finding[] {
  const findings: Finding[] = [];
  const cfg = getRulesConfig();
  const req = cfg.certificateRequirements.find(
    (r) => r.roleCode === ctx.roleCode,
  );
  if (!req) return findings;

  for (const certCode of req.requiredCertificateCodes) {
    const matching = ctx.certificates.filter(
      (c) => c.certificateCode === certCode,
    );
    const validNow = matching.some((c) => c.status === "valid");

    if (!validNow && matching.length === 0) {
      findings.push({
        type: "cert_missing",
        severity: "high",
        warehouseUserId: ctx.warehouseUserId,
        ruleVersion: RULES_VERSION,
        title: `Required certificate '${certCode}' missing for role '${ctx.roleCode}'`,
        details: { roleCode: ctx.roleCode, certificateCode: certCode },
        // Surface as an anomaly_flag — no automatic revoke for a missing
        // cert; HR needs to chase the worker for re-certification.
        action: {
          kind: "create_proposal_anomaly_flag",
          anomalyType: "expired_cert_with_active_access",
        },
      });
      continue;
    }

    if (!validNow) {
      // user HAS the cert, but it's expired/revoked.
      const activeAccessIds = ctx.access
        .filter((a) => a.status === "active")
        .map((a) => a.id);
      if (activeAccessIds.length > 0) {
        findings.push({
          type: "cert_expired_with_active_access",
          severity: "high",
          warehouseUserId: ctx.warehouseUserId,
          ruleVersion: RULES_VERSION,
          title: `Certificate '${certCode}' is not valid but the user still holds active access`,
          details: {
            roleCode: ctx.roleCode,
            certificateCode: certCode,
            activeAccessIds,
          },
          action: {
            kind: "create_proposal_revoke_access",
            accessIds: activeAccessIds,
            reason: `Required certificate '${certCode}' is expired or revoked`,
          },
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------
// Rule: segregation of duties
// ---------------------------------------------------------------------

export function ruleSegregationOfDuties(
  ctx: WarehouseUserContext,
  _params: EvaluatorParams,
): Finding[] {
  const findings: Finding[] = [];
  const cfg = getRulesConfig();
  const activeByCode = new Map<string, AccessRow>();
  for (const a of ctx.access) {
    if (a.status === "active") activeByCode.set(a.permissionCode, a);
  }

  for (const pair of cfg.segregationOfDutyPairs) {
    const aRow = activeByCode.get(pair.a);
    const bRow = activeByCode.get(pair.b);
    if (aRow && bRow) {
      findings.push({
        type: "sod_violation",
        severity: "high",
        warehouseUserId: ctx.warehouseUserId,
        ruleVersion: RULES_VERSION,
        title: `Segregation-of-duties violation: ${pair.a} + ${pair.b}`,
        details: {
          pair,
          accessIds: [aRow.id, bRow.id],
        },
        action: {
          kind: "create_proposal_anomaly_flag",
          anomalyType: "sod_violation",
          // Suggest revoking the most-recently-granted side; the operator
          // can override on approval.
          suggestedAccessIdsToRevoke: [
            aRow.grantedAt.getTime() >= bRow.grantedAt.getTime()
              ? aRow.id
              : bRow.id,
          ],
        },
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------
// Rule: temporary access expiry
// ---------------------------------------------------------------------

export function ruleTemporaryAccessExpiry(
  ctx: WarehouseUserContext,
  params: EvaluatorParams,
): Finding[] {
  const expired = ctx.access.filter(
    (a) =>
      a.status === "active" &&
      a.source === "temporary_project" &&
      a.expiresAt !== null &&
      a.expiresAt.getTime() <= params.now.getTime(),
  );
  if (expired.length === 0) return [];

  return [
    {
      type: "temp_access_expired",
      severity: "medium",
      warehouseUserId: ctx.warehouseUserId,
      ruleVersion: RULES_VERSION,
      title: `${expired.length} temporary-project access grant(s) past expiry`,
      details: {
        accessIds: expired.map((a) => a.id),
      },
      action: {
        kind: "auto_expire_access",
        accessIds: expired.map((a) => a.id),
      },
    },
  ];
}

// ---------------------------------------------------------------------
// Rule: dormant access
// ---------------------------------------------------------------------

export function ruleDormantAccess(
  ctx: WarehouseUserContext,
  params: EvaluatorParams,
): Finding[] {
  const dormantThresholdMs = params.dormantDays * 24 * 60 * 60 * 1000;
  const cutoff = params.now.getTime() - dormantThresholdMs;

  const dormant = ctx.access.filter((a) => {
    if (a.status !== "active") return false;
    // never-used grants count as dormant if they were granted before the cutoff
    const referenceTime =
      a.lastUsedAt?.getTime() ?? a.grantedAt.getTime();
    return referenceTime < cutoff;
  });
  if (dormant.length === 0) return [];

  return [
    {
      type: "dormant_access",
      severity: "low",
      warehouseUserId: ctx.warehouseUserId,
      ruleVersion: RULES_VERSION,
      title: `${dormant.length} access grant(s) dormant for > ${params.dormantDays} days`,
      details: {
        thresholdDays: params.dormantDays,
        accessIds: dormant.map((a) => a.id),
        items: dormant.map((a) => ({
          accessId: a.id,
          permissionCode: a.permissionCode,
          lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
          grantedAt: a.grantedAt.toISOString(),
        })),
      },
      action: {
        kind: "create_proposal_anomaly_flag",
        anomalyType: "dormant_access",
        suggestedAccessIdsToRevoke: dormant.map((a) => a.id),
      },
    },
  ];
}

// ---------------------------------------------------------------------
// Rule: offboarding SLA
// ---------------------------------------------------------------------

export function ruleOffboardingSla(
  ctx: WarehouseUserContext,
  params: EvaluatorParams,
): Finding[] {
  if (ctx.status !== "offboarded") return [];
  const terminatedAt = ctx.terminationDate;
  if (!terminatedAt) return [];

  const slaMs = params.offboardingSlaHours * 60 * 60 * 1000;
  const ageMs = params.now.getTime() - terminatedAt.getTime();
  if (ageMs < slaMs) return [];

  const stillActive = ctx.access.filter((a) => a.status === "active");
  if (stillActive.length === 0) return [];

  return [
    {
      type: "offboarding_sla_breach",
      severity: "high",
      warehouseUserId: ctx.warehouseUserId,
      ruleVersion: RULES_VERSION,
      title: `Offboarding SLA breach: ${stillActive.length} grant(s) still active after ${params.offboardingSlaHours}h`,
      details: {
        terminationDate: terminatedAt.toISOString(),
        slaHours: params.offboardingSlaHours,
        ageHours: Math.round(ageMs / (60 * 60 * 1000)),
        accessIds: stillActive.map((a) => a.id),
      },
      action: { kind: "create_proposal_offboard_completeness" },
    },
  ];
}

// ---------------------------------------------------------------------
// Aggregator: run all rules
// ---------------------------------------------------------------------

export type RuleFunction = (
  ctx: WarehouseUserContext,
  params: EvaluatorParams,
) => Finding[];

export const ALL_RULES: ReadonlyArray<RuleFunction> = [
  ruleCertificateGate,
  ruleSegregationOfDuties,
  ruleTemporaryAccessExpiry,
  ruleDormantAccess,
  ruleOffboardingSla,
];

export function runAllRules(
  ctx: WarehouseUserContext,
  params: EvaluatorParams,
): Finding[] {
  const findings: Finding[] = [];
  for (const rule of ALL_RULES) {
    findings.push(...rule(ctx, params));
  }
  return findings;
}
