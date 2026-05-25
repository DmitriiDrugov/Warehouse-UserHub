import { and, asc, desc, eq, ilike, or } from "drizzle-orm";

import { type DbTx, withOperator } from "../db/client";
import {
  aiProposals,
  certificates,
  permissions,
  rolePermissions,
  roles,
  systems,
  userAccess,
  userCertificates,
  warehouseUsers,
  warehouses,
} from "../db/schema";
import { serverEnv } from "../env";
import { getRulesConfig } from "../rules/config";
import { runAllRules } from "../rules/rules";
import type { Finding, WarehouseUserContext } from "../rules/types";
import type { AccessExplanationResult } from "./chat-types";

type AccessTarget = {
  systemCode: string | null;
  permissionCode: string | null;
  label: string;
};

export type ParsedAccessQuestion = {
  workerName: string | null;
  target: AccessTarget | null;
};

type WorkerRow = {
  id: string;
  employeeId: string;
  fullName: string;
  status: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  terminationDate: Date | null;
};

type AccessRow = {
  id: string;
  permissionId: string;
  systemCode: string;
  systemName: string;
  permissionCode: string;
  permissionName: string;
  source: string;
  status: string;
  grantedAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

type CertificateRow = {
  id: string;
  certificateCode: string;
  certificateName: string;
  status: string;
  expiresAt: Date | null;
};

type RolePermissionRow = {
  systemCode: string;
  systemName: string;
  permissionCode: string;
  permissionName: string;
};

type PendingProposalRow = {
  id: string;
  type: string;
  createdAt: Date;
  explanation: string;
};

export async function explainAccessQuestion(
  text: string,
  operatorId: string,
): Promise<AccessExplanationResult> {
  const parsed = parseAccessQuestion(text);

  if (!parsed.workerName) {
    return emptyAccessResult({
      question: text,
      status: "needs_name",
      target: parsed.target,
      summary: "I need a worker name to explain access.",
      reasons: [
        'Try asking: "Why does Alina Lange not have WMS access?"',
      ],
    });
  }

  return await withOperator(operatorId, async (tx) => {
    const candidates = await findWorkerCandidates(tx, parsed.workerName!);
    if (candidates.length === 0) {
      return emptyAccessResult({
        question: text,
        status: "not_found",
        target: parsed.target,
        summary: `I could not find a warehouse worker matching "${parsed.workerName}".`,
        reasons: [
          "Search is limited to workers visible to your operator account.",
          "Use the full name or employee ID if there are similar names.",
        ],
      });
    }

    if (candidates.length > 1) {
      return {
        ...emptyAccessResult({
          question: text,
          status: "ambiguous",
          target: parsed.target,
          summary: `I found ${candidates.length} workers matching "${parsed.workerName}".`,
          reasons: ["Ask again with the employee ID or the exact full name."],
        }),
        candidates: candidates.map(candidateSummary),
      };
    }

    const worker = candidates[0]!;
    const access = await loadAccess(tx, worker.id);
    const roleAccess = await loadRoleAccess(tx, worker.roleId);
    const certs = await loadCertificates(tx, worker.id);
    const proposals = await loadPendingProposals(tx, worker.id);

    const findings = runAllRules(buildRuleContext(worker, access, certs), {
      now: new Date(),
      dormantDays: serverEnv().ANOMALY_DORMANT_DAYS,
      offboardingSlaHours: serverEnv().OFFBOARDING_SLA_HOURS,
    });

    return buildAccessExplanation({
      question: text,
      target: parsed.target,
      worker,
      access,
      roleAccess,
      certs,
      findings,
      pendingProposals: proposals,
    });
  });
}

export function parseAccessQuestion(text: string): ParsedAccessQuestion {
  const target = inferTarget(text);
  const trimmed = text.trim();
  const patterns: RegExp[] = [
    /почему\s+у\s+(.+?)\s+(?:нет|не|отсутствует)\s+доступ/iu,
    /у\s+(.+?)\s+(?:нет|не|отсутствует)\s+доступ/iu,
    /why\s+does\s+(.+?)\s+not\s+have\s+(?:.+?\s+)?access/iu,
    /why\s+does(?:\s+not|n't|nt)?\s+(.+?)\s+have\s+(?:.+?\s+)?access/iu,
    /why\s+is\s+(.+?)\s+(?:without|missing|blocked\s+from)\s+(?:.+?\s+)?access/iu,
    /why\s+no\s+(?:.+?\s+)?access\s+for\s+(.+?)[?.!]?$/iu,
    /explain\s+(?:why\s+)?(.+?)\s+(?:has\s+no|does(?:\s+not|n't|nt)\s+have)\s+(?:.+?\s+)?access/iu,
    /(?:access|доступ)\s+(?:status|explanation|state)?\s*(?:for|у|для)\s+(.+?)[?.!]?$/iu,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (match?.[1]) {
      const workerName = cleanWorkerName(match[1]);
      return { workerName: workerName || null, target };
    }
  }

  return { workerName: null, target };
}

export function buildAccessExplanation(input: {
  question: string;
  target: AccessTarget | null;
  worker: WorkerRow;
  access: AccessRow[];
  roleAccess: RolePermissionRow[];
  certs: CertificateRow[];
  findings: Finding[];
  pendingProposals: PendingProposalRow[];
}): AccessExplanationResult {
  const activeAccess = input.access.filter((a) => a.status === "active");
  const inactiveAccess = input.access.filter((a) => a.status !== "active");
  const activeForTarget = activeAccess.filter((a) => matchesTarget(a, input.target));
  const inactiveForTarget = inactiveAccess.filter((a) => matchesTarget(a, input.target));
  const expectedForTarget = input.roleAccess.filter((a) => matchesTarget(a, input.target));
  const targetLabel = input.target?.label ?? "warehouse system access";
  const reasons: string[] = [];

  if (activeForTarget.length > 0) {
    reasons.push(`Active grant found: ${formatAccessList(activeForTarget)}.`);
    if (input.findings.length > 0) {
      reasons.push(`Rule engine still flags: ${input.findings.map((f) => f.title).join("; ")}.`);
    }
    return toResult(input, {
      activeAccess,
      inactiveAccess,
      summary: `${input.worker.fullName} currently has active ${targetLabel}.`,
      reasons: [
        ...reasons,
        "If the worker still cannot use the downstream system, the issue is outside the access grants stored in UserHub, such as login sync, device assignment, or credentials.",
      ],
    });
  }

  if (input.worker.status === "offboarded") {
    reasons.push("Worker status is offboarded, so active access should be removed.");
  } else if (input.worker.status === "suspended") {
    reasons.push("Worker status is suspended, so access should stay blocked until the worker is reactivated.");
  } else if (input.worker.status === "pending") {
    reasons.push("Worker status is pending, so the profile is not fully active yet.");
  }

  const certReasons = certificateReasons(input.worker.roleCode, input.certs);
  reasons.push(...certReasons);

  if (expectedForTarget.length === 0) {
    reasons.push(
      `${input.worker.roleName} does not include ${targetLabel} in its default role template.`,
    );
  } else if (inactiveForTarget.length > 0) {
    reasons.push(
      `The role template includes ${targetLabel}, but the matching grant is not active: ${formatInactiveAccessList(inactiveForTarget)}.`,
    );
  } else {
    reasons.push(
      `The role template expects ${targetLabel}, but there is no matching active grant in user_access.`,
    );
    reasons.push(
      "Most likely, the role template was not applied to this profile yet, the proposal is still waiting for approval, or access was not provisioned after the worker was created.",
    );
  }

  if (activeAccess.length > 0) {
    reasons.push(`Other active access exists: ${formatAccessList(activeAccess)}.`);
  }

  if (input.pendingProposals.length > 0) {
    reasons.push(
      `There ${input.pendingProposals.length === 1 ? "is" : "are"} ${input.pendingProposals.length} pending proposal${input.pendingProposals.length === 1 ? "" : "s"} for this worker.`,
    );
  }

  if (reasons.length === 0) {
    reasons.push("No active access grant was found for the requested scope.");
  }

  return toResult(input, {
    activeAccess,
    inactiveAccess,
    summary: `${input.worker.fullName} has no active ${targetLabel}.`,
    reasons,
  });
}

async function findWorkerCandidates(
  tx: DbTx,
  workerName: string,
): Promise<WorkerRow[]> {
  const terms = workerName.split(/\s+/).filter((term) => term.length > 0);
  const nameCondition =
    terms.length >= 2
      ? and(...terms.map((term) => ilike(warehouseUsers.fullName, `%${term}%`)))!
      : ilike(warehouseUsers.fullName, `%${workerName}%`);
  const employeeCondition = ilike(warehouseUsers.employeeId, `%${workerName}%`);

  return await tx
    .select({
      id: warehouseUsers.id,
      employeeId: warehouseUsers.employeeId,
      fullName: warehouseUsers.fullName,
      status: warehouseUsers.status,
      warehouseId: warehouseUsers.warehouseId,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
      roleId: warehouseUsers.roleId,
      roleCode: roles.code,
      roleName: roles.name,
      terminationDate: warehouseUsers.terminationDate,
    })
    .from(warehouseUsers)
    .innerJoin(roles, eq(roles.id, warehouseUsers.roleId))
    .innerJoin(warehouses, eq(warehouses.id, warehouseUsers.warehouseId))
    .where(or(nameCondition, employeeCondition))
    .orderBy(asc(warehouseUsers.fullName), asc(warehouseUsers.employeeId))
    .limit(6);
}

async function loadAccess(tx: DbTx, warehouseUserId: string): Promise<AccessRow[]> {
  return await tx
    .select({
      id: userAccess.id,
      permissionId: userAccess.permissionId,
      systemCode: systems.code,
      systemName: systems.name,
      permissionCode: permissions.code,
      permissionName: permissions.name,
      source: userAccess.source,
      status: userAccess.status,
      grantedAt: userAccess.grantedAt,
      expiresAt: userAccess.expiresAt,
      lastUsedAt: userAccess.lastUsedAt,
      revokedAt: userAccess.revokedAt,
    })
    .from(userAccess)
    .innerJoin(permissions, eq(permissions.id, userAccess.permissionId))
    .innerJoin(systems, eq(systems.id, permissions.systemId))
    .where(eq(userAccess.warehouseUserId, warehouseUserId))
    .orderBy(desc(userAccess.grantedAt));
}

async function loadRoleAccess(tx: DbTx, roleId: string): Promise<RolePermissionRow[]> {
  return await tx
    .select({
      systemCode: systems.code,
      systemName: systems.name,
      permissionCode: permissions.code,
      permissionName: permissions.name,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .innerJoin(systems, eq(systems.id, permissions.systemId))
    .where(eq(rolePermissions.roleId, roleId))
    .orderBy(asc(systems.code), asc(permissions.code));
}

async function loadCertificates(
  tx: DbTx,
  warehouseUserId: string,
): Promise<CertificateRow[]> {
  return await tx
    .select({
      id: userCertificates.id,
      certificateCode: certificates.code,
      certificateName: certificates.name,
      status: userCertificates.status,
      expiresAt: userCertificates.expiresAt,
    })
    .from(userCertificates)
    .innerJoin(certificates, eq(certificates.id, userCertificates.certificateId))
    .where(eq(userCertificates.warehouseUserId, warehouseUserId))
    .orderBy(asc(certificates.code));
}

async function loadPendingProposals(
  tx: DbTx,
  warehouseUserId: string,
): Promise<PendingProposalRow[]> {
  return await tx
    .select({
      id: aiProposals.id,
      type: aiProposals.type,
      createdAt: aiProposals.createdAt,
      explanation: aiProposals.explanation,
    })
    .from(aiProposals)
    .where(
      and(
        eq(aiProposals.targetEntityType, "warehouse_user"),
        eq(aiProposals.targetEntityId, warehouseUserId),
        eq(aiProposals.status, "pending"),
      ),
    )
    .orderBy(desc(aiProposals.createdAt))
    .limit(3);
}

function buildRuleContext(
  worker: WorkerRow,
  access: AccessRow[],
  certs: CertificateRow[],
): WarehouseUserContext {
  return {
    warehouseUserId: worker.id,
    warehouseId: worker.warehouseId,
    status: worker.status as WarehouseUserContext["status"],
    terminationDate: worker.terminationDate,
    roleCode: worker.roleCode,
    access: access.map((a) => ({
      id: a.id,
      permissionId: a.permissionId,
      permissionCode: `${a.systemCode}.${a.permissionCode}`,
      source: a.source as WarehouseUserContext["access"][number]["source"],
      status: a.status as WarehouseUserContext["access"][number]["status"],
      grantedAt: a.grantedAt,
      expiresAt: a.expiresAt,
      lastUsedAt: a.lastUsedAt,
    })),
    certificates: certs.map((c) => ({
      id: c.id,
      certificateCode: c.certificateCode,
      status: c.status as WarehouseUserContext["certificates"][number]["status"],
      expiresAt: c.expiresAt,
    })),
  };
}

function inferTarget(text: string): AccessTarget | null {
  const lower = text.toLowerCase();
  if (/\bwms\b|warehouse management/i.test(lower)) {
    return { systemCode: "wms", permissionCode: null, label: "WMS access" };
  }
  if (/\bbadge\b|\bfloor\b|\bentry\b|бейдж|бадж|пропуск|склад/iu.test(lower)) {
    return {
      systemCode: "badge",
      permissionCode: "entry",
      label: "floor badge access",
    };
  }
  if (/\bemail\b|\bmail\b|почт/iu.test(lower)) {
    return { systemCode: "email", permissionCode: null, label: "email access" };
  }
  if (/\bshared\b|\bwarehouse[-_\s]?ops\b|общ/iu.test(lower)) {
    return {
      systemCode: "shared_account",
      permissionCode: null,
      label: "shared operational account access",
    };
  }
  return null;
}

function cleanWorkerName(value: string): string {
  return value
    .replace(/\s+(?:to|for)\s+(?:wms|badge|email|warehouse management|floor|entry|access).*$/i, "")
    .replace(/\s+(?:wms|badge|email|warehouse management|floor|entry|access)$/i, "")
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^worker\s+/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function matchesTarget(
  item: { systemCode: string; permissionCode: string },
  target: AccessTarget | null,
): boolean {
  if (!target) return true;
  if (target.systemCode && item.systemCode !== target.systemCode) return false;
  if (target.permissionCode && item.permissionCode !== target.permissionCode) return false;
  return true;
}

function certificateReasons(roleCode: string, certs: CertificateRow[]): string[] {
  const requirement = getRulesConfig().certificateRequirements.find(
    (item) => item.roleCode === roleCode,
  );
  if (!requirement) return [];

  const reasons: string[] = [];
  for (const requiredCode of requirement.requiredCertificateCodes) {
    const matching = certs.filter((cert) => cert.certificateCode === requiredCode);
    const valid = matching.some((cert) => cert.status === "valid" && !isExpired(cert.expiresAt));
    if (valid) continue;

    if (matching.length === 0) {
      reasons.push(
        `Role ${roleCode} requires certificate ${requiredCode}, but no matching certificate is on file.`,
      );
    } else {
      reasons.push(
        `Role ${roleCode} requires certificate ${requiredCode}, but the current record is ${matching.map((cert) => cert.status).join(", ")}.`,
      );
    }
  }
  return reasons;
}

function toResult(
  input: {
    question: string;
    target: AccessTarget | null;
    worker: WorkerRow;
    roleAccess: RolePermissionRow[];
    certs: CertificateRow[];
    findings: Finding[];
    pendingProposals: PendingProposalRow[];
  },
  detail: {
    activeAccess: AccessRow[];
    inactiveAccess: AccessRow[];
    summary: string;
    reasons: string[];
  },
): AccessExplanationResult {
  return {
    type: "access_explain",
    status: "answered",
    question: input.question,
    targetAccess: input.target?.label ?? null,
    summary: detail.summary,
    reasons: detail.reasons,
    worker: {
      id: input.worker.id,
      employeeId: input.worker.employeeId,
      fullName: input.worker.fullName,
      status: input.worker.status,
      roleCode: input.worker.roleCode,
      roleName: input.worker.roleName,
      warehouseCode: input.worker.warehouseCode,
      warehouseName: input.worker.warehouseName,
    },
    activeAccess: detail.activeAccess.map(activeAccessSummary),
    inactiveAccess: detail.inactiveAccess.map(inactiveAccessSummary),
    expectedRoleAccess: input.roleAccess.map((row) => ({
      systemCode: row.systemCode,
      systemName: row.systemName,
      permissionCode: row.permissionCode,
      permissionName: row.permissionName,
    })),
    certificates: input.certs.map((cert) => ({
      certificateCode: cert.certificateCode,
      certificateName: cert.certificateName,
      status: cert.status,
      expiresAt: toIso(cert.expiresAt),
      isExpired: isExpired(cert.expiresAt),
    })),
    findings: input.findings.map((finding) => ({
      type: finding.type,
      severity: finding.severity,
      title: finding.title,
    })),
    pendingProposals: input.pendingProposals.map((proposal) => ({
      id: proposal.id,
      type: proposal.type,
      createdAt: toIso(proposal.createdAt),
      explanation: proposal.explanation,
    })),
  };
}

function emptyAccessResult(input: {
  question: string;
  status: AccessExplanationResult["status"];
  target: AccessTarget | null;
  summary: string;
  reasons: string[];
}): AccessExplanationResult {
  return {
    type: "access_explain",
    status: input.status,
    question: input.question,
    targetAccess: input.target?.label ?? null,
    summary: input.summary,
    reasons: input.reasons,
    activeAccess: [],
    inactiveAccess: [],
    expectedRoleAccess: [],
    certificates: [],
    findings: [],
    pendingProposals: [],
  };
}

function candidateSummary(worker: WorkerRow) {
  return {
    employeeId: worker.employeeId,
    fullName: worker.fullName,
    status: worker.status,
    roleName: worker.roleName,
    warehouseCode: worker.warehouseCode,
  };
}

function activeAccessSummary(row: AccessRow) {
  return {
    systemCode: row.systemCode,
    systemName: row.systemName,
    permissionCode: row.permissionCode,
    permissionName: row.permissionName,
    source: row.source,
    grantedAt: toIso(row.grantedAt),
    expiresAt: toIso(row.expiresAt),
    lastUsedAt: toIso(row.lastUsedAt),
  };
}

function inactiveAccessSummary(row: AccessRow) {
  return {
    systemCode: row.systemCode,
    systemName: row.systemName,
    permissionCode: row.permissionCode,
    permissionName: row.permissionName,
    source: row.source,
    status: row.status,
    grantedAt: toIso(row.grantedAt),
    expiresAt: toIso(row.expiresAt),
    revokedAt: toIso(row.revokedAt),
  };
}

function formatAccessList(rows: Array<{ systemCode: string; permissionCode: string }>): string {
  return rows.map((row) => `${row.systemCode}.${row.permissionCode}`).join(", ");
}

function formatInactiveAccessList(rows: Array<{ systemCode: string; permissionCode: string; status: string }>): string {
  return rows
    .map((row) => `${row.systemCode}.${row.permissionCode} is ${row.status}`)
    .join(", ");
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function isExpired(value: Date | null): boolean {
  return value ? value.getTime() <= Date.now() : false;
}
