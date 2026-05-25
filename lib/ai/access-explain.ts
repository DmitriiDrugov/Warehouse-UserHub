import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";

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
import { getLLM } from "../llm";
import { getRulesConfig } from "../rules/config";
import { runAllRules } from "../rules/rules";
import type { Finding, WarehouseUserContext } from "../rules/types";
import type { AccessExplanationResult } from "./chat-types";

type AccessQuestionKind = "why_missing" | "status" | "missing" | "blockers";

type AccessTarget = {
  systemCode: string | null;
  permissionCode: string | null;
  label: string;
};

export type ParsedAccessQuestion = {
  workerName: string | null;
  target: AccessTarget | null;
  kind: AccessQuestionKind;
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

const LlmAccessQuestionSchema = z.object({
  kind: z.enum([
    "why_missing",
    "status",
    "missing",
    "blockers",
    "not_access_diagnosis",
  ]),
  workerName: z.string().min(1).nullable(),
  target: z
    .object({
      systemCode: z.enum(["wms", "badge", "email", "shared_account"]).nullable(),
      permissionCode: z
        .enum([
          "view_only",
          "receive_inventory",
          "dispatch_order",
          "approve_adjustment",
          "entry",
          "admin",
          "create_account",
          "view_directory",
          "warehouse_ops",
        ])
        .nullable(),
      label: z.string().min(1).nullable().optional(),
    })
    .nullable(),
});

type LlmAccessQuestion = z.infer<typeof LlmAccessQuestionSchema>;

export async function explainAccessQuestion(
  text: string,
  operatorId: string,
  model?: string,
): Promise<AccessExplanationResult> {
  const parsed = await parseAccessQuestionIntent(text, model);

  if (!parsed.workerName) {
    return emptyAccessResult({
      question: text,
      status: "needs_name",
      target: parsed.target,
      summary: "I need a worker name to explain access.",
      reasons: [
        'Try asking: "Why does Alina Lange not have WMS access?" or "What access is missing for EMP-022?"',
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
      kind: parsed.kind,
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
  const kind = inferQuestionKind(text);
  const trimmed = text.trim();
  const patterns: RegExp[] = [
    /\u043f\u043e\u0447\u0435\u043c\u0443\s+\u0443\s+(.+?)\s+(?:\u043d\u0435\u0442|\u043d\u0435|\u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442)\s+\u0434\u043e\u0441\u0442\u0443\u043f/iu,
    /\u0443\s+(.+?)\s+(?:\u043d\u0435\u0442|\u043d\u0435|\u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442)\s+\u0434\u043e\u0441\u0442\u0443\u043f/iu,
    /(?:\u0447\u0442\u043e|\u043a\u0430\u043a\u0438\u0435).{0,40}(?:\u0431\u043b\u043e\u043a\u0438\u0440\u0443\u0435\u0442|\u043c\u0435\u0448\u0430\u0435\u0442|\u043d\u0435\s+\u0445\u0432\u0430\u0442\u0430\u0435\u0442).{0,40}(?:\u0434\u043e\u0441\u0442\u0443\u043f|\u043f\u0440\u0430\u0432).{0,20}(?:\u0443|\u0434\u043b\u044f)\s+(.+?)[?.!]?$/iu,
    /(?:\u043f\u0440\u043e\u0432\u0435\u0440\u044c|\u043e\u0431\u044a\u044f\u0441\u043d\u0438).{0,50}(?:\u0434\u043e\u0441\u0442\u0443\u043f|\u043f\u0440\u0430\u0432).{0,20}(?:\u0443|\u0434\u043b\u044f)\s+(.+?)[?.!]?$/iu,
    /(?:\u0435\u0441\u0442\u044c\s+\u043b\u0438|\u043c\u043e\u0436\u0435\u0442\s+\u043b\u0438).{0,50}(?:\u0434\u043e\u0441\u0442\u0443\u043f|\u0437\u0430\u0439\u0442\u0438).{0,20}(?:\u0443|\u0434\u043b\u044f)?\s*(.+?)[?.!]?$/iu,
    /why\s+does\s+(.+?)\s+not\s+have\s+(?:.+?\s+)?access/iu,
    /why\s+does(?:\s+not|n't|nt)?\s+(.+?)\s+have\s+(?:.+?\s+)?access/iu,
    /why\s+is\s+(.+?)\s+(?:without|missing|blocked\s+from)\s+(?:.+?\s+)?access/iu,
    /why\s+no\s+(?:.+?\s+)?access\s+for\s+(.+?)[?.!]?$/iu,
    /explain\s+(?:why\s+)?(.+?)\s+(?:has\s+no|does(?:\s+not|n't|nt)\s+have)\s+(?:.+?\s+)?access/iu,
    /(?:what|which)\s+(?:access|permissions?)\s+(?:is|are)\s+missing\s+(?:for|from)\s+(.+?)[?.!]?$/iu,
    /(?:what|which).{0,20}(?:blocks|is blocking|prevents)\s+(.+?)\s+from\s+.+?[?.!]?$/iu,
    /(?:what|which).{0,40}(?:blocks|is blocking|prevents).{0,40}(?:access|login).{0,20}(?:for|from)\s+(.+?)[?.!]?$/iu,
    /(?:check|verify|diagnose|explain)\s+(.+?)['']?\s+(?:access|permissions?|wms|badge|email|login)\s*(?:status|state)?[?.!]?$/iu,
    /(?:does|can)\s+(.+?)\s+(?:have|use|access|log\s+in\s+to)\s+(?:.+?\s+)?(?:access|wms|badge|email|account)[?.!]?$/iu,
    /(?:access|\u0434\u043e\u0441\u0442\u0443\u043f)\s+(?:status|explanation|state)?\s*(?:for|\u0443|\u0434\u043b\u044f)\s+(.+?)[?.!]?$/iu,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (match?.[1]) {
      const workerName = cleanWorkerName(match[1]);
      return { workerName: workerName || null, target, kind };
    }
  }

  return { workerName: null, target, kind };
}

export async function parseAccessQuestionIntent(
  text: string,
  model?: string,
): Promise<ParsedAccessQuestion> {
  const fallback = parseAccessQuestion(text);

  try {
    const llm = getLLM();
    const parsed = await llm.completeJSON(
      [
        {
          role: "system",
          content: [
            "Parse a warehouse access diagnostic question into JSON.",
            "The user may write in any language.",
            "",
            "Return kind:",
            "- why_missing: asks why a worker has no access, cannot log in, or is blocked.",
            "- status: asks whether a worker has access or asks to check current access.",
            "- missing: asks what access/permissions are missing.",
            "- blockers: asks what blocks/prevents access provisioning.",
            "- not_access_diagnosis: not about one worker's access diagnosis.",
            "",
            "workerName: exact worker full name or employee id mentioned by the user.",
            "If a worker is named as EMP-022, output EMP-022.",
            "",
            "target: normalize the requested target access when present:",
            "- WMS view/read: {systemCode:'wms', permissionCode:'view_only'}",
            "- WMS receiving: {systemCode:'wms', permissionCode:'receive_inventory'}",
            "- WMS dispatch/outbound: {systemCode:'wms', permissionCode:'dispatch_order'}",
            "- WMS adjustment approval: {systemCode:'wms', permissionCode:'approve_adjustment'}",
            "- floor/badge/entry: {systemCode:'badge', permissionCode:'entry'}",
            "- badge admin: {systemCode:'badge', permissionCode:'admin'}",
            "- email account creation: {systemCode:'email', permissionCode:'create_account'}",
            "- email directory: {systemCode:'email', permissionCode:'view_directory'}",
            "- shared warehouse ops account: {systemCode:'shared_account', permissionCode:'warehouse_ops'}",
            "- if only the system is clear, set permissionCode null.",
            "- if no target is clear, set target null.",
            "",
            "Output JSON only.",
          ].join("\n"),
        },
        { role: "user", content: text.slice(0, 700) },
      ],
      LlmAccessQuestionSchema,
      { temperature: 0, maxTokens: 300, model },
    );

    if (parsed.kind === "not_access_diagnosis") return fallback;

    const workerName = cleanWorkerName(parsed.workerName ?? fallback.workerName ?? "");
    return {
      workerName: workerName || fallback.workerName,
      target: normalizeLlmTarget(parsed, text) ?? fallback.target,
      kind: parsed.kind,
    };
  } catch {
    return fallback;
  }
}

export function buildAccessExplanation(input: {
  question: string;
  target: AccessTarget | null;
  kind?: AccessQuestionKind;
  worker: WorkerRow;
  access: AccessRow[];
  roleAccess: RolePermissionRow[];
  certs: CertificateRow[];
  findings: Finding[];
  pendingProposals: PendingProposalRow[];
}): AccessExplanationResult {
  const kind = input.kind ?? inferQuestionKind(input.question);
  const activeAccess = input.access.filter((a) => a.status === "active");
  const inactiveAccess = input.access.filter((a) => a.status !== "active");
  const activeForTarget = activeAccess.filter((a) => matchesTarget(a, input.target));
  const inactiveForTarget = inactiveAccess.filter((a) => matchesTarget(a, input.target));
  const expectedForTarget = input.roleAccess.filter((a) => matchesTarget(a, input.target));
  const missingExpected = expectedForTarget.filter(
    (expected) => !activeAccess.some((active) => sameAccess(active, expected)),
  );
  const targetLabel = input.target?.label ?? "warehouse system access";
  const reasons: string[] = [];

  appendStatusReasons(reasons, input.worker);
  reasons.push(...certificateReasons(input.worker.roleCode, input.certs));

  if (kind === "missing") {
    appendRoleExpectationReasons(reasons, input.worker, targetLabel, expectedForTarget, missingExpected, inactiveForTarget);
    appendOtherAccessReason(reasons, activeAccess, activeForTarget);
    appendProposalReason(reasons, input.pendingProposals);

    const summary =
      missingExpected.length > 0
        ? `${input.worker.fullName} is missing ${missingExpected.length} role-template ${missingExpected.length === 1 ? "grant" : "grants"} for ${targetLabel}.`
        : `${input.worker.fullName} is not missing role-template ${targetLabel}.`;

    return toResult(input, {
      activeAccess,
      inactiveAccess,
      summary,
      reasons: reasons.length > 0 ? reasons : ["All matching role-template grants are active."],
    });
  }

  if (activeForTarget.length > 0) {
    reasons.unshift(`Active grant found: ${formatAccessList(activeForTarget)}.`);
    if (input.findings.length > 0) {
      reasons.push(`Rule engine still flags: ${input.findings.map((f) => f.title).join("; ")}.`);
    }
    if (missingExpected.length > 0 && kind === "blockers") {
      reasons.push(`Still missing role-template grants: ${formatRoleAccessList(missingExpected)}.`);
    }
    reasons.push(
      "If the worker still cannot use the downstream system, the issue is outside the access grants stored in UserHub, such as login sync, device assignment, or credentials.",
    );
    appendProposalReason(reasons, input.pendingProposals);

    return toResult(input, {
      activeAccess,
      inactiveAccess,
      summary: `${input.worker.fullName} currently has active ${targetLabel}.`,
      reasons,
    });
  }

  appendRoleExpectationReasons(reasons, input.worker, targetLabel, expectedForTarget, missingExpected, inactiveForTarget);
  appendOtherAccessReason(reasons, activeAccess, activeForTarget);
  appendProposalReason(reasons, input.pendingProposals);

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
  if (/\badjustment\b|\bapprove\b|\bapproval\b/i.test(lower)) {
    return target("wms", "approve_adjustment");
  }
  if (/\breceiv(?:e|ing)|\binbound\b|\binventory receive/i.test(lower)) {
    return target("wms", "receive_inventory");
  }
  if (/\bdispatch\b|\boutbound\b|\bship(?:ping)?\b/i.test(lower)) {
    return target("wms", "dispatch_order");
  }
  if (/\bview[-_\s]?only\b|\bread[-_\s]?only\b|\bread\b/i.test(lower)) {
    return target("wms", "view_only");
  }
  if (/\bwms\b|warehouse management/i.test(lower)) {
    return target("wms", null);
  }
  if (/\bbadge\s+admin\b|\bbadge administration\b/i.test(lower)) {
    return target("badge", "admin");
  }
  if (/\bbadge\b|\bfloor\b|\bentry\b|\bdoor\b|\bphysical\b|\u0431\u0435\u0439\u0434\u0436|\u0431\u0430\u0434\u0436|\u043f\u0440\u043e\u043f\u0443\u0441\u043a|\u0441\u043a\u043b\u0430\u0434/iu.test(lower)) {
    return target("badge", "entry");
  }
  if (/\bcreate\b.{0,20}\bemail\b|\bemail account\b/i.test(lower)) {
    return target("email", "create_account");
  }
  if (/\bdirectory\b/i.test(lower)) {
    return target("email", "view_directory");
  }
  if (/\bemail\b|\bmail\b|\u043f\u043e\u0447\u0442/iu.test(lower)) {
    return target("email", null);
  }
  if (/\bshared\b|\bwarehouse[-_\s]?ops\b|\u043e\u0431\u0449/iu.test(lower)) {
    return target("shared_account", "warehouse_ops");
  }
  return null;
}

function inferQuestionKind(text: string): AccessQuestionKind {
  const lower = text.toLowerCase();
  if (/\bblock(?:s|ed|ing)?\b|\bprevent(?:s|ed|ing)?\b|\bwhy\s+can't\b|\u0431\u043b\u043e\u043a|\u043c\u0435\u0448\u0430/iu.test(lower)) {
    return "blockers";
  }
  if (/\bwhat\b|\bwhich\b|\bmissing\b|\black(?:ing)?\b|\u043d\u0435\s+\u0445\u0432\u0430\u0442\u0430\u0435\u0442|\u043a\u0430\u043a\u0438\u0445/iu.test(lower)) {
    return "missing";
  }
  if (/\bdoes\b|\bcan\b|\bcheck\b|\bverify\b|\bstatus\b|\u0435\u0441\u0442\u044c\s+\u043b\u0438|\u043c\u043e\u0436\u0435\u0442\s+\u043b\u0438|\u043f\u0440\u043e\u0432\u0435\u0440/iu.test(lower)) {
    return "status";
  }
  return "why_missing";
}

function normalizeLlmTarget(parsed: LlmAccessQuestion, originalText: string): AccessTarget | null {
  if (!parsed.target?.systemCode) return inferTarget(originalText);
  const permissionCode =
    parsed.target.permissionCode && permissionBelongsToSystem(parsed.target.systemCode, parsed.target.permissionCode)
      ? parsed.target.permissionCode
      : null;
  return target(parsed.target.systemCode, permissionCode, parsed.target.label ?? undefined);
}

function target(systemCode: string, permissionCode: string | null, label?: string): AccessTarget {
  return {
    systemCode,
    permissionCode,
    label: label ?? labelForTarget(systemCode, permissionCode),
  };
}

function labelForTarget(systemCode: string, permissionCode: string | null): string {
  const fullCode = permissionCode ? `${systemCode}.${permissionCode}` : systemCode;
  const labels: Record<string, string> = {
    wms: "WMS access",
    "wms.view_only": "WMS view-only access",
    "wms.receive_inventory": "WMS receiving access",
    "wms.dispatch_order": "WMS dispatch access",
    "wms.approve_adjustment": "WMS adjustment approval access",
    badge: "badge access",
    "badge.entry": "floor badge access",
    "badge.admin": "badge administration access",
    email: "email access",
    "email.create_account": "email account creation access",
    "email.view_directory": "email directory access",
    shared_account: "shared operational account access",
    "shared_account.warehouse_ops": "shared warehouse ops account access",
  };
  return labels[fullCode] ?? `${systemCode}${permissionCode ? `.${permissionCode}` : ""} access`;
}

function permissionBelongsToSystem(systemCode: string, permissionCode: string): boolean {
  const allowed: Record<string, string[]> = {
    wms: ["view_only", "receive_inventory", "dispatch_order", "approve_adjustment"],
    badge: ["entry", "admin"],
    email: ["create_account", "view_directory"],
    shared_account: ["warehouse_ops"],
  };
  return allowed[systemCode]?.includes(permissionCode) ?? false;
}

function cleanWorkerName(value: string): string {
  return value
    .replace(/\s+(?:to|for)\s+(?:wms|badge|email|warehouse management|floor|entry|access|permissions?|login|account).*$/i, "")
    .replace(/\s+(?:wms|badge|email|warehouse management|floor|entry|access|permissions?|login|account)$/i, "")
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^worker\s+/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function matchesTarget(
  item: { systemCode: string; permissionCode: string },
  accessTarget: AccessTarget | null,
): boolean {
  if (!accessTarget) return true;
  if (accessTarget.systemCode && item.systemCode !== accessTarget.systemCode) return false;
  if (accessTarget.permissionCode && item.permissionCode !== accessTarget.permissionCode) return false;
  return true;
}

function sameAccess(
  left: { systemCode: string; permissionCode: string },
  right: { systemCode: string; permissionCode: string },
): boolean {
  return left.systemCode === right.systemCode && left.permissionCode === right.permissionCode;
}

function appendStatusReasons(reasons: string[], worker: WorkerRow): void {
  if (worker.status === "offboarded") {
    reasons.push("Worker status is offboarded, so active access should be removed.");
  } else if (worker.status === "suspended") {
    reasons.push("Worker status is suspended, so access should stay blocked until the worker is reactivated.");
  } else if (worker.status === "pending") {
    reasons.push("Worker status is pending, so the profile is not fully active yet.");
  }
}

function appendRoleExpectationReasons(
  reasons: string[],
  worker: WorkerRow,
  targetLabel: string,
  expectedForTarget: RolePermissionRow[],
  missingExpected: RolePermissionRow[],
  inactiveForTarget: AccessRow[],
): void {
  if (expectedForTarget.length === 0) {
    reasons.push(`${worker.roleName} does not include ${targetLabel} in its default role template.`);
    return;
  }

  if (missingExpected.length > 0) {
    reasons.push(`Missing role-template grants: ${formatRoleAccessList(missingExpected)}.`);
    if (inactiveForTarget.length > 0) {
      reasons.push(`Matching historical grants are not active: ${formatInactiveAccessList(inactiveForTarget)}.`);
    } else {
      reasons.push(
        "Most likely, the role template was not applied to this profile yet, the proposal is still waiting for approval, or access was not provisioned after the worker was created.",
      );
    }
    return;
  }

  reasons.push(`All role-template grants for ${targetLabel} are active.`);
}

function appendOtherAccessReason(
  reasons: string[],
  activeAccess: AccessRow[],
  activeForTarget: AccessRow[],
): void {
  if (activeAccess.length > 0 && activeForTarget.length === 0) {
    reasons.push(`Other active access exists: ${formatAccessList(activeAccess)}.`);
  }
}

function appendProposalReason(
  reasons: string[],
  pendingProposals: PendingProposalRow[],
): void {
  if (pendingProposals.length > 0) {
    reasons.push(
      `There ${pendingProposals.length === 1 ? "is" : "are"} ${pendingProposals.length} pending proposal${pendingProposals.length === 1 ? "" : "s"} for this worker.`,
    );
  }
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

function formatRoleAccessList(rows: RolePermissionRow[]): string {
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
